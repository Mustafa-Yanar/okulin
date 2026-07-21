import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getWeekKey, getTeacherWeekSlots, getWeekEvents, findBlockingEvent, dateStrForWeekDay, getDaySlotTimes, type SlotCell } from '@/lib/slots';
import { ALL_DAYS, daySlots } from '@/lib/constants';

// SALT-OKUNUR grid ucu (2026-07-22 denetim B3):
// - POST/DELETE (grid slot rezervasyonu) dalga1'de KALDIRILDI — etüt rezervasyonunun tek
//   yazım kapısı /api/etut-sablon/rezervasyon (+ mobil eşleniği) → lib/etut/booking.ts.
//   Export edilmeyen metodlara Next.js otomatik 405 döner (e2e nöbetçisi: int-slots-rules).
// - teacherId'siz org-geneli tarama + veli dalı dalga2'de KALDIRILDI — üretim tüketicisi
//   kalmamıştı (paneller etüt verisini /api/etut-sablon/all'dan okur); tek meşru kullanım
//   öğretmen haftalık grid görüntüleme (TeacherPanel).
// Kanıt/harita: docs/superpowers/specs/2026-07-22-buyuk-temizlik-faz1-harita.md (B3).

// GET /api/slots?teacherId=xxx&week=2024-W20 — öğretmenin haftalık ders/açık-saat gridi.
export const GET = withAuth(async (req) => {

  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();
  const teacherId = searchParams.get('teacherId'); // legacyId
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  const slotTimes = await getDaySlotTimes();
  // Haftanın aktif (kurum geneli) etkinlikleri — tek sorgu, her hücreye tekrar tekrar sorgu atmadan uygulanır.
  const weekEvents = await getWeekEvents(weekKey);

  // Kurum geneli (sınıf hedefsiz) etkinlik (tatil vb.) çakışan, henüz boş/kapalı hücreleri işaretler.
  // Rezervasyonu OLAN hücrelere dokunmaz (mevcut veri korunur, çakışma varsa yönetici görür/çözer).
  function applyEventBlock(dayIndex: number, cells: SlotCell[]): SlotCell[] {
    const dateStr = dateStrForWeekDay(weekKey, dayIndex);
    const events = weekEvents.get(dateStr);
    if (!events) return cells;
    const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
    return cells.map((cell, i) => {
      if (cell.booked || !cell.disabled) return cell;
      const slot = slots[i];
      if (!slot) return cell;
      const blocking = findBlockingEvent(events, null, slot.start, slot.end);
      return blocking ? { ...cell, eventBlocked: true, eventTitle: blocking.title } : cell;
    });
  }

  const grid = await getTeacherWeekSlots(teacherId, weekKey);
  for (const day of ALL_DAYS) grid[day.index] = applyEventBlock(day.index, grid[day.index]);
  return NextResponse.json({ weekKey, grid });
});
