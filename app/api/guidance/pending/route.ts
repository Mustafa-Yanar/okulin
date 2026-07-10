import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';

// GET /api/guidance/pending
// Müdür için: her öğrencinin bekleyen (reviewed: false) rehberlik hafta sayısı.
// Döndürür: { [studentId]: count }
export const GET = withAuth(['director', 'counselor'], async () => {
  const rows = await tdb().guidance.findMany({ select: { studentId: true, data: true } });
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if ((r.data as { reviewed?: boolean } | null)?.reviewed) continue; // data: Json alanı
    counts[r.studentId] = (counts[r.studentId] || 0) + 1;
  }
  return NextResponse.json(counts);
});
