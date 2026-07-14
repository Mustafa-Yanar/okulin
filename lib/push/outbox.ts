import { prisma } from '@/lib/prisma';
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { newId } from '@/lib/id';
import { renderPush, applyResult } from './policy';
import { deliver, type PushTarget } from './providers';

// Outbox: bildirim = önce DB kaydı (event + cihaz başına delivery), sonra gönderim.
// Eski kusur: lib/push.ts doğrudan gönderir, hata yutulurdu → bildirim kaybolurdu.
// Yeni akış: enqueue (transaction) → anında dispatch denemesi (hızlı yol) →
// başarısızlar cron'la (notif-dispatch) backoff'lu retry. Kayıp yok.

export interface OutboxPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  requireInteraction?: boolean;
  sensitive?: boolean;
}

export interface OutboxSendResult {
  sent: number;
  failed: number;
  removed: number;
  error?: string;
}

interface DeliveryRow {
  id: string;
  provider: string;
  target: string;
  keys: unknown;
  attempts: number;
}

function toTarget(d: DeliveryRow): PushTarget {
  return d.provider === 'webpush'
    ? { provider: 'webpush', target: d.target, keys: d.keys as { p256dh: string; auth: string } }
    : { provider: 'fcm', target: d.target };
}

// Tek bir delivery satırını gönderir ve sonucunu DB'ye işler.
// Kalıcı ölümde kaynak aboneliği de temizler; resourceRemoved bunu yaptığında true
// (removed sayacı bu dönüşe bağlıdır — durum eşitliğinden türetilmez).
async function deliverOne(
  d: DeliveryRow,
  notif: { title: string; body: string; url?: string; tag?: string; requireInteraction?: boolean },
): Promise<{ status: 'sent' | 'pending' | 'dead'; resourceRemoved: boolean }> {
  const attempts = d.attempts + 1;
  const r = await deliver(toTarget(d), notif);
  const outcome = applyResult(attempts, r, new Date());
  await prisma.notificationDelivery.update({
    where: { id: d.id },
    data: {
      status: outcome.status,
      attempts,
      nextAttemptAt: outcome.nextAttemptAt ?? new Date(),
      providerId: r.providerId ?? undefined,
      lastError: r.ok ? null : (r.error ?? 'bilinmeyen hata'),
    },
  });
  let resourceRemoved = false;
  if (outcome.status === 'dead' && r.permanent) {
    // Ölü hedefi kaynak tablodan da düşür (eski sendPushToUser 404/410 temizliği)
    if (d.provider === 'webpush') {
      await prisma.pushSub.deleteMany({ where: { endpoint: d.target } });
    } else {
      await prisma.deviceInstallation.updateMany({ where: { token: d.target }, data: { enabled: false } });
    }
    resourceRemoved = true;
  }
  return { status: outcome.status, resourceRemoved };
}

// Kullanıcının cihazlarına bildirim kuyruklar + anında göndermeyi dener.
// İstek/tenant bağlamında çağrılır (tdb doğru kuruma yönlenir).
// Dönüş şekli eski sendPushToUser ile aynı: { sent, failed, removed }.
export async function enqueueNotification(role: string, userId: string, payload: OutboxPayload): Promise<OutboxSendResult> {
  // 1) Cihaz fan-out: web abonelikleri + native kurulumlar (bugün boş — Plan 3 doldurur)
  const webSubs = await tdb().pushSub.findMany({ where: { role, userId } });
  const devices = await tdb().deviceInstallation.findMany({ where: { role, userId, enabled: true } });

  // 2) Event + delivery satırları TEK transaction'da (outbox garantisi)
  const eventId = newId('ne_');
  const org = currentOrg();
  const branch = currentBranch();
  interface NewDelivery {
    id: string; eventId: string; orgSlug: string; branch: string;
    provider: string; target: string; keys?: object;
  }
  const deliveries: NewDelivery[] = [
    ...webSubs.map((s) => ({
      id: newId('nd_'), eventId, orgSlug: org, branch,
      provider: 'webpush', target: s.endpoint, keys: (s.keys ?? {}) as object,
    })),
    ...devices.map((di) => ({
      id: newId('nd_'), eventId, orgSlug: org, branch,
      provider: di.provider, target: di.token,
    })),
  ];
  // DİKKAT: transaction'da base prisma kullanılır — $extends'li tdb() promise'i
  // base $transaction'a karıştırılamaz (runtime "Transaction API error").
  // withScope runtime'da alan EKLEMEZ (salt tip cast'i) → orgSlug/branch elle yazılır.
  await prisma.$transaction([
    prisma.notificationEvent.create({
      data: {
        id: eventId,
        orgSlug: org,
        branch,
        role, userId,
        title: payload.title, body: payload.body,
        url: payload.url, tag: payload.tag,
        sensitive: payload.sensitive ?? false,
        dispatchStatus: 'done', // fan-out bu transaction'da yazıldı
      },
    }),
    ...deliveries.map((data) => prisma.notificationDelivery.create({ data })),
  ]);

  if (deliveries.length === 0) return { sent: 0, failed: 0, removed: 0 }; // cihazsız kullanıcı — event inbox'ta durur

  // 3) Anında gönderim (hızlı yol) — başarısızlar pending kalır, cron toparlar
  const pushText = renderPush(payload);
  const notif = { ...pushText, url: payload.url, tag: payload.tag, requireInteraction: payload.requireInteraction };
  let sent = 0, failed = 0, removed = 0;
  for (const d of deliveries) {
    const { status, resourceRemoved } = await deliverOne({ ...d, keys: d.keys ?? {}, attempts: 0 }, notif);
    if (status === 'sent') sent++;
    else failed++;
    if (resourceRemoved) removed++;
  }
  return { sent, failed, removed };
}

// Cron retry: vadesi gelmiş pending teslimatları global tarar (tüm kurumlar —
// kasıtlı base prisma, bkz. cron/cleanup kalıbı; hedef token satırda gömülü,
// tenant bağlamı gerekmez). Event'in push metnini yeniden üretir.
export async function dispatchDue(limit = 200): Promise<{ processed: number; sent: number; retried: number; dead: number }> {
  const due = await prisma.notificationDelivery.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
  let sent = 0, retried = 0, dead = 0;
  for (const d of due) {
    const ev = await prisma.notificationEvent.findUnique({ where: { id: d.eventId } });
    if (!ev) { // event silinmiş (retention) → teslimatı kapat
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'dead', lastError: 'event yok' } });
      dead++;
      continue;
    }
    const pushText = renderPush({ title: ev.title, body: ev.body, sensitive: ev.sensitive });
    const { status } = await deliverOne(d, { ...pushText, url: ev.url ?? undefined, tag: ev.tag ?? undefined });
    if (status === 'sent') sent++;
    else if (status === 'dead') dead++;
    else retried++;
  }
  return { processed: due.length, sent, retried, dead };
}
