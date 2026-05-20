import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buildStudentPoints } from '@/lib/deneme/store';

// Müdür/öğretmen: belirli bir öğrencinin deneme analizini görür.
// GET /api/deneme/student?studentId=...
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (session.role !== 'director' && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  const points = await buildStudentPoints(studentId);
  return NextResponse.json({ points });
}
