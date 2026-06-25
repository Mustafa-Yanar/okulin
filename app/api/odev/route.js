import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { getClass } from '@/lib/classes';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// Ödev verme + takip (ver → teslim → kontrol).
// Öğretmen/müdür/rehber ödev verir (sınıf bazlı hedef), öğrenci "teslim ettim" işaretler
// (+ not), öğretmen kontrol eder (+ puan/geri bildirim). Veli salt-okunur takip eder.
//
// "Öğrenci aktivite omurgası" adlandırma deseni (gelecekteki #hedef/#davranış ile tutarlı):
//   odevler (set)                → ödev id'leri
//   odev:<id>                    → {id, title, desc, branch, classes[], dueDate, createdBy, ...}
//   odev:<id>:teslimler (set)    → kaydı olan öğrenci id'leri (ucuz sayım için)
//   odev:<id>:sub:<studentId>    → {studentId, status:'teslim'|'kontrol', note, score, feedback, submittedAt, checkedAt}

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

function genId() { return Math.random().toString(36).slice(2, 10); }

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
  if (isSqlEnabled()) {
    const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
    return rows.map(s => ({ id: s.legacyId, name: s.name, cls: s.class?.legacyId || '' }));
  }
  const ids = await redis.smembers('students');
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  ids.forEach(id => pipe.get(`student:${id}`));
  return (await pipe.exec()).filter(Boolean);
}

// SQL'de teslimler odev kaydının data.submissions map'inde durur (ayrı anahtar yok).
// odevView = data'dan submissions'ı çıkarır (Redis odev kaydı şekliyle birebir).
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
    if (isSqlEnabled()) {
      const row = await tdb().odev.findFirst({ where: { legacyId: detailId } });
      if (!row) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
      const rec = row.data;
      const students = await loadStudents();
      const roster = rosterFor(students, rec.classes);
      const subsMap = rec.submissions || {};
      const submissions = roster.map(s => ({ studentId: s.id, name: s.name, cls: s.cls, sub: subsMap[s.id] || null }));
      return NextResponse.json({ odev: odevView(rec), submissions });
    }
    const rec = await redis.get(`odev:${detailId}`);
    if (!rec) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
    const students = await loadStudents();
    const roster = rosterFor(students, rec.classes);
    const pipe = redis.pipeline();
    roster.forEach(s => pipe.get(`odev:${detailId}:sub:${s.id}`));
    const subs = await pipe.exec();
    const submissions = roster.map((s, i) => ({
      studentId: s.id, name: s.name, cls: s.cls,
      sub: subs[i] || null, // {status, note, score, feedback, submittedAt, checkedAt}
    }));
    return NextResponse.json({ odev: rec, submissions });
  }

  // Liste (yönetici/öğretmen): tüm ödevler + ilerleme sayıları.
  if (isManager(session) || session.role === 'teacher') {
    if (isSqlEnabled()) {
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
    const ids = await redis.smembers('odevler');
    if (!ids || ids.length === 0) return NextResponse.json({ odevler: [] });
    const students = await loadStudents();
    const pipe = redis.pipeline();
    ids.forEach(id => { pipe.get(`odev:${id}`); pipe.scard(`odev:${id}:teslimler`); });
    const res = await pipe.exec();
    const list = [];
    ids.forEach((id, i) => {
      const rec = res[i * 2];
      if (!rec) return;
      list.push({ ...rec, submittedCount: res[i * 2 + 1] || 0, rosterCount: rosterFor(students, rec.classes).length });
    });
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ odevler: list });
  }

  // Öğrenci: kendi sınıfına atanan ödevler + kendi teslim durumu.
  if (session.role === 'student') {
    if (isSqlEnabled()) {
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
    const ids = await redis.smembers('odevler');
    if (!ids || ids.length === 0) return NextResponse.json({ odevler: [] });
    const pipe = redis.pipeline();
    ids.forEach(id => pipe.get(`odev:${id}`));
    const recs = (await pipe.exec()).filter(r => r && Array.isArray(r.classes) && r.classes.includes(session.cls));
    if (recs.length === 0) return NextResponse.json({ odevler: [] });
    const pipe2 = redis.pipeline();
    recs.forEach(r => pipe2.get(`odev:${r.id}:sub:${session.id}`));
    const subs = await pipe2.exec();
    const list = recs.map((r, i) => ({
      id: r.id, title: r.title, desc: r.desc || '', branch: r.branch || '',
      dueDate: r.dueDate || '', createdByName: r.createdByName || '', createdAt: r.createdAt,
      sub: subs[i] || null,
    }));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ odevler: list });
  }

  // Veli: çocuklarının sınıflarına atanan ödevler + her çocuğun durumu (salt-okunur).
  if (session.role === 'parent') {
    const children = Array.isArray(session.children) ? session.children : [];
    if (children.length === 0) return NextResponse.json({ odevler: [] });
    const childClasses = new Set(children.map(c => c.cls).filter(Boolean));
    if (isSqlEnabled()) {
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
    const ids = await redis.smembers('odevler');
    if (!ids || ids.length === 0) return NextResponse.json({ odevler: [] });
    const pipe = redis.pipeline();
    ids.forEach(id => pipe.get(`odev:${id}`));
    const recs = (await pipe.exec()).filter(r => r && Array.isArray(r.classes) && r.classes.some(c => childClasses.has(c)));
    if (recs.length === 0) return NextResponse.json({ odevler: [] });
    // Her ödev için, o ödevin sınıfındaki çocukların teslim durumu.
    const pipe2 = redis.pipeline();
    const lookups = [];
    recs.forEach(r => {
      children.forEach(ch => {
        if (r.classes.includes(ch.cls)) { pipe2.get(`odev:${r.id}:sub:${ch.id}`); lookups.push({ odevId: r.id, child: ch }); }
      });
    });
    const subs = await pipe2.exec();
    const byOdev = new Map();
    lookups.forEach((lk, i) => {
      if (!byOdev.has(lk.odevId)) byOdev.set(lk.odevId, []);
      byOdev.get(lk.odevId).push({ childId: lk.child.id, childName: lk.child.name, cls: lk.child.cls, sub: subs[i] || null });
    });
    const list = recs.map(r => ({
      id: r.id, title: r.title, desc: r.desc || '', branch: r.branch || '',
      dueDate: r.dueDate || '', createdByName: r.createdByName || '', createdAt: r.createdAt,
      children: byOdev.get(r.id) || [],
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
    if (isSqlEnabled()) {
      await tdb().odev.create({ data: { legacyId: id, data: { ...rec, submissions: {} } } });
    } else {
      await redis.set(`odev:${id}`, rec);
      await redis.sadd('odevler', id);
    }

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
    if (isSqlEnabled()) {
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
    const rec = await redis.get(`odev:${data.id}`);
    if (!rec) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
    if (!Array.isArray(rec.classes) || !rec.classes.includes(session.cls)) {
      return NextResponse.json({ error: 'Bu ödev size atanmamış' }, { status: 403 });
    }
    const subKey = `odev:${data.id}:sub:${session.id}`;

    // Teslimi geri al (öğretmen henüz kontrol etmediyse).
    if (data.done === false) {
      const cur = await redis.get(subKey);
      if (cur?.status === 'kontrol') return NextResponse.json({ error: 'Öğretmen kontrol etti, geri alınamaz' }, { status: 400 });
      await redis.del(subKey);
      await redis.srem(`odev:${data.id}:teslimler`, session.id);
      return NextResponse.json({ ok: true, status: null });
    }

    const cur = await redis.get(subKey);
    const sub = {
      studentId: session.id,
      status: cur?.status === 'kontrol' ? 'kontrol' : 'teslim', // öğretmen kontrol ettiyse koru
      note: data.note || '',
      score: cur?.score || '',
      feedback: cur?.feedback || '',
      submittedAt: cur?.submittedAt || new Date().toISOString(),
      checkedAt: cur?.checkedAt || '',
    };
    await redis.set(subKey, sub);
    await redis.sadd(`odev:${data.id}:teslimler`, session.id);
    return NextResponse.json({ ok: true, status: sub.status });
  }

  // ── Öğretmen/müdür kontrol eder (puan + geri bildirim) ──
  if (data.action === 'check') {
    if (!isManager(session) && session.role !== 'teacher') {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    if (isSqlEnabled()) {
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
    const rec = await redis.get(`odev:${data.id}`);
    if (!rec) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
    const subKey = `odev:${data.id}:sub:${data.studentId}`;
    const cur = await redis.get(subKey);

    // Kontrol işaretini kaldır → teslim durumuna döndür (kayıt yoksa tamamen sil).
    if (data.done === false) {
      if (!cur) return NextResponse.json({ ok: true });
      if (cur.submittedAt) {
        await redis.set(subKey, { ...cur, status: 'teslim', checkedAt: '' });
      } else {
        await redis.del(subKey);
        await redis.srem(`odev:${data.id}:teslimler`, data.studentId);
      }
      return NextResponse.json({ ok: true });
    }

    const sub = {
      studentId: data.studentId,
      status: 'kontrol',
      note: cur?.note || '',
      score: data.score !== undefined ? data.score : (cur?.score || ''),
      feedback: data.feedback !== undefined ? data.feedback : (cur?.feedback || ''),
      submittedAt: cur?.submittedAt || '', // öğrenci teslim etmemiş de olabilir (öğretmen elle işaretler)
      checkedAt: new Date().toISOString(),
    };
    await redis.set(subKey, sub);
    await redis.sadd(`odev:${data.id}:teslimler`, data.studentId);
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

  if (isSqlEnabled()) {
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

  const rec = await redis.get(`odev:${id}`);
  if (!rec) return NextResponse.json({ error: 'Ödev bulunamadı' }, { status: 404 });
  if (session.role === 'teacher' && rec.createdBy !== session.id) {
    return NextResponse.json({ error: 'Yalnız kendi verdiğiniz ödevi silebilirsiniz' }, { status: 403 });
  }

  // Teslim kayıtlarını temizle (kaydı olan öğrencilerin sub anahtarları).
  const submitted = await redis.smembers(`odev:${id}:teslimler`);
  if (submitted && submitted.length > 0) {
    const pipe = redis.pipeline();
    submitted.forEach(sid => pipe.del(`odev:${id}:sub:${sid}`));
    await pipe.exec();
  }
  await redis.del(`odev:${id}:teslimler`);
  await redis.del(`odev:${id}`);
  await redis.srem('odevler', id);

  await logAudit({
    ...actorFrom(session),
    action: 'odev.delete',
    target: { type: 'odev', id, name: rec.title },
    detail: `Ödev silindi: "${rec.title}"`,
  });
  return NextResponse.json({ ok: true });
}
