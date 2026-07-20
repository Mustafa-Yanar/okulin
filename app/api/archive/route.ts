import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';
import { ALL_DAYS, daySlots } from '@/lib/constants';
import { getDaySlotTimes } from '@/lib/slots';
import { listStudentEtutHistory, listTeacherEtutHistory } from '@/lib/etut/history';
import type { Prisma } from '@prisma/client';

type BookingWithTeacher = Prisma.SlotBookingGetPayload<{ include: { teacher: { select: { name: true; legacyId: true } } } }>;

// GET /api/archive?type=teacher&id=xxx  veya  ?type=student&id=xxx
export const GET = withAuth(['director', 'counselor'], async (req) => {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'teacher' | 'student'
  const id = searchParams.get('id');

  if (!type || !id) return NextResponse.json({ error: 'type ve id gerekli' }, { status: 400 });

  let bookings: BookingWithTeacher[] = [];
  if (type === 'teacher') {
    const teacher = await tdb().teacher.findFirst({ where: { legacyId: id } });
    if (!teacher) return NextResponse.json({ weeks: [] });
    bookings = await tdb().slotBooking.findMany({
      where: { teacherId: teacher.id, booked: true },
      include: { teacher: { select: { name: true, legacyId: true } } }
    });
  } else if (type === 'student') {
    bookings = await tdb().slotBooking.findMany({
      where: { studentId: id, booked: true },
      include: { teacher: { select: { name: true, legacyId: true } } }
    });
  }

  const slotTimes = await getDaySlotTimes(); // 7-gün model
  interface ArchiveEntry {
    day: number; dayLabel: string; slotId: string; slotLabel: string;
    studentId: string; studentName: string; studentCls: string;
    bookedBy: string; fixed: boolean; teacherId: string; teacherName: string; branch: string;
  }
  const weeksMap: Record<string, ArchiveEntry[]> = {}; // weekKey -> entries[]
  bookings.forEach(b => {
    const day = ALL_DAYS.find(d => d.index === b.dayIndex);
    const slotList = daySlots(b.dayIndex, slotTimes.days[b.dayIndex]);
    const slot = slotList.find(s => s.id === b.slotId);
    const entry: ArchiveEntry = {
      day: b.dayIndex,
      dayLabel: day?.label || '',
      slotId: b.slotId,
      slotLabel: slot?.label || '',
      studentId: b.studentId || '',
      studentName: b.studentName || '',
      studentCls: b.studentCls || '',
      bookedBy: b.bookedBy || '',
      fixed: !!b.fixed,
      teacherId: b.teacher.legacyId,
      teacherName: b.teacher.name || '',
      branch: b.dersBranch || '',
    };
    if (!weeksMap[b.weekKey]) weeksMap[b.weekKey] = [];
    weeksMap[b.weekKey].push(entry);
  });

  // Etüt geçmişi EtutReservation'dan (Faz 4 T3) — SlotBooking'de etüt artık yok (Faz 7c-3
  // sonrası ders-only); HistoryModal 'Geçmiş Etütler' bu satırlarla dolar. Entry şekli
  // ArchiveEntry ile birebir (lib/etut/history.ts). Ders satırları (SlotBooking) aynen kalır.
  const etutWeeks = type === 'teacher' ? await listTeacherEtutHistory(id) : await listStudentEtutHistory(id);
  for (const w of etutWeeks) {
    (weeksMap[w.weekKey] ||= []).push(...w.entries);
  }

  const weeks = Object.entries(weeksMap)
    .map(([weekKey, entries]) => ({ weekKey, entries }))
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey));

  return NextResponse.json({ weeks });
});
