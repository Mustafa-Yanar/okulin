import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import {
  getWeekKey, getMondayOfWeek, initWeekForTeacher,
  getAllTeachers, getCurrentWeek, setCurrentWeek,
} from '@/lib/slots';
import { parseBody, z } from '@/lib/validate';
import { isValidWeekKey } from '@/lib/etut/weeks';
import { tdb } from '@/lib/sqldb';

const WeekActionSchema = z.object({
  action: z.enum(['advance', 'reset', 'reinit', 'reset-all']),
  // Biçim doğrulaması ZORUNLU (denetim B11, Codex bulgusu): eskiden yalnız max(40) vardı.
  // 'abc' gibi bir değer advanceWeek → getMondayOfWeek'ten Invalid Date olarak geçip
  // getWeekKey'den 'NaN-WNaN' üretiyor, HER öğretmene o anahtarla SlotBooking satırı
  // yazıyor ve current_week'i de bozuyordu ('9999-W53' ise 5 haneli '10000-W02').
  // Bozuk anahtar ayrıca retention'ın string kıyasını ('YYYY-Www' kronolojik) geçersiz kılar.
  // Aynı sertleştirme mobil etüt ucunda da var (mobile/v1/etut — İnceleme Codex #11).
  weekKey: z.string().max(40).refine(isValidWeekKey, { message: 'Geçersiz hafta formatı' }).optional(),
});

// Yazmadan ÖNCE üretilen anahtarı da doğrular: girdi biçimi geçerli olsa bile aritmetik
// taşabilir ('9999-W53' + 1 hafta → 5 haneli '10000-W02'), bu da retention'ın dayandığı
// 'YYYY-Www' string sıralamasını bozar ('10000-...' < '2025-...'). Geçersizse null → 400.
async function advanceWeek(currentWeek: string): Promise<string | null> {
  const teachers = await getAllTeachers(); // SQL-aware
  if (!teachers || teachers.length === 0) return getWeekKey();

  const monday = getMondayOfWeek(currentWeek);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const nextWeek = getWeekKey(nextMonday);
  if (!isValidWeekKey(nextWeek)) return null;

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
    if (!next) return NextResponse.json({ error: 'Geçersiz hafta formatı' }, { status: 400 });
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
