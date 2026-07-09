import { ALL_DAYS, daySlots, DEFAULT_WEEKDAY_TIMES, DEFAULT_WEEKEND_TIMES,
  DEFAULT_SLOTS_PER_DAY, MEZUN_ONLY_LESSON_SLOTS, getWeekKey } from './constants';

// getWeekKey tek kaynak constants.js'te — buradan re-export (mevcut '@/lib/slots' importları kırılmasın)
export { getWeekKey };
import { tdb } from './sqldb';

// ── SLOT SAATLERİ (7-gün model) ───────────────────────────────────────────────
// Depolama şekli (TenantConfig.slotTimes):
//   YENİ: { days: { 0: {count, times:[{start,end}...]}, ..., 6: {...} } }
//   ESKİ: { weekday: [...12], weekend: [...12] }  → okurken 7 güne genişletilir.
// getDaySlotTimes her zaman NORMALİZE 7-gün objesi döndürür (geriye uyum garantili).

// Eski {weekday, weekend} veya null → normalize {days:{0..6:{count,times}}}.
export function normalizeSlotTimes(stored) {
  // Yeni format zaten days taşıyorsa: eksik günleri default'la, count'u times'tan türet.
  if (stored && stored.days && typeof stored.days === 'object') {
    const days = {};
    for (let d = 0; d < 7; d++) {
      const dc = stored.days[d] || stored.days[String(d)];
      if (dc && Array.isArray(dc.times)) {
        const count = Number.isFinite(dc.count) ? dc.count : dc.times.length;
        days[d] = { count, times: dc.times.slice(0, count) };
      } else {
        // gün tanımsız → hafta içi/sonu default'una düş
        const times = d >= 5 ? DEFAULT_WEEKEND_TIMES : DEFAULT_WEEKDAY_TIMES;
        days[d] = { count: DEFAULT_SLOTS_PER_DAY, times };
      }
    }
    return { days };
  }
  // Eski {weekday, weekend} → 5+2 güne kopyala.
  const weekday = stored?.weekday || DEFAULT_WEEKDAY_TIMES;
  const weekend = stored?.weekend || DEFAULT_WEEKEND_TIMES;
  const days = {};
  for (let d = 0; d < 5; d++) days[d] = { count: weekday.length, times: weekday };
  for (let d = 5; d < 7; d++) days[d] = { count: weekend.length, times: weekend };
  return { days };
}

// Normalize 7-gün slot saatleri (her zaman {days:{0..6}}).
export async function getDaySlotTimes() {
  const cfg = await tdb().tenantConfig.findFirst();
  return normalizeSlotTimes(cfg?.slotTimes);
}

// Bir günün slot listesi ({id,label,start,end}) — config'ten.
export async function getDaySlots(dayIndex) {
  const st = await getDaySlotTimes();
  return daySlots(dayIndex, st.days[dayIndex]);
}

// GERİYE UYUM (deprecated): {weekday, weekend} bekleyen eski çağrılar için.
// 7-gün modelinde weekday = gün0, weekend = gün5 örneği alınır (temsili).
export async function getSlotTimes() {
  const st = await getDaySlotTimes();
  return {
    weekday: st.days[0].times,
    weekend: st.days[5].times,
  };
}

// current_week — aktif hafta anahtarı (TenantConfig.currentWeek)
export async function getCurrentWeek() {
  const cfg = await tdb().tenantConfig.findFirst();
  return cfg?.currentWeek || null;
}

export async function setCurrentWeek(weekKey) {
  const cfg = await tdb().tenantConfig.findFirst();
  if (cfg) {
    await tdb().tenantConfig.update({
      where: { orgSlug_branch: { orgSlug: cfg.orgSlug, branch: cfg.branch } },
      data: { currentWeek: weekKey },
    });
  } else {
    await tdb().tenantConfig.create({ data: { currentWeek: weekKey } });
  }
}

// Week key: ISO week string like "2024-W20"
export function getMondayOfWeek(weekKey) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const jan4 = new Date(parseInt(year), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

// weekKey'i n hafta ileri/geri taşır
export function shiftWeek(weekKey, delta) {
  const mon = getMondayOfWeek(weekKey);
  mon.setDate(mon.getDate() + delta * 7);
  return getWeekKey(mon);
}

// Slot başlangıç anını (TSİ +03) Date olarak döndürür.
// slotLabel formatı: "HH:MM–HH:MM"
export function slotStartTime(weekKey, dayIndex, slotLabel) {
  const monday = getMondayOfWeek(weekKey);
  // UTC bazlı tarih oluştur (Türkiye saati TSİ +03)
  const y = monday.getFullYear();
  const m = monday.getMonth();
  const d = monday.getDate() + dayIndex;
  const startStr = (slotLabel || '').split('–')[0]?.split(':') || ['0','0'];
  const hh = parseInt(startStr[0] || '0');
  const mm = parseInt(startStr[1] || '0');
  // Türkiye yerel saatinde slot başlangıcı; UTC'ye -3 saat olarak yaz
  return new Date(Date.UTC(y, m, d, hh - 3, mm));
}

// weekKey, mevcut hafta ile +2 arasında mı? (toplam 3 hafta düzenlenebilir)
export function isEditableWeek(weekKey) {
  const current = getWeekKey();
  const w1 = shiftWeek(current, 1);
  const w2 = shiftWeek(current, 2);
  return weekKey === current || weekKey === w1 || weekKey === w2;
}

// SQL yardımcısı: hücre değerini SlotBooking satırından kur
function cellFromRow(row) {
  // data Json varsa kullan (tam hücre içeriği); yoksa scalar alanlara geri düş
  return row.data || {
    booked: row.booked,
    disabled: row.disabled,
    fixed: row.fixed,
    studentId: row.studentId,
    studentName: row.studentName,
    studentCls: row.studentCls,
    branch: row.dersBranch,
    bookedBy: row.bookedBy,
  };
}

// SQL yardımcısı: program şablonundaki giriş + mevcut hücreden yeni hücre hesapla
// (initWeekForTeacher ile program/route POST aynı mantığı kullanır)
function computeCellFromEntry(entry, existing) {
  // Şablondan gelen sabit DERS
  if (entry && entry.type === 'ders') {
    const gridEntry = {
      booked: false, disabled: true, lessonType: 'ders',
      cls: entry.cls || '', fixed: true,
    };
    if (entry.subBranch) gridEntry.subBranch = entry.subBranch;
    return gridEntry;
  }
  // Şablondan gelen sabit ETÜT (rezervasyon)
  if (entry && entry.type === 'etut') {
    if (entry.studentId && entry.fixed) {
      return {
        booked: true, disabled: false, studentId: entry.studentId,
        studentName: entry.studentName || '', studentCls: entry.studentCls || '',
        bookedBy: 'director', fixed: true,
      };
    } else {
      return { booked: false, disabled: false };
    }
  }
  // Geçici dersi koru
  if (existing && existing.lessonType === 'ders' && existing.fixed === false) {
    return existing;
  }
  // Geçici etüt rezervasyonunu koru
  if (existing && existing.booked && existing.fixed === false) {
    return existing;
  }
  // Hiçbir şey → kapalı
  return { booked: false, disabled: true };
}

// SQL yardımcısı: SlotBooking satırı için scalar alanları hücre nesnesinden çıkar
function scalarFromCell(cell) {
  return {
    booked: cell.booked ?? false,
    disabled: cell.disabled ?? true,
    fixed: cell.fixed ?? false,
    studentId: cell.studentId || null,
    studentName: cell.studentName || null,
    studentCls: cell.studentCls || null,
    dersBranch: cell.branch || null,
    bookedBy: cell.bookedBy || null,
    data: cell,
  };
}

// Bir haftanın slotlarını program'a göre init eder.
export async function initWeekForTeacher(legacyTeacherId, weekKey) {
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return;
  const hasGroups = teacher.allowedGroups && teacher.allowedGroups.length > 0;
  const offDays = new Set(teacher.offDays || []);
  const program = teacher.programTemplate || {};

  // Mevcut SlotBooking satırlarını oku (geçici rezervasyonları korumak için)
  const existingRows = await tdb().slotBooking.findMany({ where: { weekKey, teacherId: teacher.id } });
  const existingByKey = {};
  for (const row of existingRows) {
    existingByKey[`${row.dayIndex}:${row.slotId}`] = cellFromRow(row);
  }

  // Her slot için yeni hücre değeri hesapla (7-gün model: her gün kendi slotları)
  const slotTimes = await getDaySlotTimes();
  const newRows = [];
  for (const day of ALL_DAYS) {
    const slots = daySlots(day.index, slotTimes.days[day.index]);
    for (let slotNo = 1; slotNo <= slots.length; slotNo++) {
      const slot = slots[slotNo - 1];
      const entry = program[String(day.index)]?.[slot.id];
      const existing = existingByKey[`${day.index}:${slot.id}`];
      let cell;

      // Mezun-only kuralı: hafta içi (gün<5) ilk 6 slot yalnız mezun öğretmene açık.
      // Eski id-bazlı (w1-w6) kontrol → slot NUMARASINA taşındı (güne özgü id'lerde geçerli).
      const isMezunOnlySlot = day.index < 5 && slotNo <= MEZUN_ONLY_LESSON_SLOTS.length;

      if (!hasGroups) {
        cell = { booked: false, disabled: true };
      } else if (offDays.has(day.index)) {
        cell = { booked: false, disabled: true };
      } else if (isMezunOnlySlot) {
        const groups = teacher.allowedGroups || [];
        const onlyMezun = groups.length > 0 && groups.every(g => g === 'mezun');
        if (!onlyMezun) {
          cell = { booked: false, disabled: true };
        } else {
          cell = computeCellFromEntry(entry, existing);
        }
      } else {
        cell = computeCellFromEntry(entry, existing);
      }

      newRows.push({
        weekKey, teacherId: teacher.id, dayIndex: day.index, slotId: slot.id,
        ...scalarFromCell(cell),
      });
    }
  }

  // Eski satırları sil, yenilerini oluştur (tdb() orgSlug+branch enjekte eder)
  await tdb().slotBooking.deleteMany({ where: { weekKey, teacherId: teacher.id } });
  if (newRows.length > 0) await tdb().slotBooking.createMany({ data: newRows });
}

// Tüm günler ve slotlar için grid döndürür (7-gün model)
export async function getTeacherWeekSlots(legacyTeacherId, weekKey) {
  const slotTimes = await getDaySlotTimes();
  const daySlotList = {}; // dayIndex → slot[] (id eşlemesi için)
  const grid = {};
  for (const day of ALL_DAYS) {
    const slots = daySlots(day.index, slotTimes.days[day.index]);
    daySlotList[day.index] = slots;
    grid[day.index] = slots.map(() => ({ booked: false, disabled: true }));
  }
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return grid;
  const rows = await tdb().slotBooking.findMany({ where: { weekKey, teacherId: teacher.id } });
  for (const row of rows) {
    const slots = daySlotList[row.dayIndex] || [];
    const slotIdx = slots.findIndex(s => s.id === row.slotId);
    if (slotIdx >= 0) grid[row.dayIndex][slotIdx] = cellFromRow(row);
  }
  return grid;
}

export async function getAllTeachers() {
  const rows = await tdb().teacher.findMany();
  return rows.map(t => ({
    id: t.legacyId, name: t.name, branches: t.branches,
    allowedGroups: t.allowedGroups, offDays: t.offDays,
    username: t.username, phone: t.phone || null, photoUrl: t.photoUrl || null,
  }));
}

export async function getAllStudents() {
  const rows = await tdb().student.findMany({ include: { class: true } });
  return rows.map(s => ({
    id: s.legacyId, name: s.name, cls: s.class?.legacyId || null,
    group: s.group, phone: s.phone || null,
  }));
}

// program:{legacyTeacherId} objesini oku (grid + etutSablonlari)
export async function getProgramTemplate(legacyTeacherId) {
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  return teacher?.programTemplate || {};
}

// program:{legacyTeacherId} objesini yaz (grid + etutSablonlari)
export async function setProgramTemplate(legacyTeacherId, data) {
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return;
  await tdb().teacher.update({ where: { id: teacher.id }, data: { programTemplate: data } });
}

// program şablonunu sil (null yap)
export async function deleteProgramTemplate(legacyTeacherId) {
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return;
  await tdb().teacher.update({ where: { id: teacher.id }, data: { programTemplate: null } });
}
