import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { buildStudentPoints } from '@/lib/deneme/store';

// Müdür/öğretmen: belirli bir öğrencinin deneme analizini görür. Veli: kendi çocuğunu.
// GET /api/deneme/student?studentId=...
// Bilinçli inline rol dallanması: veli yalnız kendi çocuğu (isteğe bağlı kontrol).
export const GET = withAuth('auth', 'deneme', async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });
  if (session.role === 'parent') {
    if (!canReadStudent(session, studentId)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  } else if ((session.role !== 'director' && session.role !== 'counselor') && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const points = await buildStudentPoints(studentId);
  return NextResponse.json({ points });
});
