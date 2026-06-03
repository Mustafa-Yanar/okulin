// ── Branş sistemi: ders adı = branş adı, otomatik eşleme YOK ──
// Öğretmen verebildiği dersleri (branches[]) tek tek işaretler; grup-bazlı kısıtlı.
// Grup → o gruba ait seçilebilir branşlar (KESİN matris)
export const BRANCHES_BY_GROUP = {
  ortaokul: ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İnkılap Tarihi', 'İngilizce'],
  lise:     ['Türkçe', 'Matematik', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'],
  mezun:    ['Türkçe', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'],
};

export function branchesForGroup(group) {
  return BRANCHES_BY_GROUP[group] || [];
}

// allowedGroups birleşimi → öğretmenin seçebileceği branşlar (dedup, sıra korunur).
// Boşsa tüm grupların branşları.
export function branchesForGroups(groups) {
  const gs = (groups && groups.length) ? groups : Object.keys(BRANCHES_BY_GROUP);
  const out = [], seen = new Set();
  for (const g of gs) for (const b of branchesForGroup(g)) {
    if (!seen.has(b)) { seen.add(b); out.push(b); }
  }
  return out;
}

export function allBranches() {
  return branchesForGroups(Object.keys(BRANCHES_BY_GROUP));
}

// 12/mezun: TYT/AYT/Geometri "matematik ailesi" — öğrenci yalnız birinden etüt alabilir
export const MATH_FAMILY = ['TYT Matematik', 'AYT Matematik', 'Geometri'];

// Sınıfa göre öğrencinin etütte görebileceği dersler (= o sınıfın gördüğü dersler).
// COL_COURSES + colKeyFor ile türetilir → program ders listesiyle senkron.
export function allowedBranchesForClass(cls) {
  if (!cls) return [];
  return COL_COURSES[colKeyForClass(cls)] || [];
}

// Hafta içi & hafta sonu slot id'leri — 12'şer slot (saatleri dinamik, Redis'te)
export const WEEKDAY_SLOT_IDS = ['w1','w2','w3','w4','w5','w6','w7','w8','w9','w10','w11','w12'];
export const WEEKEND_SLOT_IDS = ['e1','e2','e3','e4','e5','e6','e7','e8','e9','e10','e11','e12'];

// Default saatler (Redis'te slot_times yoksa kullanılır)
export const DEFAULT_WEEKDAY_TIMES = [
  { start: '09:45', end: '10:20' },
  { start: '10:30', end: '11:05' },
  { start: '11:15', end: '11:50' },
  { start: '12:00', end: '12:35' },
  { start: '13:30', end: '14:05' },
  { start: '14:15', end: '14:50' },
  { start: '15:00', end: '15:35' },
  { start: '15:45', end: '16:20' },
  { start: '16:30', end: '17:05' },
  { start: '17:15', end: '17:50' },
  { start: '18:00', end: '18:35' },
  { start: '18:45', end: '19:20' },
];
export const DEFAULT_WEEKEND_TIMES = [
  { start: '09:30', end: '10:05' },
  { start: '10:15', end: '10:50' },
  { start: '11:00', end: '11:35' },
  { start: '11:45', end: '12:20' },
  { start: '12:30', end: '13:05' },
  { start: '13:15', end: '13:50' },
  { start: '14:30', end: '15:05' },
  { start: '15:15', end: '15:50' },
  { start: '16:00', end: '16:35' },
  { start: '16:45', end: '17:20' },
  { start: '17:30', end: '18:05' },
  { start: '18:15', end: '18:50' },
];

// Etüt takvimi varsayılanları (Redis'te slot_times yoksa kullanılır)
export const DEFAULT_ETUT_SURESI = 60; // dk — etüt formunda bitişi ön-doldurmak için
export const DEFAULT_MOLA_SURESI = 10; // dk — ders/etüt arası min boşluk (uyarı kontrolü)

// Etiket üretici: { start, end } → "HH:MM–HH:MM"
export function formatSlotLabel(t) {
  return `${t.start}–${t.end}`;
}

// Saat dizisini { id, label } slot dizisine çevir
export function makeSlots(ids, times) {
  return ids.map((id, i) => {
    const t = times[i] || { start: '00:00', end: '00:00' };
    return { id, label: formatSlotLabel(t), start: t.start, end: t.end };
  });
}

// Geriye dönük uyumluluk için default slot dizileri
export const WEEKDAY_SLOTS = makeSlots(WEEKDAY_SLOT_IDS, DEFAULT_WEEKDAY_TIMES);
export const WEEKEND_SLOTS = makeSlots(WEEKEND_SLOT_IDS, DEFAULT_WEEKEND_TIMES);

// Tüm günler: 0=Pzt 1=Sal 2=Çar 3=Per 4=Cum 5=Cmt 6=Paz
export const ALL_DAYS = [
  { index: 0, label: 'Pazartesi', short: 'Pzt', weekend: false },
  { index: 1, label: 'Salı',      short: 'Sal', weekend: false },
  { index: 2, label: 'Çarşamba',  short: 'Çar', weekend: false },
  { index: 3, label: 'Perşembe',  short: 'Per', weekend: false },
  { index: 4, label: 'Cuma',      short: 'Cum', weekend: false },
  { index: 5, label: 'Cumartesi', short: 'Cmt', weekend: true  },
  { index: 6, label: 'Pazar',     short: 'Paz', weekend: true  },
];

export const WEEKDAYS = ALL_DAYS.filter(d => !d.weekend).map(d => d.label);

// Bir gün için geçerli slot listesini döndür (default).
// Dinamik saatler için API endpoint'leri Redis'ten okuyup makeSlots ile üretir.
export function slotsForDay(dayIndex, times) {
  if (times) {
    const ids = dayIndex >= 5 ? WEEKEND_SLOT_IDS : WEEKDAY_SLOT_IDS;
    return makeSlots(ids, times);
  }
  return dayIndex >= 5 ? WEEKEND_SLOTS : WEEKDAY_SLOTS;
}

// Hafta içi sadece mezun sınıfların ders olarak atanabileceği ilk 6 slot
export const MEZUN_ONLY_LESSON_SLOTS = ['w1','w2','w3','w4','w5','w6'];

// Mezun öğrencilerin etüt rezervasyonu yapamayacağı hafta içi slot
export const MEZUN_FORBIDDEN_ETUT_SLOT = 'w9';

export const STUDENT_GROUPS = {
  ortaokul: {
    label: 'Ortaokul',
    classes: ['701', '702', '801', '802'],
  },
  lise: {
    label: 'Lise',
    classes: [
      '101', '102',
      '201', '202',
      '301', '302', '303',
      '304', '305', '306',
      '401', '402', '403', '404', '405',
      '406', '407', '408', '409', '410',
    ],
  },
  mezun: {
    label: 'Mezun',
    classes: ['m1','m2','m3','m4','m5','m6','m7','m8','m9','m10'],
  },
};

export function classToGroup(cls) {
  for (const [key, val] of Object.entries(STUDENT_GROUPS)) {
    if (val.classes.includes(cls)) return key;
  }
  return null;
}

export function classLabel(cls) {
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    return `Mezun ${n <= 5 ? 'Sayısal' : 'EA'} (${cls.toUpperCase()})`;
  }
  const g = Math.floor(parseInt(cls) / 100);
  const sec = parseInt(cls.slice(1));
  const gNames = { 7:'7.Sınıf', 8:'8.Sınıf', 1:'9.Sınıf', 2:'10.Sınıf', 3:'11.Sınıf', 4:'12.Sınıf' };
  let type = '';
  if (g === 3) type = sec <= 3 ? ' Sayısal' : ' EA';
  if (g === 4) type = sec <= 5 ? ' Sayısal' : ' EA';
  return `${gNames[g] || g+'.Sınıf'}${type} (${cls})`;
}

// Hafta anahtarı (ISO-8601 hafta no): "2026-W21". slots.js ve page.js tek kaynak olarak buradan alır.
export function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Hafta anahtarından okunabilir tarih aralığı: { startStr:'25 Mayıs', endStr:'31 Mayıs', yearStr:2026 }
// DirectorPanel ve StudentPanel tek kaynak olarak buradan alır.
const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
export function weekRangeLabel(weekKey) {
  try {
    const [year, wStr] = String(weekKey).split('-W');
    const week = parseInt(wStr);
    if (!Number.isFinite(week) || !Number.isFinite(parseInt(year))) {
      return { startStr: '', endStr: '', yearStr: '' };
    }
    const jan4 = new Date(parseInt(year), 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const startStr = `${monday.getDate()} ${TR_MONTHS[monday.getMonth()]}`;
    const endStr = `${sunday.getDate()} ${TR_MONTHS[sunday.getMonth()]}`;
    return { startStr, endStr, yearStr: sunday.getFullYear() };
  } catch {
    return { startStr: '', endStr: '', yearStr: '' };
  }
}

// ── Ders yükü sütunları ve sınıf→sütun eşlemesi (tek kaynak) ──
// Her sütunun gördüğü dersler. allowedBranchesForClass + ProgramOlusturucu buna dayanır.
export const COL_COURSES = {
  'Ortaokul_7':               ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'],
  'Ortaokul_8':               ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'],
  'Lise Ortak_9':             ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'],
  'Lise Ortak_10':            ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'],
  'Lise Sayısal_11':          ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
  'Lise Eşit Ağırlık_11':    ['Türkçe', 'Matematik', 'Tarih', 'Coğrafya', 'Felsefe'],
  'Lise Sayısal_12':          ['Türkçe', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji'],
  'Lise Eşit Ağırlık_12':    ['Türkçe', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Tarih', 'Coğrafya', 'Felsefe'],
  'Mezun Sayısal':            ['Türkçe', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji'],
  'Mezun Eşit Ağırlık':      ['Türkçe', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Tarih', 'Coğrafya', 'Felsefe'],
};

// Sınıf → ders yükü sütun anahtarı
export function colKeyForClass(cls) {
  if (!cls) return 'Lise Ortak_9';
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    return n <= 5 ? 'Mezun Sayısal' : 'Mezun Eşit Ağırlık';
  }
  const grade = Math.floor(parseInt(cls) / 100);
  const sec = parseInt(cls.slice(1));
  if (grade === 7) return 'Ortaokul_7';
  if (grade === 8) return 'Ortaokul_8';
  if (grade === 9 || grade === 10) return `Lise Ortak_${grade}`;
  if (grade === 3) return sec <= 3 ? 'Lise Sayısal_11' : 'Lise Eşit Ağırlık_11';
  if (grade === 4) return sec <= 5 ? 'Lise Sayısal_12' : 'Lise Eşit Ağırlık_12';
  return 'Lise Ortak_9';
}

// Kurum gideri kategorileri (muhasebe — diğer giderler). "Diğer" daima sonda.
export const EXPENSE_CATEGORIES = [
  'Kira',
  'Faturalar',
  'Kırtasiye & Malzeme',
  'Vergi & SGK',
  'Bakım & Onarım',
  'Reklam & Pazarlama',
  'Diğer',
];
