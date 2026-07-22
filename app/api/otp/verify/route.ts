import { NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/sms';
import { getClientIp, resetLoginBudget } from '@/lib/ratelimit';
import { tenantRedis } from '@/lib/tenant';
import { parseBody, z } from '@/lib/validate';
import { notifyNewDeviceLogin } from '@/lib/notify';
import { getOtpIdentity } from '@/lib/login';

import { newId as makeId } from '@/lib/id';

const Schema = z.object({
  code: z.string().min(4).max(10),
  username: z.string().min(1).max(200),
  role: z.string().min(1).max(40),
});

const THIRTY_DAYS = 60 * 60 * 24 * 30;

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

  // İkinci faktör kanıtlandı → login kovasını sıfırla. Aksi halde "4 yanlış + doğru şifre
  // (needsOtp, reset yok) + OTP doğru → tekrar login" dizisi son adımda 429 yerdi.
  // Saldırgan OTP onayını üretemez → SMS tetikleme sınırı (5/15dk) bozulmaz.
  await resetLoginBudget(`${getClientIp(req)}:${username.toLowerCase()}`);

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
