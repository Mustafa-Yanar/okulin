// Deneme analizi veri katmanı. Tüm anahtarlar "deneme:" prefix'li —
// okulin'in mevcut verisinden tamamen ayrı.
// Bayrak-kapılı SQL göçü: isSqlEnabled() ile sınav/satır/namemap erişimi PostgreSQL'e.
// Analiz lib'leri (analysis/grade/score/report) SAF — exam objesi üzerinde çalışır,
// burada onlara her zaman GÖMÜLÜ-rows şekli (Redis kayıt şekli) verilir.
import redis from '@/lib/db';
import { isSqlEnabled } from '@/lib/usesql';
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
  if (isSqlEnabled()) {
    const ex = await tdb().exam.findFirst({ where: { legacyId: id }, include: { rows: true } });
    return sqlExamToObj(ex);
  }
  return redis.get(dkeys.exam(id));
}

// Sınavı kaydet (gömülü-rows objesi). SQL'de: Exam kolonları update/create + rows tam-replace.
export async function saveExam(exam) {
  if (isSqlEnabled()) {
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
    return;
  }
  await redis.set(dkeys.exam(exam.id), exam);
}

// Sınav listesi (meta, en yeni başta).
export async function listExams() {
  if (isSqlEnabled()) {
    const rows = await tdb().exam.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((e) => ({ id: e.legacyId, name: e.name, examType: e.examType, category: e.category, date: e.date, createdAt: e.createdAt ? e.createdAt.getTime() : 0 }));
  }
  return (await redis.get(dkeys.examsIndex)) || [];
}

// Yeni sınav index'e ekle (SQL'de no-op — listExams Exam tablosundan türetir).
export async function addExamToIndex(meta) {
  if (isSqlEnabled()) return; // index yok; saveExam yeterli
  const index = (await redis.get(dkeys.examsIndex)) || [];
  index.unshift(meta);
  await redis.set(dkeys.examsIndex, index);
}

// Sınav sil.
export async function deleteExam(id) {
  if (isSqlEnabled()) {
    const ex = await tdb().exam.findFirst({ where: { legacyId: id } });
    if (ex) await tdb().exam.delete({ where: { id: ex.id } }); // rows cascade
    return;
  }
  await redis.del(dkeys.exam(id));
  const index = (await redis.get(dkeys.examsIndex)) || [];
  await redis.set(dkeys.examsIndex, index.filter((m) => m.id !== id));
}

// İsim eşleştirme haritası (excelName(lower) → studentId).
export async function getNameMap() {
  if (isSqlEnabled()) {
    const cfg = await tdb().tenantConfig.findFirst();
    return cfg?.denemeNameMap || {};
  }
  return (await redis.get(dkeys.nameMap)) || {};
}

export async function saveNameMap(map) {
  if (isSqlEnabled()) {
    const cfg = await tdb().tenantConfig.findFirst();
    if (cfg) await tdb().tenantConfig.update({ where: { orgSlug_branch: { orgSlug: cfg.orgSlug, branch: cfg.branch } }, data: { denemeNameMap: map } });
    else await tdb().tenantConfig.create({ data: { denemeNameMap: map } });
    return;
  }
  await redis.set(dkeys.nameMap, map);
}

// Bir öğrencinin tüm denemelerdeki sonuç noktalarını üret (eskiden yeniye).
// /api/deneme/me ve /api/deneme/student ortak kullanır.
export async function buildStudentPoints(studentId) {
  const { computeRanks, groupNetsFor, shortDate } = await import('./analysis');

  // SQL hızlı yol: N+1'i kaldır. Öğrencinin satırı olan sınavları tek sorguda bul,
  // o sınavların TÜM satırlarını (computeRanks için gerekli) tek sorguda çek.
  let exams;
  if (isSqlEnabled()) {
    const myRows = await tdb().examRow.findMany({
      where: { studentId }, select: { examId: true },
    });
    const examIds = [...new Set(myRows.map((r) => r.examId))];
    if (examIds.length === 0) return [];
    const rows = await tdb().exam.findMany({
      where: { id: { in: examIds } }, include: { rows: true }, orderBy: { createdAt: 'asc' },
    });
    exams = rows.map(sqlExamToObj);
  } else {
    const index = await listExams();
    const ordered = [...index].sort((a, b) => a.createdAt - b.createdAt);
    exams = [];
    for (const meta of ordered) {
      const ex = await getExam(meta.id);
      if (ex) exams.push(ex);
    }
  }

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
  if (isSqlEnabled()) {
    const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
    return rows.map((s) => ({ id: s.legacyId, name: s.name, username: s.username, cls: s.class?.legacyId || '', group: s.group }));
  }
  const ids = (await redis.smembers('students')) || [];
  if (ids.length === 0) return [];
  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.get(`student:${id}`));
  const results = await pipeline.exec();
  return results
    .filter(Boolean)
    .map((s) => ({ id: s.id, name: s.name, username: s.username, cls: s.cls, group: s.group }));
}
