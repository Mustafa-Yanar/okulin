import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import {
  getWeekKey, getMondayOfWeek, initWeekForTeacher,
  getAllTeachers, getCurrentWeek, setCurrentWeek, getTeacherWeekSlots, getDaySlotTimes,
} from '@/lib/slots';
import { ALL_DAYS, daySlots } from '@/lib/constants';

// Pazar 11:00 UTC+3 = 08:00 UTC → "0 8 * * 0"
// Bilinçli withAuth istisnası: cron ucu — oturum yok, CRON_SECRET Bearer doğrulanır.
// Öğretmen listesi / current_week / slot okuma / hafta init SQL'den.
// NOT: haftalık arşiv (archive:teacher|student) hâlâ Redis — arşiv alt-sistemi SQL'e
// taşınmadı (okuyan /api/archive de Redis). Tutarlı; ayrı bir göç işi.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  // Mevcut haftaya sıfırla (düzeltme modu)
  if (searchParams.get('action') === 'reset') {
    const current = getWeekKey();
    await setCurrentWeek(current);
    return NextResponse.json({ ok: true, weekKey: current });
  }

  const teachers = await getAllTeachers(); // SQL-aware (legacyId + name)
  if (!teachers || teachers.length === 0) return NextResponse.json({ ok: true, message: 'No teachers' });

  const stored = await getCurrentWeek();
  const currentWeek = stored || getWeekKey();

  const monday = getMondayOfWeek(currentWeek);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const nextWeek = getWeekKey(nextMonday);

  // 1. Her öğretmenin bu haftaki booked slotlarını SQL grid'inden topla (arşiv için)
  const teacherArchiveMap: Record<string, object[]> = {}; // teacherId -> entries[]
  const studentArchiveMap: Record<string, object[]> = {}; // studentId -> entries[]
  const slotTimes = await getDaySlotTimes(); // 7-gün model

  for (const t of teachers) {
    const grid = await getTeacherWeekSlots(t.id, currentWeek); // SQL-aware
    for (const day of ALL_DAYS) {
      const slots = daySlots(day.index, slotTimes.days[day.index]);
      (grid[day.index] || []).forEach((sd, slotIdx) => {
        if (!sd || !sd.booked) return;
        const slot = slots[slotIdx];
        const entry = {
          day: day.index,
          dayLabel: day.label,
          slotId: slot?.id,
          slotLabel: slot?.label,
          studentId: sd.studentId,
          studentName: sd.studentName,
          studentCls: sd.studentCls,
          bookedBy: sd.bookedBy,
          fixed: !!sd.fixed,
          teacherId: t.id,
          teacherName: t.name,
          branch: sd.branch || '',
        };
        (teacherArchiveMap[t.id] ||= []).push(entry);
        if (sd.studentId) (studentArchiveMap[sd.studentId] ||= []).push(entry);
      });
    }
  }

  // 2. Arşivleri Redis'e yaz (arşiv alt-sistemi Redis — yukarıdaki NOT)
  const writePipeline = redis.pipeline();
  let hasWriteOps = false;
  for (const [tid, entries] of Object.entries(teacherArchiveMap)) {
    writePipeline.set(`archive:teacher:${tid}:${currentWeek}`, entries);
    hasWriteOps = true;
  }
  for (const [sid, entries] of Object.entries(studentArchiveMap)) {
    writePipeline.set(`archive:student:${sid}:${currentWeek}`, entries);
    hasWriteOps = true;
  }
  if (hasWriteOps) await writePipeline.exec();

  // 3. Tüm öğretmenlerin yeni haftasını init et (SQL-aware)
  await Promise.all(teachers.map(t => initWeekForTeacher(t.id, nextWeek)));

  await setCurrentWeek(nextWeek); // SQL-aware

  return NextResponse.json({ ok: true, previousWeek: currentWeek, newWeek: nextWeek });
}
