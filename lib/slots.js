import { tenantRedis } from './tenant';
import { ALL_DAYS, slotsForDay, DEFAULT_WEEKDAY_TIMES, DEFAULT_WEEKEND_TIMES, WEEKDAY_SLOT_IDS, WEEKEND_SLOT_IDS, makeSlots, MEZUN_ONLY_LESSON_SLOTS, classToGroup, getWeekKey } from './constants';

// getWeekKey tek kaynak constants.js'te — buradan re-export (mevcut '@/lib/slots' importları kırılmasın)
export { getWeekKey };
import { normalizeTeacher } from './teacherMigrate';
import { tdb } from './sqldb';
import { useSql } from './usesql';

// Redis'ten global slot saatlerini oku (yoksa default'a düş)
export async function getSlotTimes() {
  if (useSql()) {
    const cfg = await tdb().tenantConfig.findFirst();
    const stored = cfg?.slotTimes;
    return {
      weekday: stored?.weekday || DEFAULT_WEEKDAY_TIMES,
      weekend: stored?.weekend || DEFAULT_WEEKEND_TIMES,
    };
  }
  const redis = tenantRedis();
  const stored = await redis.get('slot_times');
  return {
    weekday: stored?.weekday || DEFAULT_WEEKDAY_TIMES,
    weekend: stored?.weekend || DEFAULT_WEEKEND_TIMES,
  };
}

// current_week — aktif hafta anahtarı (SQL: TenantConfig.currentWeek)
export async function getCurrentWeek() {
  if (useSql()) {
    const cfg = await tdb().tenantConfig.findFirst();
    return cfg?.currentWeek || null;
  }
  const redis = tenantRedis();
  return (await redis.get('current_week')) || null;
}

export async function setCurrentWeek(weekKey) {
  if (useSql()) {
    const cfg = await tdb().tenantConfig.findFirst();
    if (cfg) {
      await tdb().tenantConfig.update({
        where: { orgSlug_branch: { orgSlug: cfg.orgSlug, branch: cfg.branch } },
        data: { currentWeek: weekKey },
      });
    } else {
      await tdb().tenantConfig.create({ data: { currentWeek: weekKey } });
    }
    return;
  }
  const redis = tenantRedis();
  await redis.set('current_week', weekKey);
}

// Belirli bir gün için saat-uyumlu slot dizisi döndürür
export async function slotsForDayDynamic(dayIndex) {
  const times = await getSlotTimes();
  const ids = dayIndex >= 5 ? WEEKEND_SLOT_IDS : WEEKDAY_SLOT_IDS;
  const arr = dayIndex >= 5 ? times.weekend : times.weekday;
  return makeSlots(ids, arr);
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

// slot key: slot:{weekKey}:{teacherId}:{dayIndex}:{slotId}
export function slotKey(weekKey, teacherId, dayIndex, slotId) {
  return `slot:${weekKey}:${teacherId}:${dayIndex}:${slotId}`;
}

function programKey(teacherId) {
  return `program:${teacherId}`;
}

// SQL yardımcısı: hücre değerini SQL SlotBooking satırından kur
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
  if (useSql()) {
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

    // Her slot için yeni hücre değeri hesapla
    const newRows = [];
    for (const day of ALL_DAYS) {
      const slots = slotsForDay(day.index);
      for (const slot of slots) {
        const entry = program[String(day.index)]?.[slot.id];
        const existing = existingByKey[`${day.index}:${slot.id}`];
        let cell;

        if (!hasGroups) {
          cell = { booked: false, disabled: true };
        } else if (offDays.has(day.index)) {
          cell = { booked: false, disabled: true };
        } else if (day.index < 5 && MEZUN_ONLY_LESSON_SLOTS.includes(slot.id)) {
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
    return;
  }

  // Redis yolu
  const redis = tenantRedis();
  const teacher = await redis.get(`teacher:${legacyTeacherId}`);
  const hasGroups = teacher?.allowedGroups && teacher.allowedGroups.length > 0;
  const offDays = new Set(teacher?.offDays || []);
  const program = (await redis.get(programKey(legacyTeacherId))) || {};

  // Mevcut grid'i oku — fixed: false olan ders/etüt'leri koruyacağız
  const existingPipeline = redis.pipeline();
  const slotMeta = [];
  for (const day of ALL_DAYS) {
    for (const slot of slotsForDay(day.index)) {
      const k = slotKey(weekKey, legacyTeacherId, day.index, slot.id);
      slotMeta.push({ k, dayIndex: day.index, slotId: slot.id });
      existingPipeline.get(k);
    }
  }
  const existingResults = await existingPipeline.exec();
  const existingByKey = {};
  slotMeta.forEach((m, i) => { existingByKey[m.k] = existingResults[i]; });

  const pipeline = redis.pipeline();

  for (const day of ALL_DAYS) {
    const slots = slotsForDay(day.index);
    for (const slot of slots) {
      const entry = program[String(day.index)]?.[slot.id];
      const k = slotKey(weekKey, legacyTeacherId, day.index, slot.id);
      const existing = existingByKey[k];

      // Etiketsiz öğretmenin tüm slotları kapalı
      if (!hasGroups) {
        pipeline.set(k, { booked: false, disabled: true }, { ex: 60 * 60 * 24 * 16 });
        continue;
      }

      // İzin günü → tüm slotlar kapalı
      if (offDays.has(day.index)) {
        pipeline.set(k, { booked: false, disabled: true }, { ex: 60 * 60 * 24 * 16 });
        continue;
      }

      // Hafta içi w1-w6 → sadece mezun öğretmenler; lise/ortaokul öğrencisi etüt yapamaz
      if (day.index < 5 && MEZUN_ONLY_LESSON_SLOTS.includes(slot.id)) {
        const groups = teacher?.allowedGroups || [];
        const onlyMezun = groups.length > 0 && groups.every(g => g === 'mezun');
        if (!onlyMezun) {
          pipeline.set(k, { booked: false, disabled: true }, { ex: 60 * 60 * 24 * 16 });
          continue;
        }
      }

      // 1) Şablondan gelen sabit DERS
      if (entry && entry.type === 'ders') {
        const gridEntry = {
          booked: false,
          disabled: true,
          lessonType: 'ders',
          cls: entry.cls || '',
          fixed: true,
        };
        if (entry.subBranch) gridEntry.subBranch = entry.subBranch;
        pipeline.set(k, gridEntry, { ex: 60 * 60 * 24 * 16 });
        continue;
      }

      // 2) Şablondan gelen sabit ETÜT (rezervasyon)
      if (entry && entry.type === 'etut') {
        if (entry.studentId && entry.fixed) {
          pipeline.set(k, {
            booked: true,
            disabled: false,
            studentId: entry.studentId,
            studentName: entry.studentName || '',
            studentCls: entry.studentCls || '',
            bookedBy: 'director',
            fixed: true,
          }, { ex: 60 * 60 * 24 * 16 });
        } else {
          pipeline.set(k, { booked: false, disabled: false }, { ex: 60 * 60 * 24 * 16 });
        }
        continue;
      }

      // 3) Şablonda yok — mevcut grid'de geçici ders veya geçici rezervasyon var mı?
      if (existing && existing.lessonType === 'ders' && existing.fixed === false) {
        // Geçici dersi koru
        pipeline.set(k, existing, { ex: 60 * 60 * 24 * 16 });
        continue;
      }
      if (existing && existing.booked && existing.fixed === false) {
        // Geçici etüt rezervasyonunu koru (öğrencinin haftalık rezervasyonu)
        pipeline.set(k, existing, { ex: 60 * 60 * 24 * 16 });
        continue;
      }

      // 4) Hiçbir şey yok → kapalı
      pipeline.set(k, { booked: false, disabled: true }, { ex: 60 * 60 * 24 * 16 });
    }
  }
  await pipeline.exec();
}

// Tüm günler ve slotlar için grid döndürür
export async function getTeacherWeekSlots(legacyTeacherId, weekKey) {
  if (useSql()) {
    const grid = {};
    for (const day of ALL_DAYS) {
      grid[day.index] = slotsForDay(day.index).map(() => ({ booked: false, disabled: true }));
    }
    const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
    if (!teacher) return grid;
    const rows = await tdb().slotBooking.findMany({ where: { weekKey, teacherId: teacher.id } });
    for (const row of rows) {
      const cell = cellFromRow(row);
      const slots = slotsForDay(row.dayIndex);
      const slotIdx = slots.findIndex(s => s.id === row.slotId);
      if (slotIdx >= 0) grid[row.dayIndex][slotIdx] = cell;
    }
    return grid;
  }

  const redis = tenantRedis();
  const pipeline = redis.pipeline();
  const keys = [];

  for (const day of ALL_DAYS) {
    const slots = slotsForDay(day.index);
    for (const slot of slots) {
      const k = slotKey(weekKey, legacyTeacherId, day.index, slot.id);
      keys.push({ dayIndex: day.index, slotId: slot.id, k });
      pipeline.get(k);
    }
  }

  const results = await pipeline.exec();

  const grid = {};
  for (const day of ALL_DAYS) {
    grid[day.index] = slotsForDay(day.index).map(() => null);
  }

  results.forEach((val, i) => {
    const { dayIndex, slotId } = keys[i];
    const slots = slotsForDay(dayIndex);
    const slotIdx = slots.findIndex(s => s.id === slotId);
    grid[dayIndex][slotIdx] = val !== null ? val : { booked: false, disabled: true };
  });

  return grid;
}

export async function getAllTeachers() {
  if (useSql()) {
    const rows = await tdb().teacher.findMany();
    return rows.map(t => ({
      id: t.legacyId, name: t.name, branches: t.branches,
      allowedGroups: t.allowedGroups, offDays: t.offDays,
      username: t.username, phone: t.phone || null, photoUrl: t.photoUrl || null,
    }));
  }
  const redis = tenantRedis();
  const ids = await redis.smembers('teachers');
  if (!ids || ids.length === 0) return [];
  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`teacher:${id}`));
  const results = await pipeline.exec();
  return results.filter(Boolean).map(normalizeTeacher);
}

export async function getAllStudents() {
  if (useSql()) {
    const rows = await tdb().student.findMany({ include: { class: true } });
    return rows.map(s => ({
      id: s.legacyId, name: s.name, cls: s.class?.legacyId || null,
      group: s.group, phone: s.phone || null,
    }));
  }
  const redis = tenantRedis();
  const ids = await redis.smembers('students');
  if (!ids || ids.length === 0) return [];
  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`student:${id}`));
  const results = await pipeline.exec();
  return results.filter(Boolean);
}

// program:{legacyTeacherId} Redis objesini SQL'den oku (grid + etutSablonlari)
export async function getProgramTemplate(legacyTeacherId) {
  if (useSql()) {
    const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
    return teacher?.programTemplate || {};
  }
  const redis = tenantRedis();
  return (await redis.get(programKey(legacyTeacherId))) || {};
}

// program:{legacyTeacherId} Redis objesini SQL'e yaz (grid + etutSablonlari)
export async function setProgramTemplate(legacyTeacherId, data) {
  if (useSql()) {
    const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
    if (!teacher) return;
    await tdb().teacher.update({ where: { id: teacher.id }, data: { programTemplate: data } });
    return;
  }
  const redis = tenantRedis();
  await redis.set(programKey(legacyTeacherId), data);
}

// program şablonunu sil (null yap)
export async function deleteProgramTemplate(legacyTeacherId) {
  if (useSql()) {
    const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
    if (!teacher) return;
    await tdb().teacher.update({ where: { id: teacher.id }, data: { programTemplate: null } });
    return;
  }
  const redis = tenantRedis();
  await redis.del(programKey(legacyTeacherId));
}
