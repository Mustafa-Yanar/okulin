import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ALL_DAYS, slotsForDay } from '@/lib/constants';
import { getWeekKey, slotKey, getSlotTimes, getProgramTemplate } from '@/lib/slots';
import { tdb } from '@/lib/sqldb';
import { useSql } from '@/lib/usesql';

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

  if (useSql()) {
    // Tüm yoklama kayıtlarını öğretmen dahil çek, JS'te filtrele
    const allRecs = await tdb().attendance.findMany({ include: { teacher: true } });
    const slotTimes = await getSlotTimes();

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
        const isWeekend = dayIndex >= 5;
        const daySlots = slotsForDay(dayIndex, isWeekend ? slotTimes.weekend : slotTimes.weekday);

        const slotBookings = await tdb().slotBooking.findMany({
          where: { weekKey, teacherId: teacher.id, dayIndex },
        });
        const cellMap = {};
        for (const sb of slotBookings) cellMap[sb.slotId] = sb.data || {};

        let counter = 0, matchedSlot = null, matchedCell = null;
        for (const slot of daySlots) {
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

  // Tüm attendance key'lerini tara
  let cursor = '0';
  const keys = [];
  do {
    const [next, found] = await redis.scan(cursor, { match: 'attendance:*', count: 200 });
    cursor = String(next);
    keys.push(...found);
  } while (cursor !== '0');

  if (keys.length === 0) {
    return NextResponse.json({ entries: [], summary: { yok: 0, gec: 0 } });
  }

  const pipeline = redis.pipeline();
  keys.forEach(k => pipeline.get(k));
  const results = await pipeline.exec();

  const teacherIds = new Set();
  const matched = [];
  results.forEach((data, i) => {
    if (!data || typeof data !== 'object') return;
    const status = data[studentId];
    if (status !== 'yok' && status !== 'gec') return;
    const parts = keys[i].split(':');
    if (parts.length !== 5) return;
    const [, date, teacherId, cls, lessonNoRaw] = parts;
    teacherIds.add(teacherId);
    // Etüt yoklaması: lessonNo "e<etutId>" formatında (birebir serbest etüt). Ders: sayı.
    if (lessonNoRaw.startsWith('e') && lessonNoRaw.length > 1) {
      matched.push({ date, teacherId, cls, etutId: lessonNoRaw.slice(1), isEtut: true, status });
    } else {
      matched.push({ date, teacherId, cls, lessonNo: parseInt(lessonNoRaw), status });
    }
  });

  // Teacher lookup (+ etüt şablonları, etüt yoklamalarını zenginleştirmek için)
  const teacherMap = {};
  const etutMap = {}; // `${teacherId}|${etutId}` → { branch, start, end, dayIndex }
  if (teacherIds.size > 0) {
    const ids = Array.from(teacherIds);
    const tPipeline = redis.pipeline();
    ids.forEach(id => tPipeline.get(`teacher:${id}`));
    ids.forEach(id => tPipeline.get(`program:${id}`));
    const tResults = await tPipeline.exec();
    ids.forEach((id, i) => {
      if (tResults[i]) teacherMap[id] = tResults[i];
      const prog = tResults[ids.length + i];
      const list = Array.isArray(prog?.etutSablonlari) ? prog.etutSablonlari : [];
      for (const sb of list) {
        etutMap[`${id}|${sb.id}`] = { branch: sb.branch || '', start: sb.start, end: sb.end, dayIndex: sb.dayIndex };
      }
    });
  }

  // Her benzersiz (date, teacherId) için o günün grid'inden ders slotlarını çek
  // ve lessonNo → { slotLabel, subBranch } map'i türet
  const slotTimes = await getSlotTimes();
  const uniqueDateTeachers = [];
  const seen = new Set();
  for (const m of matched) {
    if (m.isEtut) continue; // etüt branch/saat etutMap'ten gelir, grid taraması gerekmez
    const key = `${m.date}|${m.teacherId}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueDateTeachers.push({ date: m.date, teacherId: m.teacherId });
    }
  }

  // Her (date, teacherId) için o günün slot grid'lerini topla
  const lessonInfoMap = {}; // `${date}|${teacherId}|${lessonNo}` → { slotLabel, subBranch }
  const slotPipeline = redis.pipeline();
  const slotMeta = [];
  for (const dt of uniqueDateTeachers) {
    const d = new Date(dt.date);
    const jsDay = d.getDay();
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
    const wk = getWeekKey(new Date(dt.date));
    const daySlots = slotsForDay(dayIndex, dayIndex >= 5 ? slotTimes.weekend : slotTimes.weekday);
    for (const s of daySlots) {
      slotPipeline.get(slotKey(wk, dt.teacherId, dayIndex, s.id));
      slotMeta.push({ date: dt.date, teacherId: dt.teacherId, slot: s });
    }
  }
  if (slotMeta.length > 0) {
    const slotResults = await slotPipeline.exec();
    // Her (date, teacherId) için ders slotlarını sırayla sayıp lessonNo ata
    const counters = {}; // `${date}|${teacherId}` → current lessonNo counter
    slotMeta.forEach((meta, i) => {
      const sd = slotResults[i];
      if (!sd || sd.lessonType !== 'ders') return;
      const counterKey = `${meta.date}|${meta.teacherId}`;
      counters[counterKey] = (counters[counterKey] || 0) + 1;
      const ln = counters[counterKey];
      lessonInfoMap[`${meta.date}|${meta.teacherId}|${ln}`] = {
        slotLabel: meta.slot.label,
        subBranch: sd.subBranch || '',
        branch: sd.branch || '',
      };
    });
  }

  // Yapıyı zenginleştir
  const entries = matched.map(m => {
    const d = new Date(m.date);
    const teacher = teacherMap[m.teacherId];
    if (m.isEtut) {
      const et = etutMap[`${m.teacherId}|${m.etutId}`] || {};
      return {
        date: m.date,
        dayLabel: DAY_NAMES_TR[d.getDay()],
        teacherId: m.teacherId,
        teacherName: teacher?.name || m.teacherId,
        branch: et.branch || '',
        cls: m.cls,
        lessonNo: null,
        slotLabel: et.start && et.end ? `${et.start}–${et.end}` : '',
        subBranch: '',
        isEtut: true,
        status: m.status,
      };
    }
    const info = lessonInfoMap[`${m.date}|${m.teacherId}|${m.lessonNo}`] || {};
    return {
      date: m.date,
      dayLabel: DAY_NAMES_TR[d.getDay()],
      teacherId: m.teacherId,
      teacherName: teacher?.name || m.teacherId,
      branch: info.branch || info.subBranch || '',
      cls: m.cls,
      lessonNo: m.lessonNo,
      slotLabel: info.slotLabel || '',
      subBranch: info.subBranch || '',
      isEtut: false,
      status: m.status,
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || (a.lessonNo || 0) - (b.lessonNo || 0));

  const summary = {
    yok: entries.filter(e => e.status === 'yok').length,
    gec: entries.filter(e => e.status === 'gec').length,
  };

  return NextResponse.json({ entries, summary });
}
