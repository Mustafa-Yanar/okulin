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

function placeholderTopics(): string[] {
  return Array.from({ length: 10 }, (_, i) => `Konu ${i + 1}`);
}

// ders adı -> konu adları dizisi
export const SUBJECT_TOPICS: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const s of ALL_SUBJECTS) map[s] = placeholderTopics();
  return map;
})();

// Bir dersin konu listesi. Sabit listede olmayan (kuruma özel adlandırılmış) dersler
// için de placeholder döndürür — böylece registry'den gelen özel ders adları konu
// takibinde ATLANMAZ (müfredat henüz placeholder; gerçek konularla sonra değişecek).
export function topicsFor(subject: string): string[] {
  return SUBJECT_TOPICS[subject] || placeholderTopics();
}
