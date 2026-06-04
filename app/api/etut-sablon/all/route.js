import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, canReadStudent } from '@/lib/auth';
import { getAllTeachers } from '@/lib/slots';
import { ALL_DAYS, getWeekKey } from '@/lib/constants';

// GET /api/etut-sablon/all?week=YYYY-Www
// Tüm öğretmenlerin o hafta EFEKTİF AKTİF serbest etüt şablonlarını düz liste döndürür.
// Öğrenci/veli panelinin "uygun etüt" + "etütlerim" görünümleri bunu kullanır.
// Ders slot'larından (w1-w12) bağımsız — gerçek saatli etüt blokları.

function programKey(teacherId) {
  return `program:${teacherId}`;
}

// Bir şablon verilen haftada efektif aktif mi? (kalıcı aktif + bu hafta pasif listesinde değil)
function aktifThisWeek(sb, weekKey) {
  if (sb.aktif === false) return false;
  if (Array.isArray(sb.pasifHaftalar) && sb.pasifHaftalar.includes(weekKey)) return false;
  return true;
}

export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();

  const teachers = await getAllTeachers();
  const dayLabel = Object.fromEntries(ALL_DAYS.map(d => [d.index, d.label]));

  const etutler = [];
  for (const teacher of teachers) {
    const prog = (await redis.get(programKey(teacher.id))) || {};
    const list = Array.isArray(prog.etutSablonlari) ? prog.etutSablonlari : [];
    for (const sb of list) {
      if (!aktifThisWeek(sb, weekKey)) continue;
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
}
