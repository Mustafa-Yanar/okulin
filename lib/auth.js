import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// JWT secret. Public repo'da duran eski sabit/leaked secret ('etut-takip-secret-key-2024')
// KALDIRILDI. Prod'da JWT_SECRET Vercel env'de tanımlı (zorunlu). Lazy çözümleme: modül
// yüklenirken değil, ilk imzalama/doğrulamada — böylece build kırılmaz.
let _secret;
function getSecret() {
  if (_secret) return _secret;
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.warn('[auth] UYARI: JWT_SECRET tanımlı değil — geçici dev secret kullanılıyor. Production env\'inde tanımlı OLMALI.');
  }
  _secret = new TextEncoder().encode(s || 'dev-only-insecure-secret-change-me');
  return _secret;
}
const COOKIE = 'etut_session';

export async function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

export async function getSession() {
  const jar = cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setSession(res, payload) {
  const token = await signToken(payload);
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
}

export async function clearSession(res) {
  res.cookies.set(COOKIE, '', { maxAge: 0, path: '/' });
}
