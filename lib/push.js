import webpush from 'web-push';
import { tenantRedis } from './tenant';
import { useSql } from './usesql';
import { tdb } from './sqldb';

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
  if (useSql()) {
    // endpoint global-unique → varsa güncelle (kapsam-içi), yoksa oluştur.
    const existing = await tdb().pushSub.findFirst({ where: { endpoint: subscription.endpoint } });
    if (existing) await tdb().pushSub.update({ where: { id: existing.id }, data: { role, userId, keys: subscription.keys || {} } });
    else await tdb().pushSub.create({ data: { role, userId, endpoint: subscription.endpoint, keys: subscription.keys || {} } });
    return true;
  }
  const redis = tenantRedis();
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
  if (useSql()) {
    await tdb().pushSub.deleteMany({ where: { role, userId, endpoint } });
    return true;
  }
  const redis = tenantRedis();
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
  if (useSql()) {
    return await tdb().pushSub.count({ where: { role, userId } });
  }
  const redis = tenantRedis();
  const existing = (await redis.get(subsKey(role, userId))) || [];
  return Array.isArray(existing) ? existing.length : 0;
}

// Bir kullanıcının TÜM cihazlarına push gönderir.
// payload: { title, body, url?, tag?, icon?, requireInteraction? }
// Geçersiz/expired abonelikler (404/410) otomatik temizlenir.
// Dönüş: { sent, failed, removed }
export async function sendPushToUser(role, userId, payload) {
  if (!ensureConfigured()) return { sent: 0, failed: 0, removed: 0, error: 'VAPID yok' };
  const body = JSON.stringify(payload);

  if (useSql()) {
    const rows = await tdb().pushSub.findMany({ where: { role, userId } });
    if (rows.length === 0) return { sent: 0, failed: 0, removed: 0 };
    let sent = 0, failed = 0;
    const toRemove = [];
    for (const row of rows) {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: row.keys }, body);
        sent++;
      } catch (err) {
        failed++;
        const code = err?.statusCode;
        if (code === 404 || code === 410) toRemove.push(row.id); // geçersiz → düşür
      }
    }
    if (toRemove.length > 0) await tdb().pushSub.deleteMany({ where: { id: { in: toRemove } } });
    return { sent, failed, removed: toRemove.length };
  }

  const redis = tenantRedis();
  const key = subsKey(role, userId);
  const existing = (await redis.get(key)) || [];
  const list = Array.isArray(existing) ? existing : [];
  if (list.length === 0) return { sent: 0, failed: 0, removed: 0 };

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
