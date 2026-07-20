// Düzey (grup) ders havuzu — spec §4a: öğrenci kendi SINIF listesiyle sınırlı değil,
// kendi DÜZEYİNDEKİ (ortaokul/lise/mezun) tüm derslerden etüt alabilir (Mustafa kararı
// 2026-07-20: lise öğrencisi İnkılap alamaz, ortaokul Fizik alamaz; sınıf-dışı düzey
// dersi ALABİLİR). Grup-bazlı olduğu için s_UUID sınıf-kodu tuzağı burada YOKTUR
// (cls hiç parse edilmez — rehberlik-konu-takibi-fix kuralı).
import { COL_COURSES } from '@/lib/constants';
import { getClasses } from '@/lib/classes';

export interface LevelClass { group: string; dersler: string[] }

// Registry yoksa/boşsa kullanılacak COL_COURSES sütun grupları.
const FALLBACK_KEYS: Record<string, string[]> = {
  ortaokul: ['Ortaokul_7', 'Ortaokul_8'],
  lise: ['Lise Ortak_9', 'Lise Ortak_10', 'Lise Sayısal_11', 'Lise Eşit Ağırlık_11', 'Lise Sayısal_12', 'Lise Eşit Ağırlık_12'],
  mezun: ['Mezun Sayısal', 'Mezun Eşit Ağırlık'],
};

// Saf çekirdek: o gruptaki sınıfların dersler birleşimi; hiç ders çıkmazsa constants fallback.
export function levelPoolFrom(classes: LevelClass[], group: string): string[] {
  const set = new Set<string>();
  for (const c of classes) {
    if (c.group !== group) continue;
    for (const d of c.dersler || []) set.add(d);
  }
  if (set.size === 0) {
    for (const key of FALLBACK_KEYS[group] || []) {
      for (const d of COL_COURSES[key] || []) set.add(d);
    }
  }
  return Array.from(set);
}

// DB sarmalayıcı (tenant-scoped getClasses üzerinden).
export async function levelPoolForGroup(group: string): Promise<string[]> {
  const classes = await getClasses();
  return levelPoolFrom(classes.map((c) => ({ group: c.group, dersler: c.dersler })), group);
}
