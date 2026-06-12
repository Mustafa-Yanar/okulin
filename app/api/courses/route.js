import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';
import {
  getCourses, courseKeyFromName, seedCoursesFromConstants,
} from '@/lib/courses';

export const runtime = 'nodejs';

const COURSES_SET = 'dersler';
const courseKey = (key) => `ders:${key}`;

// GET /api/courses — ders kataloğu (tüm roller okur).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  const courses = await getCourses();
  return NextResponse.json({ courses });
}

const CreateCourseSchema = z.object({
  ad: z.string().min(1).max(60),
});

// POST /api/courses — kuruma yeni ders ekle (müdür/rehber). core:false → özel kural taşımaz.
export async function POST(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, CreateCourseSchema);
  if (!parsed.ok) return parsed.response;
  const ad = parsed.data.ad.trim();

  await seedCoursesFromConstants(); // çekirdek katalog gerçek kayda dönsün

  // Benzersiz anahtar üret (çakışmada sonek)
  const existing = new Set(await redis.smembers(COURSES_SET));
  let key = courseKeyFromName(ad);
  if (existing.has(key)) {
    let i = 2;
    while (existing.has(`${key}-${i}`)) i++;
    key = `${key}-${i}`;
  }

  const rec = {
    key, ad, core: false, family: null, active: true,
    seeded: true, createdAt: new Date().toISOString(),
  };
  await redis.sadd(COURSES_SET, key);
  await redis.set(courseKey(key), rec);
  return NextResponse.json({ ok: true, course: rec });
}

const UpdateCourseSchema = z.object({
  key: z.string().min(1).max(80),
  ad: z.string().min(1).max(60).optional(),
  active: z.boolean().optional(),
});

// PATCH /api/courses — ders adını değiştir / pasifleştir-aktifleştir. key SABİT kalır.
export async function PATCH(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, UpdateCourseSchema);
  if (!parsed.ok) return parsed.response;
  const { key, ad, active } = parsed.data;

  await seedCoursesFromConstants();
  const rec = await redis.get(courseKey(key));
  if (!rec) return NextResponse.json({ error: 'Ders bulunamadı' }, { status: 404 });

  const next = { ...rec };
  if (ad !== undefined) next.ad = ad.trim();
  if (active !== undefined) next.active = active;
  await redis.set(courseKey(key), next);
  return NextResponse.json({ ok: true, course: next });
}

// DELETE /api/courses — dersi pasifleştir (soft delete; geçmiş/program bozulmaz).
export async function DELETE(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, z.object({ key: z.string().min(1).max(80) }));
  if (!parsed.ok) return parsed.response;
  const { key } = parsed.data;

  await seedCoursesFromConstants();
  const rec = await redis.get(courseKey(key));
  if (!rec) return NextResponse.json({ error: 'Ders bulunamadı' }, { status: 404 });

  await redis.set(courseKey(key), { ...rec, active: false });
  return NextResponse.json({ ok: true });
}
