import { ALL_DAYS, daySlots } from '@/lib/constants';
import {
  getWeekCellsAllTeachers, getDaySlotTimes,
  getTeacherWeekSlots, dateStrForWeekDay,
} from '@/lib/slots';
import { listEtutlerForWeek, type EtutAllRow } from '@/lib/etut/rezervasyon';
import { toMin } from '@/lib/etut/overlap';
import { getOrgConfig } from '@/lib/config';
import { HttpError } from '@/lib/errors';
import type { Session } from '@/lib/auth';
import type {
  StudentWeek, ParentWeek, TeacherWeek, ManagementWeek,
  WeekDay, TeacherWeekDay, TodayLesson, TodayEtut, TeacherSlotView, ParentChildView,
} from './api-types';

// Haftalık program servis katmanı (spec §5.1) — today.ts collectClassDay mantığının
// 7 güne genişlemesi. Öğretmen-başına sorgu YOK (getWeekCellsAllTeachers tüm hafta,
// listEtutlerForWeek tek — Faz 3 tablo-tabanlı, getDaySlotTimes tek). Öğrenci yalnız KENDİ etütleri.

async function collectClassWeek(cls: string, weekKey: string, etutStudentId: string | null): Promise<WeekDay[]> {
  const [weekCells, etutRows, slotTimes] = await Promise.all([
    getWeekCellsAllTeachers(weekKey),
    etutStudentId ? listEtutlerForWeek(weekKey) : Promise.resolve([] as EtutAllRow[]),
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
      etuts = etutRows
        .filter((r) => r.dayIndex === dayIndex && r.studentId === etutStudentId) // yalnız KENDİ rezervasyonu (veri minimizasyonu)
        .map((r) => ({ id: r.id, start: r.start, end: r.end, teacherName: r.teacherName, branch: r.branch, studentName: r.studentName, booked: true }));
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
  const mods = await getOrgConfig('modules');
  const [grid, slotTimes, etutRows] = await Promise.all([
    getTeacherWeekSlots(me, weekKey),
    getDaySlotTimes(),
    mods.etut !== false ? listEtutlerForWeek(weekKey) : Promise.resolve([] as EtutAllRow[]),
  ]);
  // Öğretmenin bu haftaki DOLU etütleri (EtutReservation) — days[].slots içine type:'etut'
  // satırı olarak eklenir (yanıt şekli değişmez; RN hafta ekranı 'etut' render'ını zaten
  // içerir). Eski kaynak (SlotBooking booked hücresi) B3/dalga2'de kaldırıldı; bu besleme
  // cutover'da unutulmuş öğretmen-hafta boşluğunu da kapatır (bugün ekranıyla parite).
  const myEtuts = etutRows.filter((r) => r.teacherId === me && r.booked);
  const days: TeacherWeekDay[] = [];
  for (const day of ALL_DAYS) {
    const dayIndex = day.index;
    const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
    // Ders + etüt satırları startMin ile toplanır, KRONOLOJİK sıralanıp öyle döndürülür
    // (api-types sözleşmesi: slots saat sıralı — diff-denetim bulgusu: sona push edilen
    // etüt satırı 10:00'da olsa bile 16:00 dersinden sonra görünüyordu).
    const cells: { startMin: number; view: TeacherSlotView }[] = [];
    (grid[dayIndex] || []).forEach((sd, i) => {
      if (!sd || sd.lessonType !== 'ders') return; // yalnız ders hücreleri; boş/disabled gösterilmez
      const slot = slots[i];
      cells.push({
        startMin: slot ? toMin(slot.start) : 24 * 60,
        view: {
          slotId: slot?.id ?? '',
          slotLabel: slot?.label ?? '',
          type: 'ders',
          cls: sd.cls || null,
          studentName: null,
          branch: sd.branch || sd.subBranch || '',
        },
      });
    });
    for (const r of myEtuts.filter((e) => e.dayIndex === dayIndex)) {
      cells.push({
        startMin: toMin(r.start),
        view: {
          slotId: `etut:${r.id}`,
          slotLabel: `${r.start}–${r.end}`,
          type: 'etut',
          cls: r.studentCls || null,
          studentName: r.studentName || null,
          branch: r.branch || '',
        },
      });
    }
    cells.sort((a, b) => a.startMin - b.startMin);
    days.push({ dayIndex, dayLabel: day.label, date: dateStrForWeekDay(weekKey, dayIndex), slots: cells.map((c) => c.view) });
  }
  return { role: 'teacher', weekKey, days };
}

export function buildManagementWeek(weekKey: string): ManagementWeek {
  return { role: 'management', weekKey };
}
