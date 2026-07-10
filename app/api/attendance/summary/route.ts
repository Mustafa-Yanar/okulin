import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getWeekKey, getAllTeachers, getTeacherWeekSlots } from '@/lib/slots';
import { tdb } from '@/lib/sqldb';

// GET ?date=YYYY-MM-DD
// Döndürür: { [cls]: { lessons: [ { lessonNo, teacherId, teacherName, attendanceTaken, absent, late } ] } }

interface StudentInfo {
  id: string;
  name: string;
  phone: string;
  parentPhone: string;
}

interface LessonSummary {
  lessonNo: number;
  teacherId: string;
  teacherName: string;
  attendanceTaken: boolean;
  absent: StudentInfo[];
  late: StudentInfo[];
}

export const GET = withAuth(['director', 'counselor'], async (req) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date gerekli' }, { status: 400 });

  // O günün slot-grid'inden ders slotlarını türet (lessonNo sıra ile), attendance
  // kayıtlarıyla birleştir. Böylece "yoklama alınmamış" dersler de (attendanceTaken:false)
  // özette görünür. Etüt slotları (ders değil) doğal olarak dışlanır.
  const d = new Date(date);
  const jsDay = d.getDay();
  const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
  const weekKey = getWeekKey(new Date(date));

  const teachers = await getAllTeachers(); // legacyId + name
  const students = await tdb().student.findMany();
  const studentMap: Record<string, (typeof students)[number]> = {};
  for (const s of students) studentMap[s.legacyId] = s;

  // attendance kayıtları → map (teacherLegacyId|cls|lessonNo → records)
  const attRecords = await tdb().attendance.findMany({ where: { date }, include: { teacher: true } });
  const attMap: Record<string, Record<string, string>> = {};
  for (const r of attRecords) attMap[`${r.teacher.legacyId}|${r.cls}|${r.lessonNo}`] = (r.records as Record<string, string> | null) || {}; // records: Json

  const clsMap: Record<string, { cls: string; lessons: LessonSummary[] }> = {};
  for (const t of teachers) {
    const grid = await getTeacherWeekSlots(t.id, weekKey); // {[day]:[cell]}
    let lessonNo = 0;
    for (const sd of (grid[dayIndex] || [])) {
      if (!sd || sd.lessonType !== 'ders' || !sd.cls) continue;
      lessonNo++;
      const cls = sd.cls;
      const recObj = attMap[`${t.id}|${cls}|${lessonNo}`] || {};
      const absent: StudentInfo[] = [], late: StudentInfo[] = [];
      for (const [sid, status] of Object.entries(recObj)) {
        const s = studentMap[sid];
        const info = { id: sid, name: s?.name || sid, phone: s?.phone || '', parentPhone: s?.parentPhone || '' };
        if (status === 'yok') absent.push(info);
        else if (status === 'gec') late.push(info);
      }
      if (!clsMap[cls]) clsMap[cls] = { cls, lessons: [] };
      clsMap[cls].lessons.push({
        lessonNo,
        teacherId: t.id,
        teacherName: t.name,
        attendanceTaken: Object.keys(recObj).length > 0,
        absent,
        late,
      });
    }
  }

  for (const cls of Object.keys(clsMap)) {
    clsMap[cls].lessons.sort((a, b) => a.lessonNo - b.lessonNo);
  }
  return NextResponse.json(clsMap);
});
