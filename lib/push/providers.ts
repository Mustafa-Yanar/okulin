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
let _inflight: Promise<string | null> | null = null;

export async function fcmAccessToken(): Promise<string | null> {
  const email = process.env.FCM_CLIENT_EMAIL;
  const key = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) return null; // FCM yapılandırılmamış → no-op

  const nowSec = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expSec - 60 > nowSec) return _tokenCache.token;

  // Eşzamanlı fan-out (N cihaz = N deliverFcm) tek OAuth çağrısını paylaşsın —
  // de-dup'sız Google'a N istek giderdi (Plan 1 takip notu).
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
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
      // Bozuk gövde (proxy/ağ arızası) fırlatmasın (Plan 1 takip notu: json guard).
      const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
      if (!data?.access_token) return null;
      _tokenCache = { token: data.access_token, expSec: nowSec + (data.expires_in || 3600) };
      return data.access_token;
    } catch (err) {
      // Ağ/imza hatası fan-out veya cron döngüsünü FIRLATMASIN (İnceleme Codex #12) —
      // teslimat 'FCM yapılandırılmamış/erişilemedi' geçici hatasıyla retry'a düşer.
      console.warn('[push:fcm] OAuth ağ hatası:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
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
  icon?: string; // web-push payload'ına girer (sw.js okur); FCM'de kullanılmaz
  data?: Record<string, string>; // FCM data alanları (string zorunlu) — eventId vb.
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
  try {
    const token = await fcmAccessToken();
    if (!projectId || !token) return { ok: false, permanent: false, error: 'FCM yapılandırılmamış' };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: {
          token: t.target,
          notification: { title: n.title, body: n.body },
          // data alanları string olmak zorunda (FCM v1 kuralı). eventId: bildirim
          // merkezi eşleşmesi + dedupe hazırlığı (Plan 4 native routing okur).
          data: { ...(n.url ? { url: n.url } : {}), ...(n.data ?? {}) },
          android: {
            priority: 'HIGH',
            // İstemci 'default' kanalını oluşturur (mobile/src/push.ts) — Android 8+
            // kanal belirtilmezse bildirim "Miscellaneous"a düşer.
            notification: { channel_id: 'default', ...(n.tag ? { tag: n.tag } : {}) },
          },
        },
      }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { name?: string };
      return { ok: true, permanent: false, providerId: data.name };
    }
    // Kalıcılık kararı (İnceleme Codex #12): 404 = UNREGISTERED (token ölü). 400 tek
    // başına kalıcı DEĞİL — bozuk payload (bizim kod hatamız) da 400 döndürür ve tüm
    // cihazları yanlışlıkla disable ederdi. 400'de yalnız FCM error.details içinde
    // errorCode='UNREGISTERED' varsa kalıcı say.
    let permanent = res.status === 404;
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { error?: { details?: { errorCode?: string }[] } } | null;
      permanent = !!body?.error?.details?.some((d) => d.errorCode === 'UNREGISTERED');
    }
    return { ok: false, permanent, error: `fcm ${res.status}` };
  } catch (err) {
    return { ok: false, permanent: false, error: `fcm ağ hatası: ${err instanceof Error ? err.message : 'bilinmiyor'}` };
  }
}

export async function deliver(t: PushTarget, n: PushNotif): Promise<ProviderResult> {
  return t.provider === 'webpush' ? deliverWebPush(t, n) : deliverFcm(t, n);
}
