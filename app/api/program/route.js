import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { daySlots as buildDaySlots, MEZUN_ONLY_LESSON_SLOTS, STUDENT_GROUPS } from '@/lib/constants';
import { getWeekKey, isEditableWeek, initWeekForTeacher, slotStartTime, getDaySlotTimes, getProgramTemplate, setProgramTemplate, deleteProgramTemplate } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

// Slot id'sinden slot NUMARASINI çıkar (1-tabanlı). Yeni: d{gün}s{n} · eski: w{n}/e{n}.
function slotNoFromId(slotId) {
  const m = /(?:^[we]|s)(\d+)$/.exec(slotId);
  return m ? parseInt(m[1], 10) : null;
}

// Derin iç içe grid — üst seviye şekil doğrulanır, hücre mantığı aşağıda işlenir.
const ProgramPostSchema = z.object({ teacherId: zId, weekKey: z.string().min(1).max(40), program: z.record(z.unknown()) });
const ProgramDeleteSchema = z.object({ teacherId: zId });

// program:{teacherId} → ŞABLON (sabit ders/etüt, her hafta tekrar eder)
// entry: { type: 'ders'|'etut'|null, cls?, studentId?, ..., fixed: true }

// slot:{weekKey}:{teacherId}:{dayIndex}:{slotId} → o haftanın grid'i
// Geçici (fixed: false) ders/etüt'ler burada yaşar, sadece o haftaya özel.

// GET /api/program?teacherId=...&week=...
export const GET = withAuth(async (req) => {
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
});

// POST /api/program
export const POST = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, ProgramPostSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId: legacyTeacherId, weekKey, program } = parsed.data;

  if (!isEditableWeek(weekKey)) {
    return NextResponse.json({ error: 'Geçmiş hafta düzenlenemez. Sadece mevcut hafta ve sonraki 2 hafta düzenlenebilir.' }, { status: 400 });
  }

  // Geçmiş slotları diff'ten sessizce kaldır
  const templateForGuard = await getProgramTemplate(legacyTeacherId);
  const { etutSablonlari: _ets, ...gridTemplateForGuard } = templateForGuard;
  const postSlotTimes = await getDaySlotTimes();
  for (const dayIdx of Object.keys(program)) {
    const di = parseInt(dayIdx);
    const slots = buildDaySlots(di, postSlotTimes.days[di]);
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

  // Hafta içi ilk 6 slot 'ders' kuralı (eski dershane modeli: gündüz = mezun).
  // ÖNCELİK sınıfın kendi ders penceresi (Class.slotTemplate, Faz 4 KATI pencere):
  // müdür o (gün, slot)'u pencereye işaretlediyse kural UYGULANMAZ — pencere bilinçli
  // tercihtir. Penceresi olmayan sınıflar için eski kural sürer; mezun tespiti registry
  // group'undan (s_… id'ler) + eski sabit kodlardan (m1-m10) yapılır.
  const classRows = await tdb().class.findMany();
  const classByLegacy = new Map(classRows.map((c) => [c.legacyId, c]));
  const mezunLegacy = new Set(STUDENT_GROUPS.mezun?.classes || []);
  const mezunOnlyCount = MEZUN_ONLY_LESSON_SLOTS.length; // 6
  for (const [dayIdx, daySlotEntries] of Object.entries(program)) {
    const day = parseInt(dayIdx);
    if (day >= 5) continue;
    for (const [slotId, entry] of Object.entries(daySlotEntries || {})) {
      const slotNo = slotNoFromId(slotId);
      if (entry?.type !== 'ders' || slotNo == null || slotNo > mezunOnlyCount || !entry.cls) continue;
      const row = classByLegacy.get(entry.cls);
      const windowNos = row?.slotTemplate?.[String(day)];
      if (Array.isArray(windowNos) && windowNos.includes(slotNo)) continue; // pencere izni
      const isMezun = row ? row.group === 'mezun' : mezunLegacy.has(entry.cls);
      if (!isMezun) {
        return NextResponse.json({ error: `${slotNo}. slot (hafta içi ilk 6) sadece mezun sınıflarına ders eklenebilir — ya da sınıfın "Program Penceresi"nde bu saat işaretli olmalı` }, { status: 400 });
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
});

// DELETE /api/program — öğretmenin şablonundaki DERS/ETÜT girdilerini siler.
// 'available' (uygunluk) işaretleri ve etutSablonlari KORUNUR: uygunluk çözücünün
// girdisidir, program yeniden oluşturulduğunda müdürün baştan işaretlemesi gerekmemeli.
// (Tam sıfırlama gerekiyorsa: /api/admin/week reset-all)
export const DELETE = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, ProgramDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId: legacyTeacherId } = parsed.data;

  const full = await getProgramTemplate(legacyTeacherId);
  const { etutSablonlari, ...grid } = full;
  const kept = {};
  for (const [dayIdx, daySlots] of Object.entries(grid)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry?.type === 'available') (kept[dayIdx] = kept[dayIdx] || {})[slotId] = entry;
    }
  }
  if (etutSablonlari !== undefined) kept.etutSablonlari = etutSablonlari;
  if (Object.keys(kept).length) await setProgramTemplate(legacyTeacherId, kept);
  else await deleteProgramTemplate(legacyTeacherId);
  return NextResponse.json({ ok: true });
});
