import { SignJWT, importPKCS8 } from 'jose';
import webpush from 'web-push';

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

export interface ProviderResult {
  ok: boolean;
  permanent: boolean; // true → hedef ölü, retry ETME (abonelik/token temizlenir)
  providerId?: string;
  error?: string;
}

export type PushTarget =
  | { provider: 'webpush'; target: string; keys: { p256dh: string; auth: string } }
  | { provider: 'fcm'; target: string };

export interface PushNotif {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

let _vapidConfigured = false;
function ensureVapid(): boolean {
  if (_vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);
  _vapidConfigured = true;
  return true;
}

async function deliverWebPush(t: Extract<PushTarget, { provider: 'webpush' }>, n: PushNotif): Promise<ProviderResult> {
  if (!ensureVapid()) return { ok: false, permanent: false, error: 'VAPID yapılandırılmamış' };
  try {
    await webpush.sendNotification({ endpoint: t.target, keys: t.keys }, JSON.stringify(n));
    return { ok: true, permanent: false };
  } catch (err) {
    const code = (err as { statusCode?: number } | null)?.statusCode;
    return {
      ok: false,
      permanent: code === 404 || code === 410, // abonelik ölü
      error: `webpush ${code ?? 'hata'}`,
    };
  }
}

async function deliverFcm(t: Extract<PushTarget, { provider: 'fcm' }>, n: PushNotif): Promise<ProviderResult> {
  const projectId = process.env.FCM_PROJECT_ID;
  const token = await fcmAccessToken();
  if (!projectId || !token) return { ok: false, permanent: false, error: 'FCM yapılandırılmamış' };
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: {
          token: t.target,
          notification: { title: n.title, body: n.body },
          // data alanları string olmak zorunda (FCM v1 kuralı)
          data: n.url ? { url: n.url } : undefined,
          android: { priority: 'HIGH', notification: n.tag ? { tag: n.tag } : undefined },
        },
      }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { name?: string };
      return { ok: true, permanent: false, providerId: data.name };
    }
    // 404 UNREGISTERED / 400 INVALID_ARGUMENT → token ölü/bozuk, retry anlamsız
    return {
      ok: false,
      permanent: res.status === 404 || res.status === 400,
      error: `fcm ${res.status}`,
    };
  } catch (err) {
    return { ok: false, permanent: false, error: `fcm ağ hatası: ${err instanceof Error ? err.message : 'bilinmiyor'}` };
  }
}

export async function deliver(t: PushTarget, n: PushNotif): Promise<ProviderResult> {
  return t.provider === 'webpush' ? deliverWebPush(t, n) : deliverFcm(t, n);
}
