// Öğretmen branşı -> rehberlik/konu derslerinden hangilerini görebilir.
// guidanceSubjectsFor() dersleri: 'TYT Matematik', 'AYT Matematik', 'Geometri',
// 'TYT Fizik', 'AYT Fizik', 'Türkçe', 'Edebiyat', 'TYT Tarih' ... gibi.

// Branş -> o branşa ait ders adında geçmesi gereken anahtar kelimeler.
// Geometri Matematik branşına dahil olduğu için elle eklendi.
const BRANCH_KEYWORDS: Record<string, string[]> = {
  Matematik: ['matematik', 'geometri'],
  Geometri: ['geometri'],
  Türkçe: ['türkçe', 'edebiyat'],
  Edebiyat: ['edebiyat', 'türkçe'],
  Fizik: ['fizik'],
  Kimya: ['kimya'],
  Biyoloji: ['biyoloji'],
  Tarih: ['tarih'],
  Coğrafya: ['coğrafya'],
  Felsefe: ['felsefe', 'din'],
  'Fen Bilgisi': ['fen', 'fizik', 'kimya', 'biyoloji'],
  'Sosyal Bilgiler': ['sosyal', 'tarih', 'coğrafya', 'inkılap'],
  'İnkılap Tarihi': ['inkılap', 'tarih'],
  İngilizce: ['ingilizce'],
};

function norm(s: unknown): string {
  return String(s ?? '').toLocaleLowerCase('tr');
}

// Bir ders adı, verilen branşa ait mi?
export function subjectMatchesBranch(subject: string, branch: string | null | undefined): boolean {
  if (!branch) return true;
  const keywords = BRANCH_KEYWORDS[branch];
  if (!keywords) return true; // tanımsız branş: hepsini göster (güvenli)
  const s = norm(subject);
  return keywords.some((k) => s.includes(k));
}

// Ders listesini branşa göre süz. branch yoksa olduğu gibi döner.
export function filterSubjectsByBranch(subjects: string[], branch: string | null | undefined): string[] {
  if (!branch) return subjects;
  return subjects.filter((s) => subjectMatchesBranch(s, branch));
}
