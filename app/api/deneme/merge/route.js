import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getExam, getAllStudents } from '@/lib/deneme/store';
import { buildMergeReport } from '@/lib/deneme/report';

function isManager(s) {
  return s && (s.role === 'director' || s.role === 'counselor');
}

// TYT + AYT birleştirme raporu: ?tyt=<examId>&ayt=<examId>.
// Ortak (her ikisinde de eşleşmiş) öğrenciler için 3 türde yerleştirme puanı.
export async function GET(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tytId = searchParams.get('tyt');
  const aytId = searchParams.get('ayt');
  if (!tytId || !aytId) {
    return NextResponse.json({ error: 'tyt ve ayt sınav id gerekli' }, { status: 400 });
  }

  const [tytExam, aytExam] = await Promise.all([
    getExam(tytId),
    getExam(aytId),
  ]);
  if (!tytExam || !aytExam) {
    return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });
  }
  if (tytExam.examType !== 'TYT' || aytExam.examType !== 'AYT') {
    return NextResponse.json({ error: 'Bir TYT ve bir AYT sınavı seçilmeli' }, { status: 400 });
  }

  const students = await getAllStudents();
  const studentInfoById = {};
  for (const s of students) studentInfoById[s.id] = { name: s.name, cls: s.cls };

  const report = buildMergeReport(tytExam, aytExam, { studentInfoById });
  return NextResponse.json(report);
}
