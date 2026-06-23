import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getExam, getAllStudents } from '@/lib/deneme/store';
import { buildReports } from '@/lib/deneme/report';
import { hasAnswerKey } from '@/lib/deneme/grade';

function isManager(s) {
  return s && (s.role === 'director' || s.role === 'counselor');
}

// Okulizyon biçimli sonuç listeleri (JSON). İstemci bundan ekran tablosu + PDF/Excel üretir.
export async function GET(_req, { params }) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const exam = await getExam(params.id);
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });

  // Eşleşmiş öğrenci ad/sınıf bilgisi (rapora gerçek isim + sınıf yazılır)
  const students = await getAllStudents();
  const studentInfoById = {};
  for (const s of students) studentInfoById[s.id] = { name: s.name, cls: s.cls };

  const report = buildReports(exam, { studentInfoById });

  return NextResponse.json({
    ...report,
    hasKey: hasAnswerKey(exam, 'A') || hasAnswerKey(exam, 'B'),
    computedAt: exam.computedAt || null,
    rowCount: Array.isArray(exam.rows) ? exam.rows.length : 0,
  });
}
