import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buildStudentPoints } from '@/lib/deneme/store';

// Giriş yapan öğrencinin kişisel deneme analizi (eskiden yeniye).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (session.role !== 'student') {
    return NextResponse.json({ points: [], notStudent: true });
  }
  const points = await buildStudentPoints(session.id);
  return NextResponse.json({ name: session.name, points });
}
