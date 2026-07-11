import { NextResponse } from 'next/server';
import { withAuth, canReadStudent, type Session } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { getGoal, setGoal } from '@/lib/hedef';

export const runtime = 'nodejs';

// Haftalık hedef (soru çözüm hedefi) — guidance verisini TÜKETİR, çoğaltmaz.
// Öğrenci kendi hedefini koyar; müdür/rehber herhangi birininkini. Öğretmen/veli salt-okunur.
// DB + hesaplama lib/hedef.ts'te; burada yalnız yetki (session dallanması) + response.

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

  const goal = await getGoal(studentId);
  return NextResponse.json({ ...goal, canEdit: canWriteGoal(session, studentId) });
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

  const weekly = await setGoal({ studentId, weekly: parsed.data.weekly, setByRole: session.role, setByName: session.name || null });
  return NextResponse.json({ ok: true, weekly });
});
