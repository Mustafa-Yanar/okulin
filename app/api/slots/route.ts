import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { getWeekKey, getTeacherWeekSlots, getAllTeachers, getDaySlotTimes, getWeekEvents, findBlockingEvent, dateStrForWeekDay, type SlotCell } from '@/lib/slots';
import { ALL_DAYS, daySlots } from '@/lib/constants';

// SALT-OKUNUR uç (2026-07-22 denetim B3): POST/DELETE (grid slot rezervasyonu) KALDIRILDI —
// etüt rezervasyonunun tek yazım kapısı /api/etut-sablon/rezervasyon (+ mobil eşleniği) →
// lib/etut/booking.ts bookEtut/cancelEtutV2. SlotBooking'in booked yüzeyi cutover sonrası
// fiilen ölüydü (canlıda booked=0, yazılan kayıt yeni etüt görünümlerinde çıkmıyordu).
// Export edilmeyen metodlara Next.js otomatik 405 döner (e2e nöbetçisi: int-slots-rules).
// Kanıt/harita: docs/superpowers/specs/2026-07-22-buyuk-temizlik-faz1-harita.md (B3).

// GET /api/slots?week=2024-W20&teacherId=xxx
// Bilinçli inline rol dallanması: veli yalnız kendi çocuğunun rezervasyonlarını görür.
export const GET = withAuth(async (req, _ctx, session) => {

  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();
  const teacherId = searchParams.get('teacherId'); // legacyId
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

  if (teacherId) {
    const grid = await getTeacherWeekSlots(teacherId, weekKey);
    for (const day of ALL_DAYS) grid[day.index] = applyEventBlock(day.index, grid[day.index]);
    return NextResponse.json({ weekKey, grid });
  }

  const teachers = await getAllTeachers(); // id=legacyId
  const allSlots: ({ teacherId: string; teacherName: string; branches: string[]; allowedGroups: string[]; day: number; dayLabel: string; weekend: boolean; slotId: string; slotLabel: string } & SlotCell)[] = [];

  for (const teacher of teachers) {
    const grid = await getTeacherWeekSlots(teacher.id, weekKey);
    for (const day of ALL_DAYS) {
      const slots = daySlots(day.index, slotTimes.days[day.index]);
      const cells = applyEventBlock(day.index, grid[day.index]);
      for (let s = 0; s < slots.length; s++) {
        const slotData = cells[s] || { booked: false, disabled: true };
        allSlots.push({
          teacherId: teacher.id,
          teacherName: teacher.name,
          branches: teacher.branches || [],
          allowedGroups: teacher.allowedGroups || [],
          day: day.index,
          dayLabel: day.label,
          weekend: day.weekend,
          slotId: slots[s].id,
          slotLabel: slots[s].label,
          ...slotData,
        });
      }
    }
  }

  // Veli: yalnız kendi çocuğunun rezervasyonlarını görür (diğer öğrencilerin adı sızmaz).
  if (session.role === 'parent') {
    const childId = searchParams.get('studentId');
    if (!canReadStudent(session, childId)) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const mine = allSlots.filter(s => s.booked && s.studentId === childId);
    return NextResponse.json({ weekKey, slots: mine });
  }

  return NextResponse.json({ weekKey, slots: allSlots });
});

