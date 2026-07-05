import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';

// GET /api/guidance/pending
// Müdür için: her öğrencinin bekleyen (reviewed: false) rehberlik hafta sayısı.
// Döndürür: { [studentId]: count }
export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const rows = await tdb().guidance.findMany({ select: { studentId: true, data: true } });
  const counts = {};
  for (const r of rows) {
    if (r.data?.reviewed) continue;
    counts[r.studentId] = (counts[r.studentId] || 0) + 1;
  }
  return NextResponse.json(counts);
}
