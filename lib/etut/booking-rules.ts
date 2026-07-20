// Birleşik rezervasyon karar çekirdeği — SAF (I/O yok). Tüm yazma yolları (web/mobil/slots)
// Task 3 orkestratörü üzerinden BURADAN geçer; kural tek yerde yaşar (spec §4).
// Kural sırası ve metinler eski uygulamaya (app/api/slots/route.ts POST +
// lib/etut/rezervasyon.ts reserveEtut) BİREBİR sadık — kaynak her kuralın yorumunda.
import { MATH_FAMILY } from '@/lib/constants';
import { findTimeConflict, type NormalizedBooking } from './overlap';
import type { BookingRole } from './weeks';

export interface BookingDeny { error: string; status: number }

export interface BookingContext {
  actor: { role: BookingRole | string; id: string; isManager: boolean; readOnlyCounselor: boolean };
  scope: 'WEEK' | 'RECURRING';
  weekKey: string; allowedWeeks: string[];           // allowedBookingWeeks(actor.role, now) çıktısı
  slotStartsAt: Date; now: Date;                     // geçmiş-slot reddi
  sablon: { aktif: boolean; pasifHaftalar: string[]; deletedAt: Date | null } | null;
  teacher: { legacyId: string; branches: string[]; allowedGroups: string[] } | null;
  student: { id: string; group: string } | null;
  levelPool: string[];                                // levelPoolForGroup(student.group)
  dersBranch: string | undefined;                     // istenen ders (yoksa tek-aday otomatiği orkestratörde)
  currentEffective: { studentId: string } | null;     // o sablon+haftanın efektif rezervasyonu
  // yalnız ACTIVE satırlar — resolveEffective/studentWeekBookings sözleşmesi (CANCELLED asla gelmez)
  otherBookings: NormalizedBooking[];                 // öğrencinin o haftaki DİĞER kayıtları (etut+slot, bu sablon hariç)
  candidate: { dayIndex: number; startMin: number; endMin: number };
  weeklyCount: number; maxWeeklyPerStudent: number | null;  // null = limitsiz; yalnız öğrenci self-booking'e uygulanır
  studentSelfBookingEnabled: boolean;
  force?: boolean;                                    // yalnız isManager; bypass audit'i orkestratörde
}

export function decideBooking(ctx: BookingContext): BookingDeny | { ok: true } {
  const { actor } = ctx;

  // 1) Salt-okunur rehber (app/api/slots/route.ts POST satır 110 — metin birebir)
  if (actor.readOnlyCounselor) {
    return { error: 'Salt-okunur rehber etüt rezervasyonu yapamaz', status: 403 };
  }

  // 2) RECURRING yalnız müdür/rehber (YENİ — Faz 2b spec)
  if (ctx.scope === 'RECURRING' && !actor.isManager) {
    return { error: 'Tekrarlayan atama yalnız müdür/rehber tarafından yapılabilir', status: 403 };
  }

  // 3) Öğrenci self-booking kapalı (app/api/slots/route.ts POST satır 120 — metin birebir;
  // route'taki metin brief taslağından FARKLI, buradaki route'un GERÇEK metnidir)
  if (actor.role === 'student' && !ctx.studentSelfBookingEnabled) {
    return { error: 'Etüt rezervasyonu kurum tarafından kapatılmış. Lütfen öğretmeninize başvurun.', status: 403 };
  }

  // 4) Hafta penceresi (YENİ — spec §5; RECURRING'te haftadan bağımsız, effectiveFrom orkestratörde)
  if (ctx.scope === 'WEEK' && !ctx.allowedWeeks.includes(ctx.weekKey)) {
    return { error: 'Bu hafta için rezervasyon henüz açık değil', status: 403 };
  }

  // 5) Şablon varlık/aktiflik (lib/etut/rezervasyon.ts reserveEtut satır 104/107 — metin birebir)
  if (!ctx.sablon || ctx.sablon.deletedAt) {
    return { error: 'Etüt bulunamadı', status: 404 };
  }
  if (ctx.sablon.aktif === false || ctx.sablon.pasifHaftalar.includes(ctx.weekKey)) {
    return { error: 'Bu etüt bu hafta aktif değil', status: 400 };
  }
  const teacher = ctx.teacher;
  if (!teacher) return { error: 'Öğretmen bulunamadı', status: 404 };
  const student = ctx.student;
  if (!student) return { error: 'Öğrenci bulunamadı', status: 404 };

  // 6) Geçmiş slot (lib/etut/rezervasyon.ts satır 112 — metin birebir; WEEK için — RECURRING geleceğe akar)
  if (ctx.scope === 'WEEK' && ctx.slotStartsAt.getTime() <= ctx.now.getTime()) {
    return { error: 'Geçmiş bir etüde rezervasyon yapılamaz', status: 400 };
  }

  // 7) Grup (lib/etut/rezervasyon.ts satır 98-99 — metin birebir)
  const groups = teacher.allowedGroups;
  if (groups.length === 0) {
    return { error: 'Bu öğretmenin grup etiketi tanımlanmamış', status: 400 };
  }
  if (!groups.includes(student.group)) {
    return { error: 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz', status: 400 };
  }

  // 8) Ders: öğretmen branşı ∩ DÜZEY havuzu (§4a — sınıf listesi DEĞİL; lib/etut/rezervasyon.ts
  // satır 120-122 metin birebir)
  const dersBranch = ctx.dersBranch;
  if (!dersBranch || !teacher.branches.includes(dersBranch) || !ctx.levelPool.includes(dersBranch)) {
    return { error: 'Geçersiz veya seçilmemiş ders. Uygun bir ders seçin.', status: 400 };
  }

  // 9) Doluluk (lib/etut/rezervasyon.ts satır 108-109 — metin birebir; efektif = hafta-bazlı;
  // force ile DAHİ geçilmez — force yalnız Kural 10 saat-çakışmasına uygulanır)
  if (ctx.currentEffective) {
    if (ctx.currentEffective.studentId !== student.id) {
      return { error: 'Bu etüt zaten dolu', status: 400 };
    }
    return { error: 'Bu öğrenci zaten bu etüde kayıtlı', status: 400 };
  }

  // 10) Saat çakışması — İKİ SİSTEM birleşik, interval bazlı (YENİ mekanik, eski metin).
  // Yalnız müdür+force birlikte bypass eder; müdür TEK BAŞINA (force'suz) geçemez.
  const clash = findTimeConflict(ctx.otherBookings, ctx.candidate);
  if (clash && !(actor.isManager && ctx.force)) {
    return { error: 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı', status: 400 };
  }

  // 11) Aynı ders + matematik ailesi (lib/etut/rezervasyon.ts satır 128-134 — metin birebir;
  // yalnız yönetici-olmayan; force burada ANLAMSIZ — müdür zaten muaf)
  if (!actor.isManager) {
    if (ctx.otherBookings.some((b) => b.dersBranch === dersBranch)) {
      return { error: `Bu öğrenci bu hafta ${dersBranch} dersinden zaten etüt almış`, status: 400 };
    }
    if (MATH_FAMILY.includes(dersBranch) && ctx.otherBookings.some((b) => b.dersBranch && MATH_FAMILY.includes(b.dersBranch))) {
      return { error: 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış', status: 400 };
    }
  }

  // 12) Haftalık limit (app/api/slots/route.ts POST satır 123-128 — metin+status birebir;
  // yalnız öğrenci self-booking; öğretmen/müdür dağıtımı muaf)
  if (actor.role === 'student' && ctx.maxWeeklyPerStudent != null && ctx.weeklyCount >= ctx.maxWeeklyPerStudent) {
    return {
      error: `Bu hafta en fazla ${ctx.maxWeeklyPerStudent} etüt alabilirsiniz (${ctx.weeklyCount} dolu).`,
      status: 403,
    };
  }

  return { ok: true };
}
