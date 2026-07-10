import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';
import { getCourses, createCourse, updateCourse } from '@/lib/courses';

export const runtime = 'nodejs';

// GET /api/courses — ders kataloğu (tüm roller okur).
export const GET = withAuth(async () => {
  const courses = await getCourses();
  return NextResponse.json({ courses });
});

const CreateCourseSchema = z.object({
  ad: z.string().min(1).max(60),
});

// POST /api/courses — kuruma yeni ders ekle (müdür/rehber). core:false → özel kural taşımaz.
export const POST = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, CreateCourseSchema);
  if (!parsed.ok) return parsed.response;

  const { course } = await createCourse(parsed.data.ad); // SQL-aware
  return NextResponse.json({ ok: true, course });
});

const UpdateCourseSchema = z.object({
  key: z.string().min(1).max(80),
  ad: z.string().min(1).max(60).optional(),
  active: z.boolean().optional(),
});

// PATCH /api/courses — ders adını değiştir / pasifleştir-aktifleştir. key SABİT kalır.
export const PATCH = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, UpdateCourseSchema);
  if (!parsed.ok) return parsed.response;
  const { key, ad, active } = parsed.data;

  const r = await updateCourse(key, { ad, active }); // SQL-aware
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
  return NextResponse.json({ ok: true, course: r.course });
});

// DELETE /api/courses — dersi pasifleştir (soft delete; geçmiş/program bozulmaz).
export const DELETE = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, z.object({ key: z.string().min(1).max(80) }));
  if (!parsed.ok) return parsed.response;
  const { key } = parsed.data;

  const r = await updateCourse(key, { active: false }); // soft delete, SQL-aware
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
  return NextResponse.json({ ok: true });
});
