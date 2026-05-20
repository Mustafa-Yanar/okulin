import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { dkeys } from '@/lib/deneme/store';
import { rankedList } from '@/lib/deneme/analysis';

// Deneme detayı — sıralı liste. Müdür ve öğretmen görür (tüm öğrenciler).
export async function GET(_req, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (session.role !== 'director' && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const exam = await redis.get(dkeys.exam(params.id));
  if (!exam) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });

  return NextResponse.json({
    exam: {
      id: exam.id,
      name: exam.name,
      examType: exam.examType,
      category: exam.category,
      date: exam.date,
      subjectKeys: exam.subjectKeys,
    },
    ranking: rankedList(exam),
  });
}

// Deneme sil (müdür)
export async function DELETE(_req, { params }) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  await redis.del(dkeys.exam(params.id));
  const index = (await redis.get(dkeys.examsIndex)) || [];
  await redis.set(dkeys.examsIndex, index.filter((m) => m.id !== params.id));
  return NextResponse.json({ ok: true });
}
