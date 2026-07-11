import { NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/sms';
import { tenantRedis } from '@/lib/tenant';
import { normalizeTurkishMobile } from '@/lib/phone';
import { parseBody, z } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';
import { notifyNewDeviceLogin } from '@/lib/notify';

import { newId as makeId } from '@/lib/id';

const Schema = z.object({
  code: z.string().min(4).max(10),
  username: z.string().min(1).max(200),
  role: z.string().min(1).max(40),
});

const THIRTY_DAYS = 60 * 60 * 24 * 30;

// Kullanıcı adı + rol kategorisinden hesabın telefonu + push kimliğini bul.
// login action ile aynı arama mantığını kullanır. pushRole/pushId, push aboneliğinin
// anahtarladığı (session.role, session.id) ile BİREBİR eşleşmeli (bkz. auth/route.ts):
//   teacher/student/accountant/counselor → legacyId, parent → telefon, director → 'director'.
interface OtpIdentity { phone: string | null; pushRole: string; pushId: string; }

async function getOtpIdentity(username: string, roleCategory: string): Promise<OtpIdentity | null> {
  if (roleCategory === 'management') {
    const dir = await tdb().director.findFirst({ where: { username } });
    // NOT: Director modelinde phone kolonu yok → telefonsuz → OTP'ye hiç girmez (push moot).
    if (dir) return { phone: (dir as typeof dir & { phone?: string | null }).phone || null, pushRole: 'director', pushId: 'director' };
    const acc = await tdb().accountant.findFirst({ where: { username } });
    if (acc) return { phone: acc.phone || null, pushRole: 'accountant', pushId: acc.legacyId };
    const cou = await tdb().counselor.findFirst({ where: { username } });
    if (cou) return { phone: cou.phone || null, pushRole: 'counselor', pushId: cou.legacyId };
    return null;
  }
  if (roleCategory === 'parent') {
    const normPhone = normalizeTurkishMobile(username);
    const p = await tdb().parent.findFirst({ where: { phone: normPhone || username } });
    if (!p) return null;
    const ph = normPhone || username;
    return { phone: ph, pushRole: 'parent', pushId: ph };
  }
  const rec = roleCategory === 'teacher'
    ? await tdb().teacher.findFirst({ where: { username } })
    : await tdb().student.findFirst({ where: { username } });
  if (!rec) return null;
  return { phone: rec.phone || null, pushRole: roleCategory, pushId: rec.legacyId };
}

// Bilinçli withAuth istisnası: OTP login akışının parçası — oturum henüz yok.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const { code, username, role } = parsed.data;

  const identity = await getOtpIdentity(username, role);
  if (!identity?.phone) {
    return NextResponse.json({ error: 'Bu hesap için kayıtlı telefon bulunamadı' }, { status: 400 });
  }
  const phone = identity.phone;

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

  // Güvenlik: hesabın MEVCUT (önceden kayıtlı/abone) cihazlarına "yeni cihaz girişi" push'u.
  // Best-effort — yeni cihaz henüz abone değil, bildirim eski cihazlara ulaşır; login akışını bozmaz.
  await notifyNewDeviceLogin(identity.pushRole, identity.pushId);

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
