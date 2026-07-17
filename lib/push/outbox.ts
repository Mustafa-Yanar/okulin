import { prisma } from '@/lib/prisma';
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { newId } from '@/lib/id';
import { isPushMuted, categoryOf } from '@/lib/notify-prefs';
import { renderPush, applyResult } from './policy';
import { deliver, type PushTarget, type PushNotif } from './providers';

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
  notif: PushNotif,
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

  // Kategori tercihi (spec §5.1): kullanıcı bu kategoriyi susturmuşsa PUSH gönderilmez
  // ama NotificationEvent (inbox) YİNE yazılır — kayıp yok. guvenlik hep açık (isPushMuted).
  // Muted → deliveries boş: event oluşur (dispatchStatus:'done'), retry'a düşmez.
  const muted = await isPushMuted(role, userId, payload.tag);

  // 2) Event + delivery satırları TEK transaction'da (outbox garantisi)
  const eventId = newId('ne_');
  const org = currentOrg();
  const branch = currentBranch();
  interface NewDelivery {
    id: string; eventId: string; orgSlug: string; branch: string;
    provider: string; target: string; keys?: object;
  }
  const deliveries: NewDelivery[] = muted ? [] : [
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
        // Görsel meta cron retry'da kaybolmasın (Plan 1 takip notu) — şema değişikliği
        // yok, mevcut Json `data` alanı kullanılır.
        data: payload.icon || payload.requireInteraction
          ? { icon: payload.icon, requireInteraction: payload.requireInteraction }
          : undefined,
        dispatchStatus: 'done', // fan-out bu transaction'da yazıldı
      },
    }),
    ...deliveries.map((data) => prisma.notificationDelivery.create({ data })),
  ]);

  if (deliveries.length === 0) return { sent: 0, failed: 0, removed: 0 }; // cihazsız kullanıcı — event inbox'ta durur

  // 3) Anında gönderim (hızlı yol) — başarısızlar pending kalır, cron toparlar
  const pushText = renderPush(payload);
  const notif: PushNotif = {
    ...pushText,
    url: payload.url,
    tag: payload.tag,
    icon: payload.icon,
    requireInteraction: payload.requireInteraction,
    data: { eventId },
  };
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
  if (due.length === 0) return { processed: 0, sent: 0, retried: 0, dead: 0 };

  // Event toplu ön-yükleme (Plan 3 Minor #2): eski döngü teslimat başına event
  // findUnique atıyordu — tek IN sorgusuna iner (event immutable, ön-yükleme risksiz).
  // SAHİPLİK kontrolü İSE bilinçli olarak per-item ve gönderimden HEMEN ÖNCE kalır
  // (İnceleme Codex #2): sahipliği batch başında okumak, token devri sırasında eski
  // kullanıcının bildirimini yeni sahibe gönderebilecek saniyeler mertebesinde bir
  // TOCTOU penceresi açardı (KVKK). N teslimat = 2N+1 sorgu (3N+'dan iner).
  const events = await prisma.notificationEvent.findMany({
    where: { id: { in: [...new Set(due.map((d) => d.eventId))] } },
  });
  const evById = new Map(events.map((e) => [e.id, e]));

  let sent = 0, retried = 0, dead = 0;
  for (const d of due) {
    const ev = evById.get(d.eventId);
    if (!ev) { // event silinmiş (retention) → teslimatı kapat
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'dead', lastError: 'event yok' } });
      dead++;
      continue;
    }

    // Sahiplik kontrolü (İnceleme Codex #2 — KVKK): teslimat kuyruğa girdikten sonra
    // hedef cihaz logout / hesap silme / token devri ile el değiştirmiş olabilir.
    // NotificationDelivery.target denormalize — körlemesine gönderilirse ESKİ
    // kullanıcının bildirimi cihazın YENİ sahibine gider. Gönderimden hemen önce
    // hedefin hâlâ event'in kullanıcısına bağlı olduğunu doğrula; değilse teslimatı
    // kapat (anında gönderim yolu bu kontrolden muaf — fan-out aynı istekte taze).
    // branch koşulu YENİ (İnceleme Codex #1): aynı kurumun iki şubesinde aynı
    // legacyId olabilir — şube de eşleşmeli (mevcut kodda eksikti, bilinçli sıkılaştırma).
    const stillOwned = d.provider === 'webpush'
      ? await prisma.pushSub.findFirst({
          where: { endpoint: d.target, orgSlug: ev.orgSlug, branch: ev.branch, role: ev.role, userId: ev.userId },
          select: { id: true },
        })
      : await prisma.deviceInstallation.findFirst({
          where: { provider: d.provider, token: d.target, enabled: true, orgSlug: ev.orgSlug, branch: ev.branch, role: ev.role, userId: ev.userId },
          select: { id: true },
        });
    if (!stillOwned) {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: 'dead', lastError: 'hedef sahiplik değişti/kaldırıldı' },
      });
      dead++;
      continue;
    }

    // Kategori tercihi re-check (İnceleme Codex #5): teslimat kuyruğa girdikten sonra
    // kullanıcı kategoriyi susturmuş olabilir. base prisma (dispatchDue tenant-siz; org/branch
    // event'ten). bilinmeyen (null) + guvenlik daima gider (isPushMuted paritesi).
    const cat = categoryOf(ev.tag);
    if (cat && cat !== 'guvenlik') {
      const muted = await prisma.notificationPreference.findFirst({
        where: { orgSlug: ev.orgSlug, branch: ev.branch, role: ev.role, userId: ev.userId, category: cat, enabled: false },
        select: { id: true },
      });
      if (muted) {
        await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'dead', lastError: 'kategori susturuldu' } });
        dead++;
        continue;
      }
    }

    const meta = (ev.data ?? {}) as { icon?: string; requireInteraction?: boolean };
    const pushText = renderPush({ title: ev.title, body: ev.body, sensitive: ev.sensitive });
    const { status } = await deliverOne(d, {
      ...pushText,
      url: ev.url ?? undefined,
      tag: ev.tag ?? undefined,
      icon: meta.icon,
      requireInteraction: meta.requireInteraction,
      data: { eventId: ev.id },
    });
    if (status === 'sent') sent++;
    else if (status === 'dead') dead++;
    else retried++;
  }
  return { processed: due.length, sent, retried, dead };
}
