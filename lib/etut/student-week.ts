// Öğrenci-hafta etüt rezervasyon normalizasyonu — decideBooking'in (booking-rules.ts)
// otherBookings + weeklyCount girdisini besler; bookEtut orkestratörü (booking.ts) buradan okur.
//
// 2026-07-22 denetim B3/dalga3: eski SlotBooking ayağı (combineBookings'in slotRows
// parametresi + studentWeekBookings DB sarmalayıcısı + SlotRowLike/saat-çözümleme
// yardımcıları) KALDIRILDI — grid rezervasyon yüzeyi emekli edildi (POST /api/slots yok),
// booked SlotBooking satırı üreten hiçbir kod yolu kalmadı ve canlı veride de sıfırdı.
// Kanıt/harita: docs/superpowers/specs/2026-07-22-buyuk-temizlik-faz1-harita.md (B3/B4).
import { toMin, type NormalizedBooking } from './overlap';
import type { EtutReservation } from '@prisma/client';

export interface StudentWeekBookings {
  list: NormalizedBooking[];
  weeklyCount: number;
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

// SAF — girdi zaten filtrelenmiş (öğrenci+hafta+ACTIVE efektif; exclude çağıran tarafta
// uygulanmış) satır listesidir; I/O yok. weeklyCount = satır sayısı.
export function normalizeEtutBookings(effectiveEtutRows: EtutReservation[]): StudentWeekBookings {
  return {
    list: effectiveEtutRows.map(etutToNormalized),
    weeklyCount: effectiveEtutRows.length,
  };
}
