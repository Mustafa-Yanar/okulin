import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getWeekKey, getMondayOfWeek, initWeekForTeacher, slotKey, getSlotTimes } from '@/lib/slots';
import { ALL_DAYS, slotsForDay } from '@/lib/constants';

// Pazar 11:00 UTC+3 = 08:00 UTC → "0 8 * * 0"
export async function GET(req) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  // Mevcut haftaya sıfırla (düzeltme modu)
  if (searchParams.get('action') === 'reset') {
    const current = getWeekKey();
    await redis.set('current_week', current);
    return NextResponse.json({ ok: true, weekKey: current });
  }

  const ids = await redis.smembers('teachers');
  if (!ids || ids.length === 0) return NextResponse.json({ ok: true, message: 'No teachers' });

  const stored = await redis.get('current_week');
  const currentWeek = stored || getWeekKey();

  const monday = getMondayOfWeek(currentWeek);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const nextWeek = getWeekKey(nextMonday);

  // Mevcut haftayı arşivle (öğretmen bazlı ve öğrenci bazlı)
  const studentArchiveMap = {}; // studentId -> entries[]
  const slotTimes = await getSlotTimes();

  for (const tid of ids) {
    const teacher = await redis.get(`teacher:${tid}`);
    if (!teacher) continue;

    const teacherEntries = [];
    for (const day of ALL_DAYS) {
      for (const slot of slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday)) {
        const k = slotKey(currentWeek, tid, day.index, slot.id);
        const sd = await redis.get(k);
        if (!sd || !sd.booked) continue;
        const entry = {
          day: day.index, dayLabel: day.label,
          slotId: slot.id, slotLabel: slot.label,
          studentId: sd.studentId, studentName: sd.studentName, studentCls: sd.studentCls,
          bookedBy: sd.bookedBy, fixed: !!sd.fixed,
          teacherId: tid, teacherName: teacher.name, branch: sd.branch || '',
        };
        teacherEntries.push(entry);
        if (sd.studentId) {
          if (!studentArchiveMap[sd.studentId]) studentArchiveMap[sd.studentId] = [];
          studentArchiveMap[sd.studentId].push(entry);
        }
      }
    }
    if (teacherEntries.length > 0) {
      await redis.set(`archive:teacher:${tid}:${currentWeek}`, teacherEntries);
    }
  }

  // Öğrenci arşivlerini kaydet
  for (const [sid, entries] of Object.entries(studentArchiveMap)) {
    await redis.set(`archive:student:${sid}:${currentWeek}`, entries);
  }

  for (const tid of ids) {
    const teacher = await redis.get(`teacher:${tid}`);
    if (!teacher) continue;
    // initWeekForTeacher program'daki sabit rezervasyonları da uygular
    await initWeekForTeacher(tid, nextWeek);
  }

  await redis.set('current_week', nextWeek);

  return NextResponse.json({ ok: true, previousWeek: currentWeek, newWeek: nextWeek });
}
