// Yoklama geçmişi etüt etiketi (Faz 4 T1) — orijinal denetim gap #5'in kapanışı:
// branch HAFTA-SCOPED (EtutReservation weekKey-join, snapshot saatiyle); rezervasyon
// satırı yoksa şablon saatine düşer. SAF — route batch-lookup yapıp buraya verir.
export interface EtutLabelSource {
  sablon: { legacyId: string; start: string; end: string } | null;      // EtutSablon (deletedAt DAHİL — tarihsel etiket)
  reservation: { dersBranch: string; startsAt: string; endsAt: string } | null; // o haftanın efektif satırı (varsa)
}

export function pickEtutLabel(src: EtutLabelSource): { branch: string; slotLabel: string } {
  if (src.reservation) {
    return { branch: src.reservation.dersBranch, slotLabel: `${src.reservation.startsAt}–${src.reservation.endsAt}` };
  }
  if (src.sablon) return { branch: '', slotLabel: `${src.sablon.start}–${src.sablon.end}` };
  return { branch: '', slotLabel: '' };
}
