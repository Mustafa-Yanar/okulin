import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';
import { getExamsByType, getAllStudents } from '@/lib/deneme/store';
import { buildClassReport, buildClassTrend, type StudentInfoById } from '@/lib/deneme/report';

// Müdür/rehber: seçili türde SINIF bazlı karşılaştırma + gelişim trendi.
// GET /api/deneme/class-report?type=TYT[&examId=...]
// Yalnız HESAPLANMIŞ (computedAt) sınavlar anlamlıdır; hesaplanmamışlar liste dışı.
export const GET = withAuth(['director', 'counselor'], 'deneme', async (req) => {
  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') || 'TYT').toUpperCase();
  if (!['TYT', 'AYT', 'LGS'].includes(type)) {
    return NextResponse.json({ error: 'Geçersiz tür' }, { status: 400 });
  }

  // Sınıf legacyId → görünen ad; öğrenci → { name, cls(ad) }.
  // Rapor sınıfı ADIYLA gösterir (opak legacyId değil).
  const [classes, students] = await Promise.all([
    tdb().class.findMany({ select: { legacyId: true, ad: true } }),
    getAllStudents(),
  ]);
  const clsAd = new Map(classes.map((c) => [c.legacyId, c.ad]));
  const studentInfoById: StudentInfoById = {};
  for (const s of students) {
    studentInfoById[s.id] = { name: s.name, cls: s.cls ? (clsAd.get(s.cls) || s.cls) : '' };
  }

  const all = await getExamsByType(type);
  const computed = all.filter((e) => e.computedAt);
  if (computed.length === 0) {
    return NextResponse.json({ type, exams: [], selectedId: null, comparison: null, trend: null });
  }

  // Karşılaştırma için seçili sınav: istenen (varsa) yoksa en yeni hesaplanmış.
  const wantId = searchParams.get('examId');
  const selected = (wantId && computed.find((e) => e.id === wantId)) || computed[computed.length - 1];

  const comparison = buildClassReport(selected, { studentInfoById });
  const trend = buildClassTrend(computed, { studentInfoById });

  return NextResponse.json({
    type,
    exams: computed.map((e) => ({ id: e.id, name: e.name, date: e.date })),
    selectedId: selected.id,
    comparison,
    trend,
  });
});
