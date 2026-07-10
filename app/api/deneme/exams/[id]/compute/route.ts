import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getExam, saveExam } from '@/lib/deneme/store';
import { gradeFlat, hasAnswerKey } from '@/lib/deneme/grade';
import { computePuanlar } from '@/lib/deneme/score';
import { notifyExamResults } from '@/lib/notify';

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

// Hesapla: tüm satırları ham cevaplardan + güncel cevap anahtarıyla yeniden puanla.
// (Anahtar satırlardan SONRA girilmiş olabilir → results boş kalmış olabilir.) Her satıra
// results + toplamNet + puan yazılır; öğrenci paneli/grafiği güncel netleri görür.
export const POST = withAuth(['director', 'counselor'], async (_req, ctx) => {

  const exam = await getExam(String(ctx.params?.id));
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });
  const rows = Array.isArray(exam.rows) ? exam.rows : [];

  const hasKey = hasAnswerKey(exam, 'A') || hasAnswerKey(exam, 'B');
  if (!hasKey) {
    return NextResponse.json({ error: 'Önce cevap anahtarı gir.' }, { status: 400 });
  }

  let graded = 0;
  let sumNet = 0;
  for (const row of rows) {
    const g = gradeFlat(exam, (row.rawAnswers as (string | null)[] | undefined) || [], row.kitapcik || 'A');
    if (g) {
      row.results = g.results;
      row.toplamNet = g.toplamNet;
      graded++;
    } else {
      row.results = {};
      row.toplamNet = 0;
    }
    row.puan = computePuanlar(exam.examType, row.results);
    sumNet += row.toplamNet || 0;
  }

  exam.computedAt = Date.now();
  await saveExam(exam);

  // "Yeni sonuç" tetikleyicisi — eşleşmiş öğrencilerin velilerine push (best-effort, sınav başına bir kez)
  await notifyExamResults(exam);

  return NextResponse.json({
    ok: true,
    count: rows.length,
    graded,
    ortalamaNet: rows.length ? Math.round((sumNet / rows.length) * 100) / 100 : 0,
  });
});
