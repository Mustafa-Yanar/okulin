import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { slotsForDay, ALL_DAYS, MEZUN_ONLY_LESSON_SLOTS, STUDENT_GROUPS } from '@/lib/constants';
import { getWeekKey, slotKey, isEditableWeek, initWeekForTeacher, slotStartTime, getSlotTimes } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';

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
// Verilen hafta için efektif program'ı döndürür:
// - Şablondaki entry'ler (fixed: true)
// - O haftanın grid'inde fixed: false olarak yazılmış geçici ders/etüt'ler
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get('teacherId');
  const weekKey = searchParams.get('week') || getWeekKey();
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  const template = (await redis.get(programKey(teacherId))) || {};

  // Grid'i çek, geçici (fixed:false) entry'leri topla
  const slotTimes = await getSlotTimes();
  const pipeline = redis.pipeline();
  const slotMeta = [];
  for (const day of ALL_DAYS) {
    for (const slot of slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday)) {
      slotMeta.push({ dayIndex: day.index, slotId: slot.id });
      pipeline.get(slotKey(weekKey, teacherId, day.index, slot.id));
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
// Body: { teacherId, weekKey, program }
// program: { [dayIndex]: { [slotId]: { type, cls?, studentId?, ..., fixed: bool } | null } }
//
// fixed: true  → şablona yazılır (program:{teacherId})
// fixed: false → o haftanın grid'ine yazılır (slot:{weekKey}:...)
//
// null veya undefined entry: o slotu temizle (hem şablon hem grid)
export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, ProgramPostSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, weekKey, program } = parsed.data;

  if (!isEditableWeek(weekKey)) {
    return NextResponse.json({ error: 'Geçmiş hafta düzenlenemez. Sadece mevcut hafta ve sonraki 2 hafta düzenlenebilir.' }, { status: 400 });
  }

  // Geçmiş slotları diff'ten sessizce kaldır — frontend yanlışlıkla gönderirse
  // mevcut etüt/ders kayıtlarına dokunulmaz.
  // İSTİSNA: type:'available' haftadan bağımsız şablon ayarı (öğretmenin genel
  // müsaitliği); geçmiş-silme kuralından muaf, aksi halde bu haftanın geçmiş
  // günleri işaretlenemez.
  const postSlotTimes = await getSlotTimes();
  for (const dayIdx of Object.keys(program)) {
    const di = parseInt(dayIdx);
    const slots = slotsForDay(di, di >= 5 ? postSlotTimes.weekend : postSlotTimes.weekday);
    for (const slotId of Object.keys(program[dayIdx] || {})) {
      const entry = program[dayIdx][slotId];
      if (entry?.type === 'available') continue; // şablon müsaitliği — koru
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
  const teacherForOff = await redis.get(`teacher:${teacherId}`);
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
  const otherTeacherIds = (await redis.smembers('teachers')).filter(id => id !== teacherId);
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
  const oldTemplate = (await redis.get(programKey(teacherId))) || {};
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

  await redis.set(programKey(teacherId), newTemplate);

  // 2) O haftayı şablona göre yeniden init et (geçici entry'leri korur)
  await initWeekForTeacher(teacherId, weekKey);

  // 3) Geçici (fixed: false) entry'leri grid'e doğrudan yaz
  const gridPipeline = redis.pipeline();
  let gridCmds = 0;
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      const k = slotKey(weekKey, teacherId, parseInt(dayIdx), slotId);
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
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, ProgramDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId } = parsed.data;

  await redis.del(programKey(teacherId));
  return NextResponse.json({ ok: true });
}
