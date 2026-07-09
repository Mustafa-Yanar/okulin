import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { DEFAULT_ORG } from './org';

// İstekteki kurum (middleware'in koyduğu x-org; yoksa varsayılan).
function currentOrg() {
  try {
    return headers().get('x-org') || DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG;
  }
}

// İstekteki şube (middleware'in koyduğu x-branch; yoksa 'main').
function currentBranch() {
  try {
    return headers().get('x-branch') || 'main';
  } catch {
    return 'main';
  }
}

// Operasyonel yönetici: müdür VEYA rehber. Rehber = müdür yetkileri EKSİ muhasebe
// (öğretmen/program/öğrenci/deneme/yoklama/optik/rehberlik). Finans route'ları bunu
// KULLANMAZ — orada director||accountant ayrı kontrol edilir (rehber finansı görmez).
export function isManager(session) {
  return !!session && (session.role === 'director' || session.role === 'counselor');
}

// Bu oturum yönetimsel bir MUTASYON yapabilir mi? (öğrenci/öğretmen/program/slot/
// kaynak ekle-sil-düzenle). isManager OKUMA için; bu YAZMA için. Müdür her zaman
// yazabilir. Rehber yalnız kurum config.permissions.counselor.readOnly KAPALI iken
// yazabilir — müdür rehberi "salt-okunur" yapmışsa false döner.
//
// İSTİSNA: rehberin ÇEKİRDEK işi (rehberlik notu, deneme/optik, hedef) bu kontrolden
// GEÇMEZ — o route'lar isManager kullanmaya devam eder. Bu yalnız "yönetimsel" write
// route'larında çağrılır. Async — config DB'den okunur (eksikse default: yazabilir).
//
// lib/config.js'i lazy import ederiz: auth.js çok yerde import edilir, config zinciri
// (prisma/sqldb) build-time'da yüklenmesin diye fonksiyon içinde require yapılır.
export async function canManage(session) {
  if (!isManager(session)) return false;
  if (session.role === 'director') return true;
  // counselor: config'e bak.
  const { getOrgConfig } = await import('./config');
  const perms = await getOrgConfig('permissions');
  return !perms?.counselor?.readOnly;
}

// ── Route yetki wrapper'ı ─────────────────────────────────────────────────────
// Her API route'unda tekrarlayan `getSession` + 401 + rol/yetki + 403 guard'ını
// TEK kaynağa indirir. Handler'ı sarar; guard geçerse session'ı 3. argüman olarak
// enjekte eder → handler(req, ctx, session). Böylece "yeni route'ta yetki kontrolü
// unutma" riski kapanır ve 401/403 gövde formatı tek yerde tutarlı kalır.
//
// Kullanım:
//   export const POST = withAuth(async (req, ctx, session) => { ... });        // yalnız giriş
//   export const POST = withAuth('manage', async (req, ctx, session) => {...}); // yönetim yazma yetkisi
//   export const POST = withAuth(['director','accountant'], handler);           // belirli roller
//
// mode:
//   'auth'   (varsayılan) → yalnız oturum şart (401 yoksa)
//   'manage' → canManage(session) (müdür daima, rehber config'e göre) — 403
//   dizi     → session.role listede mi — 403
//   fn       → özel async predicate (session) => bool — 403
export function withAuth(modeOrHandler, maybeHandler) {
  const handler = maybeHandler || modeOrHandler;
  const mode = maybeHandler ? modeOrHandler : 'auth';
  return async (req, ctx) => {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
    let ok = true;
    if (mode === 'manage') ok = await canManage(session);
    else if (Array.isArray(mode)) ok = mode.includes(session.role);
    else if (typeof mode === 'function') ok = await mode(session);
    // mode === 'auth' → giriş yeterli
    if (!ok) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    return handler(req, ctx, session);
  };
}

// Karışıklık-önleyici alfabe — 0/O/o ve 1/I/l çıkarıldı, öğrenci el yazısından okurken
// "sıfır mı O mu" sorusunu sormayacak. ~57 karakter (55 sembol).
const PWD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

// Kriptografik güvenli rastgele şifre. crypto.randomBytes kullanır (Math.random DEĞİL).
// 8 karakter × 55 alfabe = ~46 bit entropi, brute force pratik imkansız (rate limit ile).
export function randomPassword(length = 8) {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += PWD_ALPHABET[bytes[i] % PWD_ALPHABET.length];
  }
  return result;
}

// Yeni hesap (öğretmen/öğrenci/rehber/muhasebeci) için ilk şifre kuralı — TEK kaynak.
// Sıra: elle girilen şifre → telefon (kanonik) → sabit "12345678".
// Hangi yol olursa olsun mustChangePassword:true ile birlikte kullanılmalı (ilk
// girişte zorunlu değişim). Müdür bu kurala DAHİL DEĞİL (ayrı yönetilir).
export const FALLBACK_PASSWORD = '12345678';
export function initialPassword(manualPassword, normalizedPhone) {
  const manual = (manualPassword || '').trim();
  if (manual) return manual;
  if (normalizedPhone) return normalizedPhone;
  return FALLBACK_PASSWORD;
}

// JWT secret. Public repo'da duran eski sabit/leaked secret ('etut-takip-secret-key-2024')
// KALDIRILDI. Prod'da JWT_SECRET Vercel env'de tanımlı (zorunlu). Lazy çözümleme: modül
// yüklenirken değil, ilk imzalama/doğrulamada — böylece build kırılmaz.
let _secret;
function getSecret() {
  if (_secret) return _secret;
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET tanımlı değil — production ortamında zorunludur.');
    }
    console.warn('[auth] UYARI: JWT_SECRET tanımlı değil — geçici dev secret kullanılıyor.');
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
  const session = await verifyToken(token);
  if (!session) return null;
  // Superadmin global rol — org kısıtı YOK (tüm kurumları yönetir).
  if (session.role === 'superadmin') return session;
  // Org_admin: kendi org'una kilitli ama branch kısıtı YOK ('__hq__' özel değer).
  if (session.role === 'org_admin') {
    if (session.org && session.org !== currentOrg()) return null;
    return session;
  }
  // Kurum doğrulaması: token'ın org'u isteğin org'uyla eşleşmeli — başka kurumun
  // subdomain'inde cozum cookie'si kullanılamaz (çapraz-kurum koruması, 2. kat).
  // (org'suz eski token'lar geçişte reddedilmez; reset sonrası herkes org'lu olur.)
  if (session.org && session.org !== currentOrg()) return null;
  // Şube doğrulaması: bir şubenin token'ı başka şubenin subdomain'inde kullanılamaz
  // (çapraz-şube koruması). '__hq__' (org_admin) yukarıda döndü; şubesiz eski token muaf.
  if (session.branch && session.branch !== currentBranch()) return null;
  return session;
}

export async function setSession(res, payload) {
  // Superadmin: '__super__'. Org_admin: '__hq__' branch. Diğerleri: currentOrg() + istek şubesi.
  const org = payload.role === 'superadmin' ? '__super__' : currentOrg();
  const branch = payload.role === 'org_admin' ? '__hq__' : (payload.branch || currentBranch());
  const token = await signToken({ ...payload, org, branch });
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

// Bir oturum, verilen öğrencinin verisini OKUYABİLİR mi?
// - müdür/öğretmen: tüm öğrenciler
// - öğrenci: yalnız kendisi
// - veli: yalnız kendi çocukları (session.children içindeki id'ler)
// (muhasebeci buraya dahil DEĞİL — finance route'u kendi içinde izin verir)
export function canReadStudent(session, studentId) {
  if (!session || !studentId) return false;
  if (session.role === 'director' || session.role === 'teacher') return true;
  if (session.role === 'student') return session.id === studentId;
  if (session.role === 'parent') {
    return Array.isArray(session.children) && session.children.some(c => (c.id || c) === studentId);
  }
  return false;
}
