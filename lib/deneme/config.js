// Deneme analizi — sınav yapısı (TYT/AYT dersler, soru sayıları).
// Tek doğruluk kaynağı. denemeanalizi projesinden JS'e taşındı.

// ---------------- TYT ----------------
export const TYT_GROUPS = [
  {
    key: 'turkce',
    label: 'Türkçe',
    subjects: [{ key: 'turkce', label: 'Türkçe', questionCount: 40 }],
  },
  {
    key: 'sosyal',
    label: 'Sosyal Bilimler',
    subjects: [
      { key: 'tarih', label: 'Tarih', questionCount: 5 },
      { key: 'cografya', label: 'Coğrafya', questionCount: 5 },
      { key: 'felsefe', label: 'Felsefe', questionCount: 5 },
      // Din Kültürü ve Felsefe (Seçmeli) alternatif: öğrenci birini çözer.
      // İkisi de doluysa neti yüksek olan toplama katılır.
      { key: 'din', label: 'Din Kültürü', questionCount: 5 },
      { key: 'felsefe_secmeli', label: 'Felsefe (Seçmeli)', questionCount: 5 },
    ],
  },
  {
    key: 'matematik',
    label: 'Matematik',
    subjects: [
      { key: 'matematik', label: 'Matematik', questionCount: 30 },
      { key: 'geometri', label: 'Geometri', questionCount: 10 },
    ],
  },
  {
    key: 'fen',
    label: 'Fen Bilimleri',
    subjects: [
      { key: 'fizik', label: 'Fizik', questionCount: 7 },
      { key: 'kimya', label: 'Kimya', questionCount: 7 },
      { key: 'biyoloji', label: 'Biyoloji', questionCount: 6 },
    ],
  },
];

// ---------------- AYT (öğrenci paneli için hazır; yükleme sonra) ----------------
const AYT_MATEMATIK = {
  key: 'matematik',
  label: 'Matematik',
  subjects: [
    { key: 'matematik', label: 'Matematik', questionCount: 30 },
    { key: 'geometri', label: 'Geometri', questionCount: 10 },
  ],
};
const AYT_FEN = {
  key: 'fen',
  label: 'Fen Bilimleri',
  subjects: [
    { key: 'fizik', label: 'Fizik', questionCount: 14 },
    { key: 'kimya', label: 'Kimya', questionCount: 13 },
    { key: 'biyoloji', label: 'Biyoloji', questionCount: 13 },
  ],
};
const AYT_EDEB_1 = {
  key: 'edeb_sosyal_1',
  label: 'Edebiyat - Sosyal 1',
  subjects: [
    { key: 'edebiyat_1', label: 'Edebiyat-1', questionCount: 24 },
    { key: 'tarih_1', label: 'Tarih-1', questionCount: 10 },
    { key: 'cografya_1', label: 'Coğrafya-1', questionCount: 6 },
  ],
};
const AYT_SOSYAL_2 = {
  key: 'sosyal_2',
  label: 'Sosyal Bilimler 2',
  subjects: [
    { key: 'tarih_2', label: 'Tarih-2', questionCount: 11 },
    { key: 'cografya_2', label: 'Coğrafya-2', questionCount: 11 },
    { key: 'felsefe', label: 'Felsefe', questionCount: 12 },
    { key: 'din', label: 'Din Kültürü', questionCount: 6 },
  ],
};

export const AYT_CATEGORIES = {
  SAYISAL: { label: 'Sayısal', groups: [AYT_MATEMATIK, AYT_FEN] },
  ESIT_AGIRLIK: { label: 'Eşit Ağırlık', groups: [AYT_EDEB_1, AYT_MATEMATIK] },
  SOZEL: { label: 'Sözel', groups: [AYT_EDEB_1, AYT_SOSYAL_2] },
};

// Alternatif ders çiftleri: [birincil, alternatif]. Yüksek neti toplama girer.
export const ALTERNATIVE_PAIRS = [['din', 'felsefe_secmeli']];

export function getGroupsFor(examType, category) {
  if (examType === 'TYT') return TYT_GROUPS;
  if (!category) return [];
  return AYT_CATEGORIES[category] ? AYT_CATEGORIES[category].groups : [];
}

export function calcNet(dogru, yanlis) {
  return Math.round((dogru - yanlis / 4) * 100) / 100;
}
