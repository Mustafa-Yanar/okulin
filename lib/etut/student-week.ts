// Çapraz-sistem öğrenci-hafta toplayıcı (spec §4) — etüt (EtutReservation) ile ders programı
// (SlotBooking) rezervasyonlarını TEK listede + TEK sayaçta birleştirir. decideBooking'in
// (booking-rules.ts) otherBookings + weeklyCount girdisini besler — Task 4 orkestratörü BURADAN
// okur. Saat çözümleme app/api/slots/route.ts:155/309 ile BİREBİR aynı desen:
//   daySlots(day, slotTimes.days[day]).find(s => s.id === slotId)
// Branş önceliği app/api/slots/route.ts:230 ile BİREBİR aynı:
//   ((data as SlotCell | null)?.branch) || dersBranch kolonu
import { tdb } from '@/lib/sqldb';
import { daySlots } from '@/lib/constants';
import type { NormalizedSlotTimes, SlotCell } from '@/lib/slots';
import { getDaySlotTimes } from '@/lib/slots';
import { toMin, type NormalizedBooking } from './overlap';
import { getWeekReservations, resolveEffective } from './reservations';
import type { EtutReservation } from '@prisma/client';

export interface StudentWeekBookings {
  list: NormalizedBooking[];
  weeklyCount: number;
}

// SlotBooking'ten okunan minimal alan seti — çakışma/limit için gerekenler, tüm model DEĞİL.
// Alan adları SlotBooking modeliyle birebir (prisma/schema.prisma satır 257-281).
export interface SlotRowLike {
  dayIndex: number;
  slotId: string;
  startsAt: string | null; // Faz 1 saat snapshot'ı — çoğu satırda henüz null (spec §4 notu)
  endsAt: string | null;
  dersBranch: string | null; // kolon — data.branch YOKSA yedek
  data: { branch?: string | null } | null; // SlotCell.branch — VARSA öncelikli
}

// route.ts:230 ile birebir aynı öncelik: data.branch || dersBranch kolonu.
function slotBranch(row: SlotRowLike): string | null {
  return row.data?.branch || row.dersBranch || null;
}

function etutToNormalized(r: EtutReservation): NormalizedBooking {
  return {
    dayIndex: r.dayIndex,
    startMin: toMin(r.startsAt),
    endMin: toMin(r.endsAt),
    dersBranch: r.dersBranch || null,
    source: 'etut',
  };
}

// Slot satırının saatini çözer: snapshot (startsAt/endsAt) ÖNCELİKLİ; yoksa slot tanımından
// (route.ts:155/309 deseni). İkisi de yoksa null — çağıran kaydı listeye almaz ama sayar.
function resolveSlotMinutes(row: SlotRowLike, slotTimes: NormalizedSlotTimes): { startMin: number; endMin: number } | null {
  if (row.startsAt && row.endsAt) {
    return { startMin: toMin(row.startsAt), endMin: toMin(row.endsAt) };
  }
  const slotDef = daySlots(row.dayIndex, slotTimes.days[row.dayIndex]).find((s) => s.id === row.slotId);
  if (!slotDef) return null;
  return { startMin: toMin(slotDef.start), endMin: toMin(slotDef.end) };
}

// SAF — girdiler zaten filtrelenmiş (öğrenci+hafta+ACTIVE) satır listeleridir; I/O yok.
export function combineBookings(
  effectiveEtutRows: EtutReservation[],
  slotRows: SlotRowLike[],
  slotTimes: NormalizedSlotTimes,
): StudentWeekBookings {
  const list: NormalizedBooking[] = effectiveEtutRows.map(etutToNormalized);

  for (const row of slotRows) {
    const minutes = resolveSlotMinutes(row, slotTimes);
    if (!minutes) {
      // Sessiz-yanlış yerine görünür-eksik (spec §4): kayıt limit sayımına dahil kalır,
      // çakışma interval listesine GİRMEZ (saati bilinmeyen kaydın hayali bir saatle
      // çakışma üretmesi istenmiyor).
      console.warn(`[student-week] slot saati çözülemedi — dayIndex=${row.dayIndex} slotId=${row.slotId} (snapshot yok + slot config'te bulunamadı); weeklyCount'a dahil, çakışma listesine DEĞİL`);
      continue;
    }
    list.push({
      dayIndex: row.dayIndex,
      startMin: minutes.startMin,
      endMin: minutes.endMin,
      dersBranch: slotBranch(row),
      source: 'slot',
    });
  }

  // Toplam = iki sistemin TOPLAM satır sayısı (spec §4) — saati çözülemeyen slot da dahil.
  return { list, weeklyCount: effectiveEtutRows.length + slotRows.length };
}

// DB ince sarmalayıcı — Task 4 (bookEtut orkestratörü) bunu çağırır.
export async function studentWeekBookings(
  orgSlug: string,
  branch: string,
  studentId: string,
  weekKey: string,
  opts?: { excludeSablonId?: string },
): Promise<StudentWeekBookings> {
  // orgSlug/branch AÇIK geçilir (getWeekReservations'la aynı savunma — reservations.ts
  // yorumu: "$extends findMany'e enjekte etse de çıplak tx ile sızıntıyı yapısal olarak
  // engeller"): ambient currentOrg()/currentBranch()'e GÜVENMEK yerine parametre tdb()'ye
  // açıkça verilir. getDaySlotTimes() İSTİSNA — override almıyor (lib/slots.ts imzası),
  // dolayısıyla ambient bağlama kalır; bu satır tüm çağrılarda ambient=parametre olduğu
  // sürece sorunsuzdur (tek istek = tek tenant).
  const [allEtutRows, slotRowsRaw, slotTimes] = await Promise.all([
    getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey),
    tdb(orgSlug, branch).slotBooking.findMany({ where: { weekKey, booked: true, studentId } }),
    getDaySlotTimes(),
  ]);

  // excludeSablonId EFEKTİF HARİTA üzerinde filtrelenir — sorguya SIZDIRILMAZ (brief):
  // getWeekReservations tüm haftanın satırlarını çeker (N+1 yok), resolveEffective
  // sablonId→efektif satır çözer, biz burada hem öğrenciye hem dışlanana göre süzeriz.
  const effective = resolveEffective(allEtutRows, weekKey);
  const effectiveEtutRows = [...effective.values()].filter(
    (r) => r.studentId === studentId && r.sablonId !== opts?.excludeSablonId,
  );

  const slotRows: SlotRowLike[] = slotRowsRaw.map((r) => ({
    dayIndex: r.dayIndex,
    slotId: r.slotId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    dersBranch: r.dersBranch,
    data: r.data as SlotCell | null,
  }));

  return combineBookings(effectiveEtutRows, slotRows, slotTimes);
}
