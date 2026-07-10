// Eski öğretmen şemasını (branch + extraBranches) yeni şemaya (branches[]) çevirir.
// Migrasyon kuralı: eski branch + extraBranches birleşir; 'Matematik' varsa
// TYT/AYT/Geometri de eklenir (12/mezun dersleri için). Savunma amaçlı: zaten
// branches[] olan kayda dokunmaz.

const MATH_EXPANSION = ['TYT Matematik', 'AYT Matematik', 'Geometri'];

// Eski şema (branch/extraBranches) veya yeni şema (branches[]) taşıyan öğretmen kaydı.
export interface LegacyTeacherLike {
  branch?: string;
  extraBranches?: string[];
  branches?: string[];
  [key: string]: unknown; // kaydın kalan alanları olduğu gibi taşınır
}

export function normalizeTeacher<T extends LegacyTeacherLike | null | undefined>(t: T): T | (Omit<NonNullable<T>, 'branch' | 'extraBranches'> & { branches: string[] }) {
  if (!t) return t;
  if (Array.isArray(t.branches)) return t; // zaten yeni şema

  const merged: string[] = [];
  const seen = new Set<string>();
  const add = (b: string | undefined) => { if (b && !seen.has(b)) { seen.add(b); merged.push(b); } };

  add(t.branch);
  (t.extraBranches || []).forEach(add);
  if (seen.has('Matematik')) MATH_EXPANSION.forEach(add);

  const { branch, extraBranches, ...rest } = t;
  return { ...rest, branches: merged };
}
