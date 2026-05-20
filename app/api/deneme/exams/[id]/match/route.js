import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { dkeys } from '@/lib/deneme/store';

// Eşleşmeyen Excel isimlerini öğrenci id'lerine bağlar (kalıcı namemap'e de yazar).
// body: { matches: [{ excelName, studentId }] }  (boş studentId = eşleşmeyi kaldır)
export async function POST(req, { params }) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { matches } = await req.json();
  const exam = await redis.get(dkeys.exam(params.id));
  if (!exam) return NextResponse.json({ error: 'Deneme bulunamadı' }, { status: 404 });

  const nameMap = (await redis.get(dkeys.nameMap)) || {};
  for (const m of matches || []) {
    const row = exam.rows.find((r) => r.excelName === m.excelName);
    if (row) row.studentId = m.studentId || '';
    const lower = String(m.excelName).toLowerCase();
    if (m.studentId) nameMap[lower] = m.studentId;
    else delete nameMap[lower];
  }

  await redis.set(dkeys.exam(exam.id), exam);
  await redis.set(dkeys.nameMap, nameMap);
  return NextResponse.json({ ok: true });
}
