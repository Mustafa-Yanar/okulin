import { NextResponse } from 'next/server';
import { withAuth, isManager, type Session } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';
import type { BehaviorEntry } from '@prisma/client';

// Davranış puanlama — olumlu/olumsuz davranış kaydı (artı/eksi puan).
// Öğretmen + müdür/rehber öğrenciye puan verir (sebep + opsiyonel not). Öğrenci kendi
// toplamını + geçmişini görür; veli çocuğunkini. Toplam, motivasyon/sorumluluk için şeffaf.

export const runtime = 'nodejs'; // push (web-push Node crypto)

// SQL BehaviorEntry satırı → mevcut sözleşme şekli (at = createdAt ISO).
const behEntryOut = (e: BehaviorEntry) => ({
  id: e.id, points: e.points, reason: e.reason || '', note: e.note || '',
  byName: e.byName || '', byRole: e.byRole || '', by: e.by || '',
  at: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
});

// Bir öğrencinin (legacyId) davranış kaydını SQL'den getirir (entries dahil).
async function behaviorByLegacySql(studentId: string) {
  const beh = await tdb().behavior.findFirst({
    where: { student: { legacyId: studentId } },
    include: { entries: { orderBy: { createdAt: 'asc' } } },
  });
  return beh;
}

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
    const beh = await behaviorByLegacySql(studentId);
    const entries = (beh?.entries || []).map(behEntryOut).reverse();
    return NextResponse.json({ studentId, total: beh?.total || 0, entries });
  }

  // ── Öğrenci: kendi kaydı ──
  if (session.role === 'student') {
    const beh = await behaviorByLegacySql(session.id || '');
    return NextResponse.json({ studentId: session.id, total: beh?.total || 0, entries: (beh?.entries || []).map(behEntryOut).reverse() });
  }

  // ── Veli: studentId şart (panel childId geçer) ──
  if (session.role === 'parent') {
    return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });
  }

  // ── Yönetici/öğretmen: roster + toplamlar ──
  if (!canGive(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const rows = await tdb().student.findMany({
    include: {
      class: { select: { legacyId: true } },
      behavior: { select: { total: true, _count: { select: { entries: true } } } },
    },
  });
  const roster = rows.map(s => ({
    id: s.legacyId, name: s.name, cls: s.class?.legacyId || '',
    total: s.behavior?.total || 0, count: s.behavior?._count?.entries || 0,
  }));
  roster.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
  return NextResponse.json({ roster });
});

// ───────────────────────────────────────── POST (ekle) ─────────────────────────────────────────
export const POST = withAuth((s: Session) => canGive(s), async (req, _ctx, session) => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, points, reason, note } = parsed.data;
  if (points === 0) return NextResponse.json({ error: 'Puan 0 olamaz' }, { status: 400 });

  const student = await tdb().student.findFirst({ where: { legacyId: studentId } });
  if (!student) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  let beh = await tdb().behavior.findFirst({ where: { studentId: student.id } });
  if (!beh) beh = await tdb().behavior.create({ data: withScope({ studentId: student.id, total: 0 }) });
  await tdb().behaviorEntry.create({ data: {
    behaviorId: beh.id, points, reason: reason.trim(), note: (note || '').trim(),
    byName: session.name || '', byRole: session.role, by: session.id,
  } });
  const updated = await tdb().behavior.update({ where: { id: beh.id }, data: { total: { increment: points } } });

  const sign = points > 0 ? '+' : '';
  await Promise.allSettled([sendPushToUser('student', studentId, {
    title: points > 0 ? '👍 Davranış puanı' : '⚠️ Davranış puanı',
    body: `${reason.trim()} (${sign}${points})`,
    url: '/?tab=davranis', tag: `davranis-${studentId}`,
  })]);
  await logAudit({
    ...actorFrom(session), action: 'behavior.add',
    target: { type: 'student', id: studentId, name: student.name },
    detail: `Davranış puanı: ${sign}${points} — ${reason.trim()}`,
  });
  return NextResponse.json({ ok: true, total: updated.total });
});

// ───────────────────────────────────────── DELETE (kayıt sil) ─────────────────────────────────────────
export const DELETE = withAuth((s: Session) => canGive(s), async (req, _ctx, session) => {
  const url = new URL(req.url);
  const studentId = url.searchParams.get('studentId');
  const entryId = url.searchParams.get('entryId');
  if (!studentId || !entryId) return NextResponse.json({ error: 'studentId ve entryId gerekli' }, { status: 400 });

  const beh = await tdb().behavior.findFirst({
    where: { student: { legacyId: studentId } },
    include: { entries: true },
  });
  if (!beh) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });
  const entry = beh.entries.find(e => e.id === entryId);
  if (!entry) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });
  // Öğretmen yalnız kendi verdiğini siler; müdür/rehber hepsini.
  if (!isManager(session) && entry.by !== session.id) {
    return NextResponse.json({ error: 'Yalnız kendi verdiğiniz puanı silebilirsiniz' }, { status: 403 });
  }
  await tdb().behaviorEntry.delete({ where: { id: entry.id } });
  const updated = await tdb().behavior.update({ where: { id: beh.id }, data: { total: { decrement: entry.points || 0 } } });
  await logAudit({
    ...actorFrom(session), action: 'behavior.delete',
    target: { type: 'student', id: studentId, name: '' },
    detail: `Davranış puanı silindi: ${entry.points > 0 ? '+' : ''}${entry.points} — ${entry.reason}`,
  });
  return NextResponse.json({ ok: true, total: updated.total });
});
