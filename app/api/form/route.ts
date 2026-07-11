import { NextResponse } from 'next/server';
import { withAuth, isManager, canManage, type Session } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import {
  getFormResults, listFormsForManager, getFormForRespondent, listFormsForRespondent,
  createForm, submitForm, closeForm, deleteForm, type RespondentFacts,
} from '@/lib/form';

// Form / Anket — müdür/rehber form oluşturur, hedef rollere (öğrenci/veli/öğretmen) dağıtır,
// yanıtları toplar ve soru bazında özet görür. Soru tipleri: text/single/multi/rating.
// Anonim seçeneği: açıksa yanıtta kişi kimliği saklanmaz.
// DB + iş kuralı lib/form.ts'te; burada yalnız yetki (rol/canManage) + push + audit + response.

export const runtime = 'nodejs'; // push web-push (Node crypto)

const QTYPES = ['text', 'single', 'multi', 'rating'] as const;

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

// Session → yanıtlayan olguları (eligible/submit için).
function respondentFacts(session: Session): RespondentFacts {
  return { role: session.role, id: session.id, cls: session.cls as string | undefined, children: session.children, name: session.name };
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
// Bilinçli inline rol dallanması: yönetici sonuç/liste, yanıtlayan kendi formlarını görür.
export const GET = withAuth(async (req, _ctx, session) => {
  const detailId = new URL(req.url).searchParams.get('id');

  // ── Yönetici: sonuç detayı ──
  if (detailId && isManager(session)) {
    return NextResponse.json(await getFormResults(detailId));
  }

  // ── Yönetici: form listesi ──
  if (isManager(session)) {
    return NextResponse.json({ formlar: await listFormsForManager() });
  }

  // ── Yanıtlayan: kendi cevabı (doldurma için) ──
  if (detailId) {
    return NextResponse.json(await getFormForRespondent(detailId, respondentFacts(session)));
  }

  // ── Yanıtlayan: uygun formlar + kendi durumu ──
  return NextResponse.json({ formlar: await listFormsForRespondent(respondentFacts(session)) });
});

// ───────────────────────────────────────── POST ─────────────────────────────────────────
// Bilinçli inline yetki dallanması: create/close yönetici (canManage), submit uygun roldeki yanıtlayan.
export const POST = withAuth(async (req, _ctx, session) => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // ── Oluştur (müdür/rehber) ──
  if (data.action === 'create') {
    if (!(await canManage(session))) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const { id, targets } = await createForm({
      title: data.title, desc: data.desc, audience: data.audience, questions: data.questions,
      anonymous: data.anonymous, closeDate: data.closeDate,
      createdBy: session.id, createdByName: session.name || '', createdByRole: session.role,
    });

    // Hedef kitleye push (hata toleranslı)
    const payload = { title: '📋 Yeni form/anket', body: data.title.trim().slice(0, 120), url: '/?tab=formlar', tag: `form-${id}` };
    await Promise.allSettled(targets.map(t => sendPushToUser(t.role, t.id, payload)));

    await logAudit({
      ...actorFrom(session),
      action: 'form.create',
      target: { type: 'form', id, name: data.title.trim() },
      detail: `Form/anket oluşturuldu: "${data.title.trim()}" → ${targets.length} kişi`,
    });
    return NextResponse.json({ ok: true, id, notified: targets.length });
  }

  // ── Yanıtla (uygun rol) ──
  if (data.action === 'submit') {
    await submitForm(data.id, respondentFacts(session), data.answers);
    return NextResponse.json({ ok: true });
  }

  // ── Aç/kapat (müdür/rehber) ──
  if (data.action === 'close') {
    if (!(await canManage(session))) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const { closed } = await closeForm(data.id, data.closed);
    return NextResponse.json({ ok: true, closed });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
});

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
export const DELETE = withAuth('manage', async (req, _ctx, session) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const { title } = await deleteForm(id);
  await logAudit({
    ...actorFrom(session),
    action: 'form.delete',
    target: { type: 'form', id, name: title },
    detail: `Form/anket silindi: "${title}"`,
  });
  return NextResponse.json({ ok: true });
});
