import webpush from 'web-push';
import redis from './redis';

// Web Push altyapısı — VAPID ile tarayıcı push servislerine bildirim gönderir.
//
// Subscription saklama: push_subs:<role>:<userId> = [subscription, ...]
//   Bir kullanıcının birden çok cihazı olabilir (telefon + tablet) → dizi.
//   Endpoint'e göre tekilleştirilir.

let _configured = false;
function ensureConfigured() {
  if (_configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) {
    console.warn('[push] VAPID anahtarları tanımlı değil — push gönderilemez');
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  _configured = true;
  return true;
}

function subsKey(role, userId) {
  return `push_subs:${role}:${userId}`;
}

// Kullanıcıya yeni bir cihaz aboneliği ekler (endpoint'e göre tekilleştirir).
export async function savePushSubscription(role, userId, subscription) {
  if (!subscription?.endpoint) return false;
  const key = subsKey(role, userId);
  const existing = (await redis.get(key)) || [];
  const list = Array.isArray(existing) ? existing : [];
  // Aynı endpoint varsa güncelle, yoksa ekle
  const filtered = list.filter(s => s.endpoint !== subscription.endpoint);
  filtered.push(subscription);
  await redis.set(key, filtered);
  return true;
}

// Bir cihaz aboneliğini kaldırır (endpoint'e göre).
export async function removePushSubscription(role, userId, endpoint) {
  const key = subsKey(role, userId);
  const existing = (await redis.get(key)) || [];
  const list = Array.isArray(existing) ? existing : [];
  const filtered = list.filter(s => s.endpoint !== endpoint);
  if (filtered.length > 0) await redis.set(key, filtered);
  else await redis.del(key);
  return true;
}

// Kullanıcının kayıtlı cihaz sayısı.
export async function getSubscriptionCount(role, userId) {
  const existing = (await redis.get(subsKey(role, userId))) || [];
  return Array.isArray(existing) ? existing.length : 0;
}

// Bir kullanıcının TÜM cihazlarına push gönderir.
// payload: { title, body, url?, tag?, icon?, requireInteraction? }
// Geçersiz/expired abonelikler (404/410) otomatik temizlenir.
// Dönüş: { sent, failed, removed }
export async function sendPushToUser(role, userId, payload) {
  if (!ensureConfigured()) return { sent: 0, failed: 0, removed: 0, error: 'VAPID yok' };
  const key = subsKey(role, userId);
  const existing = (await redis.get(key)) || [];
  const list = Array.isArray(existing) ? existing : [];
  if (list.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0;
  const stillValid = [];

  for (const sub of list) {
    try {
      await webpush.sendNotification(sub, body);
      sent++;
      stillValid.push(sub);
    } catch (err) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        // Abonelik artık geçersiz — listeden düşür
        failed++;
      } else {
        // Geçici hata olabilir — aboneliği koru
        failed++;
        stillValid.push(sub);
      }
    }
  }

  const removed = list.length - stillValid.length;
  if (removed > 0) {
    if (stillValid.length > 0) await redis.set(key, stillValid);
    else await redis.del(key);
  }

  return { sent, failed, removed };
}
