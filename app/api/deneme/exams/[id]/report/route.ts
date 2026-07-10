import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getExam, getAllStudents } from '@/lib/deneme/store';
import { buildReports } from '@/lib/deneme/report';
import { hasAnswerKey } from '@/lib/deneme/grade';
import type { StudentInfoById } from '@/lib/deneme/report';
// Okulizyon biçimli sonuç listeleri (JSON). İstemci bundan ekran tablosu + PDF/Excel üretir.
export const GET = withAuth(['director', 'counselor'], async (_req, ctx) => {

  const exam = await getExam(String(ctx.params?.id));
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });

  // Eşleşmiş öğrenci ad/sınıf bilgisi (rapora gerçek isim + sınıf yazılır)
  const students = await getAllStudents();
  const studentInfoById: StudentInfoById = {};
  for (const s of students) studentInfoById[s.id] = { name: s.name, cls: s.cls };

  const report = buildReports(exam, { studentInfoById });

  return NextResponse.json({
    ...report,
    hasKey: hasAnswerKey(exam, 'A') || hasAnswerKey(exam, 'B'),
    computedAt: exam.computedAt || null,
    rowCount: Array.isArray(exam.rows) ? exam.rows.length : 0,
  });
});
