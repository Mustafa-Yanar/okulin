import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { daySlots as buildDaySlots } from '@/lib/constants';
import { getWeekKey, getDaySlotTimes, getProgramTemplate } from '@/lib/slots';
import { tdb } from '@/lib/sqldb';

// GET /api/attendance/student?studentId=...
// Bir öğrencinin tüm devamsızlık ve geç kalma kayıtlarını döner.
// Döndürür: { entries: [ { date, dayLabel, teacherId, teacherName, branch, cls, lessonNo, slotLabel, subBranch, status } ], summary: { yok, gec } }

const DAY_NAMES_TR = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];

export async function GET(req) {
  const session = await getSession();
  if (!session || ((session.role !== 'director' && session.role !== 'counselor') && session.role !== 'teacher')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  {
    // Tüm yoklama kayıtlarını öğretmen dahil çek, JS'te filtrele
    const allRecs = await tdb().attendance.findMany({ include: { teacher: true } });
    const slotTimes = await getDaySlotTimes();

    const matched = [];
    for (const rec of allRecs) {
      const recObj = (rec.records) || {};
      const status = recObj[studentId];
      if (status !== 'yok' && status !== 'gec') continue;
      const lessonNoStr = String(rec.lessonNo);
      if (lessonNoStr.startsWith('e') && lessonNoStr.length > 1) {
        matched.push({ rec, etutId: lessonNoStr.slice(1), isEtut: true, status });
      } else {
        matched.push({ rec, lessonNo: parseInt(lessonNoStr), isEtut: false, status });
      }
    }

    const progCache = {};
    const entries = [];

    for (const m of matched) {
      const d = new Date(m.rec.date);
      const teacher = m.rec.teacher;

      if (m.isEtut) {
        if (!progCache[teacher.legacyId]) {
          progCache[teacher.legacyId] = await getProgramTemplate(teacher.legacyId);
        }
        const list = Array.isArray(progCache[teacher.legacyId]?.etutSablonlari)
          ? progCache[teacher.legacyId].etutSablonlari : [];
        const et = list.find(s => s.id === m.etutId) || {};
        entries.push({
          date: m.rec.date, dayLabel: DAY_NAMES_TR[d.getDay()],
          teacherId: teacher.legacyId, teacherName: teacher.name,
          branch: et.branch || '', cls: m.rec.cls,
          lessonNo: null, slotLabel: et.start && et.end ? `${et.start}–${et.end}` : '',
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
        const cellMap = {};
        for (const sb of slotBookings) cellMap[sb.slotId] = sb.data || {};

        let counter = 0, matchedSlot = null, matchedCell = null;
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
  }
}
