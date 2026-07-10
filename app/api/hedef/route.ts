import { NextResponse } from 'next/server';
import { withAuth, canReadStudent, type Session } from '@/lib/auth';
import { getWeekKey } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';

export const runtime = 'nodejs';

// Haftalık hedef (soru çözüm hedefi) — guidance verisini TÜKETİR, çoğaltmaz.
// Hedef (SQL) → { studentId, weekly:number, setBy, setByName, updatedAt }
// "Çözülen soru" = guidance entries'teki correct+wrong+empty toplamı (D+Y+B).
// Öğrenci kendi hedefini koyar; müdür/rehber herhangi birininkini. Öğretmen/veli salt-okunur.

// Guidance.data Json şekli: { entries: { [ders]: { correct, wrong, empty } } }
interface GuidanceData {
  entries?: Record<string, { correct?: number | string; wrong?: number | string; empty?: number | string } | null>;
}

function sumWeek(data: GuidanceData | null | undefined): number {
  if (!data || !data.entries) return 0;
  let total = 0;
  for (const v of Object.values(data.entries)) {
    if (!v || typeof v !== 'object') continue;
    total += (parseInt(String(v.correct)) || 0) + (parseInt(String(v.wrong)) || 0) + (parseInt(String(v.empty)) || 0);
  }
  return total;
}

const SetSchema = z.object({
  studentId: zId.optional(),
  weekly: z.coerce.number().int().min(0).max(100000),
});

// Çağıran bu öğrenci için yazma yetkili mi (editable mantığıyla hizalı):
// öğrenci kendi, müdür/rehber herkes. Öğretmen + veli HAYIR.
function canWriteGoal(session: Session, studentId: string): boolean {
  if (session.role === 'student') return session.id === studentId;
  if (session.role === 'director' || session.role === 'counselor') return true;
  return false;
}

// GET /api/hedef?studentId=...
// Döner: { studentId, weekly, setBy, setByName, updatedAt, weekKey, thisWeekSolved, canEdit, history[] }
// history: son haftalar [{ weekKey, solved }] (en yeni önce, max 8).
// Bilinçli inline rol dallanması: erişim kapsamı isteğe (studentId) bağlı.
export const GET = withAuth(async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  let studentId = searchParams.get('studentId');

  if (session.role === 'student') {
    studentId = session.id ?? null;
  } else if (session.role === 'parent') {
    if (!canReadStudent(session, studentId)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  } else if (session.role !== 'director' && session.role !== 'counselor' && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  const weekKey = getWeekKey();

  const rows = await tdb().guidance.findMany({ where: { studentId } });
  let thisWeekSolved = 0;
  const history = rows.map(r => {
    const solved = sumWeek(r.data as GuidanceData | null);
    if (r.week === weekKey) thisWeekSolved = solved;
    return { weekKey: r.week, solved };
  })
    .filter(h => h.solved > 0)
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
    .slice(0, 8);
  const goal = await tdb().hedef.findFirst({ where: { studentId } });
  return NextResponse.json({
    studentId,
    weekly: goal?.weekly || 0,
    setBy: goal?.setBy || null,
    setByName: goal?.setByName || null,
    updatedAt: goal?.updatedAt ? (goal.updatedAt instanceof Date ? goal.updatedAt.toISOString() : goal.updatedAt) : null,
    weekKey,
    thisWeekSolved,
    canEdit: canWriteGoal(session, studentId),
    history,
  });
});

// POST /api/hedef  Body: { studentId?, weekly }
// weekly=0 → hedefi temizle (anahtarı sil). Öğrenci kendi, müdür/rehber herkes.
// Bilinçli inline rol dallanması: öğrenci kendi id'sine sabitlenir (istek gövdesine bağlı).
export const POST = withAuth(async (req, _ctx, session) => {
  const parsed = await parseBody(req, SetSchema);
  if (!parsed.ok) return parsed.response;

  let studentId = parsed.data.studentId;
  if (session.role === 'student') studentId = session.id;
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  if (!canWriteGoal(session, studentId)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const weekly = parsed.data.weekly;

  if (weekly === 0) {
    await tdb().hedef.deleteMany({ where: { studentId } });
    return NextResponse.json({ ok: true, weekly: 0 });
  }
  const existing = await tdb().hedef.findFirst({ where: { studentId } });
  const data = { weekly, setBy: session.role, setByName: session.name || null, updatedAt: new Date() };
  if (existing) await tdb().hedef.update({ where: { id: existing.id }, data });
  else await tdb().hedef.create({ data: withScope({ studentId, ...data }) });
  return NextResponse.json({ ok: true, weekly });
});
