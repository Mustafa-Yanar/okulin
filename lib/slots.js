import redis from './redis';
import { ALL_DAYS, slotsForDay, DEFAULT_WEEKDAY_TIMES, DEFAULT_WEEKEND_TIMES, WEEKDAY_SLOT_IDS, WEEKEND_SLOT_IDS, makeSlots, MEZUN_ONLY_LESSON_SLOTS, classToGroup } from './constants';
import { normalizeTeacher } from './teacherMigrate';

// Redis'ten global slot saatlerini oku (yoksa default'a düş)
export async function getSlotTimes() {
  const stored = await redis.get('slot_times');
  return {
    weekday: stored?.weekday || DEFAULT_WEEKDAY_TIMES,
    weekend: stored?.weekend || DEFAULT_WEEKEND_TIMES,
  };
}

// Belirli bir gün için saat-uyumlu slot dizisi döndürür
export async function slotsForDayDynamic(dayIndex) {
  const times = await getSlotTimes();
  const ids = dayIndex >= 5 ? WEEKEND_SLOT_IDS : WEEKDAY_SLOT_IDS;
  const arr = dayIndex >= 5 ? times.weekend : times.weekday;
  return makeSlots(ids, arr);
}

// Week key: ISO week string like "2024-W20"
export function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

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

// Bir haftanın slotlarını program'a göre init eder.
// program[dayIndex][slotId]: { type:'ders'|'etut'|null, studentId?, fixed?, ... }
// - type=null veya yok → disabled (kapalı)
// - type='ders'       → disabled (etüt alınamaz)
// - type='etut', studentId yok → açık etüt slotu
// - type='etut', studentId var + fixed → sabit rezervasyon
export async function initWeekForTeacher(teacherId, weekKey) {
  const teacher = await redis.get(`teacher:${teacherId}`);
  const hasGroups = teacher?.allowedGroups && teacher.allowedGroups.length > 0;
  const offDays = new Set(teacher?.offDays || []);
  const program = (await redis.get(programKey(teacherId))) || {};

  // Mevcut grid'i oku — fixed: false olan ders/etüt'leri koruyacağız
  const existingPipeline = redis.pipeline();
  const slotMeta = [];
  for (const day of ALL_DAYS) {
    for (const slot of slotsForDay(day.index)) {
      const k = slotKey(weekKey, teacherId, day.index, slot.id);
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
      const k = slotKey(weekKey, teacherId, day.index, slot.id);
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
export async function getTeacherWeekSlots(teacherId, weekKey) {
  const pipeline = redis.pipeline();
  const keys = [];

  for (const day of ALL_DAYS) {
    const slots = slotsForDay(day.index);
    for (const slot of slots) {
      const k = slotKey(weekKey, teacherId, day.index, slot.id);
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
  const ids = await redis.smembers('teachers');
  if (!ids || ids.length === 0) return [];
  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`teacher:${id}`));
  const results = await pipeline.exec();
  return results.filter(Boolean).map(normalizeTeacher);
}

export async function getAllStudents() {
  const ids = await redis.smembers('students');
  if (!ids || ids.length === 0) return [];
  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`student:${id}`));
  const results = await pipeline.exec();
  return results.filter(Boolean);
}
