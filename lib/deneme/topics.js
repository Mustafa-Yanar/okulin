// Konu takibi — her ders için sabit konu listesi.
// guidanceSubjectsFor()'un döndürdüğü tüm ders adlarını kapsar.
// ŞİMDİLİK her derse Konu_1..Konu_10 verildi; gerçek müfredatla sonra değiştirilecek.
// Bir dersin konularını değiştirmek için aşağıdaki diziyi güncellemen yeterli.

// Konu takibinde görünebilecek tüm dersler (guidanceSubjectsFor ile uyumlu)
const ALL_SUBJECTS = [
  // Ortaokul
  'Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İnkılap Tarihi', 'İngilizce',
  // Lise / YKS alt branşları
  'Edebiyat',
  'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe',
  'TYT Matematik', 'AYT Matematik', 'Geometri',
  'TYT Fizik', 'AYT Fizik',
  'TYT Kimya', 'AYT Kimya',
  'TYT Biyoloji', 'AYT Biyoloji',
  'TYT Tarih', 'AYT Tarih',
  'TYT Coğrafya', 'AYT Coğrafya',
  'TYT Felsefe', 'AYT Felsefe',
  'Din Kültürü',
];

function placeholderTopics() {
  return Array.from({ length: 10 }, (_, i) => `Konu ${i + 1}`);
}

// ders adı -> konu adları dizisi
export const SUBJECT_TOPICS = (() => {
  const map = {};
  for (const s of ALL_SUBJECTS) map[s] = placeholderTopics();
  return map;
})();

// Bir dersin konu listesi (tanımsızsa boş)
export function topicsFor(subject) {
  return SUBJECT_TOPICS[subject] || [];
}
