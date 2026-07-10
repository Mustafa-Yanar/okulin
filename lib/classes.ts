import { colKeyForClass, COL_COURSES } from '@/lib/constants';
import { tdb } from '@/lib/sqldb';
import type { Class } from '@prisma/client';

// Şube kaydının dışa dönük sözleşme şekli (id = legacyId).
export interface ClassRecord {
  id: string;
  ad: string;
  group: string;
  kademe: string;
  duzey: string | null;
  dal: string | null;
  dersler: string[];
  seeded: boolean;
  slotTemplate: unknown;
}

// SQL satırı → mevcut sözleşme şekli (id = legacyId; student.cls === class.id korunur).
function classFromRow(c: Class): ClassRecord {
  return { id: c.legacyId, ad: c.ad, group: c.group, kademe: c.kademe, duzey: c.duzey, dal: c.dal, dersler: c.dersler || [], seeded: c.seeded, slotTemplate: c.slotTemplate || null };
}

// Şube (sınıf) registry — sabit-koddan veriye geçiş. Şube = düzey altına ELLE açılan,
// serbest isimli birim ("8-A" / "801" / "Einstein"). İç kimlik (id) SABİT — Redis/yoklama/
// program/deneme hep ona bağlanır; etiket (ad) serbest değişir.
//
// Yeni kurum BOŞ başlar (auto-seed yok) — müdür şubeleri elle oluşturur. Tenant-scoped.
// `group` alanı köprüdür: mevcut çözücü/etüt/constants 'ortaokul|lise|mezun' bekler.

// Sınıf kodundan düzey (grade) türet — fallback/seed metadata'sı için.
export function duzeyOf(cls: string): string {
  if (cls.startsWith('m')) return 'mezun';
  const g = Math.floor(parseInt(cls) / 100);
  return ({ 7: '7', 8: '8', 1: '9', 2: '10', 3: '11', 4: '12' } as Record<number, string>)[g] || String(g);
}

// Sınıf kodundan dal (sayisal/ea) — colKeyForClass üzerinden, yoksa null.
export function dalOf(cls: string): string | null {
  const ck = colKeyForClass(cls);
  if (ck.includes('Sayısal')) return 'sayisal';
  if (ck.includes('Eşit')) return 'ea';
  return null;
}

// Yeni şube için varsayılan ders kümesi (düzey/dal şablonundan prefill). Kurum sonra
// per-şube ekler/çıkarır. COL_COURSES çekirdek anahtarlarını döner (= ders kataloğu key'leri).
export function defaultCoursesFor(kademe: string, duzey: string | null | undefined, dal: string | null | undefined): string[] {
  if (kademe === 'mezun') return COL_COURSES[dal === 'ea' ? 'Mezun Eşit Ağırlık' : 'Mezun Sayısal'] || [];
  if (kademe === 'ortaokul') return COL_COURSES[duzey === '8' ? 'Ortaokul_8' : 'Ortaokul_7'] || [];
  if (kademe === 'lise') {
    if (duzey === '9' || duzey === '10') return COL_COURSES[`Lise Ortak_${duzey}`] || [];
    if (duzey === '11') return COL_COURSES[dal === 'ea' ? 'Lise Eşit Ağırlık_11' : 'Lise Sayısal_11'] || [];
    if (duzey === '12') return COL_COURSES[dal === 'ea' ? 'Lise Eşit Ağırlık_12' : 'Lise Sayısal_12'] || [];
  }
  return []; // ilkokul vb. — şablon Faz 2+, kurum elle doldurur
}

// Tüm şubeler — kurum kendi oluşturmadıysa boş liste döner (auto-seed yok).
export async function getClasses(): Promise<ClassRecord[]> {
  const rows = await tdb().class.findMany();
  return rows.map(classFromRow);
}

// Tek şube.
export async function getClass(id: string): Promise<ClassRecord | null> {
  const row = await tdb().class.findFirst({ where: { legacyId: id } });
  return row ? classFromRow(row) : null;
}
