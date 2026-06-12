import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { dkeys } from '@/lib/deneme/store';
import { gradeFlat, hasAnswerKey } from '@/lib/deneme/grade';
import { computePuanlar } from '@/lib/deneme/score';
import { notifyExamResults } from '@/lib/notify';

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

function isManager(s) {
  return s && (s.role === 'director' || s.role === 'counselor');
}

// Hesapla: tüm satırları ham cevaplardan + güncel cevap anahtarıyla yeniden puanla.
// (Anahtar satırlardan SONRA girilmiş olabilir → results boş kalmış olabilir.) Her satıra
// results + toplamNet + puan yazılır; öğrenci paneli/grafiği güncel netleri görür.
export async function POST(_req, { params }) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const exam = await redis.get(dkeys.exam(params.id));
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });
  const rows = Array.isArray(exam.rows) ? exam.rows : [];

  const hasKey = hasAnswerKey(exam, 'A') || hasAnswerKey(exam, 'B');
  if (!hasKey) {
    return NextResponse.json({ error: 'Önce cevap anahtarı gir.' }, { status: 400 });
  }

  let graded = 0;
  let sumNet = 0;
  for (const row of rows) {
    const g = gradeFlat(exam, row.rawAnswers || [], row.kitapcik || 'A');
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
  await redis.set(dkeys.exam(exam.id), exam);

  // "Yeni sonuç" tetikleyicisi — eşleşmiş öğrencilerin velilerine push (best-effort, sınav başına bir kez)
  await notifyExamResults(exam);

  return NextResponse.json({
    ok: true,
    count: rows.length,
    graded,
    ortalamaNet: rows.length ? Math.round((sumNet / rows.length) * 100) / 100 : 0,
  });
}
