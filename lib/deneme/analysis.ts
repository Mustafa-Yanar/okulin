import { ALTERNATIVE_PAIRS, getGroupsFor } from './config';
import type { DenemeExam, DenemeRow, Results } from './types';

// Alternatif ders kuralıyla toplam net (Din / Felsefe Seçmeli: yüksek olan).
export function computeToplamNet(results: Results): number {
  const altKeys = new Set(ALTERNATIVE_PAIRS.flat());
  let sum = 0;
  for (const [key, r] of Object.entries(results)) {
    if (altKeys.has(key)) continue;
    sum += r.net;
  }
  for (const [a, b] of ALTERNATIVE_PAIRS) {
    const na = results[a]?.net ?? null;
    const nb = results[b]?.net ?? null;
    if (na === null && nb === null) continue;
    sum += Math.max(na ?? -Infinity, nb ?? -Infinity);
  }
  return Math.round(sum * 100) / 100;
}

export interface RankInfo {
  rank: number;
  toplamNet: number | undefined;
  total: number;
}

// Denemede öğrencileri toplam nete göre sıralayıp sıra ata. username -> {rank,...}
export function computeRanks(exam: DenemeExam): Record<string, RankInfo> {
  const sorted = [...exam.rows].sort((a, b) => (b.toplamNet ?? 0) - (a.toplamNet ?? 0));
  const out: Record<string, RankInfo> = {};
  sorted.forEach((row, i) => {
    if (row.studentId) {
      out[row.studentId] = { rank: i + 1, toplamNet: row.toplamNet, total: sorted.length };
    }
  });
  return out;
}

// Sıralı liste (tablo için)
export function rankedList(exam: DenemeExam) {
  return [...exam.rows]
    .sort((a, b) => (b.toplamNet ?? 0) - (a.toplamNet ?? 0))
    .map((row, i) => ({
      rank: i + 1,
      excelName: row.excelName,
      studentId: row.studentId || '',
      toplamNet: row.toplamNet,
    }));
}

// Bir öğrencinin bir denemedeki ders grubu netleri (alternatif uygulanmış).
export function groupNetsFor(exam: DenemeExam, row: DenemeRow): Record<string, number> {
  const groups = getGroupsFor(exam.examType, exam.category);
  const altKeys = new Set(ALTERNATIVE_PAIRS.flat());
  const out: Record<string, number> = {};
  const results = row.results || {};
  for (const g of groups) {
    let sum = 0;
    for (const s of g.subjects) {
      const r = results[s.key];
      if (!r) continue;
      if (altKeys.has(s.key)) continue;
      sum += r.net;
    }
    for (const [a, b] of ALTERNATIVE_PAIRS) {
      const inGroup = g.subjects.some((s) => s.key === a || s.key === b);
      if (!inGroup) continue;
      const na = results[a]?.net ?? null;
      const nb = results[b]?.net ?? null;
      if (na === null && nb === null) continue;
      sum += Math.max(na ?? -Infinity, nb ?? -Infinity);
    }
    out[g.label] = Math.round(sum * 100) / 100;
  }
  return out;
}

export function shortDate(iso: string | null | undefined): string {
  const d = new Date(iso as string);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
