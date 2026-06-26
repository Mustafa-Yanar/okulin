import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';
import { ALL_DAYS, slotsForDay } from '@/lib/constants';

// GET /api/archive?type=teacher&id=xxx  veya  ?type=student&id=xxx
export async function GET(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'teacher' | 'student'
  const id = searchParams.get('id');

  if (!type || !id) return NextResponse.json({ error: 'type ve id gerekli' }, { status: 400 });

  if (isSqlEnabled()) {
    let bookings = [];
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

    const weeksMap = {}; // weekKey -> entries[]
    bookings.forEach(b => {
      const day = ALL_DAYS.find(d => d.index === b.dayIndex);
      const slotList = slotsForDay(b.dayIndex);
      const slot = slotList.find(s => s.id === b.slotId);
      const entry = {
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

    const weeks = Object.entries(weeksMap)
      .map(([weekKey, entries]) => ({ weekKey, entries }))
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey));

    return NextResponse.json({ weeks });
  }

  // Tüm arşiv key'lerini tara (Redis legacy)
  const pattern = `archive:${type}:${id}:*`;
  const keys = await redis.keys(pattern);

  if (!keys || keys.length === 0) return NextResponse.json({ weeks: [] });

  const pipeline = redis.pipeline();
  keys.forEach(k => pipeline.get(k));
  const results = await pipeline.exec();

  const weeks = keys
    .map((k, i) => {
      const weekKey = k.split(':')[3]; // archive:teacher:xxx:2026-W20
      return { weekKey, entries: results[i] || [] };
    })
    .filter(w => w.entries.length > 0)
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey)); // en yeni önce

  return NextResponse.json({ weeks });
}
