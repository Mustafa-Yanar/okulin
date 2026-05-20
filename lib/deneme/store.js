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
