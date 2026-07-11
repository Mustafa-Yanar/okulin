import { NextResponse } from 'next/server';
import { withAuth, isManager, type Session } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z } from '@/lib/validate';
import { getStudentBehavior, getBehaviorRoster, addBehavior, deleteBehaviorEntry } from '@/lib/davranis';

// Davranış puanlama — olumlu/olumsuz davranış kaydı (artı/eksi puan).
// Öğretmen + müdür/rehber öğrenciye puan verir (sebep + opsiyonel not). Öğrenci kendi
// toplamını + geçmişini görür; veli çocuğunkini. Toplam, motivasyon/sorumluluk için şeffaf.
// DB + iş kuralı lib/davranis.ts'te; burada yalnız yetki (session dallanması) + push + audit.

export const runtime = 'nodejs'; // push (web-push Node crypto)

const AddSchema = z.object({
  action: z.literal('add'),
  studentId: z.string().min(1).max(100),
  points: z.coerce.number().int().min(-50).max(50),
  reason: z.string().min(1).max(100),
  note: z.string().max(500).optional(),
});
const BodySchema = z.discriminatedUnion('action', [AddSchema]);

function canGive(session: Session | null | undefined): boolean {
  return isManager(session) || session?.role === 'teacher';
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
// Bilinçli inline rol dallanması: aynı uç rolüne göre farklı kapsam döner
// (öğrenci kendi kaydı, veli çocuğu, yönetici/öğretmen roster).
export const GET = withAuth(async (req, _ctx, session) => {
  const studentId = new URL(req.url).searchParams.get('studentId');

  // ── Tek öğrenci detayı (toplam + geçmiş) ──
  if (studentId) {
    // Yetki: yönetici/öğretmen herkesi; öğrenci yalnız kendini; veli yalnız çocuğunu.
    if (session.role === 'student' && session.id !== studentId) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    if (session.role === 'parent' && !(session.children || []).some(c => (typeof c === 'string' ? c : c.id) === studentId)) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const { total, entries } = await getStudentBehavior(studentId);
    return NextResponse.json({ studentId, total, entries });
  }

  // ── Öğrenci: kendi kaydı ──
  if (session.role === 'student') {
    const { total, entries } = await getStudentBehavior(session.id || '');
    return NextResponse.json({ studentId: session.id, total, entries });
  }

  // ── Veli: studentId şart (panel childId geçer) ──
  if (session.role === 'parent') {
    return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });
  }

  // ── Yönetici/öğretmen: roster + toplamlar ──
  if (!canGive(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  return NextResponse.json({ roster: await getBehaviorRoster() });
});

// ───────────────────────────────────────── POST (ekle) ─────────────────────────────────────────
export const POST = withAuth((s: Session) => canGive(s), async (req, _ctx, session) => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, points, reason, note } = parsed.data;

  const { total, studentName } = await addBehavior({
    studentId, points, reason, note,
    byName: session.name || '', byRole: session.role, by: session.id,
  });

  const sign = points > 0 ? '+' : '';
  await Promise.allSettled([sendPushToUser('student', studentId, {
    title: points > 0 ? '👍 Davranış puanı' : '⚠️ Davranış puanı',
    body: `${reason.trim()} (${sign}${points})`,
    url: '/?tab=davranis', tag: `davranis-${studentId}`,
  })]);
  await logAudit({
    ...actorFrom(session), action: 'behavior.add',
    target: { type: 'student', id: studentId, name: studentName },
    detail: `Davranış puanı: ${sign}${points} — ${reason.trim()}`,
  });
  return NextResponse.json({ ok: true, total });
});

// ───────────────────────────────────────── DELETE (kayıt sil) ─────────────────────────────────────────
export const DELETE = withAuth((s: Session) => canGive(s), async (req, _ctx, session) => {
  const url = new URL(req.url);
  const studentId = url.searchParams.get('studentId');
  const entryId = url.searchParams.get('entryId');
  if (!studentId || !entryId) return NextResponse.json({ error: 'studentId ve entryId gerekli' }, { status: 400 });

  const { total, points, reason } = await deleteBehaviorEntry(studentId, entryId, { isManager: isManager(session), sessionId: session.id });
  await logAudit({
    ...actorFrom(session), action: 'behavior.delete',
    target: { type: 'student', id: studentId, name: '' },
    detail: `Davranış puanı silindi: ${points > 0 ? '+' : ''}${points} — ${reason}`,
  });
  return NextResponse.json({ ok: true, total });
});
