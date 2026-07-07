import webpush from 'web-push';
import { currentOrg, currentBranch } from './tenant';
import { tdb } from './sqldb';
import { prisma } from './prisma';

// Web Push altyapısı — VAPID ile tarayıcı push servislerine bildirim gönderir.
//
// Subscription saklama: PushSub tablosu (role, userId, endpoint, keys).
//   Bir kullanıcının birden çok cihazı olabilir (telefon + tablet) → birden çok satır.
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

// Kullanıcıya yeni bir cihaz aboneliği ekler (endpoint'e göre tekilleştirir).
export async function savePushSubscription(role, userId, subscription) {
  if (!subscription?.endpoint) return false;
  // endpoint GLOBAL-unique → arama tenant'sız (ham prisma) olmalı. tdb() ile aransa
  // orgSlug enjekte edilir, başka kurumdaki aynı endpoint bulunamaz → create → P2002.
  // Varsa: cihazı yeni sahibe/kuruma geçir (update). Yoksa: tenant context ile oluştur.
  const existing = await prisma.pushSub.findFirst({ where: { endpoint: subscription.endpoint } });
  if (existing) {
    await prisma.pushSub.update({
      where: { id: existing.id },
      data: { role, userId, keys: subscription.keys || {}, orgSlug: currentOrg(), branch: currentBranch() },
    });
  } else {
    await tdb().pushSub.create({ data: { role, userId, endpoint: subscription.endpoint, keys: subscription.keys || {} } });
  }
  return true;
}

// Bir cihaz aboneliğini kaldırır (endpoint'e göre).
export async function removePushSubscription(role, userId, endpoint) {
  await tdb().pushSub.deleteMany({ where: { role, userId, endpoint } });
  return true;
}

// Kullanıcının kayıtlı cihaz sayısı.
export async function getSubscriptionCount(role, userId) {
  return await tdb().pushSub.count({ where: { role, userId } });
}

// Bir kullanıcının TÜM cihazlarına push gönderir.
// payload: { title, body, url?, tag?, icon?, requireInteraction? }
// Geçersiz/expired abonelikler (404/410) otomatik temizlenir.
// Dönüş: { sent, failed, removed }
export async function sendPushToUser(role, userId, payload) {
  if (!ensureConfigured()) return { sent: 0, failed: 0, removed: 0, error: 'VAPID yok' };
  const body = JSON.stringify(payload);

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
