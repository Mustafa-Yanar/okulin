import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getExam, deleteExam } from '@/lib/deneme/store';
import { rankedList } from '@/lib/deneme/analysis';

// Deneme detayı — sıralı liste. Müdür ve öğretmen görür (tüm öğrenciler).
export const GET = withAuth(['director', 'counselor', 'teacher'], async (_req, ctx, session) => {
  const exam = await getExam(String(ctx.params?.id));
  if (!exam) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });

  const isManager = session.role === 'director' || session.role === 'counselor';

  return NextResponse.json({
    exam: {
      id: exam.id,
      name: exam.name,
      examType: exam.examType,
      category: exam.category,
      date: exam.date,
      kitapcikSayisi: exam.kitapcikSayisi || 1,
      subjectKeys: exam.subjectKeys,
      // Cevap anahtarı + ham satırlar yalnız yöneticiye (öğretmene gitmez).
      ...(isManager
        ? {
            answerKey: exam.answerKey || {},
            rows: (exam.rows || []).map((r) => ({
              id: r.id,
              source: r.source,
              kitapcik: r.kitapcik,
              excelName: r.excelName,
              studentId: r.studentId || '',
              toplamNet: r.toplamNet,
            })),
          }
        : {}),
      rowCount: Array.isArray(exam.rows) ? exam.rows.length : 0,
    },
    ranking: rankedList(exam),
  });
});

// Deneme sil (müdür)
export const DELETE = withAuth(['director', 'counselor'], async (_req, ctx) => {
  await deleteExam(String(ctx.params?.id));
  return NextResponse.json({ ok: true });
});
