import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { daySlots as buildDaySlots } from '@/lib/constants';
import { getWeekKey, getDaySlotTimes, type SlotCell } from '@/lib/slots';
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { resolveEffective, RECURRING_WEEKKEY } from '@/lib/etut/reservations';
import { pickEtutLabel } from '@/lib/etut/attendance-label';

// GET /api/attendance/student?studentId=...
// Bir öğrencinin tüm devamsızlık ve geç kalma kayıtlarını döner.
// Döndürür: { entries: [ { date, dayLabel, teacherId, teacherName, branch, cls, lessonNo, slotLabel, subBranch, status } ], summary: { yok, gec } }

const DAY_NAMES_TR = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];

interface AttendanceEntry {
  date: string;
  dayLabel: string;
  teacherId: string;
  teacherName: string;
  branch: string;
  cls: string;
  lessonNo: number | null;
  slotLabel: string;
  subBranch: string;
  isEtut: boolean;
  status: string;
}

export const GET = withAuth(['director', 'counselor', 'teacher'], async (req) => {
  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  // Tüm yoklama kayıtlarını öğretmen dahil çek, JS'te filtrele
  const allRecs = await tdb().attendance.findMany({ include: { teacher: true } });
  const slotTimes = await getDaySlotTimes();

  type Matched = { rec: (typeof allRecs)[number]; status: string } & ({ etutId: string; isEtut: true } | { lessonNo: number; isEtut: false });
  const matched: Matched[] = [];
  for (const rec of allRecs) {
    const recObj = (rec.records as Record<string, string> | null) || {}; // records: Json
    const status = recObj[studentId];
    if (status !== 'yok' && status !== 'gec') continue;
    const lessonNoStr = String(rec.lessonNo);
    if (lessonNoStr.startsWith('e') && lessonNoStr.length > 1) {
      matched.push({ rec, etutId: lessonNoStr.slice(1), isEtut: true, status });
    } else {
      matched.push({ rec, lessonNo: parseInt(lessonNoStr), isEtut: false, status });
    }
  }

  // Etüt etiketleri: EtutSablon (deletedAt DAHİL — silinmiş şablonun tarihsel saati geçerli
  // etiket; deletedAt-süzgeci istisnası BİLİNÇLİ) + o haftanın efektif rezervasyonu
  // (weekKey-join: branch hafta-scoped, gap #5). JSON etutSablonlari OKUNMAZ (Faz 4 T1).
  const etutMatches = matched.filter((m): m is Extract<Matched, { isEtut: true }> => m.isEtut);
  const sablonRows = etutMatches.length
    ? await tdb().etutSablon.findMany({ where: { legacyId: { in: [...new Set(etutMatches.map(m => m.etutId))] } } })
    : [];
  const sablonByLegacy = new Map(sablonRows.map(r => [r.legacyId, r]));
  const weekKeys = [...new Set(etutMatches.map(m => getWeekKey(new Date(m.rec.date))))];
  const orgSlug = currentOrg(); const branch = currentBranch();
  const rezRows = etutMatches.length
    ? await tdb(orgSlug, branch).etutReservation.findMany({
        where: { orgSlug, branch, sablonId: { in: sablonRows.map(r => r.id) }, OR: [{ weekKey: { in: weekKeys } }, { weekKey: RECURRING_WEEKKEY }] },
      })
    : [];
  const effByWeek = new Map(weekKeys.map(wk => [wk, resolveEffective(rezRows, wk)]));

  const entries: AttendanceEntry[] = [];

  for (const m of matched) {
    const d = new Date(m.rec.date);
    const teacher = m.rec.teacher;

    if (m.isEtut) {
      const sb = sablonByLegacy.get(m.etutId) ?? null;
      const wk = getWeekKey(new Date(m.rec.date));
      const eff = sb ? effByWeek.get(wk)?.get(sb.id) ?? null : null;
      const label = pickEtutLabel({
        sablon: sb ? { legacyId: sb.legacyId, start: sb.start, end: sb.end } : null,
        reservation: eff ? { dersBranch: eff.dersBranch, startsAt: eff.startsAt, endsAt: eff.endsAt } : null,
      });
      entries.push({
        date: m.rec.date, dayLabel: DAY_NAMES_TR[d.getDay()],
        teacherId: teacher.legacyId, teacherName: teacher.name,
        branch: label.branch, cls: m.rec.cls,
        lessonNo: null, slotLabel: label.slotLabel,
        subBranch: '', isEtut: true, status: m.status,
      });
    } else {
      // Slot bilgisi: SlotBooking'den ders slotlarını sayarak N. ders bul
      const jsDay = d.getDay();
      const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
      const weekKey = getWeekKey(new Date(m.rec.date));
      const dayS = buildDaySlots(dayIndex, slotTimes.days[dayIndex]);

      const slotBookings = await tdb().slotBooking.findMany({
        where: { weekKey, teacherId: teacher.id, dayIndex },
      });
      const cellMap: Record<string, SlotCell> = {};
      for (const sb of slotBookings) cellMap[sb.slotId] = (sb.data as SlotCell | null) || {};

      let counter = 0, matchedSlot: (typeof dayS)[number] | null = null, matchedCell: SlotCell | null = null;
      for (const slot of dayS) {
        const cell = cellMap[slot.id] || {};
        if (cell.lessonType === 'ders') {
          counter++;
          if (counter === m.lessonNo) { matchedSlot = slot; matchedCell = cell; break; }
        }
      }
      entries.push({
        date: m.rec.date, dayLabel: DAY_NAMES_TR[d.getDay()],
        teacherId: teacher.legacyId, teacherName: teacher.name,
        branch: matchedCell?.branch || matchedCell?.subBranch || '',
        cls: m.rec.cls, lessonNo: m.lessonNo,
        slotLabel: matchedSlot?.label || '', subBranch: matchedCell?.subBranch || '',
        isEtut: false, status: m.status,
      });
    }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date) || (a.lessonNo || 0) - (b.lessonNo || 0));
  return NextResponse.json({
    entries,
    summary: { yok: entries.filter(e => e.status === 'yok').length, gec: entries.filter(e => e.status === 'gec').length },
  });
});
