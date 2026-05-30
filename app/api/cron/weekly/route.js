import { NextResponse } from 'next/server';
import redis from '@/lib/db';
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

  // 1. Tüm öğretmen nesnelerini tek bir pipeline ile paralel olarak çek
  const teachersPipeline = redis.pipeline();
  ids.forEach(tid => teachersPipeline.get(`teacher:${tid}`));
  const teachersResults = await teachersPipeline.exec();
  const teachersMap = {};
  ids.forEach((tid, idx) => {
    if (teachersResults[idx]) {
      teachersMap[tid] = teachersResults[idx];
    }
  });

  // 2. Tüm öğretmenlerin tüm günlük slot anahtarlarını topla ve tek pipeline ile çek
  const studentArchiveMap = {}; // studentId -> entries[]
  const slotTimes = await getSlotTimes();
  const slotKeysMeta = []; // list of { key, teacherId, dayIndex, slot }
  const slotPipeline = redis.pipeline();

  for (const tid of ids) {
    if (!teachersMap[tid]) continue;
    for (const day of ALL_DAYS) {
      const slots = slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday);
      for (const slot of slots) {
        const k = slotKey(currentWeek, tid, day.index, slot.id);
        slotKeysMeta.push({ k, teacherId: tid, dayIndex: day.index, slot });
        slotPipeline.get(k);
      }
    }
  }

  const slotResults = await slotPipeline.exec();

  // 3. Arşiv haritasını doldur
  const teacherArchiveMap = {}; // teacherId -> entries[]

  slotKeysMeta.forEach((meta, idx) => {
    const sd = slotResults[idx];
    if (sd && sd.booked) {
      const teacher = teachersMap[meta.teacherId];
      const entry = {
        day: meta.dayIndex,
        dayLabel: ALL_DAYS.find(d => d.index === meta.dayIndex)?.label || '',
        slotId: meta.slot.id,
        slotLabel: meta.slot.label,
        studentId: sd.studentId,
        studentName: sd.studentName,
        studentCls: sd.studentCls,
        bookedBy: sd.bookedBy,
        fixed: !!sd.fixed,
        teacherId: meta.teacherId,
        teacherName: teacher.name,
        branch: sd.branch || '',
      };

      if (!teacherArchiveMap[meta.teacherId]) teacherArchiveMap[meta.teacherId] = [];
      teacherArchiveMap[meta.teacherId].push(entry);

      if (sd.studentId) {
        if (!studentArchiveMap[sd.studentId]) studentArchiveMap[sd.studentId] = [];
        studentArchiveMap[sd.studentId].push(entry);
      }
    }
  });

  // 4. Arşivleri Redis'e pipelined olarak yaz
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

  if (hasWriteOps) {
    await writePipeline.exec();
  }

  // 5. Tüm öğretmenlerin yeni haftasını paralel (Promise.all) olarak init et
  const activeTeacherIds = ids.filter(tid => !!teachersMap[tid]);
  if (activeTeacherIds.length > 0) {
    await Promise.all(activeTeacherIds.map(tid => initWeekForTeacher(tid, nextWeek)));
  }

  await redis.set('current_week', nextWeek);

  return NextResponse.json({ ok: true, previousWeek: currentWeek, newWeek: nextWeek });
}
