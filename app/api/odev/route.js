import { NextResponse } from 'next/server';
import { getSession, isManager } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { getClass } from '@/lib/classes';
import { tdb } from '@/lib/sqldb';

// Ödev verme + takip (ver → teslim → kontrol).
// Öğretmen/müdür/rehber ödev verir (sınıf bazlı hedef), öğrenci "teslim ettim" işaretler
// (+ not), öğretmen kontrol eder (+ puan/geri bildirim). Veli salt-okunur takip eder.

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

import { newId as genId } from '@/lib/id';

const CreateSchema = z.object({
  action: z.literal('create'),
  title: z.string().min(1).max(160),
  desc: z.string().max(2000).optional(),
  branch: z.string().max(60).optional(),
  dueDate: z.string().max(20).optional(), // YYYY-MM-DD
  classes: z.array(z.string().min(1).max(60)).min(1).max(60),
});
const SubmitSchema = z.object({
  action: z.literal('submit'),
  id: zId,
  note: z.string().max(1000).optional(),
  done: z.boolean().optional(), // false → teslim geri al
});
const CheckSchema = z.object({
  action: z.literal('check'),
  id: zId,
  studentId: z.string().min(1).max(100),
  score: z.string().max(20).optional(),     // serbest metin puan (notlandırma kurum-bağımsız)
  feedback: z.string().max(1000).optional(),
  done: z.boolean().optional(),             // false → kontrol işaretini kaldır
});
const BodySchema = z.discriminatedUnion('action', [CreateSchema, SubmitSchema, CheckSchema]);

// Tüm öğrencileri tek seferde yükle (roster çözümü için).
async function loadStudents() {
  const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
  return rows.map(s => ({ id: s.legacyId, name: s.name, cls: s.class?.legacyId || '' }));
}

// Teslimler odev kaydının data.submissions map'inde durur (ayrı anahtar yok).
// odevView = data'dan submissions'ı çıkarır (dış sözleşme şekliyle birebir).
const odevView = (rec) => { const { submissions, ...rest } = rec; return rest; };

// Ödevin hedef sınıflarındaki öğrenciler.
function rosterFor(students, classes) {
  const set = new Set(classes || []);
  return students.filter(s => set.has(s.cls));
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const detailId = new URL(req.url).searchParams.get('id');

  // Detay (yönetici/öğretmen): ödev + roster'daki her öğrencinin teslim durumu (kontrol ekranı).
  if (detailId && (isManager(session) || session.role === 'teacher')) {
    const row = await tdb().odev.findFirst({ where: { legacyId: detailId } });
    if (!row) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
    const rec = row.data;
    const students = await loadStudents();
    const roster = rosterFor(students, rec.classes);
    const subsMap = rec.submissions || {};
    const submissions = roster.map(s => ({ studentId: s.id, name: s.name, cls: s.cls, sub: subsMap[s.id] || null }));
    return NextResponse.json({ odev: odevView(rec), submissions });
  }

  // Liste (yönetici/öğretmen): tüm ödevler + ilerleme sayıları.
  if (isManager(session) || session.role === 'teacher') {
    const rows = await tdb().odev.findMany();
    if (rows.length === 0) return NextResponse.json({ odevler: [] });
    const students = await loadStudents();
    const list = rows.map(r => {
      const rec = r.data;
      return { ...odevView(rec), submittedCount: Object.keys(rec.submissions || {}).length, rosterCount: rosterFor(students, rec.classes).length };
    });
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ odevler: list });
  }

  // Öğrenci: kendi sınıfına atanan ödevler + kendi teslim durumu.
  if (session.role === 'student') {
    const rows = await tdb().odev.findMany();
    const recs = rows.map(r => r.data).filter(r => Array.isArray(r.classes) && r.classes.includes(session.cls));
    const list = recs.map(r => ({
      id: r.id, title: r.title, desc: r.desc || '', branch: r.branch || '',
      dueDate: r.dueDate || '', createdByName: r.createdByName || '', createdAt: r.createdAt,
      sub: (r.submissions || {})[session.id] || null,
    }));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ odevler: list });
  }

  // Veli: çocuklarının sınıflarına atanan ödevler + her çocuğun durumu (salt-okunur).
  if (session.role === 'parent') {
    const children = Array.isArray(session.children) ? session.children : [];
    if (children.length === 0) return NextResponse.json({ odevler: [] });
    const childClasses = new Set(children.map(c => c.cls).filter(Boolean));
    const rows = await tdb().odev.findMany();
    const recs = rows.map(r => r.data).filter(r => Array.isArray(r.classes) && r.classes.some(c => childClasses.has(c)));
    const list = recs.map(r => ({
      id: r.id, title: r.title, desc: r.desc || '', branch: r.branch || '',
      dueDate: r.dueDate || '', createdByName: r.createdByName || '', createdAt: r.createdAt,
      children: children.filter(ch => r.classes.includes(ch.cls)).map(ch => ({
        childId: ch.id, childName: ch.name, cls: ch.cls, sub: (r.submissions || {})[ch.id] || null,
      })),
    }));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ odevler: list });
  }

  return NextResponse.json({ odevler: [] });
}

// ───────────────────────────────────────── POST ─────────────────────────────────────────
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // ── Ödev oluştur (müdür/rehber/öğretmen) ──
  if (data.action === 'create') {
    if (!isManager(session) && session.role !== 'teacher') {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const { title, desc, branch, dueDate, classes } = data;
    // Geçerli şube id'leri (registry-aware; kayıtsızsa constants'tan sanal kayıt döner).
    const valid = [];
    for (const c of classes) { if (await getClass(c)) valid.push(c); }
    if (valid.length === 0) return NextResponse.json({ error: 'Geçerli sınıf seçilmedi' }, { status: 400 });

    const id = genId();
    const rec = {
      id, title, desc: desc || '', branch: branch || '',
      dueDate: dueDate || '', classes: valid,
      createdBy: session.id, createdByName: session.name || '', createdByRole: session.role,
      createdAt: new Date().toISOString(),
    };
    await tdb().odev.create({ data: { legacyId: id, data: { ...rec, submissions: {} } } });

    // Hedef sınıflardaki öğrencilere push (hata toleranslı).
    const students = await loadStudents();
    const roster = rosterFor(students, valid);
    const payload = { title: '📝 Yeni ödev', body: title.slice(0, 120), url: '/?tab=odev', tag: `odev-${id}` };
    await Promise.allSettled(roster.map(s => sendPushToUser('student', s.id, payload)));

    await logAudit({
      ...actorFrom(session),
      action: 'odev.create',
      target: { type: 'odev', id, name: title },
      detail: `Ödev verildi: "${title}" → ${valid.length} sınıf (${roster.length} öğrenci)`,
    });
    return NextResponse.json({ ok: true, id, rosterCount: roster.length });
  }

  // ── Öğrenci teslim eder / geri alır ──
  if (data.action === 'submit') {
    if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const row = await tdb().odev.findFirst({ where: { legacyId: data.id } });
    if (!row) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
    const rec = row.data;
    if (!Array.isArray(rec.classes) || !rec.classes.includes(session.cls)) {
      return NextResponse.json({ error: 'Bu ödev size atanmamış' }, { status: 403 });
    }
    const subs = { ...(rec.submissions || {}) };
    const cur = subs[session.id] || null;
    if (data.done === false) {
      if (cur?.status === 'kontrol') return NextResponse.json({ error: 'Öğretmen kontrol etti, geri alınamaz' }, { status: 400 });
      delete subs[session.id];
      await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
      return NextResponse.json({ ok: true, status: null });
    }
    const sub = {
      studentId: session.id,
      status: cur?.status === 'kontrol' ? 'kontrol' : 'teslim',
      note: data.note || '', score: cur?.score || '', feedback: cur?.feedback || '',
      submittedAt: cur?.submittedAt || new Date().toISOString(), checkedAt: cur?.checkedAt || '',
    };
    subs[session.id] = sub;
    await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
    return NextResponse.json({ ok: true, status: sub.status });
  }

  // ── Öğretmen/müdür kontrol eder (puan + geri bildirim) ──
  if (data.action === 'check') {
    if (!isManager(session) && session.role !== 'teacher') {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const row = await tdb().odev.findFirst({ where: { legacyId: data.id } });
    if (!row) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
    const rec = row.data;
    const subs = { ...(rec.submissions || {}) };
    const cur = subs[data.studentId] || null;
    if (data.done === false) {
      if (!cur) return NextResponse.json({ ok: true });
      if (cur.submittedAt) subs[data.studentId] = { ...cur, status: 'teslim', checkedAt: '' };
      else delete subs[data.studentId];
      await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
      return NextResponse.json({ ok: true });
    }
    subs[data.studentId] = {
      studentId: data.studentId, status: 'kontrol',
      note: cur?.note || '',
      score: data.score !== undefined ? data.score : (cur?.score || ''),
      feedback: data.feedback !== undefined ? data.feedback : (cur?.feedback || ''),
      submittedAt: cur?.submittedAt || '', checkedAt: new Date().toISOString(),
    };
    await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
// DELETE ?id=X — yönetici hepsini, öğretmen kendi verdiğini siler.
export async function DELETE(req) {
  const session = await getSession();
  if (!session || (!isManager(session) && session.role !== 'teacher')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const row = await tdb().odev.findFirst({ where: { legacyId: id } });
  if (!row) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
  if (session.role === 'teacher' && row.data?.createdBy !== session.id) {
    return NextResponse.json({ error: 'Yalnız kendi verdiğiniz ödevi silebilirsiniz' }, { status: 403 });
  }
  await tdb().odev.delete({ where: { id: row.id } }); // teslimler data içinde, birlikte gider
  await logAudit({
    ...actorFrom(session),
    action: 'odev.delete',
    target: { type: 'odev', id, name: row.data?.title || '' },
    detail: `Ödev silindi: "${row.data?.title || ''}"`,
  });
  return NextResponse.json({ ok: true });
}
