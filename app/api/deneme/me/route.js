import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { dkeys } from '@/lib/deneme/store';
import { computeRanks, groupNetsFor, shortDate } from '@/lib/deneme/analysis';

// Giriş yapan öğrencinin kişisel deneme analizi (eskiden yeniye).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (session.role !== 'student') {
    return NextResponse.json({ points: [], notStudent: true });
  }

  const studentId = session.id;
  const index = (await redis.get(dkeys.examsIndex)) || [];
  const ordered = [...index].sort((a, b) => a.createdAt - b.createdAt);

  const points = [];
  for (const meta of ordered) {
    const exam = await redis.get(dkeys.exam(meta.id));
    if (!exam) continue;
    const row = exam.rows.find((r) => r.studentId === studentId);
    if (!row) continue;
    const ranks = computeRanks(exam);
    const rk = ranks[studentId];
    points.push({
      examId: exam.id,
      name: exam.name,
      examType: exam.examType,
      dateLabel: shortDate(exam.date),
      fullDate: new Date(exam.date).toLocaleDateString('tr-TR'),
      toplamNet: row.toplamNet,
      rank: rk ? rk.rank : 0,
      total: rk ? rk.total : exam.rows.length,
      groupNets: groupNetsFor(exam, row),
    });
  }

  return NextResponse.json({ name: session.name, points });
}
