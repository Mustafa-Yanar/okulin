import { currentOrg, currentBranch } from './tenant';
import { tdb, withScope } from './sqldb';
import { prisma } from './prisma';
import { enqueueNotification } from './push/outbox';

// Web Push altyapısı — VAPID ile tarayıcı push servislerine bildirim gönderir.
//
// Subscription saklama: PushSub tablosu (role, userId, endpoint, keys).
//   Bir kullanıcının birden çok cihazı olabilir (telefon + tablet) → birden çok satır.
//   Endpoint'e göre tekilleştirilir.

// Tarayıcının PushSubscription.toJSON() çıktısı (subscribe akışından gelir).
export interface PushSubscriptionInput {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  requireInteraction?: boolean;
  // true → push'ta jenerik metin (kilit ekranı mahremiyeti); tam metin yalnız
  // NotificationEvent'te (uygulama içi inbox). Devamsızlık/taksit için.
  sensitive?: boolean;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  removed: number;
  error?: string;
}

// Kullanıcıya yeni bir cihaz aboneliği ekler (endpoint'e göre tekilleştirir).
export async function savePushSubscription(role: string, userId: string, subscription: PushSubscriptionInput | null | undefined): Promise<boolean> {
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
    await tdb().pushSub.create({ data: withScope({ role, userId, endpoint: subscription.endpoint, keys: subscription.keys || {} }) });
  }
  return true;
}

// Bir cihaz aboneliğini kaldırır (endpoint'e göre).
export async function removePushSubscription(role: string, userId: string, endpoint: string): Promise<boolean> {
  await tdb().pushSub.deleteMany({ where: { role, userId, endpoint } });
  return true;
}

// Kullanıcının kayıtlı cihaz sayısı.
export async function getSubscriptionCount(role: string, userId: string): Promise<number> {
  return await tdb().pushSub.count({ where: { role, userId } });
}

// Bir kullanıcının TÜM cihazlarına push gönderir — OUTBOX üzerinden.
// Bildirim önce NotificationEvent + NotificationDelivery olarak yazılır (kayıp
// olmaz), anında gönderim denenir, başarısızlar cron'la (notif-dispatch) retry
// edilir. İmza ve dönüş şekli eski davranışla birebir — çağıranlar değişmez.
export async function sendPushToUser(role: string, userId: string, payload: PushPayload): Promise<PushSendResult> {
  try {
    return await enqueueNotification(role, userId, payload);
  } catch (err) {
    // Outbox yazımı bile başarısızsa (DB kesintisi) eski best-effort sözleşmesi korunur
    console.warn('[push] enqueue başarısız:', err instanceof Error ? err.message : err);
    return { sent: 0, failed: 0, removed: 0, error: 'enqueue başarısız' };
  }
}
