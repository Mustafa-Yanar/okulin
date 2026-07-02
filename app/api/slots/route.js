import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, canReadStudent } from '@/lib/auth';
import { getWeekKey, getTeacherWeekSlots, slotKey, getAllTeachers, slotStartTime, getSlotTimes, getProgramTemplate } from '@/lib/slots';
import { ALL_DAYS, slotsForDay, MEZUN_FORBIDDEN_ETUT_SLOT, MATH_FAMILY, allowedBranchesForClass } from '@/lib/constants';
import { parseBody, z, zId } from '@/lib/validate';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';
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
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();
  const teacherId = searchParams.get('teacherId'); // legacyId

  if (teacherId) {
    const grid = await getTeacherWeekSlots(teacherId, weekKey); // SQL-aware
    return NextResponse.json({ weekKey, grid });
  }

  const teachers = await getAllTeachers(); // SQL-aware, id=legacyId
  const slotTimes = await getSlotTimes(); // SQL-aware
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
}

// POST /api/slots - book a slot
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

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
    // 2) Haftalık max etüt sınırı (0 = sınırsız). SQL yolunda sayılır (prod).
    const maxWeekly = parseInt(etut?.maxWeeklyPerStudent) || 0;
    if (maxWeekly > 0 && isSqlEnabled()) {
      const used = await tdb().slotBooking.count({ where: { weekKey, booked: true, studentId: session.id } });
      if (used >= maxWeekly) {
        return NextResponse.json({ error: `Bu hafta en fazla ${maxWeekly} etüt alabilirsiniz (${used} dolu).` }, { status: 403 });
      }
    }
  }

  if (isSqlEnabled()) {
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
    const slotTimes = await getSlotTimes();
    const slotDef = slotsForDay(day, day >= 5 ? slotTimes.weekend : slotTimes.weekday).find(s => s.id === slotId);
    if (slotDef) {
      const slotStart = slotStartTime(weekKey, day, slotDef.label);
      if (slotStart.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Geçmiş bir saat dilimine rezervasyon yapılamaz' }, { status: 400 });
      }
    }

    // Hedef öğrenciyi belirle (legacyId bazında)
    let targetLegacyStudentId = reqStudentId;
    let targetStudent;

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

    // Mezun öğrenciler hafta içi 16:30–17:05 etüdüne kayıt olamaz
    if (studentGroup === 'mezun' && slotId === MEZUN_FORBIDDEN_ETUT_SLOT && day < 5) {
      return NextResponse.json({ error: 'Mezun öğrenciler hafta içi 16:30–17:05 saatindeki etüde kayıt olamaz' }, { status: 400 });
    }

    // Branş doğrulaması
    const studentAllowed = allowedBranchesForClass(studentCls);
    let bookingBranch = branch;
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
      const branchConflict = studentSlots.some(s => (s.data?.branch || s.dersBranch) === bookingBranch);
      if (branchConflict) {
        return NextResponse.json({ error: `Bu öğrenci bu hafta ${bookingBranch} dersinden zaten etüt almış` }, { status: 400 });
      }
      // Kural 3: TYT/AYT/Geometri matematik ailesi
      if (MATH_FAMILY.includes(bookingBranch)) {
        const mathConflict = studentSlots.some(s => MATH_FAMILY.includes(s.data?.branch || s.dersBranch));
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
      create: {
        weekKey, teacherId: teacher.id, dayIndex: day, slotId,
        booked: true, disabled: false, fixed: false,
        studentId: targetLegacyStudentId, studentName: targetStudent.name,
        studentCls: studentCls, dersBranch: bookingBranch, bookedBy: session.role,
        data: bookedData,
      },
    });

    return NextResponse.json({ ok: true, slot: bookedData });
  }

  // Redis yolu
  const teacherRaw = await redis.get(`teacher:${legacyTeacherId}`);
  if (!teacherRaw) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
  // Eski şema güvenliği: branch+extraBranches → branches
  const teacher = Array.isArray(teacherRaw.branches) ? teacherRaw
    : { ...teacherRaw, branches: [teacherRaw.branch, ...(teacherRaw.extraBranches || [])].filter(Boolean) };

  // Etiketsiz öğretmende rezervasyon yapılamaz
  if (!teacher.allowedGroups || teacher.allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Bu öğretmenin grup etiketi tanımlanmamış, rezervasyon yapılamaz' }, { status: 400 });
  }

  // Slot kapalı mı kontrol et
  const key = slotKey(weekKey, legacyTeacherId, day, slotId);
  const existing = await redis.get(key);
  if (existing && existing.disabled) {
    // Müdür forceOpen ile kapalı slotu bu hafta için açıp rezerve edebilir
    if (!forceOpen || (session.role !== 'director' && session.role !== 'counselor')) {
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

  let targetStudentId = reqStudentId;
  let targetStudent;

  if (session.role === 'student') {
    targetStudentId = session.id;
    targetStudent = await redis.get(`student:${session.id}`);
  } else if (session.role === 'teacher') {
    if (legacyTeacherId !== session.id) {
      return NextResponse.json({ error: 'Sadece kendi slotlarınıza rezervasyon yapabilirsiniz' }, { status: 403 });
    }
    targetStudent = await redis.get(`student:${reqStudentId}`);
  } else if ((session.role === 'director' || session.role === 'counselor')) {
    targetStudent = await redis.get(`student:${reqStudentId}`);
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

  if ((session.role !== 'director' && session.role !== 'counselor')) {
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
    const lockH = parseInt(etut?.cancelLockHours) || 0;
    if (lockH > 0) {
      const slotTimes = await getSlotTimes();
      const slotDef = slotsForDay(day, day >= 5 ? slotTimes.weekend : slotTimes.weekday).find(s => s.id === slotId);
      if (slotDef) {
        const slotStart = slotStartTime(weekKey, day, slotDef.label);
        if (slotStart.getTime() - Date.now() < lockH * 3600 * 1000) {
          return NextResponse.json({ error: `Etüt başlamasına ${lockH} saatten az kala iptal edemezsiniz. Öğretmeninize başvurun.` }, { status: 403 });
        }
      }
    }
  }

  if (isSqlEnabled()) {
    const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
    if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

    const existingRow = await tdb().slotBooking.findFirst({
      where: { weekKey, teacherId: teacher.id, dayIndex: day, slotId },
    });
    if (!existingRow || !existingRow.booked) {
      return NextResponse.json({ error: 'Rezervasyon bulunamadı' }, { status: 404 });
    }

    const cell = (existingRow.data || {});
    if (session.role === 'student' && cell.studentId !== session.id) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    if (session.role === 'teacher' && legacyTeacherId !== session.id) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }

    // Slot'un program şablonundaki durumunu kontrol et (disabled mı yoksa açık mı)
    const program = await getProgramTemplate(legacyTeacherId);
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
  }

  const key = slotKey(weekKey, legacyTeacherId, day, slotId);

  const existing = await redis.get(key);
  if (!existing || !existing.booked) {
    return NextResponse.json({ error: 'Rezervasyon bulunamadı' }, { status: 404 });
  }

  if (session.role === 'student' && existing.studentId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (session.role === 'teacher' && legacyTeacherId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Program'a bakarak disabled durumunu restore et
  const program = await redis.get(`program:${legacyTeacherId}`);
  const slotEntry = program?.[String(day)]?.[slotId];
  const disabled = !slotEntry || slotEntry.type !== 'etut';

  await redis.set(key, { booked: false, disabled }, { ex: 60 * 60 * 24 * 16 });

  return NextResponse.json({ ok: true });
}
