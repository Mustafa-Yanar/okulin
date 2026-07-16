import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'crypto';
import type { Session } from '@/lib/auth';

// Mobil token yardımcıları — DB/Prisma import ETMEZ (sessions.ts bağlar).
//
// Access token: web'den AYRI MOBILE_JWT_SECRET ile imzalanır → yüzey ayrımı
// kriptografik (web verifyToken mobil token'ı imza hatasıyla reddeder). Ayrıca
// aud='okulin-mobile' + iss='okulin' + alg='HS256' zorunlu (defense-in-depth:
// bir verifier gelecekte aud'u unutsa bile secret ayrımı korur).
// Refresh token: opak rastgele değer; DB'de yalnız sha256 hash'i durur.

export const MOBILE_AUDIENCE = 'okulin-mobile';
export const MOBILE_ISSUER = 'okulin';
export const ACCESS_TTL_SEC = 15 * 60; // spec §7: 10-15 dk

// Lazy secret çözümleme (auth.ts getSecret deseni). Prod'da MOBILE_JWT_SECRET
// zorunlu ve web JWT_SECRET'tan FARKLI olmalı (İnceleme: Codex #6 — iki secret
// eşitse kriptografik ayrım kalmaz → fail-closed). Dev'de secret yoksa fallback web
// secret'ından TÜRETİLİR ('-mobile-dev' eki) — asla düz JWT_SECRET değil ki dev'de
// bile mobil token web verifyToken'dan (aud reddine ek) imza olarak da geçemesin.
let _mobileSecret: Uint8Array | undefined;
function getMobileSecret(): Uint8Array {
  if (_mobileSecret) return _mobileSecret;
  const s = process.env.MOBILE_JWT_SECRET;
  const web = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!s) throw new Error('MOBILE_JWT_SECRET tanımlı değil — production ortamında zorunludur.');
    if (s === web) throw new Error('MOBILE_JWT_SECRET, JWT_SECRET ile aynı olamaz — token yüzey ayrımı için farklı olmalı.');
  }
  if (!s) console.warn('[mobile] UYARI: MOBILE_JWT_SECRET yok — türetilmiş dev secret kullanılıyor.');
  _mobileSecret = new TextEncoder().encode(s || (web ? `${web}-mobile-dev` : 'dev-only-mobile-secret-change-me'));
  return _mobileSecret;
}

// sid = MobileSession id — logout/devices/iptal kontrolü oturum satırını bundan bulur.
export interface MobileClaims extends Session {
  sid: string;
}

export async function signMobileAccessToken(payload: Session, sid: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(MOBILE_AUDIENCE)
    .setIssuer(MOBILE_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ACCESS_TTL_SEC)
    .sign(getMobileSecret());
}

export async function verifyMobileAccessToken(token: string): Promise<MobileClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getMobileSecret(), {
      audience: MOBILE_AUDIENCE,
      issuer: MOBILE_ISSUER,
      algorithms: ['HS256'],
    });
    if (typeof (payload as { sid?: unknown }).sid !== 'string') return null;
    return payload as MobileClaims;
  } catch {
    return null;
  }
}

// 32 bayt (256 bit) kriptografik rastgelelik — tahmin edilemez, brute force pratik imkansız.
export function newRefreshToken(): string {
  return 'mrt_' + randomBytes(32).toString('base64url');
}

// DB'de düz token durmaz: sızan DB dump'ı oturum çalmaya yetmez.
export function hashRefreshToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}
