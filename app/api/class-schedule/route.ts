import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { ALL_DAYS, daySlots } from '@/lib/constants';
import { getWeekKey, getAllTeachers, getTeacherWeekSlots, getDaySlotTimes } from '@/lib/slots';

// GET /api/class-schedule?cls=701&week=2026-W20
// Bir sınıfın o haftadaki ders programını döner — öğretmen slot grid'lerinden okur.
// getAllTeachers + getTeacherWeekSlots bayrak-aware (SQL/Redis).
//
// Döndürür:
// {
//   cls, weekKey,
//   schedule: { [dayIndex]: [ { slotId, slotLabel, teacherId, teacherName, branch, fixed } ] }
// }
export const GET = withAuth(async (req) => {

  const { searchParams } = new URL(req.url);
  const cls = searchParams.get('cls');
  const weekKey = searchParams.get('week') || getWeekKey();
  if (!cls) return NextResponse.json({ error: 'cls gerekli' }, { status: 400 });

  const teachers = await getAllTeachers(); // SQL-aware
  if (!teachers || teachers.length === 0) {
    return NextResponse.json({ cls, weekKey, schedule: {} });
  }

  const schedule: Record<number, object[]> = {};
  for (const day of ALL_DAYS) schedule[day.index] = [];
  const slotTimes = await getDaySlotTimes(); // 7-gün model

  for (const t of teachers) {
    const grid = await getTeacherWeekSlots(t.id, weekKey); // SQL-aware grid {[day]:[cell]}
    for (const day of ALL_DAYS) {
      const slots = daySlots(day.index, slotTimes.days[day.index]);
      (grid[day.index] || []).forEach((sd, slotIdx) => {
        if (!sd || sd.lessonType !== 'ders' || sd.cls !== cls) return;
        const slot = slots[slotIdx];
        schedule[day.index].push({
          slotId: slot?.id,
          slotLabel: slot?.label,
          teacherId: t.id,
          teacherName: t.name,
          branch: sd.branch || sd.subBranch || '',
          subBranch: sd.subBranch || '',
          fixed: sd.fixed !== false,
        });
      });
    }
  }

  return NextResponse.json({ cls, weekKey, schedule });
});
