import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ALL_DAYS, slotsForDay } from '@/lib/constants';
import { getWeekKey, slotKey, getSlotTimes } from '@/lib/slots';

// GET /api/class-schedule?cls=701&week=2026-W20
// Bir sınıfın o haftadaki ders programını döner — slot grid'inden okur.
//
// Döndürür:
// {
//   cls, weekKey,
//   schedule: { [dayIndex]: [ { slotId, slotLabel, teacherId, teacherName, branch, fixed } ] }
// }
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cls = searchParams.get('cls');
  const weekKey = searchParams.get('week') || getWeekKey();
  if (!cls) return NextResponse.json({ error: 'cls gerekli' }, { status: 400 });

  const teacherIds = await redis.smembers('teachers');
  if (!teacherIds || teacherIds.length === 0) {
    return NextResponse.json({ cls, weekKey, schedule: {} });
  }

  const teacherPipeline = redis.pipeline();
  teacherIds.forEach(id => teacherPipeline.get(`teacher:${id}`));
  const teachers = await teacherPipeline.exec();

  // Tüm öğretmen × tüm gün × tüm slot için grid'den oku
  const slotTimes = await getSlotTimes();
  const gridPipeline = redis.pipeline();
  const meta = [];
  for (let i = 0; i < teacherIds.length; i++) {
    const tid = teacherIds[i];
    for (const day of ALL_DAYS) {
      for (const slot of slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday)) {
        meta.push({ teacherIdx: i, dayIndex: day.index, slot });
        gridPipeline.get(slotKey(weekKey, tid, day.index, slot.id));
      }
    }
  }
  const gridResults = await gridPipeline.exec();

  const schedule = {};
  for (const day of ALL_DAYS) schedule[day.index] = [];

  meta.forEach((m, i) => {
    const sd = gridResults[i];
    if (!sd || sd.lessonType !== 'ders' || sd.cls !== cls) return;
    const teacher = teachers[m.teacherIdx];
    if (!teacher) return;
    schedule[m.dayIndex].push({
      slotId: m.slot.id,
      slotLabel: m.slot.label,
      teacherId: teacher.id,
      teacherName: teacher.name,
      branch: sd.branch || sd.subBranch || '',
      subBranch: sd.subBranch || '',
      fixed: sd.fixed !== false,
    });
  });

  return NextResponse.json({ cls, weekKey, schedule });
}
