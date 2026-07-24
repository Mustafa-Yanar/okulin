// Yoklama muafiyeti — SAF yardımcı (DB/istek bağlamı yok). Hem istemci (TeacherPanel
// "Muaf" rozeti) hem sunucu (POST /api/attendance yazım süzgeci) BURADAN geçer; iki
// taraf aynı kuralı paylaşmazsa öğretmenin gördüğü ile kaydedilen çelişirdi.

// [exemptFrom, exemptUntil] iki ucu DAHİL kapalı aralık; tarihler YYYY-MM-DD olduğundan
// sözlük karşılaştırması kronolojik karşılaştırmayla birebir aynıdır.
export function isExemptOn(
  exemptFrom: string | null | undefined,
  exemptUntil: string | null | undefined,
  date: string | null | undefined,
): boolean {
  if (!exemptFrom || !exemptUntil || !date) return false;
  return exemptFrom <= date && date <= exemptUntil;
}
