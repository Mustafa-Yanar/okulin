import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
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
