import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';
import {
  getClasses, getClass, defaultCoursesFor, seedClassesFromConstants,
} from '@/lib/classes';
import { getCourses, seedCoursesFromConstants } from '@/lib/courses';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

export const runtime = 'nodejs';

// SQL satırı → mevcut sözleşme şekli (id = legacyId).
const classOut = (c) => ({ id: c.legacyId, ad: c.ad, kademe: c.kademe, duzey: c.duzey, dal: c.dal, group: c.group, dersler: c.dersler || [], seeded: c.seeded });

const CLASSES_SET = 'classes';
const classKey = (id) => `sinif:${id}`;
const newClassId = () => 's_' + Math.random().toString(36).slice(2, 10);

// Kademe → köprü grubu (mevcut çözücü/etüt 'ortaokul|lise|mezun' bekler).
function groupForKademe(kademe) {
  if (kademe === 'mezun') return 'mezun';
  if (kademe === 'ortaokul') return 'ortaokul';
  if (kademe === 'lise') return 'lise';
  return kademe; // ilkokul → 'ilkokul' (çözücü kapsamı dışı, Faz 2+)
}

// İlk yazma anında registry'yi constants'tan materyalize et (mevcut sınıflar gerçek kayda
// dönüşsün, yenisi onların YANINA eklensin — yoksa tek kayıt kalır, fallback bozulurdu).
async function ensureMaterialized() {
  await seedClassesFromConstants();   // no-op if already seeded
  await seedCoursesFromConstants();
}

// GET /api/classes — geçerli kurumun şube listesi + ders kataloğu (tüm roller okur).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const [classes, courses] = await Promise.all([getClasses(), getCourses()]);
  return NextResponse.json({ classes, courses });
}

const CreateClassSchema = z.object({
  ad: z.string().min(1).max(60),
  kademe: z.enum(['ilkokul', 'ortaokul', 'lise', 'mezun']),
  duzey: z.string().max(10).optional(),
  dal: z.enum(['sayisal', 'sozel', 'ea', 'dil']).nullable().optional(),
  dersler: z.array(z.string().max(60)).optional(),
});

// POST /api/classes — yeni şube oluştur (müdür/rehber).
export async function POST(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, CreateClassSchema);
  if (!parsed.ok) return parsed.response;
  const { ad, kademe, duzey, dal, dersler } = parsed.data;

  if (isSqlEnabled()) {
    await seedClassesFromConstants(); // Class boşsa constants'ı materialize et (yeni kurumda 34 şube kaybolmasın)
    const row = await tdb().class.create({ data: {
      legacyId: newClassId(), ad: ad.trim(), kademe, duzey: duzey || null, dal: dal || null,
      group: groupForKademe(kademe),
      dersler: (dersler && dersler.length) ? dersler : defaultCoursesFor(kademe, duzey, dal),
      seeded: true,
    } });
    return NextResponse.json({ ok: true, class: classOut(row) });
  }

  await ensureMaterialized();

  const id = newClassId();
  const rec = {
    id,
    ad: ad.trim(),
    kademe,
    duzey: duzey || null,
    dal: dal || null,
    group: groupForKademe(kademe),
    dersler: (dersler && dersler.length) ? dersler : defaultCoursesFor(kademe, duzey, dal),
    seeded: true,
    createdAt: new Date().toISOString(),
  };
  await redis.sadd(CLASSES_SET, id);
  await redis.set(classKey(id), rec);
  return NextResponse.json({ ok: true, class: rec });
}

const UpdateClassSchema = z.object({
  id: z.string().min(1).max(60),
  ad: z.string().min(1).max(60).optional(),
  dal: z.enum(['sayisal', 'sozel', 'ea', 'dil']).nullable().optional(),
  dersler: z.array(z.string().max(60)).optional(),
});

// PATCH /api/classes — şube düzenle (ad / dal / ders ataması). id SABİT, asla değişmez.
export async function PATCH(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, UpdateClassSchema);
  if (!parsed.ok) return parsed.response;
  const { id, ad, dal, dersler } = parsed.data;

  if (isSqlEnabled()) {
    const existing = await tdb().class.findFirst({ where: { legacyId: id } });
    if (!existing) return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });
    const patch = {};
    if (ad !== undefined) patch.ad = ad.trim();
    if (dal !== undefined) patch.dal = dal || null;
    if (dersler !== undefined) patch.dersler = dersler;
    const row = await tdb().class.update({ where: { id: existing.id }, data: patch });
    return NextResponse.json({ ok: true, class: classOut(row) });
  }

  await ensureMaterialized();
  const rec = await redis.get(classKey(id));
  if (!rec) return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });

  const next = { ...rec };
  if (ad !== undefined) next.ad = ad.trim();
  if (dal !== undefined) next.dal = dal || null;
  if (dersler !== undefined) next.dersler = dersler;
  await redis.set(classKey(id), next);
  return NextResponse.json({ ok: true, class: next });
}

// DELETE /api/classes — şube sil. Öğrenci atanmışsa engelle (önce taşınmalı).
export async function DELETE(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, z.object({ id: z.string().min(1).max(60) }));
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  if (isSqlEnabled()) {
    const existing = await tdb().class.findFirst({ where: { legacyId: id } });
    if (!existing) return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });
    const cnt = await tdb().student.count({ where: { classId: existing.id } });
    if (cnt > 0) return NextResponse.json({ error: `Bu şubede ${cnt} öğrenci var. Önce taşıyın/silin.` }, { status: 409 });
    await tdb().class.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  }

  const rec = await getClass(id);
  if (!rec) return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });

  // Bu şubede öğrenci var mı? Varsa silme — önce taşınmalı.
  const studentIds = await redis.smembers('students');
  if (studentIds && studentIds.length) {
    const pipe = redis.pipeline();
    studentIds.forEach((sid) => pipe.get(`student:${sid}`));
    const recs = await pipe.exec();
    const count = recs.filter((s) => s && s.cls === id).length;
    if (count > 0) {
      return NextResponse.json({ error: `Bu şubede ${count} öğrenci var. Önce taşıyın/silin.` }, { status: 409 });
    }
  }

  await ensureMaterialized();
  await redis.srem(CLASSES_SET, id);
  await redis.del(classKey(id));
  return NextResponse.json({ ok: true });
}
