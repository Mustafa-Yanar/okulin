import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getExam, getAllStudents } from '@/lib/deneme/store';
import { buildMergeReport, type StudentInfoById } from '@/lib/deneme/report';
// TYT + AYT birleştirme raporu: ?tyt=<examId>&ayt=<examId>.
// Ortak (her ikisinde de eşleşmiş) öğrenciler için 3 türde yerleştirme puanı.
export const GET = withAuth(['director', 'counselor'], async (req) => {

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
  const studentInfoById: StudentInfoById = {};
  for (const s of students) studentInfoById[s.id] = { name: s.name, cls: s.cls };

  const report = buildMergeReport(tytExam, aytExam, { studentInfoById });
  return NextResponse.json(report);
});
