import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { getWeekKey, getTeacherWeekSlots, getAllTeachers, slotStartTime, getDaySlotTimes, getProgramTemplate, getWeekEvents, findBlockingEvent, dateStrForWeekDay, type SlotCell, type ProgramEntry } from '@/lib/slots';
import { ALL_DAYS, daySlots, MEZUN_FORBIDDEN_ETUT_SLOT_NO, slotNoOf, MATH_FAMILY } from '@/lib/constants';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';
import type { Prisma } from '@prisma/client';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { getOrgConfig } from '@/lib/config';
import { HttpError } from '@/lib/errors';
import { studentWeekBookings, combineBookings, type SlotRowLike } from '@/lib/etut/student-week';
import { getWeekReservations, resolveEffective, lockResource, lockStudentWeek } from '@/lib/etut/reservations';
import { levelPoolForStudent } from '@/lib/etut/level-pool';
import { findTimeConflict, toMin } from '@/lib/etut/overlap';

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
  const slotTimes = await getDaySlotTimes();
  // Haftanın aktif (kurum geneli) etkinlikleri — tek sorgu, her hücreye tekrar tekrar sorgu atmadan uygulanır.
  const weekEvents = await getWeekEvents(weekKey);

  // Kurum geneli (sınıf hedefsiz) etkinlik (tatil vb.) çakışan, henüz boş/kapalı hücreleri işaretler.
  // Rezervasyonu OLAN hücrelere dokunmaz (mevcut veri korunur, çakışma varsa yönetici görür/çözer).
  function applyEventBlock(dayIndex: number, cells: SlotCell[]): SlotCell[] {
    const dateStr = dateStrForWeekDay(weekKey, dayIndex);
    const events = weekEvents.get(dateStr);
    if (!events) return cells;
    const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
    return cells.map((cell, i) => {
      if (cell.booked || !cell.disabled) return cell;
      const slot = slots[i];
      if (!slot) return cell;
      const blocking = findBlockingEvent(events, null, slot.start, slot.end);
      return blocking ? { ...cell, eventBlocked: true, eventTitle: blocking.title } : cell;
    });
  }

  if (teacherId) {
    const grid = await getTeacherWeekSlots(teacherId, weekKey);
    for (const day of ALL_DAYS) grid[day.index] = applyEventBlock(day.index, grid[day.index]);
    return NextResponse.json({ weekKey, grid });
  }

  const teachers = await getAllTeachers(); // id=legacyId
  const allSlots: ({ teacherId: string; teacherName: string; branches: string[]; allowedGroups: string[]; day: number; dayLabel: string; weekend: boolean; slotId: string; slotLabel: string } & SlotCell)[] = [];

  for (const teacher of teachers) {
    const grid = await getTeacherWeekSlots(teacher.id, weekKey);
    for (const day of ALL_DAYS) {
      const slots = daySlots(day.index, slotTimes.days[day.index]);
      const cells = applyEventBlock(day.index, grid[day.index]);
      for (let s = 0; s < slots.length; s++) {
        const slotData = cells[s] || { booked: false, disabled: true };
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
    // 2) Haftalık max etüt sınırı (0 = sınırsız). Sayaç artık BİRLEŞİK (SlotBooking +
    // EtutReservation, spec §4 studentWeekBookings) — eski SlotBooking-only count yerine.
    // UCUZ ÖN-KONTROL (Fix 1, review bulgusu): tx/lock açmadan, en yaygın red durumunu erken
    // keser — ama studentWeekBookings kendi tdb()'sini açtığından kilitsiz/yarışa AÇIK
    // (bookEtut'un lockStudentWeek'iyle senkron DEĞİL). OTORİTER karar aşağıda, çakışma
    // kontrolüyle AYNI transaction+advisory lock içinde TAZE weeklyCount ile tekrar verilir
    // (booking.ts'in bookEtut'undaki "erken çıkış ucuz, tx içi otoriter" ilkesiyle AYNI desen).
    const maxWeekly = parseInt(String(etut?.maxWeeklyPerStudent)) || 0;
    if (maxWeekly > 0) {
      const { weeklyCount: used } = await studentWeekBookings(currentOrg(), currentBranch(), String(session.id ?? ''), weekKey);
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

  // Aktif etkinlik (tatil veya öğrencinin sınıfını hedefleyen sınav/etkinlik) kontrolü.
  // Müdür/rehber forceOpen ile geçebilir (şablon-kapalı slot bypass'ıyla simetrik).
  if (!(forceOpen && (session.role === 'director' || session.role === 'counselor')) && slotDef) {
    const dateStr = dateStrForWeekDay(weekKey, day);
    const weekEvents = await getWeekEvents(weekKey);
    const blocking = findBlockingEvent(weekEvents.get(dateStr), studentCls, slotDef.start, slotDef.end);
    if (blocking) {
      return NextResponse.json({ error: `Bu tarihte "${blocking.title}" etkinliği aktif — rezervasyon yapılamaz` }, { status: 400 });
    }
  }

  // Grup erişim kontrolü
  const allowedGroups = teacher.allowedGroups || [];
  if (allowedGroups.length > 0 && !allowedGroups.includes(studentGroup)) {
    return NextResponse.json({ error: 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz' }, { status: 400 });
  }

  // Mezun öğrenciler hafta içi 9. slot etüdüne kayıt olamaz (slot NUMARASINA göre)
  if (studentGroup === 'mezun' && slotNoOf(slotId) === MEZUN_FORBIDDEN_ETUT_SLOT_NO && day < 5) {
    return NextResponse.json({ error: 'Mezun öğrenciler hafta içi 9. slottaki etüde kayıt olamaz' }, { status: 400 });
  }

  // Branş doğrulaması — DÜZEY havuzu (§4a): öğrenci kendi sınıf listesiyle sınırlı değil,
  // kendi düzeyindeki (ortaokul/lise/mezun) TÜM derslerden etüt alabilir. Eski
  // pickAllowedBranches(class.dersler, cls) sınıf-bazlıydı; levelPoolForStudent(cls, group)
  // ile değişti — lib/etut/booking.ts'in autoPickBranch'iyle AYNI kaynak (tutarlılık için).
  // levelPoolForStudent (Fix 2, review bulgusu): grup havuzu boşsa (örn. 'ilkokul' —
  // FALLBACK_KEYS'te yok + registry'de henüz sınıf yok) öğrencinin KENDİ şubesine düşer —
  // levelPoolForGroup TEK BAŞINA o gruptaki TÜM öğrencileri branş doğrulamasında reddederdi.
  const studentAllowed = await levelPoolForStudent(studentCls || '', targetStudent.group);
  let bookingBranch: string | undefined = branch;
  if (!bookingBranch) {
    const candidates = (teacher.branches || []).filter(b => studentAllowed.includes(b));
    if (candidates.length === 1) bookingBranch = candidates[0];
  }
  if (!bookingBranch || !(teacher.branches || []).includes(bookingBranch) || !studentAllowed.includes(bookingBranch)) {
    return NextResponse.json({ error: 'Geçersiz veya seçilmemiş ders. Bu öğretmen-öğrenci için uygun bir ders seçin.' }, { status: 400 });
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

  const orgSlug = currentOrg();
  const branchSlug = currentBranch();
  const targetStudentId = String(targetLegacyStudentId ?? '');
  // Atomik upsert — race condition önler (UNIQUE kısıt: orgSlug+branch+weekKey+teacherId+dayIndex+slotId)
  // DİKKAT: tdb() enjeksiyonu upsert'i KAPSAMAZ (lib/sqldb tasarımı: "route explicit
  // verir") — create'te orgSlug/branch açıkça geçilmeli. withScope salt tip iddiasıdır;
  // burada kullanılırsa satırsız haftaya ilk rezervasyon PrismaClientValidationError
  // ("orgSlug is missing") ile 500 döner.
  const scope = { orgSlug, branch: branchSlug };
  // Saat snapshot'ı (spec §4): slotDef zaten yukarıda ("Geçmiş slot kontrolü") çözülü —
  // slot saat config'i sonradan değişirse bu kayıt kaymasın diye start/end burada donuyor.
  const startsAt = slotDef?.start ?? null;
  const endsAt = slotDef?.end ?? null;

  // Çakışma/limit kontrolü + yazım TEK transaction+advisory lock içinde (Fix 1, review
  // bulgusu): lib/etut/booking.ts'in bookEtut'uyla AYNI kilit deseni. studentWeekBookings
  // yardımcı fonksiyonu KENDİ tdb()'sini açtığı için tx-güvenli DEĞİL — okuma burada
  // getWeekReservations+resolveEffective+slotBooking.findMany+combineBookings ile TX
  // İÇİNDE, lock alındıktan SONRA elle tekrarlanır. Amaç: aynı öğrenci+hafta için
  // /api/slots ile bookEtut (etüt-şablon rezervasyonu) AYNI ANDA çalışırsa, ikisi de aynı
  // (stale) satırı görüp ikisi de geçerli sayılamasın (çapraz-sistem yarış).
  return await tdb().$transaction(async (rawTx) => {
    // Tip köprüsü — lib/etut/booking.ts'teki AYNI gerekçe: $extends sarmalı tdb()'nin
    // ürettiği tx tipi çalışma zamanında aynı delegeye sahip olsa da tsc'ye yapısal
    // uyumsuz görünür (Exact<>/SelectSubset<> jenerikleri) — reservations.ts'in imzası
    // Prisma.TransactionClient beklediğinden köprü BURADA, tek satırda kurulur.
    const tx = rawTx as unknown as Prisma.TransactionClient;
    // Faz 4 Y3: initWeekForTeacher (hafta-grid yeniden kurulumu) ile AYNI anahtar/sıra —
    // slotweek İLK (grid rebuild sırasında bu POST'un rezervasyonu kaybolmasın). Kilit
    // sırası GLOBAL: slotweek → slot-cell → student.
    await lockResource(tx, `slotweek:${orgSlug}:${branchSlug}:${weekKey}:${teacher.id}`);
    // Kaynak-bazlı advisory lock (Faz 2 audit-fix FIX-A, KRİTİK) — slotweek'ten SONRA (slot
    // hücresi kaynağı). Kök neden: yalnız lockStudentWeek varken İKİ FARKLI öğrenci AYNI
    // hücreye eşzamanlı POST atınca FARKLI kilit alıyordu → ikisi de "boş" görüp ikisi de
    // upsert ediyordu (2. istek 1.'yi sessizce eziyordu — unique kısıt upsert'te tetiklenmez).
    await lockResource(tx, `slot:${orgSlug}:${branchSlug}:${weekKey}:${teacher.id}:${day}:${slotId}`);
    // SIRA: HER ZAMAN lockResource'tan SONRA (deadlock-free, bkz. reservations.ts lockResource).
    await lockStudentWeek(tx, orgSlug, branchSlug, targetStudentId, weekKey);

    // Doluluk TEKRAR-DOĞRULAMA (Faz 2 audit-fix FIX-A, OTORİTER): satır ~151'deki pre-tx
    // okuma yarışa açıktı (stale) — kilit ALINDIKTAN SONRA hücreyi TAZE oku. Başka bir
    // öğrenciye (yarışı kazanan eşzamanlı istek) geçmişse burada reddet — mesaj/status
    // pre-tx kontrolle (satır ~159) BİREBİR. Aynı öğrenci zaten bu hücrede ise (idempotent
    // yeniden-deneme) engellenmez — upsert aynı satırı günceller.
    const freshCell = await tx.slotBooking.findUnique({
      where: {
        orgSlug_branch_weekKey_teacherId_dayIndex_slotId: {
          orgSlug, branch: branchSlug, weekKey, teacherId: teacher.id, dayIndex: day, slotId,
        },
      },
    });
    if (freshCell?.booked && freshCell.studentId !== targetStudentId) {
      throw new HttpError(400, 'Bu saat dilimi zaten dolu');
    }

    const [allRows, slotRowsRaw] = await Promise.all([
      getWeekReservations(tx, orgSlug, branchSlug, weekKey),
      tx.slotBooking.findMany({ where: { orgSlug, branch: branchSlug, weekKey, booked: true, studentId: targetStudentId } }),
    ]);
    const effectiveMap = resolveEffective(allRows, weekKey);
    // filtre: yalnız studentId — /api/slots'ta dışlanacak bir sablonId YOK (bookEtut'un
    // "r.sablonId !== sablonRow?.id" dışlaması yalnız kendi hedef etüdünü sayımdan çıkarır;
    // bu route SlotBooking-only bir yazım, dışlanacak bir EtutReservation satırı yok).
    const effectiveEtutRows = Array.from(effectiveMap.values()).filter((r) => r.studentId === targetStudentId);
    const slotRows: SlotRowLike[] = slotRowsRaw.map((r) => ({
      dayIndex: r.dayIndex, slotId: r.slotId, startsAt: r.startsAt, endsAt: r.endsAt,
      dersBranch: r.dersBranch, data: r.data as SlotCell | null,
    }));
    // slotTimes: fonksiyon başında ("Geçmiş slot kontrolü") zaten çözülü — org-geneli slot
    // saat config'i öğrenci+hafta kilidine bağlı DEĞİL, tx içinde yeniden okumaya gerek yok.
    const { list: otherBookings, weeklyCount } = combineBookings(effectiveEtutRows, slotRows, slotTimes);

    // Kural 0 (OTORİTER — Fix 1): haftalık max etüt sınırı. Yukarıdaki (satır ~127) ucuz
    // ön-kontrol non-transactional'dı; burada TAZE weeklyCount ile kesin karar verilir.
    if (session.role === 'student') {
      const etut = await getOrgConfig('etut');
      const maxWeekly = parseInt(String(etut?.maxWeeklyPerStudent)) || 0;
      if (maxWeekly > 0 && weeklyCount >= maxWeekly) {
        throw new HttpError(403, `Bu hafta en fazla ${maxWeekly} etüt alabilirsiniz (${weeklyCount} dolu).`);
      }
    }

    // Kural 1: Aynı gün aynı saatte başka etüt (interval-bazlı; eski string slotId eşitliği
    // DEĞİL — iki sistem arasında slotId uzayı ortak değil, saat çakışması tek doğru ölçüt).
    if (slotDef) {
      const candidate = { dayIndex: day, startMin: toMin(slotDef.start), endMin: toMin(slotDef.end) };
      const timeConflict = findTimeConflict(otherBookings, candidate);
      if (timeConflict) {
        throw new HttpError(400, 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı');
      }
    }

    if (session.role !== 'director' && session.role !== 'counselor') {
      // Kural 2: Aynı dersten ikinci etüt
      const branchConflict = otherBookings.some(b => b.dersBranch === bookingBranch);
      if (branchConflict) {
        throw new HttpError(400, `Bu öğrenci bu hafta ${bookingBranch} dersinden zaten etüt almış`);
      }
      // Kural 3: TYT/AYT/Geometri matematik ailesi
      if (MATH_FAMILY.includes(bookingBranch)) {
        const mathConflict = otherBookings.some(b => b.dersBranch && MATH_FAMILY.includes(b.dersBranch));
        if (mathConflict) {
          throw new HttpError(400, 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış');
        }
      }
    }

    await tx.slotBooking.upsert({
      where: {
        orgSlug_branch_weekKey_teacherId_dayIndex_slotId: {
          ...scope,
          weekKey, teacherId: teacher.id, dayIndex: day, slotId,
        },
      },
      update: {
        booked: true, disabled: false, fixed: false,
        studentId: targetLegacyStudentId, studentName: targetStudent.name,
        studentCls: studentCls, dersBranch: bookingBranch, bookedBy: session.role,
        data: bookedData, startsAt, endsAt,
      },
      create: {
        ...scope,
        weekKey, teacherId: teacher.id, dayIndex: day, slotId,
        booked: true, disabled: false, fixed: false,
        studentId: targetLegacyStudentId, studentName: targetStudent.name,
        studentCls: studentCls, dersBranch: bookingBranch, bookedBy: session.role,
        data: bookedData, startsAt, endsAt,
      },
    });

    return NextResponse.json({ ok: true, slot: bookedData });
  });
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

  // Pre-tx okuma (Faz 2 audit-fix FIX-A) — ucuz erken-red: en yaygın "rezervasyon yok" /
  // "yetkisiz" durumlarını tx/lock açmadan keser. STALE olabilir — OTORİTER doğrulama
  // aşağıda, kilit alındıktan SONRA, tx içinde TAZE satırla tekrarlanır (eskiden bu route
  // tamamen kilitsizdi: iki eşzamanlı DELETE/POST aynı hücrede stale-update yarışına açıktı).
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

  // Slot'un program şablonundaki durumunu kontrol et (disabled mı yoksa açık mı) — statik
  // şablon verisi, yarışa açık değil, tx dışında (lock'tan önce) hesaplanabilir.
  const program = await getProgramTemplate(legacyTeacherId) as Record<string, Record<string, ProgramEntry | undefined> | undefined>;
  const slotEntry = program[String(day)]?.[slotId];
  const disabled = !slotEntry || slotEntry.type !== 'etut';

  const orgSlug = currentOrg();
  const branchSlug = currentBranch();
  // Kilit anahtarı için öğrenci id'si — pre-tx (stale) satırdan; yalnız kilit ALIRKEN
  // kullanılır, sahiplik kararı aşağıda TAZE satırla tekrar verilir.
  const preLockStudentId = String(existingRow.studentId ?? cell.studentId ?? '');

  return await tdb().$transaction(async (rawTx) => {
    // Tip köprüsü — bookEtut/POST'taki AYNI gerekçe (reservations.ts imzası
    // Prisma.TransactionClient bekliyor, $extends sarmalı tx tipi tsc'ye yapısal uyumsuz
    // görünür ama çalışma zamanında aynı delegedir).
    const tx = rawTx as unknown as Prisma.TransactionClient;
    // Faz 4 Y3: initWeekForTeacher (hafta-grid yeniden kurulumu) ile AYNI anahtar/sıra —
    // slotweek İLK, POST ile de AYNI (grid rebuild ile bu DELETE aynı anda çalışırsa
    // serileşsin). Kilit sırası GLOBAL: slotweek → slot-cell → student.
    await lockResource(tx, `slotweek:${orgSlug}:${branchSlug}:${weekKey}:${teacher.id}`);
    // Kaynak-bazlı advisory lock (Faz 2 audit-fix FIX-A, KRİTİK) — slotweek'ten SONRA, POST
    // ile AYNI anahtar biçimi (`slot:${orgSlug}:${branch}:${weekKey}:${teacherId}:${day}:${slotId}`)
    // — aksi halde POST ve DELETE aynı hücreye AYNI ANDA dokunurken FARKLI kilit alır,
    // yarış kapanmaz.
    await lockResource(tx, `slot:${orgSlug}:${branchSlug}:${weekKey}:${teacher.id}:${day}:${slotId}`);
    // SIRA: HER ZAMAN lockResource'tan SONRA (deadlock-free).
    await lockStudentWeek(tx, orgSlug, branchSlug, preLockStudentId, weekKey);

    // Race penceresi: lock alınana kadar başka bir istek aynı hücreyi iptal etmiş/başka bir
    // öğrenciye yeniden rezerve etmiş olabilir — TAZE veriyle yeniden doğrula (bookEtut'un
    // cancelEtutV2'sindeki AYNI ilke). Mesaj/status pre-tx kontrollerle BİREBİR.
    const freshRow = await tx.slotBooking.findUnique({
      where: {
        orgSlug_branch_weekKey_teacherId_dayIndex_slotId: {
          orgSlug, branch: branchSlug, weekKey, teacherId: teacher.id, dayIndex: day, slotId,
        },
      },
    });
    if (!freshRow || !freshRow.booked) {
      throw new HttpError(404, 'Rezervasyon bulunamadı');
    }

    // Öğretmen kendi-slotu kontrolü satır-bağımsız (input.teacherId sabit, freshRow'a
    // bakmaz) — yukarıdaki pre-tx kontrol zaten yeterli, burada tekrarlanmaz (cancelEtutV2
    // ile AYNI ilke). Öğrenci sahipliği İSE hücrenin GÜNCEL sakinine bağlı — TAZE veriyle,
    // pre-tx kontrolle BİREBİR aynı 'Yetkisiz' metniyle yeniden doğrulanır.
    const freshCell = ((freshRow.data as SlotCell | null) || {});
    if (session.role === 'student' && freshCell.studentId !== session.id) {
      throw new HttpError(403, 'Yetkisiz');
    }

    await tx.slotBooking.update({
      where: { id: freshRow.id },
      data: {
        booked: false, disabled, fixed: false,
        studentId: null, studentName: null, studentCls: null, dersBranch: null, bookedBy: null,
        data: { booked: false, disabled },
      },
    });
    return NextResponse.json({ ok: true });
  });
});
