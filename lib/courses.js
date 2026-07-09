import { BRANCHES_BY_GROUP, COL_COURSES, MATH_FAMILY } from '@/lib/constants';
import { tdb } from '@/lib/sqldb';

// Ders kataloğu registry — sabit-koddan veriye geçiş (kurum kendi dersini ekler/çıkarır).
// Registry BOŞSA constants'tan türetilen "sanal" katalog döner (geriye-uyum); böylece
// tohumlanmamış kurum bile bugünkü ders listesiyle çalışır. Tenant-scoped (lib/db Proxy).
//
// İlke: çekirdek derste anahtar = ad (teacher.branches değerleri geçerli kalır). Eklenen
// derste sabit `key` üretilir (CRUD'da), etiket serbest. Özel kurallar (MATH_FAMILY = etüt
// matematik ailesi) yalnız core:true derslerde koda gömülü tetiklenir — düz ders by-pass eder.

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
//
// Kaçak-veri onarımı: registry'ye HENÜZ hiç yazılmamış çekirdek dersler (örn. şubeye
// defaultCoursesFor() ile prefill edilmiş "Matematik", "Fizik" vb. — bunlar createCourse()
// çağrılmadan doğrudan Class.dersler'e yazıldığı için Course tablosunda hiç satırı yok) ama
// halen bir şubenin dersler listesinde kullanılıyorsa, ilk okumada registry'ye otomatik
// eklenir. Böylece registry'ye TEK bir manuel ders eklendiği an (createCourse çağrılınca)
// fallback kapanıp o çekirdek dersler UI'dan tamamen kaybolmuyor.
export async function getCourses() {
  const rows = await tdb().course.findMany();
  if (!rows.length) return coursesFromConstants();

  const byKey = new Map(rows.map((c) => [c.key, c]));
  const fallback = coursesFromConstants();
  const usedKeys = new Set();
  const classRows = await tdb().class.findMany({ select: { dersler: true } });
  for (const c of classRows) for (const d of c.dersler || []) usedKeys.add(d);

  const missing = fallback.filter((c) => usedKeys.has(c.key) && !byKey.has(c.key));
  if (missing.length) {
    for (const c of missing) {
      const created = await tdb().course.create({
        data: { key: c.key, ad: c.ad, core: c.core, family: c.family, active: true },
      }).catch(() => null); // yarış durumunda unique çakışması olursa yok say
      if (created) byKey.set(created.key, created);
    }
  }

  return [...byKey.values()].map((c) => ({ key: c.key, ad: c.ad, core: c.core, family: c.family, active: c.active !== false, seeded: true }));
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

// Yeni ders ekle (benzersiz key üret, core:false). SQL-aware. Döner: { ok, course }
export async function createCourse(ad) {
  const name = String(ad).trim();
  const existing = await tdb().course.findMany({ select: { key: true } });
  const set = new Set(existing.map((c) => c.key));
  let key = courseKeyFromName(name);
  if (set.has(key)) { let i = 2; while (set.has(`${key}-${i}`)) i++; key = `${key}-${i}`; }
  await tdb().course.create({ data: { key, ad: name, core: false, family: null, active: true } });
  return { ok: true, course: { key, ad: name, core: false, family: null, active: true, seeded: true } };
}

// Ders güncelle: ad değiştir ve/veya active aç-kapa (soft delete = active:false). SQL-aware.
export async function updateCourse(key, { ad, active }) {
  const existing = await tdb().course.findFirst({ where: { key } });
  if (!existing) return { ok: false, status: 404, error: 'Ders bulunamadı' };
  const data = {};
  if (ad !== undefined) data.ad = String(ad).trim();
  if (active !== undefined) data.active = active;
  const u = await tdb().course.update({ where: { id: existing.id }, data });
  return { ok: true, course: { key: u.key, ad: u.ad, core: u.core, family: u.family, active: u.active } };
}
