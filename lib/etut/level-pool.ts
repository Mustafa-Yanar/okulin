// Düzey (grup) ders havuzu — spec §4a: öğrenci kendi SINIF listesiyle sınırlı değil,
// kendi DÜZEYİNDEKİ (ortaokul/lise/mezun) tüm derslerden etüt alabilir (Mustafa kararı
// 2026-07-20: lise öğrencisi İnkılap alamaz, ortaokul Fizik alamaz; sınıf-dışı düzey
// dersi ALABİLİR). Grup-bazlı olduğu için s_UUID sınıf-kodu tuzağı burada YOKTUR
// (cls hiç parse edilmez — rehberlik-konu-takibi-fix kuralı).
import { COL_COURSES } from '@/lib/constants';
import { getClasses, getClass } from '@/lib/classes';

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

// levelPoolForStudent — review bulgusu (Fix 2): levelPoolForGroup, grubun ne registry'de
// sınıfı NE DE FALLBACK_KEYS'te (yalnız ortaokul/lise/mezun) girdisi varsa [] döner. Bu,
// 'ilkokul' gibi henüz düzey-havuzu tanımsız gruplardaki öğrenciler için branş doğrulamasını
// HER ZAMAN reddeder (studentAllowed.includes(bookingBranch) asla true olmaz). Düzeltme:
// grup havuzu boşsa öğrencinin KENDİ ŞUBESİNİN (cls — legacyId, ASLA parse edilmez, ilkeler
// rehberlik-konu-takibi-fix ile AYNI) dersler listesine düş — en azından o öğrencinin kayıtlı
// olduğu şubenin dersleri rezerve edilebilsin.
export async function levelPoolForStudent(cls: string, group: string): Promise<string[]> {
  const pool = await levelPoolForGroup(group);
  if (pool.length) return pool;
  const row = await getClass(cls);
  return row?.dersler ?? [];
}
