import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { daySlots as buildDaySlots } from '@/lib/constants';
import { getWeekKey, isEditableWeek, initWeekForTeacher, slotStartTime, getDaySlotTimes, getProgramTemplate, setProgramTemplate, deleteProgramTemplate } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';
import type { SlotCell } from '@/lib/slots';

// Slot id'sinden slot NUMARASINI çıkar (1-tabanlı). Yeni: d{gün}s{n} · eski: w{n}/e{n}.
// Grid hücresi — istemciden gelen program kaydındaki tek giriş.
interface GridEntry {
  type?: string;
  cls?: string;
  subBranch?: string;
  fixed?: boolean;
  studentId?: string | null;
  studentName?: string;
  studentCls?: string;
  [key: string]: unknown;
}
// gün ("0".."6") → slotId → giriş
type ProgramGrid = Record<string, Record<string, GridEntry | null | undefined>>;

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
  // programTemplate Json — grid kısmı gün→slot→giriş şeklinde saklanır
  const { etutSablonlari, ...template } = fullTemplate as { etutSablonlari?: unknown } & ProgramGrid;

  // SlotBooking'den geçici (fixed:false) entry'leri topla
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  const effective: ProgramGrid = JSON.parse(JSON.stringify(template));
  for (const dayIdx of Object.keys(effective)) {
    for (const sid of Object.keys(effective[dayIdx] || {})) {
      const cur = effective[dayIdx][sid];
      if (cur) cur.fixed = true;
    }
  }

  if (teacher) {
    const rows = await tdb().slotBooking.findMany({ where: { weekKey, teacherId: teacher.id } });
    for (const row of rows) {
      const tmplEntry = template[String(row.dayIndex)]?.[row.slotId];
      if (tmplEntry) continue; // şablonda var, geçici değil

      const cell = (row.data as SlotCell | null) || {};
      // Geçici ders
      if (cell.lessonType === 'ders' && cell.fixed === false) {
        if (!effective[String(row.dayIndex)]) effective[String(row.dayIndex)] = {};
        const e: GridEntry = { type: 'ders', cls: cell.cls || '', fixed: false };
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
  const { teacherId: legacyTeacherId, weekKey } = parsed.data;
  // Derin grid şekli üst seviyede z.record ile doğrulanır; hücre mantığı aşağıda işlenir (şema yorumu).
  const program = parsed.data.program as ProgramGrid;

  if (!isEditableWeek(weekKey)) {
    return NextResponse.json({ error: 'Geçmiş hafta düzenlenemez. Sadece mevcut hafta ve sonraki 2 hafta düzenlenebilir.' }, { status: 400 });
  }

  // Geçmiş slotları diff'ten sessizce kaldır.
  // İSTİSNA: kalıcı şablon dersi (fixed:true) her hafta tekrar eden SABİT programdır —
  // "geçmiş slot" kavramı ona uygulanmaz. Aksi halde haftanın son günlerinde (ör. Cmt/Paz)
  // program uygulanınca bu haftanın geçmiş günlerine düşen dersler şablona hiç yazılmaz,
  // öğretmen/sınıf kartları boş görünür. Geçmiş koruması yalnız o haftaya özel geçici
  // girdiler (etüt/geçici ders rezervasyonu, fixed:false) ve slot silme (null) içindir.
  const templateForGuard = await getProgramTemplate(legacyTeacherId);
  const { etutSablonlari: _ets, ...gridTemplateForGuard } = templateForGuard as { etutSablonlari?: unknown } & ProgramGrid;
  const postSlotTimes = await getDaySlotTimes();
  for (const dayIdx of Object.keys(program)) {
    const di = parseInt(dayIdx);
    const slots = buildDaySlots(di, postSlotTimes.days[di]);
    for (const slotId of Object.keys(program[dayIdx] || {})) {
      const entry = program[dayIdx][slotId];
      if (entry?.type === 'available') continue;
      if (entry?.fixed === true) continue; // kalıcı şablon dersi — geçmiş silme muaf
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

  // NOT: Eski "hafta içi ilk 6 slot yalnız mezun" DERS kısıtı KALDIRILDI (2026-07-13).
  // Slot-NUMARASI tabanlıydı (7-gün göçünden sonra saat-kör, yanlış slotları kapatıyordu)
  // ve müdürün elle/çözücü ile bilinçli ders atamasını hafta içi erken saatlerde
  // engelliyordu → o öğretmenin TÜM kaydı 400 dönüp ders sınıf kartına hiç yansımıyordu.
  // Ders yerleşimi artık müdürün/çözücünün kararı; etütteki mezun-only kuralı POST
  // /api/slots'ta ayrıca korunur (bu değişiklik yalnız DERS programını serbestleştirir).

  // Sınıf çakışma kontrolü (diğer öğretmenlerin programTemplates'inden)
  const otherTeachers = await tdb().teacher.findMany({ where: { id: { not: teacherSql.id } } });
  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry?.type !== 'ders' || !entry.cls || entry.fixed !== true) continue;
      for (const ot of otherTeachers) {
        const otTemplate = (ot.programTemplate as ProgramGrid | null) || {};
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
  const { etutSablonlari, ...oldGridTemplate } = fullOldTemplate as { etutSablonlari?: unknown } & ProgramGrid;
  const newGridTemplate: ProgramGrid = JSON.parse(JSON.stringify(oldGridTemplate));

  for (const [dayIdx, daySlots] of Object.entries(program)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry === null || entry === undefined) {
        if (newGridTemplate[dayIdx]) delete newGridTemplate[dayIdx][slotId];
        continue;
      }
      if (entry.fixed === true) {
        if (!newGridTemplate[dayIdx]) newGridTemplate[dayIdx] = {};
        const toStore: GridEntry = { ...entry };
        delete toStore.fixed;
        newGridTemplate[dayIdx][slotId] = toStore;
      } else if (entry.fixed === false) {
        if (newGridTemplate[dayIdx]) delete newGridTemplate[dayIdx][slotId];
      }
    }
  }

  // etutSablonlari'nı koru
  const newFullTemplate: Record<string, unknown> = { ...newGridTemplate };
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
      let cell: SlotCell;
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
        data: cell as object,
      };
      if (existingRow) {
        await tdb().slotBooking.update({ where: { id: existingRow.id }, data: rowData });
      } else {
        await tdb().slotBooking.create({ data: withScope({ weekKey, teacherId: teacherSql.id, dayIndex: parseInt(dayIdx), slotId, ...rowData }) });
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
  const { etutSablonlari, ...grid } = full as { etutSablonlari?: unknown } & ProgramGrid;
  const kept: Record<string, unknown> = {};
  for (const [dayIdx, daySlots] of Object.entries(grid)) {
    for (const [slotId, entry] of Object.entries(daySlots || {})) {
      if (entry?.type === 'available') ((kept[dayIdx] = (kept[dayIdx] as Record<string, unknown>) || {}) as Record<string, unknown>)[slotId] = entry;
    }
  }
  if (etutSablonlari !== undefined) kept.etutSablonlari = etutSablonlari;
  if (Object.keys(kept).length) await setProgramTemplate(legacyTeacherId, kept);
  else await deleteProgramTemplate(legacyTeacherId);
  return NextResponse.json({ ok: true });
});
