import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';
import {
  getClasses, defaultCoursesFor, seedClassesFromConstants,
} from '@/lib/classes';
import { getCourses } from '@/lib/courses';
import { tdb } from '@/lib/sqldb';

export const runtime = 'nodejs';

// SQL satırı → mevcut sözleşme şekli (id = legacyId).
const classOut = (c) => ({ id: c.legacyId, ad: c.ad, kademe: c.kademe, duzey: c.duzey, dal: c.dal, group: c.group, dersler: c.dersler || [], seeded: c.seeded, slotTemplate: c.slotTemplate || null });

import { newId } from '@/lib/id';
const newClassId = () => newId('s_');

// Kademe → köprü grubu (mevcut çözücü/etüt 'ortaokul|lise|mezun' bekler).
function groupForKademe(kademe) {
  if (kademe === 'mezun') return 'mezun';
  if (kademe === 'ortaokul') return 'ortaokul';
  if (kademe === 'lise') return 'lise';
  return kademe; // ilkokul → 'ilkokul' (çözücü kapsamı dışı, Faz 2+)
}

// GET /api/classes — geçerli kurumun şube listesi + ders kataloğu (tüm roller okur).
export const GET = withAuth(async () => {
  const [classes, courses] = await Promise.all([getClasses(), getCourses()]);
  return NextResponse.json({ classes, courses });
});

const CreateClassSchema = z.object({
  ad: z.string().min(1).max(60),
  kademe: z.enum(['ilkokul', 'ortaokul', 'lise', 'mezun']),
  duzey: z.string().max(10).optional(),
  dal: z.enum(['sayisal', 'sozel', 'ea', 'dil']).nullable().optional(),
  dersler: z.array(z.string().max(60)).optional(),
});

// POST /api/classes — yeni şube oluştur (müdür/rehber).
export const POST = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, CreateClassSchema);
  if (!parsed.ok) return parsed.response;
  const { ad, kademe, duzey, dal, dersler } = parsed.data;

  await seedClassesFromConstants(); // Class boşsa constants'ı materialize et (yeni kurumda 34 şube kaybolmasın)
  const row = await tdb().class.create({ data: {
    legacyId: newClassId(), ad: ad.trim(), kademe, duzey: duzey || null, dal: dal || null,
    group: groupForKademe(kademe),
    dersler: (dersler && dersler.length) ? dersler : defaultCoursesFor(kademe, duzey, dal),
    seeded: true,
  } });
  return NextResponse.json({ ok: true, class: classOut(row) });
});

// slotTemplate: gün (0-6) → o gün işaretli ders NO'ları (1-tabanlı). KATI pencere.
const zSlotTemplate = z.record(
  z.string().regex(/^[0-6]$/),
  z.array(z.number().int().min(1).max(16)),
);

const UpdateClassSchema = z.object({
  id: z.string().min(1).max(60),
  ad: z.string().min(1).max(60).optional(),
  dal: z.enum(['sayisal', 'sozel', 'ea', 'dil']).nullable().optional(),
  dersler: z.array(z.string().max(60)).optional(),
  slotTemplate: zSlotTemplate.nullable().optional(),
});

// PATCH /api/classes — şube düzenle (ad / dal / ders ataması / slotTemplate). id SABİT, asla değişmez.
export const PATCH = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, UpdateClassSchema);
  if (!parsed.ok) return parsed.response;
  const { id, ad, dal, dersler, slotTemplate } = parsed.data;

  const existing = await tdb().class.findFirst({ where: { legacyId: id } });
  if (!existing) return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });
  const patch = {};
  if (ad !== undefined) patch.ad = ad.trim();
  if (dal !== undefined) patch.dal = dal || null;
  if (dersler !== undefined) patch.dersler = dersler;
  if (slotTemplate !== undefined) {
    // Boş dizileri temizle → sadece slotu olan günleri sakla (null = hiç işaret yok).
    if (slotTemplate === null) patch.slotTemplate = null;
    else {
      const cleaned = {};
      for (const [d, nos] of Object.entries(slotTemplate)) {
        const arr = [...new Set(nos)].sort((a, b) => a - b);
        if (arr.length) cleaned[d] = arr;
      }
      patch.slotTemplate = Object.keys(cleaned).length ? cleaned : null;
    }
  }
  const row = await tdb().class.update({ where: { id: existing.id }, data: patch });
  return NextResponse.json({ ok: true, class: classOut(row) });
});

// DELETE /api/classes — şube sil. Öğrenci atanmışsa engelle (önce taşınmalı).
export const DELETE = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, z.object({ id: z.string().min(1).max(60) }));
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  const existing = await tdb().class.findFirst({ where: { legacyId: id } });
  if (!existing) return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });
  const cnt = await tdb().student.count({ where: { classId: existing.id } });
  if (cnt > 0) return NextResponse.json({ error: `Bu şubede ${cnt} öğrenci var. Önce taşıyın/silin.` }, { status: 409 });
  await tdb().class.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
});
