import { ALL_DAYS, daySlots } from '@/lib/constants';
import {
  getWeekCellsAllTeachers, getAllProgramTemplates, getDaySlotTimes,
  getTeacherWeekSlots, dateStrForWeekDay, etutAktifThisWeek, type EtutSablonu,
} from '@/lib/slots';
import { getOrgConfig } from '@/lib/config';
import { HttpError } from '@/lib/errors';
import type { Session } from '@/lib/auth';
import type {
  StudentWeek, ParentWeek, TeacherWeek, ManagementWeek,
  WeekDay, TeacherWeekDay, TodayLesson, TodayEtut, TeacherSlotView, ParentChildView,
} from './api-types';

// Haftalık program servis katmanı (spec §5.1) — today.ts collectClassDay mantığının
// 7 güne genişlemesi. Öğretmen-başına sorgu YOK (getWeekCellsAllTeachers tüm hafta,
// getAllProgramTemplates tek, getDaySlotTimes tek). Öğrenci yalnız KENDİ etütleri.

async function collectClassWeek(cls: string, weekKey: string, etutStudentId: string | null): Promise<WeekDay[]> {
  const [weekCells, templates, slotTimes] = await Promise.all([
    getWeekCellsAllTeachers(weekKey),
    etutStudentId ? getAllProgramTemplates() : Promise.resolve([]),
    getDaySlotTimes(),
  ]);
  const days: WeekDay[] = [];
  for (const day of ALL_DAYS) {
    const dayIndex = day.index;
    const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
    const labelBySlotId = new Map(slots.map((s) => [s.id, s.label]));
    const idxBySlotId = new Map(slots.map((s, i) => [s.id, i]));

    const lessons: TodayLesson[] = [];
    for (const r of weekCells[dayIndex] ?? []) {
      const sd = r.cell;
      if (!sd || sd.lessonType !== 'ders' || sd.cls !== cls) continue;
      lessons.push({
        slotId: r.slotId,
        slotLabel: labelBySlotId.get(r.slotId) ?? '',
        teacherId: r.teacherLegacyId,
        teacherName: r.teacherName,
        branch: sd.branch || sd.subBranch || '',
        subBranch: sd.subBranch || '',
      });
    }
    lessons.sort((a, b) => (idxBySlotId.get(a.slotId) ?? 99) - (idxBySlotId.get(b.slotId) ?? 99));

    let etuts: TodayEtut[] | null = null;
    if (etutStudentId) {
      const collected: TodayEtut[] = [];
      for (const t of templates) {
        const list = Array.isArray(t.template.etutSablonlari) ? (t.template.etutSablonlari as EtutSablonu[]) : [];
        for (const sb of list) {
          if (sb.dayIndex !== dayIndex || !etutAktifThisWeek(sb, weekKey)) continue;
          if (sb.studentId !== etutStudentId) continue; // yalnız KENDİ rezervasyonu (veri minimizasyonu)
          collected.push({ id: sb.id, start: sb.start, end: sb.end, teacherName: t.name, branch: sb.branch || null, studentName: sb.studentName || null, booked: true });
        }
      }
      collected.sort((a, b) => a.start.localeCompare(b.start));
      etuts = collected;
    }

    days.push({ dayIndex, dayLabel: day.label, date: dateStrForWeekDay(weekKey, dayIndex), lessons, etuts });
  }
  return days;
}

export async function buildStudentWeek(session: Session, weekKey: string): Promise<StudentWeek> {
  const mods = await getOrgConfig('modules');
  const etutOn = mods.etut !== false;
  const days = await collectClassWeek(String(session.cls ?? ''), weekKey, etutOn ? String(session.id ?? '') : null);
  return { role: 'student', weekKey, days };
}

export async function buildParentWeek(session: Session, weekKey: string, childId: string | null): Promise<ParentWeek> {
  const mods = await getOrgConfig('modules');
  const children: ParentChildView[] = (session.children ?? [])
    .map((c) => (typeof c === 'string' ? null : { id: String(c.id ?? ''), name: String(c.name ?? ''), cls: String(c.cls ?? '') }))
    .filter((c): c is ParentChildView => c != null && c.id !== '');
  if (childId && !children.some((c) => c.id === childId)) throw new HttpError(403, 'Bu öğrenciye erişim yetkiniz yok');
  const chosen = (childId ? children.find((c) => c.id === childId) : children[0]) ?? null;
  if (!chosen) return { role: 'parent', weekKey, children, child: null };
  const etutOn = mods.etut !== false;
  const days = await collectClassWeek(chosen.cls, weekKey, etutOn ? chosen.id : null);
  return { role: 'parent', weekKey, children, child: { id: chosen.id, name: chosen.name, cls: chosen.cls, days } };
}

export async function buildTeacherWeek(session: Session, weekKey: string): Promise<TeacherWeek> {
  const me = String(session.id ?? '');
  const [grid, slotTimes] = await Promise.all([getTeacherWeekSlots(me, weekKey), getDaySlotTimes()]);
  const days: TeacherWeekDay[] = [];
  for (const day of ALL_DAYS) {
    const dayIndex = day.index;
    const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
    const dayCells: TeacherSlotView[] = [];
    (grid[dayIndex] || []).forEach((sd, i) => {
      if (!sd) return;
      const isDers = sd.lessonType === 'ders';
      const isBookedEtut = !isDers && !!sd.booked; // boş/disabled gösterilmez
      if (!isDers && !isBookedEtut) return;
      const slot = slots[i];
      dayCells.push({
        slotId: slot?.id ?? '',
        slotLabel: slot?.label ?? '',
        type: isDers ? 'ders' : 'etut',
        cls: sd.cls || sd.studentCls || null,
        studentName: sd.studentName || null,
        branch: sd.branch || sd.subBranch || '',
      });
    });
    days.push({ dayIndex, dayLabel: day.label, date: dateStrForWeekDay(weekKey, dayIndex), slots: dayCells });
  }
  return { role: 'teacher', weekKey, days };
}

export function buildManagementWeek(weekKey: string): ManagementWeek {
  return { role: 'management', weekKey };
}
