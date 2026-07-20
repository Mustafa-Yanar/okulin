// EtutReservation veri katmanı (spec §3.2/§3.3). İş kuralları BURADA DEĞİL —
// Faz 2b bookEtut komut servisi kuralları uygular, buradaki fonksiyonlar yalnız
// tutarlı okuma/yazma sağlar. Tek-satır upsert stratejisi: (sablonId, weekKey)
// başına en fazla 1 satır; yeniden rezervasyon UPDATE'tir (unique ihlali imkansız);
// tam tarihçe AuditLog'a yazılır (Faz 2b).
import { tdb } from '@/lib/sqldb';
import type { EtutReservation, Prisma } from '@prisma/client';

export const RECURRING_WEEKKEY = '*';

type Db = ReturnType<typeof tdb> | Prisma.TransactionClient;

// Saf çözümleyici: sablonId → o haftanın EFEKTİF rezervasyonu.
// WEEK satırı recurring'i EZER; CANCELLED WEEK = tombstone (hafta boş);
// RECURRING yalnız ACTIVE + effectiveFromWeek <= weekKey iken görünür.
// ISO "YYYY-Www" (W her zaman 2 hane) string sıralaması kronolojiyle uyumludur.
export function resolveEffective(rows: EtutReservation[], weekKey: string): Map<string, EtutReservation> {
  const out = new Map<string, EtutReservation>();
  const tombstoned = new Set<string>();
  for (const r of rows) {
    if (r.weekKey !== weekKey) continue; // önce gerçek-hafta satırları
    if (r.status === 'ACTIVE') out.set(r.sablonId, r);
    else tombstoned.add(r.sablonId);
  }
  for (const r of rows) {
    if (r.weekKey !== RECURRING_WEEKKEY || r.scope !== 'RECURRING') continue;
    if (out.has(r.sablonId) || tombstoned.has(r.sablonId)) continue;
    if (r.status !== 'ACTIVE') continue;
    if (!r.effectiveFromWeek || r.effectiveFromWeek > weekKey) continue;
    out.set(r.sablonId, r);
  }
  return out;
}

// Bir haftanın TÜM ilgili satırları (o hafta + recurring) — tek sorgu (N+1 yok).
// orgSlug/branch AÇIK — $extends findMany'e enjekte etse de çıplak tx ile sızıntıyı yapısal olarak engeller.
export async function getWeekReservations(db: Db, orgSlug: string, branch: string, weekKey: string): Promise<EtutReservation[]> {
  return (db as ReturnType<typeof tdb>).etutReservation.findMany({
    where: { orgSlug, branch, OR: [{ weekKey }, { weekKey: RECURRING_WEEKKEY }] },
  });
}

export interface ReservationWrite {
  orgSlug: string; branch: string;
  sablonId: string; teacherId: string;
  studentId: string; studentName: string; studentCls: string; dersBranch: string;
  bookedByRole: string; bookedById: string;
  dayIndex: number; startsAt: string; endsAt: string;
}

// Tek-haftalık rezervasyon — UPSERT: mevcut satır (ACTIVE veya CANCELLED tombstone)
// yeni öğrenciyle ACTIVE'e çevrilir; cancelled* alanları temizlenir.
export async function upsertWeekReservation(db: Db, weekKey: string, w: ReservationWrite): Promise<EtutReservation> {
  const data = {
    ...w, scope: 'WEEK' as const, status: 'ACTIVE' as const, weekKey,
    effectiveFromWeek: null, bookedAt: new Date(),
    cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  };
  return (db as ReturnType<typeof tdb>).etutReservation.upsert({
    where: { orgSlug_branch_sablonId_weekKey: { orgSlug: w.orgSlug, branch: w.branch, sablonId: w.sablonId, weekKey } },
    create: data,
    update: data,
  });
}

// Tekrarlayan rezervasyon (yalnız müdür/rehber — yetki Faz 2b'de) — '*' satırı upsert.
export async function upsertRecurring(db: Db, effectiveFromWeek: string, w: ReservationWrite): Promise<EtutReservation> {
  const data = {
    ...w, scope: 'RECURRING' as const, status: 'ACTIVE' as const, weekKey: RECURRING_WEEKKEY,
    effectiveFromWeek, bookedAt: new Date(),
    cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  };
  return (db as ReturnType<typeof tdb>).etutReservation.upsert({
    where: { orgSlug_branch_sablonId_weekKey: { orgSlug: w.orgSlug, branch: w.branch, sablonId: w.sablonId, weekKey: RECURRING_WEEKKEY } },
    create: data,
    update: data,
  });
}

export interface CancelInput {
  orgSlug: string; branch: string; sablonId: string; teacherId: string;
  weekKey: string; // iptal edilen HAFTA ('*' değil — recurring'in tümden iptali ayrı: cancelRecurring)
  cancelledByRole: string; cancelledById: string; cancelReason?: string;
  // Tombstone YARATILACAKSA (recurring'in tek haftası iptal ediliyorsa) zorunlu snapshot:
  snapshot: { studentId: string; studentName: string; studentCls: string; dersBranch: string; dayIndex: number; startsAt: string; endsAt: string };
}

// Haftayı iptal et: WEEK satır varsa CANCELLED'a çevir; yoksa (efektif kaynak recurring'di)
// CANCELLED WEEK tombstone YARAT — o hafta boş görünür, diğer haftalar etkilenmez.
export async function cancelToTombstone(db: Db, c: CancelInput): Promise<EtutReservation> {
  if (c.weekKey === RECURRING_WEEKKEY) throw new Error("cancelToTombstone haftalık iptal içindir — recurring'in tümden iptali için cancelRecurring kullanın");
  const cancelFields = {
    status: 'CANCELLED' as const,
    cancelledByRole: c.cancelledByRole, cancelledById: c.cancelledById,
    cancelledAt: new Date(), cancelReason: c.cancelReason ?? null,
  };
  return (db as ReturnType<typeof tdb>).etutReservation.upsert({
    where: { orgSlug_branch_sablonId_weekKey: { orgSlug: c.orgSlug, branch: c.branch, sablonId: c.sablonId, weekKey: c.weekKey } },
    create: {
      orgSlug: c.orgSlug, branch: c.branch, sablonId: c.sablonId, teacherId: c.teacherId,
      scope: 'WEEK', weekKey: c.weekKey, effectiveFromWeek: null,
      ...c.snapshot, bookedByRole: c.cancelledByRole, bookedById: c.cancelledById,
      ...cancelFields,
    },
    update: cancelFields,
  });
}

// Recurring'i TÜMDEN iptal et ('*' satırı CANCELLED) — yalnız müdür/rehber (Faz 2b).
export async function cancelRecurring(db: Db, orgSlug: string, branch: string, sablonId: string, by: { role: string; id: string; reason?: string }): Promise<void> {
  await (db as ReturnType<typeof tdb>).etutReservation.updateMany({
    where: { orgSlug, branch, sablonId, weekKey: RECURRING_WEEKKEY },
    data: { status: 'CANCELLED', cancelledByRole: by.role, cancelledById: by.id, cancelledAt: new Date(), cancelReason: by.reason ?? null },
  });
}

// Öğrenci+hafta advisory lock — çapraz-sistem (SlotBooking+EtutReservation) limit/çakışma
// yarışını önler (Gemini denetimi). branch AÇIKÇA anahtarda (Faz 2 audit-fix FIX-A) —
// eskiden yoktu, orgSlug+studentId+weekKey tek başına branch'ler arası da aynı anahtara
// düşüyordu (aynı studentId farklı branch'lerde teorik olarak var olabilir — id şeması
// bunu engellemese de anahtar tam-kapsamlı olmalı). Transaction içinde çağrılır; tx
// bitince otomatik bırakılır. SIRA KURALI: HER ZAMAN lockResource'tan SONRA çağrılır
// (deadlock-free — bkz. lockResource yorumu).
export async function lockStudentWeek(tx: Prisma.TransactionClient, orgSlug: string, branch: string, studentId: string, weekKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgSlug}:${branch}:${studentId}:${weekKey}`}, 0))`;
}

// Kaynak-bazlı advisory lock (Faz 2 audit-fix FIX-A, KRİTİK) — kök neden: lockStudentWeek
// yalnız öğrenci+hafta üzerinde kilitleniyordu; İKİ FARKLI öğrenci AYNI kaynağa (etüt
// sablonId+weekKey, ya da SlotBooking hücresi) eşzamanlı başvurunca FARKLI kilit alıyor →
// ikisi de boş görüyor → 2. yazma 1.'yi sessizce eziyor (ya da unique-ihlali → 500).
// Çağıran, çekişilen kaynağı temsil eden herhangi bir string anahtar verir (örn.
// `etut:${orgSlug}:${branch}:${sablonId}:${weekKey}` veya
// `slot:${orgSlug}:${branch}:${weekKey}:${teacherId}:${day}:${slotId}`).
// SIRA KURALI (deadlock-free, TÜM çağrı yerlerinde SABİT): ÖNCE lockResource, SONRA
// lockStudentWeek. İki transaction ikisini de istiyorsa (aynı kaynak+aynı öğrenci) anahtar
// çifti özdeş → aynı sırada alınır → döngü yok. Farklı öğrenci+aynı kaynak yalnız
// kaynak-kilidinde, aynı öğrenci+farklı kaynak yalnız öğrenci-kilidinde çekişir → deadlock
// yapısal olarak imkânsız.
export async function lockResource(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
