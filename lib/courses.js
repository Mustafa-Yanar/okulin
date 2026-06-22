import redis from '@/lib/db';
import { BRANCHES_BY_GROUP, COL_COURSES, MATH_FAMILY } from '@/lib/constants';
import { useSql } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// Ders kataloğu registry — sabit-koddan veriye geçiş (kurum kendi dersini ekler/çıkarır).
// Registry BOŞSA constants'tan türetilen "sanal" katalog döner (geriye-uyum); böylece
// tohumlanmamış kurum bile bugünkü ders listesiyle çalışır. Tenant-scoped (lib/db Proxy).
//
// İlke: çekirdek derste anahtar = ad (teacher.branches değerleri geçerli kalır). Eklenen
// derste sabit `key` üretilir (CRUD'da), etiket serbest. Özel kurallar (MATH_FAMILY = etüt
// matematik ailesi) yalnız core:true derslerde koda gömülü tetiklenir — düz ders by-pass eder.

const COURSES_SET = 'dersler';
const courseKey = (key) => `ders:${key}`;

// Constants → ders kataloğu (fallback + seed kaynağı). BRANCHES_BY_GROUP ∪ COL_COURSES.
export function coursesFromConstants() {
  const names = new Set();
  Object.values(BRANCHES_BY_GROUP).forEach((arr) => arr.forEach((n) => names.add(n)));
  Object.values(COL_COURSES).forEach((arr) => arr.forEach((n) => names.add(n)));
  return [...names].map((name) => ({
    key: name,
    ad: name,
    core: true,
    family: MATH_FAMILY.includes(name) ? 'matematik' : null,
    seeded: false,
  }));
}

// Tüm dersler — registry varsa oradan, yoksa constants fallback.
// active alanı: eski/çekirdek kayıtta yoksa true sayılır (yalnız soft-delete false yapar).
export async function getCourses() {
  if (useSql()) {
    const rows = await tdb().course.findMany();
    if (!rows.length) return coursesFromConstants();
    return rows.map((c) => ({ key: c.key, ad: c.ad, core: c.core, family: c.family, active: c.active !== false, seeded: true }));
  }
  const keys = await redis.smembers(COURSES_SET);
  if (!keys || keys.length === 0) return coursesFromConstants();
  const pipe = redis.pipeline();
  keys.forEach((kk) => pipe.get(courseKey(kk)));
  const recs = await pipe.exec();
  return recs.filter(Boolean).map((c) => ({ ...c, active: c.active !== false }));
}

// Ders adından sabit anahtar (slug) — Türkçe karakter sadeleştirir. Çekirdek değil,
// kurum-eklemeli derslerde kullanılır (çakışmada çağıran sonek ekler).
export function courseKeyFromName(ad) {
  const slug = String(ad).toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || ('ders-' + Math.random().toString(36).slice(2, 8));
}

// Constants kataloğunu gerçek kayıtlara dök (registry doldur). overwrite=false → zaten
// doluysa dokunma. Adım 4 CRUD / Adım 6 reseed bunu çağırır.
export async function seedCoursesFromConstants({ overwrite = false } = {}) {
  if (useSql()) return { seeded: 0, skipped: true }; // SQL'de veri göçle hazır
  const existing = await redis.smembers(COURSES_SET);
  if (existing && existing.length && !overwrite) return { seeded: 0, skipped: true };
  const list = coursesFromConstants();
  for (const c of list) {
    await redis.sadd(COURSES_SET, c.key);
    await redis.set(courseKey(c.key), { ...c, seeded: true });
  }
  return { seeded: list.length };
}
