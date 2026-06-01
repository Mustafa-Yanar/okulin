import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getWeekKey, getMondayOfWeek, initWeekForTeacher } from '@/lib/slots';
import { parseBody, z } from '@/lib/validate';

const WeekActionSchema = z.object({
  action: z.enum(['advance', 'reset', 'reinit', 'reset-all']),
  weekKey: z.string().max(40).optional(),
});

async function advanceWeek(currentWeek) {
  const ids = await redis.smembers('teachers');
  if (!ids || ids.length === 0) return getWeekKey();

  const monday = getMondayOfWeek(currentWeek);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const nextWeek = getWeekKey(nextMonday);

  for (const tid of ids) {
    const teacher = await redis.get(`teacher:${tid}`);
    if (!teacher) continue;
    await initWeekForTeacher(tid, nextWeek);
  }

  await redis.set('current_week', nextWeek);
  return nextWeek;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const stored = await redis.get('current_week');
  const weekKey = stored || getWeekKey();
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
    await redis.set('current_week', current);
    return NextResponse.json({ ok: true, weekKey: current });
  }

  // Tüm slot/template/fixed key'lerini sil, bu haftayı program'dan yeniden init et
  if (action === 'reinit') {
    const ids = await redis.smembers('teachers');
    const deleted = { slot: 0, template: 0, fixed: 0 };

    // Eski key'leri temizle
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

    // Bu haftayı program'dan yeniden oluştur
    const weekKey = getWeekKey();
    for (const tid of (ids || [])) {
      await initWeekForTeacher(tid, weekKey);
    }

    return NextResponse.json({ ok: true, weekKey, deleted, teachers: ids?.length || 0 });
  }

  // Tüm öğretmenlerin izin günlerini, ders programlarını ve slot kayıtlarını sil
  if (action === 'reset-all') {
    const ids = await redis.smembers('teachers');
    const deleted = { offDays: 0, programs: 0, slots: 0 };

    // 1. İzin günlerini temizle
    for (const tid of (ids || [])) {
      const teacher = await redis.get(`teacher:${tid}`);
      if (!teacher) continue;
      if ((teacher.offDays || []).length > 0) {
        await redis.set(`teacher:${tid}`, { ...teacher, offDays: [] });
        deleted.offDays++;
      }
    }

    // 2. Ders programı şablonlarını sil (program:*)
    {
      let cursor = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: 'program:*', count: 100 });
        cursor = parseInt(nextCursor);
        if (keys.length > 0) { await redis.del(...keys); deleted.programs += keys.length; }
      } while (cursor !== 0);
    }

    // 3. Tüm slot kayıtlarını sil (slot:*)
    {
      let cursor = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: 'slot:*', count: 100 });
        cursor = parseInt(nextCursor);
        if (keys.length > 0) { await redis.del(...keys); deleted.slots += keys.length; }
      } while (cursor !== 0);
    }

    return NextResponse.json({ ok: true, deleted, teachers: ids?.length || 0 });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}
