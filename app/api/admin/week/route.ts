import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  getWeekKey, getMondayOfWeek, initWeekForTeacher,
  getAllTeachers, getCurrentWeek, setCurrentWeek,
} from '@/lib/slots';
import { parseBody, z } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

const WeekActionSchema = z.object({
  action: z.enum(['advance', 'reset', 'reinit', 'reset-all']),
  weekKey: z.string().max(40).optional(),
});

async function advanceWeek(currentWeek: string): Promise<string> {
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

export const GET = withAuth(async () => {
  const weekKey = (await getCurrentWeek()) || getWeekKey();
  return NextResponse.json({ weekKey });
});

export const POST = withAuth('manage', async (req) => {
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
    const teachers = await getAllTeachers();
    const del = await tdb().slotBooking.deleteMany({}); // tenant-scoped
    for (const t of teachers) await initWeekForTeacher(t.id, week);
    return NextResponse.json({ ok: true, weekKey: week, deleted: { slot: del.count }, teachers: teachers.length });
  }

  // Tüm öğretmenlerin izin günlerini, ders programlarını ve slot kayıtlarını sil
  if (action === 'reset-all') {
    const teachers = await tdb().teacher.findMany();
    let offDays = 0, programs = 0;
    for (const t of teachers) {
      const hasOff = (t.offDays || []).length > 0;
      const hasProg = t.programTemplate && Object.keys(t.programTemplate as object).length > 0;
      if (hasOff || hasProg) {
        await tdb().teacher.update({ where: { id: t.id }, data: { offDays: [], programTemplate: {} } });
        if (hasOff) offDays++;
        if (hasProg) programs++;
      }
    }
    const del = await tdb().slotBooking.deleteMany({});
    // Tam sıfırlama etüt şablon+rezervasyonlarını da siler (soft değil hard — reset-all
    // bilinçli yıkıcı; EtutReservation onDelete:Cascade ile birlikte düşer — bkz.
    // prisma/schema.prisma EtutSablon.deletedAt yorumu + spec §8 "admin/week (reset cascade)",
    // Faz 4 audit-fix FIX-2 D, Explore F3 bulgusu). reinit dalı BİLİNÇLİ olarak etkilenmez —
    // yalnız SlotBooking (ders gridi) sıfırlar, etüt şablonları ayrı bir yaşam döngüsüne sahip.
    const delEtut = await tdb().etutSablon.deleteMany({});
    return NextResponse.json({ ok: true, deleted: { offDays, programs, slots: del.count, etutSablon: delEtut.count }, teachers: teachers.length });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
});
