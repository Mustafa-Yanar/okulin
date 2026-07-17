import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { getAllTeachers, getProgramTemplate, etutAktifThisWeek, type EtutSablonu } from '@/lib/slots';
import { ALL_DAYS, getWeekKey } from '@/lib/constants';

// GET /api/etut-sablon/all?week=YYYY-Www
// Tüm öğretmenlerin o hafta EFEKTİF AKTİF serbest etüt şablonlarını düz liste döndürür.
// Öğrenci/veli panelinin "uygun etüt" + "etütlerim" görünümleri bunu kullanır.
// Ders slot'larından (w1-w12) bağımsız — gerçek saatli etüt blokları.
// Şablon kaynağı getProgramTemplate (SQL-aware): SQL modunda Teacher.programTemplate.

// Bilinçli inline rol dallanması: veli yalnız kendi çocuğunun etütlerini görür.
export const GET = withAuth('auth', 'etut', async (req, _ctx, session) => {

  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();

  const teachers = await getAllTeachers();
  const dayLabel = Object.fromEntries(ALL_DAYS.map(d => [d.index, d.label]));

  const etutler: Record<string, unknown>[] = [];
  for (const teacher of teachers) {
    const prog = await getProgramTemplate(teacher.id); // SQL-aware
    const list: EtutSablonu[] = Array.isArray(prog.etutSablonlari) ? (prog.etutSablonlari as EtutSablonu[]) : [];
    for (const sb of list) {
      if (!etutAktifThisWeek(sb, weekKey)) continue;
      etutler.push({
        teacherId: teacher.id,
        teacherName: teacher.name,
        branches: teacher.branches || [],
        allowedGroups: teacher.allowedGroups || [],
        id: sb.id,
        dayIndex: sb.dayIndex,
        dayLabel: dayLabel[sb.dayIndex] || '',
        start: sb.start,
        end: sb.end,
        studentId: sb.studentId || null,
        studentName: sb.studentName || null,
        studentCls: sb.studentCls || null,
        branch: sb.branch || null,
        bookedBy: sb.bookedBy || null,
        booked: !!sb.studentId,
      });
    }
  }

  // Veli: yalnız okumaya yetkili olduğu çocuğun etütleri (başka öğrencinin adı sızmasın).
  if (session.role === 'parent') {
    const childId = searchParams.get('studentId');
    const allowed = childId && canReadStudent(session, childId);
    const mine = allowed ? etutler.filter(e => e.studentId === childId) : [];
    return NextResponse.json({ weekKey, etutler: mine });
  }

  return NextResponse.json({ weekKey, etutler });
});
