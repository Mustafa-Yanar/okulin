import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { getWeekKey, getTeacherWeekSlots, slotKey, getAllTeachers } from '@/lib/slots';
import { ALL_DAYS, slotsForDay, MEZUN_FORBIDDEN_ETUT_SLOT } from '@/lib/constants';

// GET /api/slots?week=2024-W20&teacherId=xxx
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();
  const teacherId = searchParams.get('teacherId');

  if (teacherId) {
    const grid = await getTeacherWeekSlots(teacherId, weekKey);
    return NextResponse.json({ weekKey, grid });
  }

  const teachers = await getAllTeachers();
  const allSlots = [];

  for (const teacher of teachers) {
    const grid = await getTeacherWeekSlots(teacher.id, weekKey);
    for (const day of ALL_DAYS) {
      const slots = slotsForDay(day.index);
      for (let s = 0; s < slots.length; s++) {
        const slotData = grid[day.index][s] || { booked: false, disabled: true };
        allSlots.push({
          teacherId: teacher.id,
          teacherName: teacher.name,
          branch: teacher.branch,
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

  return NextResponse.json({ weekKey, slots: allSlots });
}

// POST /api/slots - book a slot
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { teacherId, day, slotId, studentId, weekKey: wk, forceOpen } = await req.json();
  const weekKey = wk || getWeekKey();

  const teacher = await redis.get(`teacher:${teacherId}`);
  if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

  // Slot kapalı mı kontrol et
  const key = slotKey(weekKey, teacherId, day, slotId);
  const existing = await redis.get(key);
  if (existing && existing.disabled) {
    // Müdür forceOpen ile kapalı slotu bu hafta için açıp rezerve edebilir
    if (!forceOpen || session.role !== 'director') {
      return NextResponse.json({ error: 'Bu saat dilimi kapalıdır' }, { status: 400 });
    }
  }
  if (existing && existing.booked) {
    return NextResponse.json({ error: 'Bu saat dilimi zaten dolu' }, { status: 400 });
  }

  let targetStudentId = studentId;
  let targetStudent;

  if (session.role === 'student') {
    targetStudentId = session.id;
    targetStudent = await redis.get(`student:${session.id}`);
  } else if (session.role === 'teacher') {
    if (teacherId !== session.id) {
      return NextResponse.json({ error: 'Sadece kendi slotlarınıza rezervasyon yapabilirsiniz' }, { status: 403 });
    }
    targetStudent = await redis.get(`student:${studentId}`);
  } else if (session.role === 'director') {
    targetStudent = await redis.get(`student:${studentId}`);
  }

  if (!targetStudent) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  // Grup erişim kontrolü
  const allowedGroups = teacher.allowedGroups || [];
  if (allowedGroups.length > 0 && !allowedGroups.includes(targetStudent.group)) {
    return NextResponse.json({ error: 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz' }, { status: 400 });
  }

  // Mezun öğrenciler hafta içi 16:30–17:05 etüdüne kayıt olamaz
  if (targetStudent.group === 'mezun' && slotId === MEZUN_FORBIDDEN_ETUT_SLOT && day < 5) {
    return NextResponse.json({ error: 'Mezun öğrenciler hafta içi 16:30–17:05 saatindeki etüde kayıt olamaz' }, { status: 400 });
  }

  // Tüm öğretmenlerin bu haftaki slotlarını çek (çakışma kontrolleri için)
  const allTeachers = await getAllTeachers();
  const allWeekKeys = [];
  for (const t of allTeachers) {
    for (const day2 of ALL_DAYS) {
      for (const slot of slotsForDay(day2.index)) {
        allWeekKeys.push({ key: slotKey(weekKey, t.id, day2.index, slot.id), branch: t.branch, day: day2.index, slotId: slot.id });
      }
    }
  }
  const pipeline = redis.pipeline();
  allWeekKeys.forEach(({ key: k }) => pipeline.get(k));
  const existingSlots = await pipeline.exec();

  const studentSlots = allWeekKeys
    .map((meta, i) => ({ ...meta, data: existingSlots[i] }))
    .filter(({ data }) => data && data.booked && data.studentId === targetStudentId);

  // Kural 1: Aynı gün aynı saat diliminde başka etüt var mı? (kimse bypass edemez)
  const timeConflict = studentSlots.some(s => s.day === day && s.slotId === slotId);
  if (timeConflict) {
    return NextResponse.json({ error: 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı' }, { status: 400 });
  }

  // Kural 2: Aynı branştan birden fazla etüt — müdür bypass edebilir
  if (session.role !== 'director') {
    const branchConflict = studentSlots.some(s => s.branch === teacher.branch);
    if (branchConflict) {
      return NextResponse.json({ error: `Bu öğrenci bu hafta ${teacher.branch} dersinden zaten etüt almış` }, { status: 400 });
    }
  }

  const bookedData = {
    booked: true,
    disabled: false,
    studentId: targetStudentId,
    studentName: targetStudent.name,
    studentCls: targetStudent.cls,
    bookedBy: session.role,
    bookedAt: new Date().toISOString(),
  };

  await redis.set(key, bookedData, { ex: 60 * 60 * 24 * 16 });

  return NextResponse.json({ ok: true, slot: bookedData });
}

// DELETE /api/slots - cancel a booking
export async function DELETE(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { teacherId, day, slotId, weekKey: wk } = await req.json();
  const weekKey = wk || getWeekKey();
  const key = slotKey(weekKey, teacherId, day, slotId);

  const existing = await redis.get(key);
  if (!existing || !existing.booked) {
    return NextResponse.json({ error: 'Rezervasyon bulunamadı' }, { status: 404 });
  }

  if (session.role === 'student' && existing.studentId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (session.role === 'teacher' && teacherId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Program'a bakarak disabled durumunu restore et
  const program = await redis.get(`program:${teacherId}`);
  const slotEntry = program?.[String(day)]?.[slotId];
  const disabled = !slotEntry || slotEntry.type !== 'etut';

  await redis.set(key, { booked: false, disabled }, { ex: 60 * 60 * 24 * 16 });

  return NextResponse.json({ ok: true });
}
