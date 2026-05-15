import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { ALL_DAYS, slotsForDay } from '@/lib/constants';
import { getWeekKey, slotKey, getSlotTimes } from '@/lib/slots';

// GET /api/attendance/student?studentId=...
// Bir öğrencinin tüm devamsızlık ve geç kalma kayıtlarını döner.
// Döndürür: { entries: [ { date, dayLabel, teacherId, teacherName, branch, cls, lessonNo, slotLabel, subBranch, status } ], summary: { yok, gec } }

const DAY_NAMES_TR = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];

export async function GET(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'teacher')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

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
    const [, date, teacherId, cls, lessonNo] = parts;
    teacherIds.add(teacherId);
    matched.push({ date, teacherId, cls, lessonNo: parseInt(lessonNo), status });
  });

  // Teacher lookup
  const teacherMap = {};
  if (teacherIds.size > 0) {
    const tPipeline = redis.pipeline();
    const ids = Array.from(teacherIds);
    ids.forEach(id => tPipeline.get(`teacher:${id}`));
    const tResults = await tPipeline.exec();
    ids.forEach((id, i) => {
      if (tResults[i]) teacherMap[id] = tResults[i];
    });
  }

  // Her benzersiz (date, teacherId) için o günün grid'inden ders slotlarını çek
  // ve lessonNo → { slotLabel, subBranch } map'i türet
  const slotTimes = await getSlotTimes();
  const uniqueDateTeachers = [];
  const seen = new Set();
  for (const m of matched) {
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
      };
    });
  }

  // Yapıyı zenginleştir
  const entries = matched.map(m => {
    const d = new Date(m.date);
    const teacher = teacherMap[m.teacherId];
    const info = lessonInfoMap[`${m.date}|${m.teacherId}|${m.lessonNo}`] || {};
    return {
      date: m.date,
      dayLabel: DAY_NAMES_TR[d.getDay()],
      teacherId: m.teacherId,
      teacherName: teacher?.name || m.teacherId,
      branch: teacher?.branch || '',
      cls: m.cls,
      lessonNo: m.lessonNo,
      slotLabel: info.slotLabel || '',
      subBranch: info.subBranch || '',
      status: m.status,
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.lessonNo - b.lessonNo);

  const summary = {
    yok: entries.filter(e => e.status === 'yok').length,
    gec: entries.filter(e => e.status === 'gec').length,
  };

  return NextResponse.json({ entries, summary });
}
