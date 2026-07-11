import { NextResponse } from 'next/server';
import { withAuth, isManager, type Session } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { getClass } from '@/lib/classes';
import { tdb, withScope } from '@/lib/sqldb';
import type { ParentChild } from '@/lib/parents';

// Etkinlik / Okul Takvimi — kurum geneli bilgilendirme takvimi (tatil, sınav, toplantı, gezi…).
// Müdür/rehber oluşturur/düzenler/siler. Öğrenci/veli/öğretmen görür (rol+sınıf filtreli).
// classes[] boş → herkes; dolu → yalnız o sınıfların öğrencileri + velileri görür (personel hepsini görür).

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

import { newId as genId } from '@/lib/id';

const TYPES = ['tatil', 'sinav', 'toplanti', 'gezi', 'etkinlik', 'diger'] as const;
const TYPE_LABEL: Record<string, string> = {
  tatil: 'Tatil', sinav: 'Sınav', toplanti: 'Toplantı', gezi: 'Gezi', etkinlik: 'Etkinlik', diger: 'Diğer',
};

const zHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const baseFields = {
  title: z.string().min(1).max(160),
  desc: z.string().max(2000).optional(),
  type: z.enum(TYPES),
  startDate: z.string().min(8).max(20), // YYYY-MM-DD
  endDate: z.string().max(20).optional(), // çok günlü etkinlik bitişi (ops.)
  classes: z.array(z.string().min(1).max(60)).max(60).optional(), // boş/yok = herkes
  startTime: zHHMM.optional(), // saat aralığı (ops.) — HH:MM
  endTime: zHHMM.optional(),
  proctorIds: z.array(z.string().min(1).max(60)).max(30).optional(), // sınav gözetmeni (öğretmen legacyId)
};
const CreateSchema = z.object({ action: z.literal('create'), ...baseFields });
const UpdateSchema = z.object({ action: z.literal('update'), id: zId, ...baseFields });
const BulkTatilSchema = z.object({
  action: z.literal('bulkTatil'),
  dates: z.array(z.string().min(8).max(20)).min(1).max(60),
});
const BodySchema = z.discriminatedUnion('action', [CreateSchema, UpdateSchema, BulkTatilSchema]);

// Etkinlik.data Json şekli.
interface EtkinlikData {
  id: string;
  title: string;
  desc?: string;
  type: string;
  startDate: string;
  endDate?: string;
  classes?: string[];
  startTime?: string;
  endTime?: string;
  proctorIds?: string[];
  createdBy?: string;
  createdByName?: string;
  createdByRole?: string;
  createdAt?: string;
  updatedAt?: string;
}

async function loadAll(): Promise<EtkinlikData[]> {
  const rows = await tdb().etkinlik.findMany({ orderBy: { startDate: 'asc' } });
  return rows.map(r => r.data as unknown as EtkinlikData);
}

async function loadStudents() {
  const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
  return rows.map(s => ({ id: s.legacyId, cls: s.class?.legacyId || '' }));
}

async function loadParents() {
  const rows = await tdb().parent.findMany();
  return rows.map(p => ({ id: p.phone, children: ((p.children as unknown as ParentChild[] | null) || []) }));
}

// Bir etkinlik bu kullanıcıya görünür mü? (sınıf hedefi boşsa herkese)
function visibleToStudent(ev: EtkinlikData, cls: string): boolean {
  const cl = Array.isArray(ev.classes) ? ev.classes : [];
  return cl.length === 0 || cl.includes(cls);
}
function visibleToChildren(ev: EtkinlikData, childClasses: Set<string | undefined>): boolean {
  const cl = Array.isArray(ev.classes) ? ev.classes : [];
  return cl.length === 0 || cl.some(c => childClasses.has(c));
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
// Bilinçli inline rol dallanması: öğrenci/veli sınıf filtreli, personel tümünü görür.
export const GET = withAuth(async (_req, _ctx, session) => {
  let list = await loadAll();

  if (session.role === 'student') {
    list = list.filter(ev => visibleToStudent(ev, session.cls as string));
  } else if (session.role === 'parent') {
    const childClasses = new Set((session.children || []).map(c => (typeof c === 'string' ? undefined : c.cls)).filter(Boolean));
    list = list.filter(ev => visibleToChildren(ev, childClasses));
  }
  // müdür/rehber/öğretmen → hepsi

  list.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  return NextResponse.json({ etkinlikler: list, canManage: isManager(session) });
});

// ───────────────────────────────────────── POST ─────────────────────────────────────────
export const POST = withAuth((s: Session) => isManager(s), async (req, _ctx, session) => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // ── Toplu tatil ekle (Ders Saatleri modülünden çoklu-gün seçimi) ──
  if (data.action === 'bulkTatil') {
    const existingTatil = await tdb().etkinlik.findMany({ where: { type: 'tatil' } });
    const existingDates = new Set(existingTatil.map(r => r.startDate));
    const uniqueDates = [...new Set(data.dates)].filter(d => !existingDates.has(d)).sort();
    const created: string[] = [];
    for (const d of uniqueDates) {
      const id = genId();
      const rec = {
        id, title: 'Tatil', desc: '', type: 'tatil', startDate: d, endDate: '', classes: [],
        createdBy: session.id, createdByName: session.name || '', createdByRole: session.role,
        createdAt: new Date().toISOString(),
      };
      await tdb().etkinlik.create({ data: withScope({ legacyId: id, title: 'Tatil', type: 'tatil', startDate: d, endDate: null, data: rec }) });
      created.push(d);
    }
    if (created.length > 0) {
      await logAudit({
        ...actorFrom(session),
        action: 'etkinlik.create',
        target: { type: 'etkinlik', id: 'bulk', name: 'Tatil günleri' },
        detail: `Ders Saatleri modülünden ${created.length} tatil günü eklendi: ${created.join(', ')}`,
      });
    }
    return NextResponse.json({ ok: true, created: created.length });
  }

  const { title, desc, type, startDate, endDate, classes, startTime, endTime, proctorIds } = data;

  // Geçerli şube id'leri (registry-aware). Boş → herkes.
  const valid: string[] = [];
  if (Array.isArray(classes) && classes.length > 0) {
    for (const c of classes) { if (await getClass(c)) valid.push(c); }
  }
  // Saat aralığı: ikisi de gelmeli ve bitiş başlangıçtan sonra olmalı, aksi hâlde yok say.
  const timeRange = startTime && endTime && endTime > startTime ? { startTime, endTime } : {};
  // Gözetmen: yalnız sınav tipinde anlamlı; gerçek öğretmen kayıtlarına karşı doğrula.
  let validProctors: string[] = [];
  if (type === 'sinav' && Array.isArray(proctorIds) && proctorIds.length > 0) {
    const teacherRows = await tdb().teacher.findMany({ where: { legacyId: { in: proctorIds } } });
    validProctors = teacherRows.map(t => t.legacyId);
  }
  // endDate < startDate ise yok say
  const end = endDate && endDate >= startDate ? endDate : '';

  // ── Güncelle ──
  if (data.action === 'update') {
    const existing = await tdb().etkinlik.findFirst({ where: { legacyId: data.id } });
    if (!existing) return NextResponse.json({ error: 'Etkinlik bulunamadı' }, { status: 404 });
    const updated = {
      ...(existing.data as object),
      title, desc: desc || '', type, startDate, endDate: end, classes: valid,
      proctorIds: validProctors, ...timeRange,
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
    proctorIds: validProctors, ...timeRange,
    createdBy: session.id, createdByName: session.name || '', createdByRole: session.role,
    createdAt: new Date().toISOString(),
  };
  await tdb().etkinlik.create({ data: withScope({ legacyId: id, title, type, startDate, endDate: end || null, data: rec }) });

  // Hedef kitleye push (sınıf boşsa herkes). Hata toleranslı.
  const payload = { title: `📅 ${TYPE_LABEL[type] || 'Takvim'}`, body: title.slice(0, 120), url: '/?tab=takvim', tag: `etkinlik-${id}` };
  const targets: [string, string][] = [];
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
});

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
export const DELETE = withAuth((s: Session) => isManager(s), async (req, _ctx, session) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const existing = await tdb().etkinlik.findFirst({ where: { legacyId: id } });
  if (!existing) return NextResponse.json({ error: 'Etkinlik bulunamadı' }, { status: 404 });
  const d = existing.data as unknown as EtkinlikData | null;
  await tdb().etkinlik.delete({ where: { id: existing.id } });
  await logAudit({
    ...actorFrom(session),
    action: 'etkinlik.delete',
    target: { type: 'etkinlik', id, name: d?.title || '' },
    detail: `Takvim etkinliği silindi: "${d?.title || ''}"`,
  });
  return NextResponse.json({ ok: true });
});
