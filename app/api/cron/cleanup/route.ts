import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { retentionCutoffWeekKey } from '@/lib/etut/weeks';
import { isCronAuthorized } from '@/lib/cron-auth';

// Günlük saklama (retention) temizliği cron'u.
// Redis'te AuditLog/ErrLog kayıtlarının TTL'i vardı (audit 90g, errlog 30g); SQL'e
// göçünce TTL kalktı → tablolar sınırsız birikiyordu. Bu cron eski kayıtları siler.
//
// tdb() DEĞİL, base `prisma`: retention zaman-bazlı GLOBAL bir bakım işi, tenant
// verisi değil. tdb() orgSlug/branch'e scope'lar → yalnız DEFAULT_ORG temizlenirdi;
// biz TÜM kurumların (testkurs + akyazicozum + ...) eski loglarını silmek istiyoruz.
// Silme yalnız `at < cutoff` zamanına bakar, kurum ayrımı yapmaz — kasıtlı.
//
// Bilinçli withAuth istisnası: cron ucu — oturum yok, CRON_SECRET Bearer doğrulanır.

export const runtime = 'nodejs'; // Prisma Node çalışma zamanı gerektirir

const AUDIT_RETENTION_DAYS = 90; // lib/audit.ts eski Redis TTL'i
const ERRLOG_RETENTION_DAYS = 30; // lib/errlog.ts eski Redis TTL'i
// NotifLog = "bir kez bildir" idempotency kaydı (att:<date>:<sid>, deneme:<examId>:<phone>).
// dedupeKey geçmiş tarihe/sınava bağlı → süre geçince bir daha kontrol edilmez, ölü ağırlık.
// 90 gün fazlasıyla güvenli (aynı gün/sınav 90 gün sonra tekrar bildirilmez).
const NOTIFLOG_RETENTION_DAYS = 90;
// Bildirim inbox kayıtları: 90 gün sonra kullanıcı için de bayat.
const NOTIF_EVENT_RETENTION_DAYS = 90;
// Sonuçlanmış (sent/dead) teslimat satırları: 30 gün hata ayıklama penceresi.
const NOTIF_DELIVERY_RETENTION_DAYS = 30;
// Kapanmış (revoke/expired) mobil oturum kayıtları: 30 gün denetim penceresi, sonra sil.
const MOBILE_SESSION_RETENTION_DAYS = 30;
// Ders programı hücreleri (SlotBooking): haftalık rollover her hafta YENİ satırlar üretir
// (~700 satır/hafta, tüm kurumlar) ama eskisini SİLMEZ → tablo sınırsız büyür (denetim B11).
// Karar (Mustafa, 2026-07-12): 14 ay geriye tut — bir öğretim sezonu + pay; müdürün yıl sonu
// öğretmen/ders raporu için tam bir sezonun hücreleri SQL'de kalmalı.
// Zaman boyutu Date DEĞİL weekKey ('YYYY-Www') olduğundan cutoff() burada kullanılamaz;
// anahtar sıfır-dolgulu olduğu için string `lt` kıyası kronolojiktir (bkz. retentionCutoffWeekKey).
// Etki: Attendance'ın kendi retention'ı yok → 14 aydan eski devamsızlık kayıtları
// /api/attendance/student'ta slotLabel/branch'ı boş görünür (matchedSlot null → '' fallback,
// çökme yok). Kayıt+durum+tarih korunur, yalnız "kaçıncı ders" etiketi kaybolur — kabul edilen ödün.
// DİKKAT: bu desen EtutReservation'a OLDUĞU GİBİ taşınamaz — orada RECURRING satırları
// weekKey='*' taşır ve '*' < '2' olduğundan naif bir `lt` TÜM tekrarlayan rezervasyonları siler.
const SLOT_BOOKING_RETENTION_WEEKS = 61; // 14 ay ≈ 60.9 hafta

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Bir tabloyu cutoff'tan eski kayıtlardan best-effort temizler (hatası diğerlerini düşürmez).
async function purge(label: string, fn: () => Promise<{ count: number }>): Promise<number> {
  try {
    const r = await fn();
    return r.count;
  } catch (e) {
    console.warn(`[cleanup] ${label} temizliği başarısız:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auditDeleted = await purge('auditLog',
    () => prisma.auditLog.deleteMany({ where: { at: { lt: cutoff(AUDIT_RETENTION_DAYS) } } }));
  const errDeleted = await purge('errLog',
    () => prisma.errLog.deleteMany({ where: { at: { lt: cutoff(ERRLOG_RETENTION_DAYS) } } }));
  const notifDeleted = await purge('notifLog',
    () => prisma.notifLog.deleteMany({ where: { at: { lt: cutoff(NOTIFLOG_RETENTION_DAYS) } } }));
  const eventDeleted = await purge('notificationEvent',
    () => prisma.notificationEvent.deleteMany({ where: { createdAt: { lt: cutoff(NOTIF_EVENT_RETENTION_DAYS) } } }));
  const deliveryDeleted = await purge('notificationDelivery',
    () => prisma.notificationDelivery.deleteMany({
      where: { status: { not: 'pending' }, updatedAt: { lt: cutoff(NOTIF_DELIVERY_RETENTION_DAYS) } },
    }));
  const mobileSessionDeleted = await purge('mobileSession',
    () => prisma.mobileSession.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: cutoff(MOBILE_SESSION_RETENTION_DAYS) } },
          { expiresAt: { lt: cutoff(MOBILE_SESSION_RETENTION_DAYS) } },
        ],
      },
    }));

  const slotBookingCutoff = retentionCutoffWeekKey(SLOT_BOOKING_RETENTION_WEEKS);
  const slotBookingDeleted = await purge('slotBooking',
    () => prisma.slotBooking.deleteMany({ where: { weekKey: { lt: slotBookingCutoff } } }));

  return NextResponse.json({
    ok: true, auditDeleted, errDeleted, notifDeleted, eventDeleted, deliveryDeleted,
    mobileSessionDeleted, slotBookingDeleted, slotBookingCutoff,
  });
}
