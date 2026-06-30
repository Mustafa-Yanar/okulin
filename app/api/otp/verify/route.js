import { NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/sms';
import { tenantRedis, rawRedis } from '@/lib/tenant';
import { lookupIndex } from '@/lib/userIndex';
import { normalizeTurkishMobile } from '@/lib/phone';
import { parseBody, z } from '@/lib/validate';
import { isSqlEnabled } from '@/lib/usesql';
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
async function getPhoneForUser(username, roleCategory) {
  if (isSqlEnabled()) {
    if (roleCategory === 'management') {
      const dir = await tdb().director.findFirst({ where: { username } });
      if (dir) return dir.phone || null; // NOT: Director modelinde phone yoksa null
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

  const redis = tenantRedis();

  // Management: director, org_admin, superadmin, accountant, counselor
  if (roleCategory === 'management') {
    // Director
    const director = await redis.get('director');
    if (director && director.username === username) return director.phone || null;

    // Org admin
    const org = rawRedis; // org bilgisi header'dan — tenant redis'te aranır
    // Accountant ve counselor için index kullan
    const candidates = await lookupIndex(username);
    for (const c of candidates) {
      if (c.role === 'accountant' || c.role === 'counselor') {
        const rec = await redis.get(`${c.role}:${c.id}`);
        if (rec && rec.username === username) return rec.phone || null;
      }
    }
    return null;
  }

  // Parent: username = telefon numarası
  if (roleCategory === 'parent') {
    const normPhone = normalizeTurkishMobile(username);
    const candidates = await lookupIndex(username);
    const normCandidates = normPhone && normPhone !== username ? await lookupIndex(normPhone) : [];
    for (const c of [...candidates, ...normCandidates]) {
      if (c.role === 'parent') {
        const rec = await redis.get(`parent:${c.id}`);
        if (rec) return normPhone || username;
      }
    }
    return null;
  }

  // Teacher veya student
  const candidates = await lookupIndex(username);
  for (const c of candidates) {
    if (c.role === roleCategory) {
      const rec = await redis.get(`${c.role}:${c.id}`);
      if (rec && rec.username === username) return rec.phone || null;
    }
  }
  return null;
}

export async function POST(req) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const { code, username, role } = parsed.data;

  const phone = await getPhoneForUser(username, role);
  if (!phone) {
    return NextResponse.json({ error: 'Bu hesap için kayıtlı telefon bulunamadı' }, { status: 400 });
  }

  let approved;
  try {
    approved = await verifyOtp(phone, code);
  } catch (err) {
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
