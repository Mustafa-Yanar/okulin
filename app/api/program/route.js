import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, canManage } from '@/lib/auth';
import { slotsForDay, ALL_DAYS, MEZUN_ONLY_LESSON_SLOTS, STUDENT_GROUPS } from '@/lib/constants';
import { getWeekKey, slotKey, isEditableWeek, initWeekForTeacher, slotStartTime, getSlotTimes, getProgramTemplate, setProgramTemplate, deleteProgramTemplate } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// Derin iç içe grid — üst seviye şekil doğrulanır, hücre mantığı aşağıda işlenir.
const ProgramPostSchema = z.object({ teacherId: zId, weekKey: z.string().min(1).max(40), program: z.record(z.unknown()) });
const ProgramDeleteSchema = z.object({ teacherId: zId });

// program:{teacherId} → ŞABLON (sabit ders/etüt, her hafta tekrar eder)
// entry: { type: 'ders'|'etut'|null, cls?, studentId?, ..., fixed: true }

// slot:{weekKey}:{teacherId}:{dayIndex}:{slotId} → o haftanın grid'i
// Geçici (fixed: false) ders/etüt'ler burada yaşar, sadece o haftaya özel.

function programKey(teacherId) {
  return `program:${teacherId}`;
}

// GET /api/program?teacherId=...&week=...
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const legacyTeacherId = searchParams.get('teacherId');
  const weekKey = searchParams.get('week') || getWeekKey();
  if (!legacyTeacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  if (isSqlEnabled()) {
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

  const template = (await redis.get(programKey(legacyTeacherId))) || {};

  // Grid'i çek, geçici (fixed:false) entry'leri topla
  const slotTimes = await getSlotTimes();
  const pipeline = redis.pipeline();
  const slotMeta = [];
  for (const day of ALL_DAYS) {
    for (const slot of slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday)) {
      slotMeta.push({ dayIndex: day.index, slotId: slot.id });
      pipeline.get(slotKey(weekKey, legacyTeacherId, day.index, slot.id));
    }
  }
  const gridResults = await pipeline.exec();

  // Efektif program: şablondan başla, üzerine geçicileri yaz
  const effective = JSON.parse(JSON.stringify(template));
  // Tüm entry'lere fixed: true ekle (şablondakiler)
  for (const dayIdx of Object.keys(effective)) {
    for (const slotId of Object.keys(effective[dayIdx])) {
      const e = effective[dayIdx][slotId];
      if (e) e.fixed = true;
    }
  }

  slotMeta.forEach((m, i) => {
    const sd = gridResults[i];
    if (!sd) return;
    const tmplEntry = template[String(m.dayIndex)]?.[m.slotId];
    if (tmplEntry) return; // şablonda zaten var, geçici tanımlanmamış demektir

    // Geçici ders
    if (sd.lessonType === 'ders' && sd.fixed === false) {
      if (!effective[String(m.dayIndex)]) effective[String(m.dayIndex)] = {};
      const e = {
        type: 'ders',
        cls: sd.cls || '',
        fixed: false,
      };
      if (sd.subBranch) e.subBranch = sd.subBranch;
      effective[String(m.dayIndex)][m.slotId] = e;
      return;
    }
    // Geçici etüt rezervasyonu
    if (sd.booked && sd.fixed === false) {
      if (!effective[String(m.dayIndex)]) effective[String(m.dayIndex)] = {};
      effective[String(m.dayIndex)][m.slotId] = {
        type: 'etut',
        studentId: sd.studentId,
        studentName: sd.studentName || '',
        studentCls: sd.studentCls || '',
        fixed: false,
      };
    }
  });

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
  const templateForGuard = await getProgramTemplate(legacyTeacherId); // SQL-aware
  const { etutSablonlari: _ets, ...gridTemplateForGuard } = templateForGuard;
  const postSlotTimes = await getSlotTimes(); // SQL-aware
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

  if (isSqlEnabled()) {
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

    await setProgramTemplate(legacyTeacherId, newFullTemplate); // SQL-aware

    // 2) O haftayı şablona göre yeniden init et
    await initWeekForTeacher(legacyTeacherId, weekKey); // SQL-aware

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

  // Redis yolu
  // İzin günü kontrolü
  const teacherForOff = await redis.get(`teacher:${legacyTeacherId}`);
  const offDays = new Set(teacherForOff?.offDays || []);
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    if (!offDays.has(parseInt(dayIdx))) continue;
    for (const [, entry] of Object.entries(daySlots || {})) {
      if (entry) {
        return NextResponse.json({ error: 'Bu gün öğretmenin izin günü olarak işaretli, ders/etüt eklenemez.' }, { status: 400 });
      }
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

  // Sınıf çakışma kontrolü (sadece sabit dersler için — şablon karşılaştırması)
  const otherTeacherIds = (await redis.smembers('teachers')).filter(id => id !== legacyTeacherId);
  if (otherTeacherIds.length > 0) {
    const pipeline = redis.pipeline();
    otherTeacherIds.forEach(id => pipeline.get(programKey(id)));
    const otherPrograms = await pipeline.exec();
    const teacherNamePipeline = redis.pipeline();
    otherTeacherIds.forEach(id => teacherNamePipeline.get(`teacher:${id}`));
    const otherTeachers = await teacherNamePipeline.exec();

    for (const [dayIdx, daySlots] of Object.entries(program)) {
      for (const [slotId, entry] of Object.entries(daySlots || {})) {
        if (entry?.type !== 'ders' || !entry.cls || entry.fixed !== true) continue;
        for (let i = 0; i < otherTeacherIds.length; i++) {
          const otherEntry = otherPrograms[i]?.[String(dayIdx)]?.[slotId];
          if (otherEntry?.type === 'ders' && otherEntry.cls === entry.cls) {
            const otherTeacher = otherTeachers[i];
            return NextResponse.json({
              error: `Çakışma: ${entry.cls.toUpperCase()} sınıfı bu gün ve saatte ${otherTeacher?.name || 'başka bir öğretmen'} ile ders olarak işaretli.`,
            }, { status: 400 });
          }
        }
      }
    }
  }

  // 1) Şablonu güncelle: gelen program'da fixed: true olan entry'leri al
  const oldTemplate = (await redis.get(programKey(legacyTeacherId))) || {};
  const newTemplate = JSON.parse(JSON.stringify(oldTemplate));

  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      const tmplEntry = oldTemplate?.[dayIdx]?.[slotId];
      if (entry === null || entry === undefined) {
        // Slot temizleme — şablondan sil
        if (newTemplate[dayIdx]) delete newTemplate[dayIdx][slotId];
        continue;
      }
      if (entry.fixed === true) {
        // Şablona yaz (fixed bayrağını saklamaya gerek yok, hep true)
        if (!newTemplate[dayIdx]) newTemplate[dayIdx] = {};
        const toStore = { ...entry };
        delete toStore.fixed; // şablonda implicit true
        newTemplate[dayIdx][slotId] = toStore;
      } else if (entry.fixed === false) {
        // Şablonda eskiden vardıysa kaldır (kullanıcı sabitten geçiciye çevirdi)
        if (newTemplate[dayIdx]) delete newTemplate[dayIdx][slotId];
      }
    }
  }

  await redis.set(programKey(legacyTeacherId), newTemplate);

  // 2) O haftayı şablona göre yeniden init et (geçici entry'leri korur)
  await initWeekForTeacher(legacyTeacherId, weekKey);

  // 3) Geçici (fixed: false) entry'leri grid'e doğrudan yaz
  const gridPipeline = redis.pipeline();
  let gridCmds = 0;
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      const k = slotKey(weekKey, legacyTeacherId, parseInt(dayIdx), slotId);
      if (!entry) {
        // Slot temizlendi — grid'de varsa kaldır (kapalı yap)
        gridPipeline.set(k, { booked: false, disabled: true }, { ex: 60 * 60 * 24 * 16 });
        gridCmds++;
        continue;
      }
      if (entry.fixed === false) {
        if (entry.type === 'ders' && entry.cls) {
          const gridEntry = {
            booked: false,
            disabled: true,
            lessonType: 'ders',
            cls: entry.cls,
            fixed: false,
          };
          if (entry.subBranch) gridEntry.subBranch = entry.subBranch;
          gridPipeline.set(k, gridEntry, { ex: 60 * 60 * 24 * 16 });
          gridCmds++;
        } else if (entry.type === 'etut' && entry.studentId) {
          gridPipeline.set(k, {
            booked: true,
            disabled: false,
            studentId: entry.studentId,
            studentName: entry.studentName || '',
            studentCls: entry.studentCls || '',
            bookedBy: 'director',
            fixed: false,
          }, { ex: 60 * 60 * 24 * 16 });
          gridCmds++;
        } else if (entry.type === 'etut') {
          // Açık etüt slotu (öğrenci rezerve edebilir)
          gridPipeline.set(k, { booked: false, disabled: false }, { ex: 60 * 60 * 24 * 16 });
          gridCmds++;
        }
      }
    }
  }
  // Upstash boş pipeline'da exec() → "Pipeline is empty" hatası. Sadece komut varsa çalıştır.
  if (gridCmds > 0) await gridPipeline.exec();

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
