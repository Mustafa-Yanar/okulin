// Eski öğretmen şemasını (branch + extraBranches) yeni şemaya (branches[]) çevirir.
// Migrasyon kuralı: eski branch + extraBranches birleşir; 'Matematik' varsa
// TYT/AYT/Geometri de eklenir (12/mezun dersleri için). Savunma amaçlı: zaten
// branches[] olan kayda dokunmaz.

const MATH_EXPANSION = ['TYT Matematik', 'AYT Matematik', 'Geometri'];

export function normalizeTeacher(t) {
  if (!t) return t;
  if (Array.isArray(t.branches)) return t; // zaten yeni şema

  const merged = [];
  const seen = new Set();
  const add = (b) => { if (b && !seen.has(b)) { seen.add(b); merged.push(b); } };

  add(t.branch);
  (t.extraBranches || []).forEach(add);
  if (seen.has('Matematik')) MATH_EXPANSION.forEach(add);

  const { branch, extraBranches, ...rest } = t;
  return { ...rest, branches: merged };
}
