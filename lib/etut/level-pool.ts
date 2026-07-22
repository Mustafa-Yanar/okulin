// Düzey (grup) ders havuzu — DB sarmalayıcıları. Saf çekirdek (levelPoolFrom, FALLBACK_KEYS,
// etutBranchCandidates) ./level-pool-core.ts'te ve İSTEMCİ de oradan okur; bu dosya Prisma'ya
// bağlıdır (getClasses/getClass), istemciden import EDİLEMEZ.
import { getClasses, getClass } from '@/lib/classes';
import { levelPoolFrom } from './level-pool-core';

export { levelPoolFrom, etutBranchCandidates, FALLBACK_KEYS, type LevelClass } from './level-pool-core';

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
