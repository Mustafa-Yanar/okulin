import { NextResponse } from 'next/server';
import { withAuth, isManager, type Session } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import {
  getOdevDetail, listOdevForManager, listOdevForStudent, listOdevForParent,
  createOdev, submitOdev, checkOdev, deleteOdev,
} from '@/lib/odev';

// Ödev verme + takip (ver → teslim → kontrol).
// Öğretmen/müdür/rehber ödev verir (sınıf bazlı hedef), öğrenci "teslim ettim" işaretler
// (+ not), öğretmen kontrol eder (+ puan/geri bildirim). Veli salt-okunur takip eder.
// DB + iş kuralı lib/odev.ts'te; burada yalnız yetki (rol dallanması) + push + audit + response.

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

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

const canAssign = (s: Session) => isManager(s) || s.role === 'teacher';

// ───────────────────────────────────────── GET ─────────────────────────────────────────
// Bilinçli inline rol dallanması: aynı uç yönetici/öğretmen/öğrenci/veli için farklı kapsam döner.
export const GET = withAuth('auth', 'odev', async (req, _ctx, session) => {
  const detailId = new URL(req.url).searchParams.get('id');

  // Detay (yönetici/öğretmen): ödev + roster'daki her öğrencinin teslim durumu (kontrol ekranı).
  if (detailId && canAssign(session)) {
    return NextResponse.json(await getOdevDetail(detailId));
  }

  // Liste (yönetici/öğretmen): tüm ödevler + ilerleme sayıları.
  if (canAssign(session)) {
    return NextResponse.json({ odevler: await listOdevForManager() });
  }

  // Öğrenci: kendi sınıfına atanan ödevler + kendi teslim durumu.
  if (session.role === 'student') {
    return NextResponse.json({ odevler: await listOdevForStudent(session.cls as string, session.id || '') });
  }

  // Veli: çocuklarının sınıflarına atanan ödevler + her çocuğun durumu (salt-okunur).
  if (session.role === 'parent') {
    const children = (Array.isArray(session.children) ? session.children : []).filter((c): c is { id?: string; name?: string; cls?: string } => typeof c !== 'string');
    return NextResponse.json({ odevler: await listOdevForParent(children) });
  }

  return NextResponse.json({ odevler: [] });
});

// ───────────────────────────────────────── POST ─────────────────────────────────────────
// Bilinçli inline yetki dallanması: aksiyon bazlı (create: yönetici/öğretmen, submit: öğrenci, check: yönetici/öğretmen).
export const POST = withAuth('auth', 'odev', async (req, _ctx, session) => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // ── Ödev oluştur (müdür/rehber/öğretmen) ──
  if (data.action === 'create') {
    if (!canAssign(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const { title, desc, branch, dueDate, classes } = data;
    const { id, validCount, roster } = await createOdev({
      title, desc, branch, dueDate, classes,
      createdBy: session.id, createdByName: session.name || '', createdByRole: session.role,
    });

    // Hedef sınıflardaki öğrencilere push (hata toleranslı).
    const payload = { title: '📝 Yeni ödev', body: title.slice(0, 120), url: '/?tab=odev', tag: `odev-${id}` };
    await Promise.allSettled(roster.map(s => sendPushToUser('student', s.id, payload)));

    await logAudit({
      ...actorFrom(session),
      action: 'odev.create',
      target: { type: 'odev', id, name: title },
      detail: `Ödev verildi: "${title}" → ${validCount} sınıf (${roster.length} öğrenci)`,
    });
    return NextResponse.json({ ok: true, id, rosterCount: roster.length });
  }

  // ── Öğrenci teslim eder / geri alır ──
  if (data.action === 'submit') {
    if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const { status } = await submitOdev({ id: data.id, studentId: session.id || '', cls: session.cls as string, note: data.note, done: data.done });
    return NextResponse.json({ ok: true, status });
  }

  // ── Öğretmen/müdür kontrol eder (puan + geri bildirim) ──
  if (data.action === 'check') {
    if (!canAssign(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    await checkOdev({ id: data.id, studentId: data.studentId, score: data.score, feedback: data.feedback, done: data.done });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
});

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
// DELETE ?id=X — yönetici hepsini, öğretmen kendi verdiğini siler.
export const DELETE = withAuth((s: Session) => canAssign(s), 'odev', async (req, _ctx, session) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const { title } = await deleteOdev(id, { role: session.role, sessionId: session.id });
  await logAudit({
    ...actorFrom(session),
    action: 'odev.delete',
    target: { type: 'odev', id, name: title },
    detail: `Ödev silindi: "${title}"`,
  });
  return NextResponse.json({ ok: true });
});
