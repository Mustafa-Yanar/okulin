import redis from '@/lib/db';
import {
  STUDENT_GROUPS, classToGroup, classLabel,
  allowedBranchesForClass, colKeyForClass, COL_COURSES,
} from '@/lib/constants';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// SQL satırı → mevcut sözleşme şekli (id = legacyId; student.cls === class.id korunur).
function classFromRow(c) {
  return { id: c.legacyId, ad: c.ad, group: c.group, kademe: c.kademe, duzey: c.duzey, dal: c.dal, dersler: c.dersler || [], seeded: c.seeded };
}

// Şube (sınıf) registry — sabit-koddan veriye geçiş. Şube = düzey altına ELLE açılan,
// serbest isimli birim ("8-A" / "801" / "Einstein"). İç kimlik (id) SABİT — Redis/yoklama/
// program/deneme hep ona bağlanır; etiket (ad) serbest değişir.
//
// Registry BOŞSA constants'tan türetilen sanal liste döner (geriye-uyum). Tenant-scoped.
// `group` alanı köprüdür: mevcut çözücü/etüt/constants 'ortaokul|lise|mezun' bekler.

const CLASSES_SET = 'classes';
const classKey = (id) => `sinif:${id}`;

// Sınıf kodundan düzey (grade) türet — fallback/seed metadata'sı için.
export function duzeyOf(cls) {
  if (cls.startsWith('m')) return 'mezun';
  const g = Math.floor(parseInt(cls) / 100);
  return ({ 7: '7', 8: '8', 1: '9', 2: '10', 3: '11', 4: '12' })[g] || String(g);
}

// Sınıf kodundan dal (sayisal/ea) — colKeyForClass üzerinden, yoksa null.
export function dalOf(cls) {
  const ck = colKeyForClass(cls);
  if (ck.includes('Sayısal')) return 'sayisal';
  if (ck.includes('Eşit')) return 'ea';
  return null;
}

// Yeni şube için varsayılan ders kümesi (düzey/dal şablonundan prefill). Kurum sonra
// per-şube ekler/çıkarır. COL_COURSES çekirdek anahtarlarını döner (= ders kataloğu key'leri).
export function defaultCoursesFor(kademe, duzey, dal) {
  if (kademe === 'mezun') return COL_COURSES[dal === 'ea' ? 'Mezun Eşit Ağırlık' : 'Mezun Sayısal'] || [];
  if (kademe === 'ortaokul') return COL_COURSES[duzey === '8' ? 'Ortaokul_8' : 'Ortaokul_7'] || [];
  if (kademe === 'lise') {
    if (duzey === '9' || duzey === '10') return COL_COURSES[`Lise Ortak_${duzey}`] || [];
    if (duzey === '11') return COL_COURSES[dal === 'ea' ? 'Lise Eşit Ağırlık_11' : 'Lise Sayısal_11'] || [];
    if (duzey === '12') return COL_COURSES[dal === 'ea' ? 'Lise Eşit Ağırlık_12' : 'Lise Sayısal_12'] || [];
  }
  return []; // ilkokul vb. — şablon Faz 2+, kurum elle doldurur
}

// Constants → şube listesi (fallback + seed kaynağı). id = eski kod ('701','m1') → SABİT
// kimlik korunur, mevcut öğrenci.cls + program/slot anahtarları geçerli kalır.
export function classesFromConstants() {
  const out = [];
  for (const def of Object.values(STUDENT_GROUPS)) {
    for (const cls of def.classes) {
      out.push({
        id: cls,
        ad: classLabel(cls),
        group: classToGroup(cls),  // köprü: ortaokul|lise|mezun
        kademe: classToGroup(cls), // facet kademesi (ilkokul henüz yok)
        duzey: duzeyOf(cls),
        dal: dalOf(cls),
        dersler: allowedBranchesForClass(cls), // şube → gördüğü dersler
        seeded: false,
      });
    }
  }
  return out;
}

// Tüm şubeler — registry varsa oradan, yoksa constants fallback.
export async function getClasses() {
  if (isSqlEnabled()) {
    const rows = await tdb().class.findMany();
    if (!rows.length) return classesFromConstants();
    return rows.map(classFromRow);
  }
  const ids = await redis.smembers(CLASSES_SET);
  if (!ids || ids.length === 0) return classesFromConstants();
  const pipe = redis.pipeline();
  ids.forEach((id) => pipe.get(classKey(id)));
  const recs = await pipe.exec();
  return recs.filter(Boolean);
}

// Tek şube — registry varsa oradan, yoksa constants fallback.
export async function getClass(id) {
  if (isSqlEnabled()) {
    const row = await tdb().class.findFirst({ where: { legacyId: id } });
    if (row) return classFromRow(row);
    // registry'de yoksa constants fallback (tohumlanmamış kurum davranışı)
    const cnt = await tdb().class.count();
    return cnt ? null : (classesFromConstants().find((c) => c.id === id) || null);
  }
  const ids = await redis.smembers(CLASSES_SET);
  if (!ids || ids.length === 0) {
    return classesFromConstants().find((c) => c.id === id) || null;
  }
  return (await redis.get(classKey(id))) || null;
}

// Constants şube listesini gerçek kayıtlara dök (registry doldur). overwrite=false →
// zaten doluysa dokunma. Adım 4 CRUD / Adım 6 reseed bunu çağırır.
export async function seedClassesFromConstants({ overwrite = false } = {}) {
  if (isSqlEnabled()) {
    // Class tablosu boşsa constants şubelerini SQL'e materialize et. Yoksa: ilk şube
    // eklenince getClasses fallback (rows.length===0) kapanır → ~34 sanal şube kaybolur.
    const cnt = await tdb().class.count();
    if (cnt > 0 && !overwrite) return { seeded: 0, skipped: true };
    const list = classesFromConstants();
    await tdb().class.createMany({ data: list.map((c) => ({
      legacyId: c.id, ad: c.ad, group: c.group, kademe: c.kademe,
      duzey: c.duzey || null, dal: c.dal || null, dersler: c.dersler || [], seeded: true,
    })) });
    return { seeded: list.length };
  }
  const existing = await redis.smembers(CLASSES_SET);
  if (existing && existing.length && !overwrite) return { seeded: 0, skipped: true };
  const list = classesFromConstants();
  for (const c of list) {
    await redis.sadd(CLASSES_SET, c.id);
    await redis.set(classKey(c.id), { ...c, seeded: true });
  }
  return { seeded: list.length };
}
