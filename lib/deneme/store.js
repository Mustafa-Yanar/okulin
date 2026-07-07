// Deneme analizi veri katmanı. Tüm sınav/satır/namemap erişimi PostgreSQL'e.
// Analiz lib'leri (analysis/grade/score/report) SAF — exam objesi üzerinde çalışır,
// burada onlara her zaman GÖMÜLÜ-rows şekli (Redis kayıt şekli) verilir.
import { tdb } from '@/lib/sqldb';

export const dkeys = {
  exam: (id) => `deneme:exam:${id}`,
  examsIndex: 'deneme:exams:index', // ExamMeta listesi (en yeni başta)
  nameMap: 'deneme:namemap', // excelName(lower) -> studentId kalıcı eşleştirme
};

// İsmi sadeleştir (eşleştirme için)
export function normName(s) {
  return String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, ' ')
    .trim();
}

// SQL Exam satırı → eski (Redis) gömülü-rows exam objesi. createdAt/computedAt
// sayısal (Date.now()) geri verilir; rows = ExamRow.data (legacy studentId korunur).
function sqlExamToObj(ex) {
  if (!ex) return null;
  return {
    id: ex.legacyId,
    name: ex.name,
    examType: ex.examType,
    category: ex.category,
    date: ex.date,
    kitapcikSayisi: ex.kitapcikSayisi || 1,
    subjectKeys: ex.subjectKeys || [],
    answerKey: ex.answerKey || {},
    rows: (ex.rows || []).map((r) => r.data),
    computedAt: ex.computedAt ? ex.computedAt.getTime() : undefined,
    createdAt: ex.createdAt ? ex.createdAt.getTime() : Date.now(),
  };
}

// Tek sınav (gömülü-rows şeklinde) getir.
export async function getExam(id) {
  const ex = await tdb().exam.findFirst({ where: { legacyId: id }, include: { rows: true } });
  return sqlExamToObj(ex);
}

// Sınavı kaydet (gömülü-rows objesi). Exam kolonları update/create + rows tam-replace.
export async function saveExam(exam) {
  const cols = {
    name: exam.name, examType: exam.examType, category: exam.category ?? null,
    date: exam.date ?? null, kitapcikSayisi: exam.kitapcikSayisi ?? 1,
    subjectKeys: exam.subjectKeys || [], answerKey: exam.answerKey ?? null,
    computedAt: exam.computedAt ? new Date(exam.computedAt) : null,
  };
  let ex = await tdb().exam.findFirst({ where: { legacyId: exam.id } });
  if (ex) {
    await tdb().exam.update({ where: { id: ex.id }, data: cols });
    await tdb().examRow.deleteMany({ where: { examId: ex.id } });
  } else {
    ex = await tdb().exam.create({ data: { legacyId: exam.id, ...cols, createdAt: exam.createdAt ? new Date(exam.createdAt) : new Date() } });
  }
  const rows = Array.isArray(exam.rows) ? exam.rows : [];
  if (rows.length) {
    await tdb().examRow.createMany({ data: rows.map((r) => ({ examId: ex.id, studentId: r.studentId || null, data: r })) });
  }
}

// Sınav listesi (meta, en yeni başta).
export async function listExams() {
  const rows = await tdb().exam.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((e) => ({ id: e.legacyId, name: e.name, examType: e.examType, category: e.category, date: e.date, createdAt: e.createdAt ? e.createdAt.getTime() : 0 }));
}

// Yeni sınav index'e ekle (no-op — listExams Exam tablosundan türetir).
export async function addExamToIndex() {}

// Sınav sil.
export async function deleteExam(id) {
  const ex = await tdb().exam.findFirst({ where: { legacyId: id } });
  if (ex) await tdb().exam.delete({ where: { id: ex.id } }); // rows cascade
}

// İsim eşleştirme haritası (excelName(lower) → studentId).
export async function getNameMap() {
  const cfg = await tdb().tenantConfig.findFirst();
  return cfg?.denemeNameMap || {};
}

export async function saveNameMap(map) {
  const cfg = await tdb().tenantConfig.findFirst();
  if (cfg) await tdb().tenantConfig.update({ where: { orgSlug_branch: { orgSlug: cfg.orgSlug, branch: cfg.branch } }, data: { denemeNameMap: map } });
  else await tdb().tenantConfig.create({ data: { denemeNameMap: map } });
}

// Bir öğrencinin tüm denemelerdeki sonuç noktalarını üret (eskiden yeniye).
// /api/deneme/me ve /api/deneme/student ortak kullanır.
export async function buildStudentPoints(studentId) {
  const { computeRanks, groupNetsFor, shortDate } = await import('./analysis');

  // N+1'i kaldır: öğrencinin satırı olan sınavları tek sorguda bul,
  // o sınavların TÜM satırlarını (computeRanks için gerekli) tek sorguda çek.
  const myRows = await tdb().examRow.findMany({
    where: { studentId }, select: { examId: true },
  });
  const examIds = [...new Set(myRows.map((r) => r.examId))];
  if (examIds.length === 0) return [];
  const rows = await tdb().exam.findMany({
    where: { id: { in: examIds } }, include: { rows: true }, orderBy: { createdAt: 'asc' },
  });
  const exams = rows.map(sqlExamToObj);

  const points = [];
  for (const exam of exams) {
    if (!exam) continue;
    const row = exam.rows.find((r) => r.studentId === studentId);
    if (!row) continue;
    const ranks = computeRanks(exam);
    const rk = ranks[studentId];
    points.push({
      examId: exam.id,
      name: exam.name,
      examType: exam.examType,
      dateLabel: shortDate(exam.date),
      fullDate: new Date(exam.date).toLocaleDateString('tr-TR'),
      toplamNet: row.toplamNet,
      rank: rk ? rk.rank : 0,
      total: rk ? rk.total : exam.rows.length,
      groupNets: groupNetsFor(exam, row),
      subjectKeys: exam.subjectKeys,
      results: row.results,
    });
  }
  return points;
}

// Mevcut okulin öğrencilerini getir: [{ id, name, username, cls, group }]
export async function getAllStudents() {
  const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
  return rows.map((s) => ({ id: s.legacyId, name: s.name, username: s.username, cls: s.class?.legacyId || '', group: s.group }));
}
