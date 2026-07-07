import { NextResponse } from 'next/server';
import { getSession, canManage } from '@/lib/auth';
import { slotsForDay, MEZUN_ONLY_LESSON_SLOTS, STUDENT_GROUPS } from '@/lib/constants';
import { getWeekKey, isEditableWeek, initWeekForTeacher, slotStartTime, getSlotTimes, getProgramTemplate, setProgramTemplate, deleteProgramTemplate } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

// Derin iç içe grid — üst seviye şekil doğrulanır, hücre mantığı aşağıda işlenir.
const ProgramPostSchema = z.object({ teacherId: zId, weekKey: z.string().min(1).max(40), program: z.record(z.unknown()) });
const ProgramDeleteSchema = z.object({ teacherId: zId });

// program:{teacherId} → ŞABLON (sabit ders/etüt, her hafta tekrar eder)
// entry: { type: 'ders'|'etut'|null, cls?, studentId?, ..., fixed: true }

// slot:{weekKey}:{teacherId}:{dayIndex}:{slotId} → o haftanın grid'i
// Geçici (fixed: false) ders/etüt'ler burada yaşar, sadece o haftaya özel.

// GET /api/program?teacherId=...&week=...
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const legacyTeacherId = searchParams.get('teacherId');
  const weekKey = searchParams.get('week') || getWeekKey();
  if (!legacyTeacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  // Şablonu oku (grid kısmı; etutSablonlari hariç)
  const fullTemplate = await getProgramTemplate(legacyTeacherId);
  const { etutSablonlari, ...template } = fullTemplate;

  // SlotBooking'den geçici (fixed:false) entry'leri topla
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  const effective = JSON.parse(JSON.stringify(template));
  for (const dayIdx of Object.keys(effective)) {
    for (const sid of Object.keys(effective[dayIdx] || {})) {
      if (effective[dayIdx][sid]) effective[dayIdx][sid].fixed = true;
    }
  }

  if (teacher) {
    const rows = await tdb().slotBooking.findMany({ where: { weekKey, teacherId: teacher.id } });
    for (const row of rows) {
      const tmplEntry = template[String(row.dayIndex)]?.[row.slotId];
      if (tmplEntry) continue; // şablonda var, geçici değil

      const cell = row.data || {};
      // Geçici ders
      if (cell.lessonType === 'ders' && cell.fixed === false) {
        if (!effective[String(row.dayIndex)]) effective[String(row.dayIndex)] = {};
        const e = { type: 'ders', cls: cell.cls || '', fixed: false };
        if (cell.subBranch) e.subBranch = cell.subBranch;
        effective[String(row.dayIndex)][row.slotId] = e;
      }
      // Geçici etüt
      if (row.booked && cell.fixed === false) {
        if (!effective[String(row.dayIndex)]) effective[String(row.dayIndex)] = {};
        effective[String(row.dayIndex)][row.slotId] = {
          type: 'etut', studentId: row.studentId,
          studentName: row.studentName || '', studentCls: row.studentCls || '', fixed: false,
        };
      }
    }
  }

  return NextResponse.json({ weekKey, program: effective });
}

// POST /api/program
export async function POST(req) {
  const session = await getSession();
  if (!session || !(await canManage(session))) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, ProgramPostSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId: legacyTeacherId, weekKey, program } = parsed.data;

  if (!isEditableWeek(weekKey)) {
    return NextResponse.json({ error: 'Geçmiş hafta düzenlenemez. Sadece mevcut hafta ve sonraki 2 hafta düzenlenebilir.' }, { status: 400 });
  }

  // Geçmiş slotları diff'ten sessizce kaldır
  const templateForGuard = await getProgramTemplate(legacyTeacherId);
  const { etutSablonlari: _ets, ...gridTemplateForGuard } = templateForGuard;
  const postSlotTimes = await getSlotTimes();
  for (const dayIdx of Object.keys(program)) {
    const di = parseInt(dayIdx);
    const slots = slotsForDay(di, di >= 5 ? postSlotTimes.weekend : postSlotTimes.weekday);
    for (const slotId of Object.keys(program[dayIdx] || {})) {
      const entry = program[dayIdx][slotId];
      if (entry?.type === 'available') continue;
      const tmpl = gridTemplateForGuard?.[dayIdx]?.[slotId];
      if ((entry === null || entry === undefined) && tmpl?.type === 'available') continue;
      const slotDef = slots.find(s => s.id === slotId);
      if (!slotDef) continue;
      const slotStart = slotStartTime(weekKey, parseInt(dayIdx), slotDef.label);
      if (slotStart.getTime() <= Date.now()) {
        delete program[dayIdx][slotId];
      }
    }
    if (Object.keys(program[dayIdx]).length === 0) delete program[dayIdx];
  }

  // İzin günü kontrolü
  const teacherSql = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacherSql) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
  const offDays = new Set(teacherSql.offDays || []);
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    if (!offDays.has(parseInt(dayIdx))) continue;
    for (const [, entry] of Object.entries(daySlots || {})) {
      if (entry) return NextResponse.json({ error: 'Bu gün öğretmenin izin günü olarak işaretli, ders/etüt eklenemez.' }, { status: 400 });
    }
  }

  // Hafta içi w1–w6 ders slotlarına sadece mezun sınıfı atanabilir
  const mezunClasses = new Set(STUDENT_GROUPS.mezun?.classes || []);
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    if (parseInt(dayIdx) >= 5) continue;
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry?.type === 'ders' && MEZUN_ONLY_LESSON_SLOTS.includes(slotId)) {
        if (entry.cls && !mezunClasses.has(entry.cls)) {
          return NextResponse.json({ error: `${slotId} slotu (hafta içi ilk 6) sadece mezun sınıflarına ders eklenebilir` }, { status: 400 });
        }
      }
    }
  }

  // Sınıf çakışma kontrolü (diğer öğretmenlerin programTemplates'inden)
  const otherTeachers = await tdb().teacher.findMany({ where: { id: { not: teacherSql.id } } });
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry?.type !== 'ders' || !entry.cls || entry.fixed !== true) continue;
      for (const ot of otherTeachers) {
        const otTemplate = ot.programTemplate || {};
        const otEntry = otTemplate[String(dayIdx)]?.[slotId];
        if (otEntry?.type === 'ders' && otEntry.cls === entry.cls) {
          return NextResponse.json({
            error: `Çakışma: ${entry.cls.toUpperCase()} sınıfı bu gün ve saatte ${ot.name || 'başka bir öğretmen'} ile ders olarak işaretli.`,
          }, { status: 400 });
        }
      }
    }
  }

  // 1) Şablonu güncelle: gelen program'da fixed: true entry'ler + etutSablonlari koru
  const fullOldTemplate = await getProgramTemplate(legacyTeacherId);
  const { etutSablonlari, ...oldGridTemplate } = fullOldTemplate;
  const newGridTemplate = JSON.parse(JSON.stringify(oldGridTemplate));

  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry === null || entry === undefined) {
        if (newGridTemplate[dayIdx]) delete newGridTemplate[dayIdx][slotId];
        continue;
      }
      if (entry.fixed === true) {
        if (!newGridTemplate[dayIdx]) newGridTemplate[dayIdx] = {};
        const toStore = { ...entry };
        delete toStore.fixed;
        newGridTemplate[dayIdx][slotId] = toStore;
      } else if (entry.fixed === false) {
        if (newGridTemplate[dayIdx]) delete newGridTemplate[dayIdx][slotId];
      }
    }
  }

  // etutSablonlari'nı koru
  const newFullTemplate = { ...newGridTemplate };
  if (etutSablonlari !== undefined) newFullTemplate.etutSablonlari = etutSablonlari;

  await setProgramTemplate(legacyTeacherId, newFullTemplate);

  // 2) O haftayı şablona göre yeniden init et
  await initWeekForTeacher(legacyTeacherId, weekKey);

  // 3) Geçici (fixed: false) entry'leri SlotBooking'e doğrudan yaz
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry?.fixed !== false) continue;
      const existingRow = await tdb().slotBooking.findFirst({
        where: { weekKey, teacherId: teacherSql.id, dayIndex: parseInt(dayIdx), slotId },
      });
      let cell;
      if (!entry) {
        cell = { booked: false, disabled: true };
      } else if (entry.type === 'ders' && entry.cls) {
        cell = { booked: false, disabled: true, lessonType: 'ders', cls: entry.cls, fixed: false };
        if (entry.subBranch) cell.subBranch = entry.subBranch;
      } else if (entry.type === 'etut' && entry.studentId) {
        cell = { booked: true, disabled: false, studentId: entry.studentId, studentName: entry.studentName || '', studentCls: entry.studentCls || '', bookedBy: 'director', fixed: false };
      } else if (entry.type === 'etut') {
        cell = { booked: false, disabled: false };
      } else {
        continue;
      }
      const rowData = {
        booked: cell.booked ?? false, disabled: cell.disabled ?? true, fixed: cell.fixed ?? false,
        studentId: cell.studentId || null, studentName: cell.studentName || null,
        studentCls: cell.studentCls || null, dersBranch: null, bookedBy: cell.bookedBy || null,
        data: cell,
      };
      if (existingRow) {
        await tdb().slotBooking.update({ where: { id: existingRow.id }, data: rowData });
      } else {
        await tdb().slotBooking.create({ data: { weekKey, teacherId: teacherSql.id, dayIndex: parseInt(dayIdx), slotId, ...rowData } });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/program — bir öğretmenin şablon programını tamamen siler
export async function DELETE(req) {
  const session = await getSession();
  if (!session || !(await canManage(session))) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, ProgramDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId: legacyTeacherId } = parsed.data;

  await deleteProgramTemplate(legacyTeacherId); // SQL-aware (grid'i siler, etutSablonlari'nı da temizler)
  return NextResponse.json({ ok: true });
}
