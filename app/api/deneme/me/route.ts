import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { buildStudentPoints } from '@/lib/deneme/store';

// Giriş yapan öğrencinin kişisel deneme analizi (eskiden yeniye).
// Bilinçli inline rol kontrolü: öğrenci-dışı roller hata değil boş liste alır (mevcut sözleşme).
export const GET = withAuth('auth', 'deneme', async (_req, _ctx, session) => {
  if (session.role !== 'student') {
    return NextResponse.json({ points: [], notStudent: true });
  }
  const points = await buildStudentPoints(session.id || '');
  return NextResponse.json({ name: session.name, points });
});
