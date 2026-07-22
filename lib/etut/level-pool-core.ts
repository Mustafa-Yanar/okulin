// Düzey (grup) ders havuzu — SAF çekirdek (DB/istek bağlamı YOK). İSTEMCİ de sunucu da
// BURADAN geçer: müdür/rehber etüt atama modalı ders adaylarını buradan üretir, sunucu
// (decideBooking kural 8) aynı kuralla doğrular. İki taraf ayrı kural kullanırsa istemci
// sunucunun reddedeceği bir dersi teklif eder (ya da kabul edeceğini gizler).
//
// Not: DB sarmalayıcıları (levelPoolForGroup/levelPoolForStudent) ./level-pool.ts'te —
// o dosya @/lib/classes üzerinden Prisma'ya bağlı, istemciden import EDİLEMEZ.
import { COL_COURSES } from '@/lib/constants';

export interface LevelClass { group: string; dersler: string[] }

// Registry yoksa/boşsa kullanılacak COL_COURSES sütun grupları.
export const FALLBACK_KEYS: Record<string, string[]> = {
  ortaokul: ['Ortaokul_7', 'Ortaokul_8'],
  lise: ['Lise Ortak_9', 'Lise Ortak_10', 'Lise Sayısal_11', 'Lise Eşit Ağırlık_11', 'Lise Sayısal_12', 'Lise Eşit Ağırlık_12'],
  mezun: ['Mezun Sayısal', 'Mezun Eşit Ağırlık'],
};

// spec §4a: öğrenci kendi SINIF listesiyle sınırlı değil, kendi DÜZEYİNDEKİ
// (ortaokul/lise/mezun) tüm derslerden etüt alabilir (Mustafa kararı 2026-07-20:
// lise öğrencisi İnkılap alamaz, ortaokul Fizik alamaz; sınıf-dışı düzey dersi ALABİLİR).
// Grup-bazlı olduğu için s_UUID sınıf-kodu tuzağı burada YOKTUR (cls hiç parse edilmez —
// rehberlik-konu-takibi-fix kuralı).
export function levelPoolFrom(classes: readonly LevelClass[], group: string): string[] {
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

// Bir öğrenciye bu öğretmenin verebileceği etüt dersleri — decideBooking kural 8'in
// (`teacher.branches.includes(d) && levelPool.includes(d)`) İSTEMCİ karşılığı.
// Tek aday varsa bookEtut/autoPickBranch onu otomatik seçer; birden fazlaysa istemci
// SORMAK ZORUNDA — aksi halde sunucu 'Geçersiz veya seçilmemiş ders' ile reddeder.
export function etutBranchCandidates(teacherBranches: readonly string[], levelPool: readonly string[]): string[] {
  return teacherBranches.filter((b) => levelPool.includes(b));
}
