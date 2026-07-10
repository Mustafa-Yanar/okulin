import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { getWeekKey, getTeacherWeekSlots, getAllTeachers, slotStartTime, getDaySlotTimes, getProgramTemplate, type SlotCell, type ProgramEntry } from '@/lib/slots';
import { ALL_DAYS, daySlots, MEZUN_FORBIDDEN_ETUT_SLOT_NO, slotNoOf, MATH_FAMILY, allowedBranchesForClass } from '@/lib/constants';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';
import type { Prisma } from '@prisma/client';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { getOrgConfig } from '@/lib/config';

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
// Bilinçli inline rol dallanması: veli yalnız kendi çocuğunun rezervasyonlarını görür.
export const GET = withAuth(async (req, _ctx, session) => {

  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();
  const teacherId = searchParams.get('teacherId'); // legacyId

  if (teacherId) {
    const grid = await getTeacherWeekSlots(teacherId, weekKey);
    return NextResponse.json({ weekKey, grid });
  }

  const teachers = await getAllTeachers(); // id=legacyId
  const slotTimes = await getDaySlotTimes();
  const allSlots: ({ teacherId: string; teacherName: string; branches: string[]; allowedGroups: string[]; day: number; dayLabel: string; weekend: boolean; slotId: string; slotLabel: string } & SlotCell)[] = [];

  for (const teacher of teachers) {
    const grid = await getTeacherWeekSlots(teacher.id, weekKey);
    for (const day of ALL_DAYS) {
      const slots = daySlots(day.index, slotTimes.days[day.index]);
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

  // Veli: yalnız kendi çocuğunun rezervasyonlarını görür (diğer öğrencilerin adı sızmaz).
  if (session.role === 'parent') {
    const childId = searchParams.get('studentId');
    if (!canReadStudent(session, childId)) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const mine = allSlots.filter(s => s.booked && s.studentId === childId);
    return NextResponse.json({ weekKey, slots: mine });
  }

  return NextResponse.json({ weekKey, slots: allSlots });
});

// POST /api/slots - book a slot
// Bilinçli inline rol dallanması: kurallar (self-booking limiti, kilit, hedef öğrenci)
// role ve istek içeriğine bağlı — withAuth mode'uyla ifade edilemez.
export const POST = withAuth(async (req, _ctx, session) => {

  const parsed = await parseBody(req, SlotBookSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId: legacyTeacherId, day, slotId, studentId: reqStudentId, weekKey: wk, forceOpen, branch } = parsed.data;
  const weekKey = wk || getWeekKey();

  // Salt-okunur rehber (kurum konfigürasyonu) etüt dağıtımı yapamaz. Öğrenci/öğretmen/
  // müdür akışı etkilenmez — yalnız config.permissions.counselor.readOnly açıkken rehber.
  if (session.role === 'counselor') {
    const perms = await getOrgConfig('permissions');
    if (perms?.counselor?.readOnly) {
      return NextResponse.json({ error: 'Salt-okunur rehber etüt rezervasyonu yapamaz' }, { status: 403 });
    }
  }

  // Öğrenci self-rezervasyon kuralları (kurum konfigürasyonu). Yalnız öğrencinin
  // KENDİ rezervasyonuna uygulanır; müdür/rehber/öğretmen dağıtımı muaf.
  if (session.role === 'student') {
    const etut = await getOrgConfig('etut');
    // 1) Self-rezervasyon kapalı mı
    if (etut?.studentSelfBooking === false) {
      return NextResponse.json({ error: 'Etüt rezervasyonu kurum tarafından kapatılmış. Lütfen öğretmeninize başvurun.' }, { status: 403 });
    }
    // 2) Haftalık max etüt sınırı (0 = sınırsız).
    const maxWeekly = parseInt(String(etut?.maxWeeklyPerStudent)) || 0;
    if (maxWeekly > 0) {
      const used = await tdb().slotBooking.count({ where: { weekKey, booked: true, studentId: session.id } });
      if (used >= maxWeekly) {
        return NextResponse.json({ error: `Bu hafta en fazla ${maxWeekly} etüt alabilirsiniz (${used} dolu).` }, { status: 403 });
      }
    }
  }

  // Öğretmeni SQL'den oku
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

  if (!teacher.allowedGroups || teacher.allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Bu öğretmenin grup etiketi tanımlanmamış, rezervasyon yapılamaz' }, { status: 400 });
  }

  // Mevcut slot durumunu oku
  const existingRow = await tdb().slotBooking.findFirst({
    where: { weekKey, teacherId: teacher.id, dayIndex: day, slotId },
  });
  if (existingRow?.disabled) {
    if (!forceOpen || (session.role !== 'director' && session.role !== 'counselor')) {
      return NextResponse.json({ error: 'Bu saat dilimi kapalıdır' }, { status: 400 });
    }
  }
  if (existingRow?.booked) {
    return NextResponse.json({ error: 'Bu saat dilimi zaten dolu' }, { status: 400 });
  }

  // Geçmiş slot kontrolü
  const slotTimes = await getDaySlotTimes();
  const slotDef = daySlots(day, slotTimes.days[day]).find(s => s.id === slotId);
  if (slotDef) {
    const slotStart = slotStartTime(weekKey, day, slotDef.label);
    if (slotStart.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Geçmiş bir saat dilimine rezervasyon yapılamaz' }, { status: 400 });
    }
  }

  // Hedef öğrenciyi belirle (legacyId bazında)
  let targetLegacyStudentId = reqStudentId;
  let targetStudent: Prisma.StudentGetPayload<{ include: { class: true } }> | null = null;

  if (session.role === 'student') {
    targetLegacyStudentId = session.id;
    targetStudent = await tdb().student.findFirst({ where: { legacyId: session.id }, include: { class: true } });
  } else if (session.role === 'teacher') {
    if (legacyTeacherId !== session.id) {
      return NextResponse.json({ error: 'Sadece kendi slotlarınıza rezervasyon yapabilirsiniz' }, { status: 403 });
    }
    targetStudent = await tdb().student.findFirst({ where: { legacyId: reqStudentId }, include: { class: true } });
  } else if (session.role === 'director' || session.role === 'counselor') {
    targetStudent = await tdb().student.findFirst({ where: { legacyId: reqStudentId }, include: { class: true } });
  }

  if (!targetStudent) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  const studentCls = targetStudent.class?.legacyId || null;
  const studentGroup = targetStudent.group || '';

  // Grup erişim kontrolü
  const allowedGroups = teacher.allowedGroups || [];
  if (allowedGroups.length > 0 && !allowedGroups.includes(studentGroup)) {
    return NextResponse.json({ error: 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz' }, { status: 400 });
  }

  // Mezun öğrenciler hafta içi 9. slot etüdüne kayıt olamaz (slot NUMARASINA göre)
  if (studentGroup === 'mezun' && slotNoOf(slotId) === MEZUN_FORBIDDEN_ETUT_SLOT_NO && day < 5) {
    return NextResponse.json({ error: 'Mezun öğrenciler hafta içi 9. slottaki etüde kayıt olamaz' }, { status: 400 });
  }

  // Branş doğrulaması
  const studentAllowed = allowedBranchesForClass(studentCls);
  let bookingBranch: string | undefined = branch;
  if (!bookingBranch) {
    const candidates = (teacher.branches || []).filter(b => studentAllowed.includes(b));
    if (candidates.length === 1) bookingBranch = candidates[0];
  }
  if (!bookingBranch || !(teacher.branches || []).includes(bookingBranch) || !studentAllowed.includes(bookingBranch)) {
    return NextResponse.json({ error: 'Geçersiz veya seçilmemiş ders. Bu öğretmen-öğrenci için uygun bir ders seçin.' }, { status: 400 });
  }

  // Çakışma kontrolü: bu öğrencinin bu haftadaki booked slotları (SQL'de verimli)
  const studentSlots = await tdb().slotBooking.findMany({
    where: { weekKey, booked: true, studentId: targetLegacyStudentId },
  });

  // Kural 1: Aynı gün aynı saatte başka etüt
  const timeConflict = studentSlots.some(s => s.dayIndex === day && s.slotId === slotId);
  if (timeConflict) {
    return NextResponse.json({ error: 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı' }, { status: 400 });
  }

  if (session.role !== 'director' && session.role !== 'counselor') {
    // Kural 2: Aynı dersten ikinci etüt
    const branchConflict = studentSlots.some(s => (((s.data as SlotCell | null)?.branch) || s.dersBranch) === bookingBranch);
    if (branchConflict) {
      return NextResponse.json({ error: `Bu öğrenci bu hafta ${bookingBranch} dersinden zaten etüt almış` }, { status: 400 });
    }
    // Kural 3: TYT/AYT/Geometri matematik ailesi
    if (MATH_FAMILY.includes(bookingBranch)) {
      const mathConflict = studentSlots.some(s => MATH_FAMILY.includes((((s.data as SlotCell | null)?.branch) || s.dersBranch) as string));
      if (mathConflict) {
        return NextResponse.json({ error: 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış' }, { status: 400 });
      }
    }
  }

  const bookedData = {
    booked: true, disabled: false,
    studentId: targetLegacyStudentId,
    studentName: targetStudent.name,
    studentCls: studentCls,
    branch: bookingBranch,
    bookedBy: session.role,
    bookedAt: new Date().toISOString(),
  };

  // Atomik upsert — race condition önler (UNIQUE kısıt: orgSlug+branch+weekKey+teacherId+dayIndex+slotId)
  await tdb().slotBooking.upsert({
    where: {
      orgSlug_branch_weekKey_teacherId_dayIndex_slotId: {
        orgSlug: currentOrg(), branch: currentBranch(),
        weekKey, teacherId: teacher.id, dayIndex: day, slotId,
      },
    },
    update: {
      booked: true, disabled: false, fixed: false,
      studentId: targetLegacyStudentId, studentName: targetStudent.name,
      studentCls: studentCls, dersBranch: bookingBranch, bookedBy: session.role,
      data: bookedData,
    },
    create: withScope({
      weekKey, teacherId: teacher.id, dayIndex: day, slotId,
      booked: true, disabled: false, fixed: false,
      studentId: targetLegacyStudentId, studentName: targetStudent.name,
      studentCls: studentCls, dersBranch: bookingBranch, bookedBy: session.role,
      data: bookedData,
    }),
  });

  return NextResponse.json({ ok: true, slot: bookedData });
});

// DELETE /api/slots - cancel a booking
// Bilinçli inline rol dallanması: iptal kilidi ve sahiplik kontrolleri role bağlı.
export const DELETE = withAuth(async (req, _ctx, session) => {

  const parsed = await parseBody(req, SlotDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId: legacyTeacherId, day, slotId, weekKey: wk } = parsed.data;
  const weekKey = wk || getWeekKey();

  // Salt-okunur rehber etüt iptal edemez (POST ile simetrik).
  if (session.role === 'counselor') {
    const perms = await getOrgConfig('permissions');
    if (perms?.counselor?.readOnly) {
      return NextResponse.json({ error: 'Salt-okunur rehber etüt iptali yapamaz' }, { status: 403 });
    }
  }

  // Öğrenci iptal kilidi (kurum konfigürasyonu): etüt başlamasına cancelLockHours
  // saatten az kala öğrenci kendi rezervasyonunu iptal edemez. Müdür/rehber/öğretmen MUAF.
  if (session.role === 'student') {
    const etut = await getOrgConfig('etut');
    const lockH = parseInt(String(etut?.cancelLockHours)) || 0;
    if (lockH > 0) {
      const slotTimes = await getDaySlotTimes();
      const slotDef = daySlots(day, slotTimes.days[day]).find(s => s.id === slotId);
      if (slotDef) {
        const slotStart = slotStartTime(weekKey, day, slotDef.label);
        if (slotStart.getTime() - Date.now() < lockH * 3600 * 1000) {
          return NextResponse.json({ error: `Etüt başlamasına ${lockH} saatten az kala iptal edemezsiniz. Öğretmeninize başvurun.` }, { status: 403 });
        }
      }
    }
  }

  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

  const existingRow = await tdb().slotBooking.findFirst({
    where: { weekKey, teacherId: teacher.id, dayIndex: day, slotId },
  });
  if (!existingRow || !existingRow.booked) {
    return NextResponse.json({ error: 'Rezervasyon bulunamadı' }, { status: 404 });
  }

  const cell = ((existingRow.data as SlotCell | null) || {});
  if (session.role === 'student' && cell.studentId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (session.role === 'teacher' && legacyTeacherId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Slot'un program şablonundaki durumunu kontrol et (disabled mı yoksa açık mı)
  const program = await getProgramTemplate(legacyTeacherId) as Record<string, Record<string, ProgramEntry | undefined> | undefined>;
  const slotEntry = program[String(day)]?.[slotId];
  const disabled = !slotEntry || slotEntry.type !== 'etut';

  await tdb().slotBooking.update({
    where: { id: existingRow.id },
    data: {
      booked: false, disabled, fixed: false,
      studentId: null, studentName: null, studentCls: null, dersBranch: null, bookedBy: null,
      data: { booked: false, disabled },
    },
  });
  return NextResponse.json({ ok: true });
});
