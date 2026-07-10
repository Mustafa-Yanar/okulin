import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { slotStartTime, getProgramTemplate, setProgramTemplate, type EtutSablonu } from '@/lib/slots';
import { getWeekKey } from '@/lib/constants';

// Etüt şablonları — öğretmenin haftadan bağımsız, serbest saatli etüt blokları.
// program:<teacherId>.etutSablonlari = [ { id, dayIndex, start, end, aktif } ]
// Ders slotlarından (w1-w12) BAĞIMSIZ; gerçek saat bazlı (calendar için).
// Teacher.programTemplate.etutSablonlari olarak saklanır (SQL).

import { newId as makeId } from '@/lib/id';

const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'Saat HH:MM olmalı');
const zDay = z.number().int().min(0).max(6);

const SaveSchema = z.object({
  teacherId: zId,
  weekKey: z.string().max(40).optional(),
  sablon: z.object({
    id: zId.optional(),
    dayIndex: zDay,
    start: zTime,
    end: zTime,
    aktif: z.boolean().optional(),
  }),
});
const DeleteSchema = z.object({ teacherId: zId, id: zId });

const ToggleSchema = z.object({
  teacherId: zId,
  id: zId,
  scope: z.enum(['all', 'week']),
  weekKey: z.string().max(40).optional(),
  aktif: z.boolean(),
});

const AssignSchema = z.object({
  teacherId: zId,
  id: zId,
  student: z.object({
    id: zId,
    name: z.string().max(120),
    // cls = sınıf legacyId'si — yeni sınıflar 's_'+UUID (38 kr), classes route max(60) ile uyumlu
    cls: z.string().max(60).optional(),
  }).nullable(),
});

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// programTemplate'ten etutSablonlari oku, değiştir, geri yaz
async function updateSablonlar(teacherId: string, mutFn: (list: EtutSablonu[]) => EtutSablonu[]) {
  const fullTemplate = await getProgramTemplate(teacherId);
  const list: EtutSablonu[] = Array.isArray(fullTemplate.etutSablonlari) ? (fullTemplate.etutSablonlari as EtutSablonu[]) : [];
  const newList = mutFn(list);
  await setProgramTemplate(teacherId, { ...fullTemplate, etutSablonlari: newList });
  return newList;
}

// GET /api/etut-sablon?teacherId=...
export const GET = withAuth(async (req) => {
  const teacherId = new URL(req.url).searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  const fullTemplate = await getProgramTemplate(teacherId);
  return NextResponse.json({ sablonlar: (fullTemplate.etutSablonlari as EtutSablonu[] | undefined) || [] });
});

// POST /api/etut-sablon → şablon ekle (id yoksa) veya güncelle (id varsa)
export const POST = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, SaveSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, sablon, weekKey: wk } = parsed.data;
  const weekKey = wk || getWeekKey();

  if (toMin(sablon.end) <= toMin(sablon.start)) {
    return NextResponse.json({ error: 'Bitiş saati başlangıçtan sonra olmalı' }, { status: 400 });
  }

  const startAt = slotStartTime(weekKey, sablon.dayIndex, sablon.start);
  if (startAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Geçmiş bir gün/saate etüt eklenemez' }, { status: 400 });
  }

  const sablonlar = await updateSablonlar(teacherId, (list) => {
    if (sablon.id) {
      const idx = list.findIndex(s => s.id === sablon.id);
      if (idx === -1) return list;
      const updated = [...list];
      updated[idx] = { ...updated[idx], ...sablon };
      return updated;
    } else {
      return [...list, { id: makeId(), dayIndex: sablon.dayIndex, start: sablon.start, end: sablon.end, aktif: sablon.aktif ?? true }];
    }
  });
  return NextResponse.json({ ok: true, sablonlar });
});

// PUT /api/etut-sablon → aktif/pasif değiştir
export const PUT = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, ToggleSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, scope, weekKey, aktif } = parsed.data;
  if (scope === 'week' && !weekKey) {
    return NextResponse.json({ error: 'weekKey gerekli' }, { status: 400 });
  }

  const sablonlar = await updateSablonlar(teacherId, (list) => {
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return list;
    const sb = { ...list[idx] };
    if (scope === 'all') {
      sb.aktif = aktif;
      if (aktif) sb.pasifHaftalar = [];
    } else {
      const set = new Set(Array.isArray(sb.pasifHaftalar) ? sb.pasifHaftalar : []);
      if (aktif) set.delete(weekKey as string); else set.add(weekKey as string);
      sb.pasifHaftalar = Array.from(set);
    }
    const updated = [...list];
    updated[idx] = sb;
    return updated;
  });
  return NextResponse.json({ ok: true, sablonlar });
});

// PATCH /api/etut-sablon → şablona öğrenci ata / kaldır
export const PATCH = withAuth('manage', async (req, ctx, session) => {
  const parsed = await parseBody(req, AssignSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, student } = parsed.data;

  const sablonlar = await updateSablonlar(teacherId, (list) => {
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return list;
    const sb = { ...list[idx] };
    if (student) {
      sb.studentId = student.id;
      sb.studentName = student.name;
      sb.studentCls = student.cls || '';
      sb.bookedBy = session.role;
    } else {
      delete sb.studentId; delete sb.studentName; delete sb.studentCls; delete sb.bookedBy;
    }
    const updated = [...list];
    updated[idx] = sb;
    return updated;
  });
  return NextResponse.json({ ok: true, sablonlar });
});

// DELETE /api/etut-sablon → şablon sil
export const DELETE = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id } = parsed.data;

  const sablonlar = await updateSablonlar(teacherId, (list) => list.filter(s => s.id !== id));
  return NextResponse.json({ ok: true, sablonlar });
});
