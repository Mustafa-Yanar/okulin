import { SignJWT, importPKCS8 } from 'jose';

// Push sağlayıcı adaptörleri — DB/Prisma import ETMEZ (outbox.ts bağlar).
//
// FCM HTTP v1 kimlik doğrulaması: service-account ile OAuth2 jwt-bearer akışı.
// Google SDK'sı (firebase-admin) KASITLI kullanılmıyor — jose zaten bağımlılık,
// tek scope'luk token için 40 satır yeterli (yeni bağımlılık yok kuralı).
// Env: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (\n kaçışlı tek satır).
// Üçü de yoksa FCM adaptörü no-op (repo deseni).

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Test edilebilir çekirdek (bkz. lib/tenant.ts _scopedClient deseni).
export async function _fcmAssertion(email: string, pkcs8Key: string, nowSec: number): Promise<string> {
  const pk = await importPKCS8(pkcs8Key, 'RS256');
  return new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 3600)
    .sign(pk);
}

let _tokenCache: { token: string; expSec: number } | null = null;

export async function fcmAccessToken(): Promise<string | null> {
  const email = process.env.FCM_CLIENT_EMAIL;
  const key = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) return null; // FCM yapılandırılmamış → no-op

  const nowSec = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expSec - 60 > nowSec) return _tokenCache.token;

  const assertion = await _fcmAssertion(email, key, nowSec);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    console.warn('[push:fcm] OAuth token alınamadı:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  _tokenCache = { token: data.access_token, expSec: nowSec + (data.expires_in || 3600) };
  return data.access_token;
}
