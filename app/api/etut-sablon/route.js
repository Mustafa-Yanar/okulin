import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { slotStartTime, getProgramTemplate, setProgramTemplate } from '@/lib/slots';
import { getWeekKey } from '@/lib/constants';
import { isSqlEnabled } from '@/lib/usesql';

// Etüt şablonları — öğretmenin haftadan bağımsız, serbest saatli etüt blokları.
// program:<teacherId>.etutSablonlari = [ { id, dayIndex, start, end, aktif } ]
// Ders slotlarından (w1-w12) BAĞIMSIZ; gerçek saat bazlı (calendar için).
// SQL modunda: Teacher.programTemplate.etutSablonlari olarak saklanır.

function programKey(teacherId) {
  return `program:${teacherId}`;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'Saat HH:MM olmalı');
const zDay = z.number().int().min(0).max(6);

const SaveSchema = z.object({
  teacherId: zId,
  weekKey: z.string().max(40).optional(),
  sablon: z.object({
    id: z.string().max(20).optional(),
    dayIndex: zDay,
    start: zTime,
    end: zTime,
    aktif: z.boolean().optional(),
  }),
});
const DeleteSchema = z.object({ teacherId: zId, id: z.string().max(20) });

const ToggleSchema = z.object({
  teacherId: zId,
  id: z.string().max(20),
  scope: z.enum(['all', 'week']),
  weekKey: z.string().max(40).optional(),
  aktif: z.boolean(),
});

const AssignSchema = z.object({
  teacherId: zId,
  id: z.string().max(20),
  student: z.object({
    id: zId,
    name: z.string().max(120),
    cls: z.string().max(20).optional(),
  }).nullable(),
});

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// SQL yardımcısı: programTemplate'ten etutSablonlari oku, değiştir, geri yaz
async function updateSablonlar(teacherId, mutFn) {
  const fullTemplate = await getProgramTemplate(teacherId); // SQL-aware
  const list = Array.isArray(fullTemplate.etutSablonlari) ? fullTemplate.etutSablonlari : [];
  const newList = mutFn(list);
  await setProgramTemplate(teacherId, { ...fullTemplate, etutSablonlari: newList }); // SQL-aware
  return newList;
}

// GET /api/etut-sablon?teacherId=...
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  const teacherId = new URL(req.url).searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  if (isSqlEnabled()) {
    const fullTemplate = await getProgramTemplate(teacherId);
    return NextResponse.json({ sablonlar: fullTemplate.etutSablonlari || [] });
  }

  const template = (await redis.get(programKey(teacherId))) || {};
  return NextResponse.json({ sablonlar: template.etutSablonlari || [] });
}

// POST /api/etut-sablon → şablon ekle (id yoksa) veya güncelle (id varsa)
export async function POST(req) {
  const session = await getSession();
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

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

  if (isSqlEnabled()) {
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
  }

  const template = (await redis.get(programKey(teacherId))) || {};
  const list = Array.isArray(template.etutSablonlari) ? template.etutSablonlari : [];

  if (sablon.id) {
    const idx = list.findIndex(s => s.id === sablon.id);
    if (idx === -1) return NextResponse.json({ error: 'Şablon bulunamadı' }, { status: 404 });
    list[idx] = { ...list[idx], ...sablon };
  } else {
    list.push({ id: makeId(), dayIndex: sablon.dayIndex, start: sablon.start, end: sablon.end, aktif: sablon.aktif ?? true });
  }

  template.etutSablonlari = list;
  await redis.set(programKey(teacherId), template);
  return NextResponse.json({ ok: true, sablonlar: list });
}

// PUT /api/etut-sablon → aktif/pasif değiştir
export async function PUT(req) {
  const session = await getSession();
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, ToggleSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, scope, weekKey, aktif } = parsed.data;
  if (scope === 'week' && !weekKey) {
    return NextResponse.json({ error: 'weekKey gerekli' }, { status: 400 });
  }

  if (isSqlEnabled()) {
    const sablonlar = await updateSablonlar(teacherId, (list) => {
      const idx = list.findIndex(s => s.id === id);
      if (idx === -1) return list;
      const sb = { ...list[idx] };
      if (scope === 'all') {
        sb.aktif = aktif;
        if (aktif) sb.pasifHaftalar = [];
      } else {
        const set = new Set(Array.isArray(sb.pasifHaftalar) ? sb.pasifHaftalar : []);
        if (aktif) set.delete(weekKey); else set.add(weekKey);
        sb.pasifHaftalar = Array.from(set);
      }
      const updated = [...list];
      updated[idx] = sb;
      return updated;
    });
    return NextResponse.json({ ok: true, sablonlar });
  }

  const template = (await redis.get(programKey(teacherId))) || {};
  const list = Array.isArray(template.etutSablonlari) ? template.etutSablonlari : [];
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Şablon bulunamadı' }, { status: 404 });

  const sb = { ...list[idx] };
  if (scope === 'all') {
    sb.aktif = aktif;
    if (aktif) sb.pasifHaftalar = [];
  } else {
    const set = new Set(Array.isArray(sb.pasifHaftalar) ? sb.pasifHaftalar : []);
    if (aktif) set.delete(weekKey); else set.add(weekKey);
    sb.pasifHaftalar = Array.from(set);
  }
  list[idx] = sb;
  template.etutSablonlari = list;
  await redis.set(programKey(teacherId), template);
  return NextResponse.json({ ok: true, sablonlar: list });
}

// PATCH /api/etut-sablon → şablona öğrenci ata / kaldır
export async function PATCH(req) {
  const session = await getSession();
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, AssignSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, student } = parsed.data;

  if (isSqlEnabled()) {
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
  }

  const template = (await redis.get(programKey(teacherId))) || {};
  const list = Array.isArray(template.etutSablonlari) ? template.etutSablonlari : [];
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) return NextResponse.json({ error: 'Şablon bulunamadı' }, { status: 404 });

  const sb = { ...list[idx] };
  if (student) {
    sb.studentId = student.id;
    sb.studentName = student.name;
    sb.studentCls = student.cls || '';
    sb.bookedBy = session.role;
  } else {
    delete sb.studentId; delete sb.studentName; delete sb.studentCls; delete sb.bookedBy;
  }
  list[idx] = sb;
  template.etutSablonlari = list;
  await redis.set(programKey(teacherId), template);
  return NextResponse.json({ ok: true, sablonlar: list });
}

// DELETE /api/etut-sablon → şablon sil
export async function DELETE(req) {
  const session = await getSession();
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id } = parsed.data;

  if (isSqlEnabled()) {
    const sablonlar = await updateSablonlar(teacherId, (list) => list.filter(s => s.id !== id));
    return NextResponse.json({ ok: true, sablonlar });
  }

  const template = (await redis.get(programKey(teacherId))) || {};
  const list = Array.isArray(template.etutSablonlari) ? template.etutSablonlari : [];
  template.etutSablonlari = list.filter(s => s.id !== id);
  await redis.set(programKey(teacherId), template);
  return NextResponse.json({ ok: true, sablonlar: template.etutSablonlari });
}
