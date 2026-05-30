import { NextResponse } from 'next/server';
import { getSession, canReadStudent } from '@/lib/auth';
import { buildStudentPoints } from '@/lib/deneme/store';

// Müdür/öğretmen: belirli bir öğrencinin deneme analizini görür. Veli: kendi çocuğunu.
// GET /api/deneme/student?studentId=...
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });
  if (session.role === 'parent') {
    if (!canReadStudent(session, studentId)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  } else if (session.role !== 'director' && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const points = await buildStudentPoints(studentId);
  return NextResponse.json({ points });
}
