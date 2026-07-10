// Deneme analizi ortak veri şekilleri — SAF tipler (çalışma zamanı kodu yok).
// Redis döneminden gelen "gömülü-rows exam objesi" sözleşmesinin tek tanımı.

// Tek dersin sonucu: { dogru, yanlis, bos, net }
export interface SubjectResult {
  dogru: number;
  yanlis: number;
  bos: number;
  net: number;
}

// dersKey → sonuç
export type Results = Record<string, SubjectResult>;

// Puan/toplam fonksiyonları savunmacı okur (r?.net || 0) — yalnız net alanı yeterli,
// kısmi/eksik sonuç objeleri de kabul edilir (ör. elle girilmiş sadece-net veriler).
export type ResultsLike = Record<string, { net: number } | SubjectResult | undefined>;

// Puanlar: TYT → {TYT}; AYT → {SAY,EA,SOZ}; LGS → {LGS}
export type PuanMap = Record<string, number | null>;

// Sınavdaki tek öğrenci satırı (ExamRow.data Json içeriği).
export interface DenemeRow {
  excelName?: string;
  studentId?: string | null;
  kitapcik?: string;
  answers?: (string | null)[];
  results?: Results;
  toplamNet?: number;
  puan?: PuanMap;
  source?: string;
  [key: string]: unknown; // giriş kaynağına göre ek alanlar taşınabilir (olduğu gibi saklanır)
}

// Gömülü-rows sınav objesi (store.getExam çıktısı / route'ların çalıştığı şekil).
export interface DenemeExam {
  id: string;
  name: string;
  examType: string;
  category?: string | null;
  date?: string | null;
  kitapcikSayisi?: number;
  subjectKeys?: string[];
  answerKey?: Record<string, Record<string, string>> | null;
  rows: DenemeRow[];
  computedAt?: number;
  createdAt?: number;
}
