import { NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/sms';
import { tenantRedis } from '@/lib/tenant';
import { normalizeTurkishMobile } from '@/lib/phone';
import { parseBody, z } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

import { newId as makeId } from '@/lib/id';

const Schema = z.object({
  code: z.string().min(4).max(10),
  username: z.string().min(1).max(200),
  role: z.string().min(1).max(40),
});

const THIRTY_DAYS = 60 * 60 * 24 * 30;

// Kullanıcı adı + rol kategorisinden gerçek telefon numarasını bul.
// login action ile aynı arama mantığını kullanır.
async function getPhoneForUser(username: string, roleCategory: string): Promise<string | null> {
  if (roleCategory === 'management') {
    const dir = await tdb().director.findFirst({ where: { username } });
    // NOT: Director modelinde phone kolonu yok — eski davranış: daima null'a düşer.
    if (dir) return (dir as typeof dir & { phone?: string | null }).phone || null;
    const acc = await tdb().accountant.findFirst({ where: { username } });
    if (acc) return acc.phone || null;
    const cou = await tdb().counselor.findFirst({ where: { username } });
    if (cou) return cou.phone || null;
    return null;
  }
  if (roleCategory === 'parent') {
    const normPhone = normalizeTurkishMobile(username);
    const p = await tdb().parent.findFirst({ where: { phone: normPhone || username } });
    return p ? (normPhone || username) : null;
  }
  const rec = roleCategory === 'teacher'
    ? await tdb().teacher.findFirst({ where: { username } })
    : await tdb().student.findFirst({ where: { username } });
  return rec ? (rec.phone || null) : null;
}

// Bilinçli withAuth istisnası: OTP login akışının parçası — oturum henüz yok.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const { code, username, role } = parsed.data;

  const phone = await getPhoneForUser(username, role);
  if (!phone) {
    return NextResponse.json({ error: 'Bu hesap için kayıtlı telefon bulunamadı' }, { status: 400 });
  }

  let approved: boolean;
  try {
    approved = await verifyOtp(phone, code);
  } catch {
    return NextResponse.json({ error: 'Doğrulama servisi hatası' }, { status: 500 });
  }

  if (!approved) {
    return NextResponse.json({ error: 'Kod yanlış veya süresi dolmuş' }, { status: 400 });
  }

  // Güvenilir cihaz token'ı oluştur ve Redis'e kaydet (tenant-scoped)
  const deviceToken = makeId() + makeId();
  const redis = tenantRedis();
  const key = `device:${role}:${username}:${deviceToken}`;
  await redis.set(key, { username, role, createdAt: Date.now() }, { ex: THIRTY_DAYS });

  const res = NextResponse.json({ ok: true });
  res.cookies.set('device_token', deviceToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: THIRTY_DAYS,
    path: '/',
  });
  return res;
}
