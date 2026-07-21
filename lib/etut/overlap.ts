// Interval çakışma matematiği — çapraz-sistem (SlotBooking + EtutReservation) denetimi
// için ORTAK normalizasyon (spec §4). String saat eşitliği YETMEZ (Gemini/Codex denetimi):
// "9:00" vs "09:00" ve kısmi örtüşme ancak dakikaya çevirip yarı-açık aralıkla yakalanır.

export interface NormalizedBooking {
  dayIndex: number;
  startMin: number;
  endMin: number;
  dersBranch: string | null;
  source: 'slot' | 'etut';
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Yarı-açık [start, end): 14:00-15:00 ile 15:00-16:00 ÇAKIŞMAZ.
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Adayla aynı GÜN + saat örtüşmesi olan ilk kaydı döner (hata mesajında kaynak gösterilir).
export function findTimeConflict(
  list: NormalizedBooking[],
  cand: Pick<NormalizedBooking, 'dayIndex' | 'startMin' | 'endMin'>,
): NormalizedBooking | null {
  for (const b of list) {
    if (b.dayIndex === cand.dayIndex && intervalsOverlap(b.startMin, b.endMin, cand.startMin, cand.endMin)) return b;
  }
  return null;
}
