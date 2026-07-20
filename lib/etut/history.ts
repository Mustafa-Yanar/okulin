// lib/etut/history.ts — Faz 4 T2. Öğrenci/öğretmen TÜM-haftalar etüt geçmişi
// (index [orgSlug,branch,studentId,weekKey] / [orgSlug,branch,teacherId,weekKey] hazır — Faz 1)
// + freeze-on-rollover (spec §3.3: recurring sahibi değişince geçmiş bozulmasın diye biten
// haftanın efektif RECURRING satırları somut WEEK/ACTIVE satırlara dondurulur).
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { ALL_DAYS } from '@/lib/constants';
import { getAllTeachers } from '@/lib/slots';
import { getWeekReservations, resolveEffective } from './reservations';
import type { EtutReservation } from '@prisma/client';

// ArchiveEntry-uyumlu (HistoryModal / app/api/archive/route.ts şekliyle BİREBİR — Task 3 bu
// şekli /api/archive weeksMap'ine aynen ekler).
export interface EtutHistoryEntry {
  day: number; dayLabel: string; slotId: string; slotLabel: string;
  studentId: string; studentName: string; studentCls: string;
  bookedBy: string; fixed: boolean; teacherId: string; teacherName: string; branch: string;
}

// SAF: EtutReservation satırlarını (status ACTIVE + scope WEEK ön-süzülmüş — RECURRING_WEEKKEY
// '*' marker'ı burada asla görünmez) haftalara grupla; hafta DESC, hafta-içi gün+saat ASC sırala.
export function buildEtutHistoryWeeks(
  rows: EtutReservation[],
  teacherNameById: Map<string, string>,
): { weekKey: string; entries: EtutHistoryEntry[] }[] {
  const dayLabel = new Map(ALL_DAYS.map(d => [d.index, d.label]));
  const byWeek = new Map<string, EtutHistoryEntry[]>();
  for (const r of rows) {
    const entry: EtutHistoryEntry = {
      day: r.dayIndex, dayLabel: dayLabel.get(r.dayIndex) || '',
      slotId: `etut:${r.sablonId}`, slotLabel: `${r.startsAt}–${r.endsAt}`,
      studentId: r.studentId, studentName: r.studentName, studentCls: r.studentCls,
      bookedBy: r.bookedByRole, fixed: false,
      teacherId: r.teacherId, teacherName: teacherNameById.get(r.teacherId) ?? r.teacherId,
      branch: r.dersBranch,
    };
    const list = byWeek.get(r.weekKey);
    if (list) list.push(entry); else byWeek.set(r.weekKey, [entry]);
  }
  return [...byWeek.entries()]
    .map(([weekKey, entries]) => ({
      weekKey,
      entries: entries.sort((a, b) => (a.day - b.day) || a.slotLabel.localeCompare(b.slotLabel)),
    }))
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey));
}

// Ortak iç fonksiyon — öğrenci/öğretmen geçmişi arasındaki TEK fark where'deki id alanı.
// status ACTIVE + scope WEEK: yalnız SOMUT haftalar (recurring '*' marker'ı geçmiş listesi
// değildir; dondurulmamış recurring haftalar freeze-on-rollover cron'u işledikçe somutlaşır).
async function listEtutHistory(idField: 'studentId' | 'teacherId', id: string) {
  const orgSlug = currentOrg(); const branch = currentBranch();
  const [rows, teachers] = await Promise.all([
    tdb(orgSlug, branch).etutReservation.findMany({
      where: { orgSlug, branch, [idField]: id, status: 'ACTIVE', scope: 'WEEK' },
    }),
    getAllTeachers(),
  ]);
  return buildEtutHistoryWeeks(rows, new Map(teachers.map(t => [t.id, t.name])));
}

export async function listStudentEtutHistory(studentId: string) {
  return listEtutHistory('studentId', studentId);
}

export async function listTeacherEtutHistory(teacherLegacyId: string) {
  return listEtutHistory('teacherId', teacherLegacyId);
}

// SAF: bir haftanın efektif satırları arasından yalnız RECURRING kaynaklıları seç (dondurulacaklar).
export function selectRecurringToFreeze(effective: Map<string, EtutReservation>): EtutReservation[] {
  return [...effective.values()].filter(r => r.scope === 'RECURRING');
}

// Biten haftanın efektif RECURRING satırlarını somut WEEK/ACTIVE satırlara dondurur.
// resolveEffective WEEK-öncelikli olduğundan efektif RECURRING dönen (sablon, hafta) çiftinde
// WEEK satırı (ACTIVE veya tombstone) KESİN yoktur — aksi halde resolveEffective o satırı
// (WEEK'i) döndürürdü, RECURRING'i değil. Bu yüzden createMany çakışmasız/güvenli;
// skipDuplicates yalnız eşzamanlı-koşu (cron iki kez tetiklenirse) yarış guard'ı.
export async function freezeRecurringWeek(weekKey: string): Promise<number> {
  const orgSlug = currentOrg(); const branch = currentBranch();
  const rows = await getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey);
  const toFreeze = selectRecurringToFreeze(resolveEffective(rows, weekKey));
  if (!toFreeze.length) return 0;
  const res = await tdb(orgSlug, branch).etutReservation.createMany({
    data: toFreeze.map(r => ({
      orgSlug, branch, sablonId: r.sablonId, teacherId: r.teacherId,
      scope: 'WEEK' as const, status: 'ACTIVE' as const, weekKey, effectiveFromWeek: null,
      studentId: r.studentId, studentName: r.studentName, studentCls: r.studentCls,
      dersBranch: r.dersBranch, bookedByRole: r.bookedByRole, bookedById: r.bookedById,
      bookedAt: r.bookedAt, dayIndex: r.dayIndex, startsAt: r.startsAt, endsAt: r.endsAt,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
