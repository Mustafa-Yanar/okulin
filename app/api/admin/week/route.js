import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  getWeekKey, getMondayOfWeek, initWeekForTeacher,
  getAllTeachers, getCurrentWeek, setCurrentWeek,
} from '@/lib/slots';
import { parseBody, z } from '@/lib/validate';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

const WeekActionSchema = z.object({
  action: z.enum(['advance', 'reset', 'reinit', 'reset-all']),
  weekKey: z.string().max(40).optional(),
});

async function advanceWeek(currentWeek) {
  const teachers = await getAllTeachers(); // SQL-aware
  if (!teachers || teachers.length === 0) return getWeekKey();

  const monday = getMondayOfWeek(currentWeek);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const nextWeek = getWeekKey(nextMonday);

  for (const t of teachers) await initWeekForTeacher(t.id, nextWeek);
  await setCurrentWeek(nextWeek);
  return nextWeek;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const weekKey = (await getCurrentWeek()) || getWeekKey();
  return NextResponse.json({ weekKey });
}

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, WeekActionSchema);
  if (!parsed.ok) return parsed.response;
  const { action, weekKey } = parsed.data;

  if (action === 'advance') {
    const current = weekKey || getWeekKey();
    const next = await advanceWeek(current);
    return NextResponse.json({ ok: true, nextWeek: next });
  }

  if (action === 'reset') {
    const current = getWeekKey();
    await setCurrentWeek(current);
    return NextResponse.json({ ok: true, weekKey: current });
  }

  // Tüm slotları sil, bu haftayı program şablonundan yeniden init et
  if (action === 'reinit') {
    const week = getWeekKey();
    if (isSqlEnabled()) {
      const teachers = await getAllTeachers();
      const del = await tdb().slotBooking.deleteMany({}); // tenant-scoped
      for (const t of teachers) await initWeekForTeacher(t.id, week);
      return NextResponse.json({ ok: true, weekKey: week, deleted: { slot: del.count }, teachers: teachers.length });
    }
    // Redis yolu
    const ids = await redis.smembers('teachers');
    const deleted = { slot: 0, template: 0, fixed: 0 };
    for (const prefix of ['slot:*', 'template:*', 'fixed:*']) {
      let cursor = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: prefix, count: 100 });
        cursor = parseInt(nextCursor);
        if (keys.length > 0) {
          await redis.del(...keys);
          if (prefix.startsWith('slot')) deleted.slot += keys.length;
          else if (prefix.startsWith('template')) deleted.template += keys.length;
          else deleted.fixed += keys.length;
        }
      } while (cursor !== 0);
    }
    for (const tid of (ids || [])) await initWeekForTeacher(tid, week);
    return NextResponse.json({ ok: true, weekKey: week, deleted, teachers: ids?.length || 0 });
  }

  // Tüm öğretmenlerin izin günlerini, ders programlarını ve slot kayıtlarını sil
  if (action === 'reset-all') {
    if (isSqlEnabled()) {
      const teachers = await tdb().teacher.findMany();
      let offDays = 0, programs = 0;
      for (const t of teachers) {
        const hasOff = (t.offDays || []).length > 0;
        const hasProg = t.programTemplate && Object.keys(t.programTemplate).length > 0;
        if (hasOff || hasProg) {
          await tdb().teacher.update({ where: { id: t.id }, data: { offDays: [], programTemplate: {} } });
          if (hasOff) offDays++;
          if (hasProg) programs++;
        }
      }
      const del = await tdb().slotBooking.deleteMany({});
      return NextResponse.json({ ok: true, deleted: { offDays, programs, slots: del.count }, teachers: teachers.length });
    }
    // Redis yolu
    const ids = await redis.smembers('teachers');
    const deleted = { offDays: 0, programs: 0, slots: 0 };
    for (const tid of (ids || [])) {
      const teacher = await redis.get(`teacher:${tid}`);
      if (!teacher) continue;
      if ((teacher.offDays || []).length > 0) {
        await redis.set(`teacher:${tid}`, { ...teacher, offDays: [] });
        deleted.offDays++;
      }
    }
    for (const prefix of ['program:*', 'slot:*']) {
      let cursor = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: prefix, count: 100 });
        cursor = parseInt(nextCursor);
        if (keys.length > 0) {
          await redis.del(...keys);
          if (prefix.startsWith('program')) deleted.programs += keys.length;
          else deleted.slots += keys.length;
        }
      } while (cursor !== 0);
    }
    return NextResponse.json({ ok: true, deleted, teachers: ids?.length || 0 });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}
