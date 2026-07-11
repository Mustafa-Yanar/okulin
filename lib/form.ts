import { tdb, withScope } from '@/lib/sqldb';
import { newId as genId } from '@/lib/id';
import { HttpError } from '@/lib/errors';
import type { ParentChild } from '@/lib/parents';

// Form / Anket servis katmanı — DB + iş kuralı (hedef çözümü, yanıt temizleme, sonuç özeti).
// Route yalnız yetki (rol/canManage) + push + audit + response. İş-kuralı ihlalinde HttpError.

type QType = 'text' | 'single' | 'multi' | 'rating';
export interface FormQuestion { id: string; label: string; type: QType; options?: string[]; required?: boolean; }
export interface FormAudience { roles: ('student' | 'parent' | 'teacher')[]; classes?: string[]; }

// Form.data Json şekli.
interface FormData {
  id: string;
  title: string;
  desc?: string;
  audience?: FormAudience;
  questions?: FormQuestion[];
  anonymous?: boolean;
  closeDate?: string;
  closed?: boolean;
  createdBy?: string;
  createdByName?: string;
  createdByRole?: string;
  createdAt?: string;
}

// FormResponse.data Json şekli.
interface ResponseData {
  answers?: Record<string, unknown>;
  role?: string;
  name?: string;
  submittedAt?: string;
}

// Yanıtlayanın session'dan çıkarılmış yetki/kimlik olguları (service session'a bağlı değil).
export interface RespondentFacts {
  role: string;
  id: string | undefined;
  cls?: string;
  children?: (string | { id?: string; name?: string; cls?: string })[];
  name?: string;
}

// Yanıtlayan bu formu görebilir/yanıtlayabilir mi? (rol + sınıf hedefi)
function eligible(form: FormData, facts: RespondentFacts): boolean {
  const a = form.audience || ({} as FormAudience);
  const roles: string[] = a.roles || [];
  if (!roles.includes(facts.role)) return false;
  const cls = Array.isArray(a.classes) ? a.classes : [];
  if (cls.length === 0) return true;
  if (facts.role === 'student') return cls.includes(facts.cls as string);
  if (facts.role === 'parent') return (facts.children || []).some(c => typeof c !== 'string' && cls.includes(c.cls || ''));
  return true; // teacher sınıf hedefinden etkilenmez
}

// Hedef kitleyi çöz → [{role,id,name}] (eligibleCount + push için)
async function resolveAudience(audience: FormAudience | Record<string, never>) {
  const roles: string[] = ('roles' in audience && audience.roles) || [];
  const cls = ('classes' in audience && Array.isArray(audience.classes)) ? audience.classes : [];
  const out: { role: string; id: string; name: string }[] = [];

  if (roles.includes('student')) {
    const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
    let recs = rows.map(s => ({ id: s.legacyId, name: s.name, cls: s.class?.legacyId || '' }));
    if (cls.length) recs = recs.filter(s => cls.includes(s.cls));
    recs.forEach(s => out.push({ role: 'student', id: s.id, name: s.name }));
  }
  if (roles.includes('parent')) {
    const rows = await tdb().parent.findMany();
    let recs = rows.map(p => ({ id: p.phone, children: ((p.children as unknown as ParentChild[] | null) || []) })); // children: Json
    if (cls.length) recs = recs.filter(p => (p.children || []).some(c => cls.includes(c.cls)));
    recs.forEach(p => out.push({ role: 'parent', id: p.id, name: (p.children || []).map(c => c.name).join(', ') + ' (Veli)' }));
  }
  if (roles.includes('teacher')) {
    const rows = await tdb().teacher.findMany();
    rows.forEach(t => out.push({ role: 'teacher', id: t.legacyId, name: t.name }));
  }
  return out;
}

// Yanıtları soru tanımına göre temizle/doğrula.
function cleanAnswers(questions: FormQuestion[], raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of questions) {
    const v = raw?.[q.id];
    if (q.type === 'text') {
      const s = typeof v === 'string' ? v.trim().slice(0, 4000) : '';
      if (s) out[q.id] = s;
    } else if (q.type === 'single') {
      if (typeof v === 'string' && (q.options || []).includes(v)) out[q.id] = v;
    } else if (q.type === 'multi') {
      if (Array.isArray(v)) {
        const picked = v.filter((x): x is string => (q.options || []).includes(x)).slice(0, 20);
        if (picked.length) out[q.id] = picked;
      }
    } else if (q.type === 'rating') {
      const n = parseInt(String(v));
      if (Number.isFinite(n) && n >= 1 && n <= 5) out[q.id] = n;
    }
  }
  return out;
}

// Eksik zorunlu soru var mı?
function missingRequired(questions: FormQuestion[], answers: Record<string, unknown>): boolean {
  return questions.some(q => q.required && (answers[q.id] === undefined || answers[q.id] === '' ||
    (Array.isArray(answers[q.id]) && (answers[q.id] as unknown[]).length === 0)));
}

// ── Yönetici: sonuç detayı (soru bazında özet + katılım). Yoksa 404. ──
export async function getFormResults(id: string) {
  const f = await tdb().form.findFirst({ where: { legacyId: id }, include: { responses: true } });
  if (!f) throw new HttpError(404, 'Form bulunamadı');
  const form = f.data as unknown as FormData;
  const responses = f.responses.map(r => r.data as unknown as ResponseData);
  const results = (form.questions || []).map(q => {
    if (q.type === 'single' || q.type === 'multi') {
      const counts: Record<string, number> = {};
      (q.options || []).forEach(o => { counts[o] = 0; });
      responses.forEach(r => {
        const a = r.answers?.[q.id];
        if (q.type === 'single') { if (a != null && counts[a as string] !== undefined) counts[a as string]++; }
        else if (Array.isArray(a)) a.forEach(x => { if (counts[x as string] !== undefined) counts[x as string]++; });
      });
      return { id: q.id, label: q.label, type: q.type, counts };
    }
    if (q.type === 'rating') {
      const vals = responses.map(r => r.answers?.[q.id]).filter((n): n is number => Number.isFinite(n as number));
      const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
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
  return { form, responseCount: responses.length, eligibleCount, results };
}

// ── Yönetici: form listesi (en yeni önce). ──
export async function listFormsForManager() {
  const rows = await tdb().form.findMany({ include: { _count: { select: { responses: true } } } });
  const list = rows.map(r => {
    const d = r.data as unknown as FormData;
    return {
      id: d.id, title: d.title, desc: d.desc, audience: d.audience,
      questionCount: (d.questions || []).length, anonymous: !!d.anonymous,
      closed: !!d.closed, closeDate: d.closeDate || '', createdAt: d.createdAt,
      responseCount: r._count.responses,
    };
  });
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return list;
}

// ── Yanıtlayan: kendi cevabı (doldurma için). Uygun değil/yoksa 404. ──
export async function getFormForRespondent(id: string, facts: RespondentFacts) {
  const f = await tdb().form.findFirst({ where: { legacyId: id } });
  if (!f || !eligible(f.data as unknown as FormData, facts)) throw new HttpError(404, 'Form bulunamadı');
  const mine = await tdb().formResponse.findFirst({ where: { formId: f.id, respondent: facts.id } });
  return { form: f.data, mine: mine?.data || null };
}

// ── Yanıtlayan: uygun formlar + kendi durumu (en yeni önce). ──
export async function listFormsForRespondent(facts: RespondentFacts) {
  const rows = await tdb().form.findMany();
  const eligForms = rows.filter(r => eligible(r.data as unknown as FormData, facts));
  if (eligForms.length === 0) return [];
  const formIds = eligForms.map(r => r.id);
  const myResp = await tdb().formResponse.findMany({ where: { formId: { in: formIds }, respondent: facts.id }, select: { formId: true } });
  const answeredSet = new Set(myResp.map(r => r.formId));
  const list = eligForms.map(r => {
    const d = r.data as unknown as FormData;
    return {
      id: d.id, title: d.title, desc: d.desc,
      questionCount: (d.questions || []).length, anonymous: !!d.anonymous,
      closed: !!d.closed, closeDate: d.closeDate || '', createdAt: d.createdAt,
      answered: answeredSet.has(r.id),
    };
  });
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return list;
}

export interface CreateFormInput {
  title: string; desc?: string; audience: FormAudience; questions: FormQuestion[];
  anonymous?: boolean; closeDate?: string;
  createdBy: string | undefined; createdByName: string; createdByRole: string;
}

// Form oluştur. Seçimli soruda <2 seçenek → 400. Döner: push+audit için { id, targets }.
export async function createForm(input: CreateFormInput): Promise<{ id: string; targets: { role: string; id: string; name: string }[] }> {
  for (const q of input.questions) {
    if ((q.type === 'single' || q.type === 'multi') && (!q.options || q.options.length < 2)) {
      throw new HttpError(400, `"${q.label}" için en az 2 seçenek gerekli`);
    }
  }
  const id = genId();
  const rec = {
    id, title: input.title.trim(), desc: (input.desc || '').trim(),
    audience: { roles: input.audience.roles, classes: input.audience.classes || [] },
    questions: input.questions, anonymous: !!input.anonymous,
    closeDate: input.closeDate || '', closed: false,
    createdBy: input.createdBy, createdByName: input.createdByName || '', createdByRole: input.createdByRole,
    createdAt: new Date().toISOString(),
  };
  await tdb().form.create({ data: withScope({ legacyId: id, data: rec }) });
  const targets = await resolveAudience(rec.audience);
  return { id, targets };
}

// Yanıt gönder/güncelle. Uygun değil/yoksa 404; kapalı/süresi dolmuş/eksik zorunlu → 400.
export async function submitForm(id: string, facts: RespondentFacts, rawAnswers: Record<string, unknown>): Promise<void> {
  const f = await tdb().form.findFirst({ where: { legacyId: id } });
  if (!f || !eligible(f.data as unknown as FormData, facts)) throw new HttpError(404, 'Form bulunamadı');
  const form = f.data as unknown as FormData;
  if (form.closed) throw new HttpError(400, 'Bu form kapatıldı');
  if (form.closeDate && form.closeDate < new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Bu formun süresi doldu');
  const answers = cleanAnswers(form.questions || [], rawAnswers);
  if (missingRequired(form.questions || [], answers)) throw new HttpError(400, 'Zorunlu soruları yanıtlayın');
  const rec = {
    answers, role: facts.role,
    name: form.anonymous ? '' : (facts.name || ''),
    submittedAt: new Date().toISOString(),
  };
  const existing = await tdb().formResponse.findFirst({ where: { formId: f.id, respondent: facts.id } });
  if (existing) await tdb().formResponse.update({ where: { id: existing.id }, data: { data: rec } });
  else await tdb().formResponse.create({ data: { formId: f.id, respondent: facts.id || '', data: rec } });
}

// Form aç/kapat. Yoksa 404. Döner: yeni closed durumu.
export async function closeForm(id: string, closed: boolean): Promise<{ closed: boolean }> {
  const f = await tdb().form.findFirst({ where: { legacyId: id } });
  if (!f) throw new HttpError(404, 'Form bulunamadı');
  await tdb().form.update({ where: { id: f.id }, data: { data: { ...(f.data as object), closed } } });
  return { closed };
}

// Form sil (yanıtlar cascade). Yoksa 404. Döner: audit için { title }.
export async function deleteForm(id: string): Promise<{ title: string }> {
  const f = await tdb().form.findFirst({ where: { legacyId: id } });
  if (!f) throw new HttpError(404, 'Form bulunamadı');
  const d = f.data as unknown as FormData | null;
  await tdb().form.delete({ where: { id: f.id } }); // yanıtlar cascade ile gider
  return { title: d?.title || '' };
}
