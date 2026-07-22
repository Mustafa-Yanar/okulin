// Toplu etüt görünümü (müdür/rehber) yoklama rozeti — SAF eşleme; sorguyu
// rezervasyon.attachEtutYoklama yapar, buraya verir.
//
// Anahtar: date + lessonNo ('e' + şablon legacyId). teacher/cls eşlemesi BİLİNÇLİ yok:
// lessonNo şablon kimliği içerdiği için tekildir ve öğrencinin sınıfı yoklama
// yazıldıktan sonra değişse bile kayıt bulunur. Kayıt var ama MEVCUT öğrenci için
// giriş yoksa yine 'alinmadi' (yeniden-atama dürüstlüğü: bu öğrencinin yoklaması yok).
export type EtutYoklamaDurum = 'var' | 'gec' | 'yok' | 'alinmadi';

export interface EtutYoklamaRow { id: string; dayIndex: number; studentId?: string | null }
export interface EtutYoklamaRecord { date: string; lessonNo: string; records: unknown }

// Dönen map: şablon legacyId → durum. Yalnız ATANMIŞ satırlar için anahtar üretir;
// boş slotun yoklaması kavramsal olarak yoktur.
export function buildEtutYoklamaMap(
  rows: EtutYoklamaRow[],
  records: EtutYoklamaRecord[],
  dateForDay: (dayIndex: number) => string,
): Record<string, EtutYoklamaDurum> {
  const byKey = new Map<string, Record<string, string>>();
  for (const r of records) {
    const recObj = r.records && typeof r.records === 'object' ? (r.records as Record<string, string>) : {};
    byKey.set(`${r.date}|${r.lessonNo}`, recObj);
  }
  const out: Record<string, EtutYoklamaDurum> = {};
  for (const row of rows) {
    if (!row.studentId) continue;
    const st = byKey.get(`${dateForDay(row.dayIndex)}|e${row.id}`)?.[row.studentId];
    out[row.id] = st === 'var' || st === 'gec' || st === 'yok' ? st : 'alinmadi';
  }
  return out;
}
