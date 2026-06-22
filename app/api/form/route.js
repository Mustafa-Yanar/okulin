import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { useSql } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// Form / Anket — müdür/rehber form oluşturur, hedef rollere (öğrenci/veli/öğretmen) dağıtır,
// yanıtları toplar ve soru bazında özet görür. Soru tipleri: text/single/multi/rating.
// Anonim seçeneği: açıksa yanıtta kişi kimliği saklanmaz (sadece dedup için yanıtlayan set'i).
//
// "Öğrenci aktivite omurgası" deseni (set + tekil anahtar, hash yok):
//   formlar (set)                  → form id'leri
//   form:<id>                      → {id, title, desc, audience:{roles[],classes[]}, questions[], anonymous, closeDate, closed, createdBy, ...}
//   form:<id>:yanitlayanlar (set)  → yanıtlayan id'leri (dedup + ucuz sayım)
//   form:<id>:yanit:<respId>       → {answers:{[qid]:value}, role, name, submittedAt}

export const runtime = 'nodejs'; // push web-push (Node crypto)

function genId() { return Math.random().toString(36).slice(2, 10); }

const QTYPES = ['text', 'single', 'multi', 'rating'];

const QuestionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(300),
  type: z.enum(QTYPES),
  options: z.array(z.string().min(1).max(200)).max(20).optional(),
  required: z.boolean().optional(),
});
const AudienceSchema = z.object({
  roles: z.array(z.enum(['student', 'parent', 'teacher'])).min(1).max(3),
  classes: z.array(z.string().min(1).max(60)).max(60).optional(), // boş = ilgili rolün tamamı
});

const CreateSchema = z.object({
  action: z.literal('create'),
  title: z.string().min(1).max(200),
  desc: z.string().max(2000).optional(),
  audience: AudienceSchema,
  questions: z.array(QuestionSchema).min(1).max(30),
  anonymous: z.boolean().optional(),
  closeDate: z.string().max(20).optional(),
});
const SubmitSchema = z.object({
  action: z.literal('submit'),
  id: zId,
  answers: z.record(z.unknown()),
});
const CloseSchema = z.object({
  action: z.literal('close'),
  id: zId,
  closed: z.boolean(),
});
const BodySchema = z.discriminatedUnion('action', [CreateSchema, SubmitSchema, CloseSchema]);

// ── Yardımcılar ──
async function loadAllForms() {
  const ids = await redis.smembers('formlar');
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  ids.forEach(id => pipe.get(`form:${id}`));
  return (await pipe.exec()).filter(Boolean);
}

// Oturum sahibi bu formu yanıtlayabilir mi? (rol + sınıf hedefi)
function eligible(form, session) {
  const a = form.audience || {};
  const roles = a.roles || [];
  if (!roles.includes(session.role)) return false;
  const cls = Array.isArray(a.classes) ? a.classes : [];
  if (cls.length === 0) return true;
  if (session.role === 'student') return cls.includes(session.cls);
  if (session.role === 'parent') return (session.children || []).some(c => cls.includes(c.cls));
  return true; // teacher sınıf hedefinden etkilenmez
}

// Hedef kitleyi çöz → [{role,id,name}] (eligibleCount + push için)
async function resolveAudience(audience) {
  const roles = audience.roles || [];
  const cls = Array.isArray(audience.classes) ? audience.classes : [];
  const out = [];

  if (roles.includes('student')) {
    if (useSql()) {
      const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
      let recs = rows.map(s => ({ id: s.legacyId, name: s.name, cls: s.class?.legacyId || '' }));
      if (cls.length) recs = recs.filter(s => cls.includes(s.cls));
      recs.forEach(s => out.push({ role: 'student', id: s.id, name: s.name }));
    } else {
      const ids = await redis.smembers('students');
      if (ids?.length) {
        const pipe = redis.pipeline();
        ids.forEach(id => pipe.get(`student:${id}`));
        let recs = (await pipe.exec()).filter(Boolean);
        if (cls.length) recs = recs.filter(s => cls.includes(s.cls));
        recs.forEach(s => out.push({ role: 'student', id: s.id, name: s.name }));
      }
    }
  }
  // NOT: parents henüz SQL'de YOK → her zaman Redis (parents modülü göçünde güncellenecek).
  if (roles.includes('parent')) {
    const phones = await redis.smembers('parents');
    if (phones?.length) {
      const pipe = redis.pipeline();
      phones.forEach(p => pipe.get(`parent:${p}`));
      let recs = (await pipe.exec()).filter(Boolean);
      if (cls.length) recs = recs.filter(p => (p.children || []).some(c => cls.includes(c.cls)));
      recs.forEach(p => out.push({ role: 'parent', id: p.id, name: (p.children || []).map(c => c.name).join(', ') + ' (Veli)' }));
    }
  }
  if (roles.includes('teacher')) {
    if (useSql()) {
      const rows = await tdb().teacher.findMany();
      rows.forEach(t => out.push({ role: 'teacher', id: t.legacyId, name: t.name }));
    } else {
      const ids = await redis.smembers('teachers');
      if (ids?.length) {
        const pipe = redis.pipeline();
        ids.forEach(id => pipe.get(`teacher:${id}`));
        const recs = (await pipe.exec()).filter(Boolean);
        recs.forEach(t => out.push({ role: 'teacher', id: t.id, name: t.name }));
      }
    }
  }
  return out;
}

// Yanıtları soru tanımına göre temizle/doğrula.
function cleanAnswers(questions, raw) {
  const out = {};
  for (const q of questions) {
    const v = raw?.[q.id];
    if (q.type === 'text') {
      const s = typeof v === 'string' ? v.trim().slice(0, 4000) : '';
      if (s) out[q.id] = s;
    } else if (q.type === 'single') {
      if (typeof v === 'string' && (q.options || []).includes(v)) out[q.id] = v;
    } else if (q.type === 'multi') {
      if (Array.isArray(v)) {
        const picked = v.filter(x => (q.options || []).includes(x)).slice(0, 20);
        if (picked.length) out[q.id] = picked;
      }
    } else if (q.type === 'rating') {
      const n = parseInt(v);
      if (Number.isFinite(n) && n >= 1 && n <= 5) out[q.id] = n;
    }
  }
  return out;
}

// Eksik zorunlu soru var mı?
function missingRequired(questions, answers) {
  return questions.some(q => q.required && (answers[q.id] === undefined || answers[q.id] === '' ||
    (Array.isArray(answers[q.id]) && answers[q.id].length === 0)));
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const detailId = new URL(req.url).searchParams.get('id');

  // ── Yönetici: sonuç detayı ──
  if (detailId && isManager(session)) {
    if (useSql()) {
      const f = await tdb().form.findFirst({ where: { legacyId: detailId }, include: { responses: true } });
      if (!f) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
      const form = f.data;
      const responses = f.responses.map(r => r.data);
      const results = (form.questions || []).map(q => {
        if (q.type === 'single' || q.type === 'multi') {
          const counts = {};
          (q.options || []).forEach(o => { counts[o] = 0; });
          responses.forEach(r => {
            const a = r.answers?.[q.id];
            if (q.type === 'single') { if (a != null && counts[a] !== undefined) counts[a]++; }
            else if (Array.isArray(a)) a.forEach(x => { if (counts[x] !== undefined) counts[x]++; });
          });
          return { id: q.id, label: q.label, type: q.type, counts };
        }
        if (q.type === 'rating') {
          const vals = responses.map(r => r.answers?.[q.id]).filter(n => Number.isFinite(n));
          const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
          vals.forEach(n => { dist[n] = (dist[n] || 0) + 1; });
          const avg = vals.length ? (vals.reduce((s, n) => s + n, 0) / vals.length) : 0;
          return { id: q.id, label: q.label, type: q.type, avg: Math.round(avg * 100) / 100, count: vals.length, dist };
        }
        const answers = responses
          .map(r => ({ text: r.answers?.[q.id], name: form.anonymous ? null : (r.name || '') }))
          .filter(x => x.text);
        return { id: q.id, label: q.label, type: q.type, answers };
      });
      const eligibleCount = (await resolveAudience(form.audience || {})).length;
      return NextResponse.json({ form, responseCount: responses.length, eligibleCount, results });
    }
    const form = await redis.get(`form:${detailId}`);
    if (!form) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
    const respIds = await redis.smembers(`form:${detailId}:yanitlayanlar`);
    let responses = [];
    if (respIds?.length) {
      const pipe = redis.pipeline();
      respIds.forEach(rid => pipe.get(`form:${detailId}:yanit:${rid}`));
      responses = (await pipe.exec()).filter(Boolean);
    }
    // Soru bazında özet
    const results = (form.questions || []).map(q => {
      if (q.type === 'single' || q.type === 'multi') {
        const counts = {};
        (q.options || []).forEach(o => { counts[o] = 0; });
        responses.forEach(r => {
          const a = r.answers?.[q.id];
          if (q.type === 'single') { if (a != null && counts[a] !== undefined) counts[a]++; }
          else if (Array.isArray(a)) a.forEach(x => { if (counts[x] !== undefined) counts[x]++; });
        });
        return { id: q.id, label: q.label, type: q.type, counts };
      }
      if (q.type === 'rating') {
        const vals = responses.map(r => r.answers?.[q.id]).filter(n => Number.isFinite(n));
        const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        vals.forEach(n => { dist[n] = (dist[n] || 0) + 1; });
        const avg = vals.length ? (vals.reduce((s, n) => s + n, 0) / vals.length) : 0;
        return { id: q.id, label: q.label, type: q.type, avg: Math.round(avg * 100) / 100, count: vals.length, dist };
      }
      // text
      const answers = responses
        .map(r => ({ text: r.answers?.[q.id], name: form.anonymous ? null : (r.name || '') }))
        .filter(x => x.text);
      return { id: q.id, label: q.label, type: q.type, answers };
    });
    const eligibleCount = (await resolveAudience(form.audience || {})).length;
    return NextResponse.json({ form, responseCount: respIds?.length || 0, eligibleCount, results });
  }

  // ── Yönetici: form listesi ──
  if (isManager(session)) {
    if (useSql()) {
      const rows = await tdb().form.findMany({ include: { _count: { select: { responses: true } } } });
      const list = rows.map(r => ({
        id: r.data.id, title: r.data.title, desc: r.data.desc, audience: r.data.audience,
        questionCount: (r.data.questions || []).length, anonymous: !!r.data.anonymous,
        closed: !!r.data.closed, closeDate: r.data.closeDate || '', createdAt: r.data.createdAt,
        responseCount: r._count.responses,
      }));
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return NextResponse.json({ formlar: list });
    }
    const forms = await loadAllForms();
    if (forms.length === 0) return NextResponse.json({ formlar: [] });
    const pipe = redis.pipeline();
    forms.forEach(f => pipe.scard(`form:${f.id}:yanitlayanlar`));
    const counts = await pipe.exec();
    const list = forms.map((f, i) => ({
      id: f.id, title: f.title, desc: f.desc, audience: f.audience,
      questionCount: (f.questions || []).length, anonymous: !!f.anonymous,
      closed: !!f.closed, closeDate: f.closeDate || '', createdAt: f.createdAt,
      responseCount: counts[i] || 0,
    }));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ formlar: list });
  }

  // ── Yanıtlayan: kendi cevabı (doldurma için) ──
  if (detailId) {
    if (useSql()) {
      const f = await tdb().form.findFirst({ where: { legacyId: detailId } });
      if (!f || !eligible(f.data, session)) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
      const mine = await tdb().formResponse.findFirst({ where: { formId: f.id, respondent: session.id } });
      return NextResponse.json({ form: f.data, mine: mine?.data || null });
    }
    const form = await redis.get(`form:${detailId}`);
    if (!form || !eligible(form, session)) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
    const mine = await redis.get(`form:${detailId}:yanit:${session.id}`);
    return NextResponse.json({ form, mine: mine || null });
  }

  // ── Yanıtlayan: uygun formlar + kendi durumu ──
  if (useSql()) {
    const rows = await tdb().form.findMany();
    const eligForms = rows.filter(r => eligible(r.data, session));
    if (eligForms.length === 0) return NextResponse.json({ formlar: [] });
    const formIds = eligForms.map(r => r.id);
    const myResp = await tdb().formResponse.findMany({ where: { formId: { in: formIds }, respondent: session.id }, select: { formId: true } });
    const answeredSet = new Set(myResp.map(r => r.formId));
    const list = eligForms.map(r => ({
      id: r.data.id, title: r.data.title, desc: r.data.desc,
      questionCount: (r.data.questions || []).length, anonymous: !!r.data.anonymous,
      closed: !!r.data.closed, closeDate: r.data.closeDate || '', createdAt: r.data.createdAt,
      answered: answeredSet.has(r.id),
    }));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ formlar: list });
  }
  const forms = (await loadAllForms()).filter(f => eligible(f, session));
  if (forms.length === 0) return NextResponse.json({ formlar: [] });
  const pipe = redis.pipeline();
  forms.forEach(f => pipe.sismember(`form:${f.id}:yanitlayanlar`, session.id));
  const answered = await pipe.exec();
  const list = forms.map((f, i) => ({
    id: f.id, title: f.title, desc: f.desc,
    questionCount: (f.questions || []).length, anonymous: !!f.anonymous,
    closed: !!f.closed, closeDate: f.closeDate || '', createdAt: f.createdAt,
    answered: !!answered[i],
  }));
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return NextResponse.json({ formlar: list });
}

// ───────────────────────────────────────── POST ─────────────────────────────────────────
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // ── Oluştur (müdür/rehber) ──
  if (data.action === 'create') {
    if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    // Seçimli sorularda en az 2 seçenek şartı
    for (const q of data.questions) {
      if ((q.type === 'single' || q.type === 'multi') && (!q.options || q.options.length < 2)) {
        return NextResponse.json({ error: `"${q.label}" için en az 2 seçenek gerekli` }, { status: 400 });
      }
    }
    const id = genId();
    const rec = {
      id, title: data.title.trim(), desc: (data.desc || '').trim(),
      audience: { roles: data.audience.roles, classes: data.audience.classes || [] },
      questions: data.questions, anonymous: !!data.anonymous,
      closeDate: data.closeDate || '', closed: false,
      createdBy: session.id, createdByName: session.name || '', createdByRole: session.role,
      createdAt: new Date().toISOString(),
    };
    if (useSql()) {
      await tdb().form.create({ data: { legacyId: id, data: rec } });
    } else {
      await redis.set(`form:${id}`, rec);
      await redis.sadd('formlar', id);
    }

    // Hedef kitleye push (hata toleranslı)
    const targets = await resolveAudience(rec.audience);
    const payload = { title: '📋 Yeni form/anket', body: rec.title.slice(0, 120), url: '/?tab=formlar', tag: `form-${id}` };
    await Promise.allSettled(targets.map(t => sendPushToUser(t.role, t.id, payload)));

    await logAudit({
      ...actorFrom(session),
      action: 'form.create',
      target: { type: 'form', id, name: rec.title },
      detail: `Form/anket oluşturuldu: "${rec.title}" → ${targets.length} kişi`,
    });
    return NextResponse.json({ ok: true, id, notified: targets.length });
  }

  // ── Yanıtla (uygun rol) ──
  if (data.action === 'submit') {
    if (useSql()) {
      const f = await tdb().form.findFirst({ where: { legacyId: data.id } });
      if (!f || !eligible(f.data, session)) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
      const form = f.data;
      if (form.closed) return NextResponse.json({ error: 'Bu form kapatıldı' }, { status: 400 });
      if (form.closeDate && form.closeDate < new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ error: 'Bu formun süresi doldu' }, { status: 400 });
      }
      const answers = cleanAnswers(form.questions || [], data.answers);
      if (missingRequired(form.questions || [], answers)) {
        return NextResponse.json({ error: 'Zorunlu soruları yanıtlayın' }, { status: 400 });
      }
      const rec = {
        answers, role: session.role,
        name: form.anonymous ? '' : (session.name || ''),
        submittedAt: new Date().toISOString(),
      };
      const existing = await tdb().formResponse.findFirst({ where: { formId: f.id, respondent: session.id } });
      if (existing) await tdb().formResponse.update({ where: { id: existing.id }, data: { data: rec } });
      else await tdb().formResponse.create({ data: { formId: f.id, respondent: session.id, data: rec } });
      return NextResponse.json({ ok: true });
    }
    const form = await redis.get(`form:${data.id}`);
    if (!form || !eligible(form, session)) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
    if (form.closed) return NextResponse.json({ error: 'Bu form kapatıldı' }, { status: 400 });
    if (form.closeDate && form.closeDate < new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: 'Bu formun süresi doldu' }, { status: 400 });
    }
    const answers = cleanAnswers(form.questions || [], data.answers);
    if (missingRequired(form.questions || [], answers)) {
      return NextResponse.json({ error: 'Zorunlu soruları yanıtlayın' }, { status: 400 });
    }
    const rec = {
      answers, role: session.role,
      name: form.anonymous ? '' : (session.name || ''),
      submittedAt: new Date().toISOString(),
    };
    await redis.set(`form:${data.id}:yanit:${session.id}`, rec);
    await redis.sadd(`form:${data.id}:yanitlayanlar`, session.id);
    return NextResponse.json({ ok: true });
  }

  // ── Aç/kapat (müdür/rehber) ──
  if (data.action === 'close') {
    if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    if (useSql()) {
      const f = await tdb().form.findFirst({ where: { legacyId: data.id } });
      if (!f) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
      await tdb().form.update({ where: { id: f.id }, data: { data: { ...f.data, closed: data.closed } } });
      return NextResponse.json({ ok: true, closed: data.closed });
    }
    const form = await redis.get(`form:${data.id}`);
    if (!form) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
    await redis.set(`form:${data.id}`, { ...form, closed: data.closed });
    return NextResponse.json({ ok: true, closed: data.closed });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
export async function DELETE(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  if (useSql()) {
    const f = await tdb().form.findFirst({ where: { legacyId: id } });
    if (!f) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });
    await tdb().form.delete({ where: { id: f.id } }); // yanıtlar cascade ile gider
    await logAudit({
      ...actorFrom(session),
      action: 'form.delete',
      target: { type: 'form', id, name: f.data?.title || '' },
      detail: `Form/anket silindi: "${f.data?.title || ''}"`,
    });
    return NextResponse.json({ ok: true });
  }

  const form = await redis.get(`form:${id}`);
  if (!form) return NextResponse.json({ error: 'Form bulunamadı' }, { status: 404 });

  // Yanıtları temizle
  const respIds = await redis.smembers(`form:${id}:yanitlayanlar`);
  if (respIds?.length) {
    const pipe = redis.pipeline();
    respIds.forEach(rid => pipe.del(`form:${id}:yanit:${rid}`));
    await pipe.exec();
  }
  await redis.del(`form:${id}:yanitlayanlar`);
  await redis.del(`form:${id}`);
  await redis.srem('formlar', id);

  await logAudit({
    ...actorFrom(session),
    action: 'form.delete',
    target: { type: 'form', id, name: form.title },
    detail: `Form/anket silindi: "${form.title}"`,
  });
  return NextResponse.json({ ok: true });
}
