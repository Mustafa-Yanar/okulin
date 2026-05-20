// Deneme analizi veri katmanı. Tüm anahtarlar "deneme:" prefix'li —
// etüttakip'in mevcut verisinden tamamen ayrı.
import redis from '@/lib/redis';

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

// Bir öğrencinin tüm denemelerdeki sonuç noktalarını üret (eskiden yeniye).
// /api/deneme/me ve /api/deneme/student ortak kullanır.
export async function buildStudentPoints(studentId) {
  const { computeRanks, groupNetsFor, shortDate } = await import('./analysis');
  const index = (await redis.get(dkeys.examsIndex)) || [];
  const ordered = [...index].sort((a, b) => a.createdAt - b.createdAt);
  const points = [];
  for (const meta of ordered) {
    const exam = await redis.get(dkeys.exam(meta.id));
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

// Mevcut etüttakip öğrencilerini getir: [{ id, name, username, cls, group }]
export async function getAllStudents() {
  const ids = (await redis.smembers('students')) || [];
  if (ids.length === 0) return [];
  const pipeline = redis.pipeline();
  ids.forEach((id) => pipeline.get(`student:${id}`));
  const results = await pipeline.exec();
  return results
    .filter(Boolean)
    .map((s) => ({ id: s.id, name: s.name, username: s.username, cls: s.cls, group: s.group }));
}
