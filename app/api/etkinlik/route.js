import { NextResponse } from 'next/server';
import { getSession, isManager } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { getClass } from '@/lib/classes';
import { tdb } from '@/lib/sqldb';

// Etkinlik / Okul Takvimi — kurum geneli bilgilendirme takvimi (tatil, sınav, toplantı, gezi…).
// Müdür/rehber oluşturur/düzenler/siler. Öğrenci/veli/öğretmen görür (rol+sınıf filtreli).
// classes[] boş → herkes; dolu → yalnız o sınıfların öğrencileri + velileri görür (personel hepsini görür).

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

import { newId as genId } from '@/lib/id';

const TYPES = ['tatil', 'sinav', 'toplanti', 'gezi', 'etkinlik', 'diger'];
const TYPE_LABEL = {
  tatil: 'Tatil', sinav: 'Sınav', toplanti: 'Toplantı', gezi: 'Gezi', etkinlik: 'Etkinlik', diger: 'Diğer',
};

const baseFields = {
  title: z.string().min(1).max(160),
  desc: z.string().max(2000).optional(),
  type: z.enum(TYPES),
  startDate: z.string().min(8).max(20), // YYYY-MM-DD
  endDate: z.string().max(20).optional(), // çok günlü etkinlik bitişi (ops.)
  classes: z.array(z.string().min(1).max(60)).max(60).optional(), // boş/yok = herkes
};
const CreateSchema = z.object({ action: z.literal('create'), ...baseFields });
const UpdateSchema = z.object({ action: z.literal('update'), id: zId, ...baseFields });
const BodySchema = z.discriminatedUnion('action', [CreateSchema, UpdateSchema]);

async function loadAll() {
  const rows = await tdb().etkinlik.findMany({ orderBy: { startDate: 'asc' } });
  return rows.map(r => r.data);
}

async function loadStudents() {
  const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
  return rows.map(s => ({ id: s.legacyId, cls: s.class?.legacyId || '' }));
}

async function loadParents() {
  const rows = await tdb().parent.findMany();
  return rows.map(p => ({ id: p.phone, children: p.children || [] }));
}

// Bir etkinlik bu kullanıcıya görünür mü? (sınıf hedefi boşsa herkese)
function visibleToStudent(ev, cls) {
  const cl = Array.isArray(ev.classes) ? ev.classes : [];
  return cl.length === 0 || cl.includes(cls);
}
function visibleToChildren(ev, childClasses) {
  const cl = Array.isArray(ev.classes) ? ev.classes : [];
  return cl.length === 0 || cl.some(c => childClasses.has(c));
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  let list = await loadAll();

  if (session.role === 'student') {
    list = list.filter(ev => visibleToStudent(ev, session.cls));
  } else if (session.role === 'parent') {
    const childClasses = new Set((session.children || []).map(c => c.cls).filter(Boolean));
    list = list.filter(ev => visibleToChildren(ev, childClasses));
  }
  // müdür/rehber/öğretmen → hepsi

  list.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  return NextResponse.json({ etkinlikler: list, canManage: isManager(session) });
}

// ───────────────────────────────────────── POST ─────────────────────────────────────────
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const { title, desc, type, startDate, endDate, classes } = data;

  // Geçerli şube id'leri (registry-aware). Boş → herkes.
  let valid = [];
  if (Array.isArray(classes) && classes.length > 0) {
    for (const c of classes) { if (await getClass(c)) valid.push(c); }
  }
  // endDate < startDate ise yok say
  const end = endDate && endDate >= startDate ? endDate : '';

  // ── Güncelle ──
  if (data.action === 'update') {
    const existing = await tdb().etkinlik.findFirst({ where: { legacyId: data.id } });
    if (!existing) return NextResponse.json({ error: 'Etkinlik bulunamadı' }, { status: 404 });
    const updated = {
      ...existing.data,
      title, desc: desc || '', type, startDate, endDate: end, classes: valid,
      updatedAt: new Date().toISOString(),
    };
    await tdb().etkinlik.update({ where: { id: existing.id }, data: { title, type, startDate, endDate: end || null, data: updated } });
    await logAudit({
      ...actorFrom(session),
      action: 'etkinlik.update',
      target: { type: 'etkinlik', id: data.id, name: title },
      detail: `Takvim etkinliği güncellendi: "${title}"`,
    });
    return NextResponse.json({ ok: true, id: data.id });
  }

  // ── Oluştur ──
  const id = genId();
  const rec = {
    id, title, desc: desc || '', type, startDate, endDate: end, classes: valid,
    createdBy: session.id, createdByName: session.name || '', createdByRole: session.role,
    createdAt: new Date().toISOString(),
  };
  await tdb().etkinlik.create({ data: { legacyId: id, title, type, startDate, endDate: end || null, data: rec } });

  // Hedef kitleye push (sınıf boşsa herkes). Hata toleranslı.
  const payload = { title: `📅 ${TYPE_LABEL[type] || 'Takvim'}`, body: title.slice(0, 120), url: '/?tab=takvim', tag: `etkinlik-${id}` };
  const targets = [];
  const students = await loadStudents();
  const sRoster = valid.length === 0 ? students : students.filter(s => valid.includes(s.cls));
  sRoster.forEach(s => targets.push(['student', s.id]));
  const parents = await loadParents();
  const pRoster = valid.length === 0 ? parents : parents.filter(p => (p.children || []).some(c => valid.includes(c.cls)));
  pRoster.forEach(p => targets.push(['parent', p.id]));
  await Promise.allSettled(targets.map(([role, uid]) => sendPushToUser(role, uid, payload)));

  await logAudit({
    ...actorFrom(session),
    action: 'etkinlik.create',
    target: { type: 'etkinlik', id, name: title },
    detail: `Takvim etkinliği eklendi: "${title}" (${TYPE_LABEL[type]}) → ${valid.length === 0 ? 'herkes' : valid.length + ' sınıf'}`,
  });
  return NextResponse.json({ ok: true, id, notified: targets.length });
}

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
export async function DELETE(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const existing = await tdb().etkinlik.findFirst({ where: { legacyId: id } });
  if (!existing) return NextResponse.json({ error: 'Etkinlik bulunamadı' }, { status: 404 });
  await tdb().etkinlik.delete({ where: { id: existing.id } });
  await logAudit({
    ...actorFrom(session),
    action: 'etkinlik.delete',
    target: { type: 'etkinlik', id, name: existing.data?.title || '' },
    detail: `Takvim etkinliği silindi: "${existing.data?.title || ''}"`,
  });
  return NextResponse.json({ ok: true });
}
