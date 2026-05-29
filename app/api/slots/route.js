import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { getWeekKey, getTeacherWeekSlots, slotKey, getAllTeachers, slotStartTime, getSlotTimes } from '@/lib/slots';
import { ALL_DAYS, slotsForDay, MEZUN_FORBIDDEN_ETUT_SLOT, MATH_FAMILY, allowedBranchesForClass } from '@/lib/constants';
import { parseBody, z, zId } from '@/lib/validate';

const zDay = z.coerce.number().int().min(0).max(6);
const zSlotId = z.string().min(1).max(20);
const SlotBookSchema = z.object({
  teacherId: zId, day: zDay, slotId: zSlotId,
  studentId: zId.optional(), weekKey: z.string().max(40).optional(),
  forceOpen: z.boolean().optional(), branch: z.string().max(100).optional(),
});
const SlotDeleteSchema = z.object({
  teacherId: zId, day: zDay, slotId: zSlotId, weekKey: z.string().max(40).optional(),
});

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
  const slotTimes = await getSlotTimes();
  const allSlots = [];

  for (const teacher of teachers) {
    const grid = await getTeacherWeekSlots(teacher.id, weekKey);
    for (const day of ALL_DAYS) {
      const slots = slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday);
      for (let s = 0; s < slots.length; s++) {
        const slotData = grid[day.index][s] || { booked: false, disabled: true };
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

  return NextResponse.json({ weekKey, slots: allSlots });
}

// POST /api/slots - book a slot
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const parsed = await parseBody(req, SlotBookSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, day, slotId, studentId, weekKey: wk, forceOpen, branch } = parsed.data;
  const weekKey = wk || getWeekKey();

  const teacherRaw = await redis.get(`teacher:${teacherId}`);
  if (!teacherRaw) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
  // Eski şema güvenliği: branch+extraBranches → branches
  const teacher = Array.isArray(teacherRaw.branches) ? teacherRaw
    : { ...teacherRaw, branches: [teacherRaw.branch, ...(teacherRaw.extraBranches || [])].filter(Boolean) };

  // Etiketsiz öğretmende rezervasyon yapılamaz
  if (!teacher.allowedGroups || teacher.allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Bu öğretmenin grup etiketi tanımlanmamış, rezervasyon yapılamaz' }, { status: 400 });
  }

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

  // Geçmiş slot kontrolü — kimse geçmişe rezervasyon yapamaz
  const slotTimes = await getSlotTimes();
  {
    const slotDef = slotsForDay(day, day >= 5 ? slotTimes.weekend : slotTimes.weekday).find(s => s.id === slotId);
    if (slotDef) {
      const slotStart = slotStartTime(weekKey, day, slotDef.label);
      if (slotStart.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Geçmiş bir saat dilimine rezervasyon yapılamaz' }, { status: 400 });
      }
    }
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

  // Branş (ders) doğrulaması — öğretmen verebilmeli VE öğrenci sınıfı görebilmeli
  const studentAllowed = allowedBranchesForClass(targetStudent.cls);
  let bookingBranch = branch;
  if (!bookingBranch) {
    // Tek seçenek varsa otomatik belirle (geriye dönük: branş gönderilmezse)
    const candidates = (teacher.branches || []).filter(b => studentAllowed.includes(b));
    if (candidates.length === 1) bookingBranch = candidates[0];
  }
  if (!bookingBranch || !(teacher.branches || []).includes(bookingBranch) || !studentAllowed.includes(bookingBranch)) {
    return NextResponse.json({ error: 'Geçersiz veya seçilmemiş ders. Bu öğretmen-öğrenci için uygun bir ders seçin.' }, { status: 400 });
  }

  // Tüm öğretmenlerin bu haftaki slotlarını çek (çakışma kontrolleri için)
  const allTeachers = await getAllTeachers();
  const allWeekKeys = [];
  for (const t of allTeachers) {
    for (const day2 of ALL_DAYS) {
      for (const slot of slotsForDay(day2.index, day2.index >= 5 ? slotTimes.weekend : slotTimes.weekday)) {
        allWeekKeys.push({ key: slotKey(weekKey, t.id, day2.index, slot.id), day: day2.index, slotId: slot.id });
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

  if (session.role !== 'director') {
    // Kural 2: Aynı dersten (branş) ikinci etüt — müdür bypass edebilir
    const branchConflict = studentSlots.some(s => s.data.branch === bookingBranch);
    if (branchConflict) {
      return NextResponse.json({ error: `Bu öğrenci bu hafta ${bookingBranch} dersinden zaten etüt almış` }, { status: 400 });
    }
    // Kural 3: TYT/AYT/Geometri "matematik ailesi" — yalnız birinden alınabilir
    if (MATH_FAMILY.includes(bookingBranch)) {
      const mathConflict = studentSlots.some(s => MATH_FAMILY.includes(s.data.branch));
      if (mathConflict) {
        return NextResponse.json({ error: 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış' }, { status: 400 });
      }
    }
  }

  const bookedData = {
    booked: true,
    disabled: false,
    studentId: targetStudentId,
    studentName: targetStudent.name,
    studentCls: targetStudent.cls,
    branch: bookingBranch,
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

  const parsed = await parseBody(req, SlotDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, day, slotId, weekKey: wk } = parsed.data;
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
