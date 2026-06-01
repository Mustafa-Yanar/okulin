import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ALL_DAYS, slotsForDay } from '@/lib/constants';
import { getWeekKey, slotKey, getSlotTimes } from '@/lib/slots';

// GET ?date=YYYY-MM-DD
// Döndürür: { [cls]: { lessons: [ { lessonNo, teacherId, teacherName, attendanceTaken, absent, late } ] } }

export async function GET(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date gerekli' }, { status: 400 });

  // Tarihin gün indexini bul (0=Pzt ... 6=Paz)
  const d = new Date(date);
  const jsDay = d.getDay();
  const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
  // Tarihin haftasını bul
  const weekKey = getWeekKey(new Date(date));

  const teacherIds = await redis.smembers('teachers');
  if (!teacherIds || teacherIds.length === 0) return NextResponse.json({});

  const teacherPipeline = redis.pipeline();
  teacherIds.forEach(id => teacherPipeline.get(`teacher:${id}`));
  const teachers = await teacherPipeline.exec();

  // Tüm öğrencileri çek
  const studentIds = await redis.smembers('students');
  const studentMap = {};
  if (studentIds && studentIds.length > 0) {
    const studentPipeline = redis.pipeline();
    studentIds.forEach(id => studentPipeline.get(`student:${id}`));
    const studentResults = await studentPipeline.exec();
    studentResults.forEach(s => { if (s) studentMap[s.id] = s; });
  }

  // O günün grid slotlarını çek (her öğretmen için)
  const slotTimes = await getSlotTimes();
  const gridPipeline = redis.pipeline();
  const meta = [];
  const slots = slotsForDay(dayIndex, dayIndex >= 5 ? slotTimes.weekend : slotTimes.weekday);
  for (let i = 0; i < teacherIds.length; i++) {
    for (const slot of slots) {
      meta.push({ teacherIdx: i, slot });
      gridPipeline.get(slotKey(weekKey, teacherIds[i], dayIndex, slot.id));
    }
  }
  const gridResults = await gridPipeline.exec();

  // Her öğretmen için ders slotlarını sırala, lessonNo türet
  const lessonsByTeacher = {}; // teacherIdx → [{ slotId, cls, lessonNo }]
  for (let i = 0; i < teacherIds.length; i++) lessonsByTeacher[i] = [];

  meta.forEach((m, i) => {
    const sd = gridResults[i];
    if (!sd || sd.lessonType !== 'ders' || !sd.cls) return;
    lessonsByTeacher[m.teacherIdx].push({ slotId: m.slot.id, cls: sd.cls });
  });

  // cls → lessons
  const clsMap = {};

  for (let i = 0; i < teacherIds.length; i++) {
    const teacher = teachers[i];
    if (!teacher) continue;
    const teacherLessons = lessonsByTeacher[i];
    if (teacherLessons.length === 0) continue;

    for (let ln = 0; ln < teacherLessons.length; ln++) {
      const lessonNo = ln + 1;
      const { cls } = teacherLessons[ln];

      const attKey = `attendance:${date}:${teacher.id}:${cls}:${lessonNo}`;
      const att = await redis.get(attKey);

      const absent = [];
      const late = [];
      if (att) {
        for (const [studentId, status] of Object.entries(att)) {
          const s = studentMap[studentId];
          const info = {
            id: studentId,
            name: s?.name || studentId,
            phone: s?.phone || '',
            parentPhone: s?.parentPhone || '',
          };
          if (status === 'yok') absent.push(info);
          else if (status === 'gec') late.push(info);
        }
      }

      if (!clsMap[cls]) clsMap[cls] = { cls, lessons: [] };
      clsMap[cls].lessons.push({
        lessonNo,
        teacherId: teacher.id,
        teacherName: teacher.name,
        attendanceTaken: !!att,
        absent,
        late,
      });
    }
  }

  for (const cls of Object.keys(clsMap)) {
    clsMap[cls].lessons.sort((a, b) => a.lessonNo - b.lessonNo);
  }

  return NextResponse.json(clsMap);
}
