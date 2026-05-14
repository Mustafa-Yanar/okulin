// Öğretmen kayıt branşları (tümü seçilebilir)
export const BRANCHES = ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İnkılap Tarihi', 'İngilizce'];

// Sınıfa göre öğrencinin görebileceği branşlar
export function allowedBranchesForClass(cls) {
  const grade = Math.floor(parseInt(cls) / 100);
  if (grade === 7) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'];
  if (grade === 8) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'];
  // Lise ve mezun: tüm lise branşları (İngilizce yok)
  return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya'];
}

// Hafta içi saatleri (Pazartesi–Cuma) — 11 slot
export const WEEKDAY_SLOTS = [
  { id: 'w1',  label: '09:45–10:20' },
  { id: 'w2',  label: '10:30–11:05' },
  { id: 'w3',  label: '11:15–11:50' },
  { id: 'w4',  label: '12:00–12:35' },
  { id: 'w5',  label: '13:30–14:05' },
  { id: 'w6',  label: '14:15–14:50' },
  { id: 'w7',  label: '15:00–15:35' },
  { id: 'w8',  label: '15:45–16:20' },
  { id: 'w9',  label: '16:30–17:05' },
  { id: 'w10', label: '17:15–17:50' },
  { id: 'w11', label: '18:00–18:35' },
];

// Hafta sonu saatleri (Cumartesi–Pazar) — 10 slot
export const WEEKEND_SLOTS = [
  { id: 'e1',  label: '09:30–10:05' },
  { id: 'e2',  label: '10:15–10:50' },
  { id: 'e3',  label: '11:00–11:35' },
  { id: 'e4',  label: '11:45–12:20' },
  { id: 'e5',  label: '12:30–13:05' },
  { id: 'e6',  label: '13:15–13:50' },
  { id: 'e7',  label: '14:30–15:05' },
  { id: 'e8',  label: '15:15–15:50' },
  { id: 'e9',  label: '16:00–16:35' },
  { id: 'e10', label: '16:45–17:20' },
];

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

// Bir gün için geçerli slot listesini döndür
export function slotsForDay(dayIndex) {
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
    const num = parseInt(cls.slice(1));
    const type = num <= 5 ? 'Sayısal' : 'Eşit Ağırlık';
    return `Mezun ${type} (${cls.toUpperCase()})`;
  }
  const grade = Math.floor(parseInt(cls) / 100);
  const section = cls.slice(1);
  const gradeNames = { 7: '7. Sınıf', 8: '8. Sınıf', 1: '9. Sınıf', 2: '10. Sınıf', 3: '11. Sınıf', 4: '12. Sınıf' };
  const name = gradeNames[grade] || `${grade}. Sınıf`;
  let type = '';
  if (grade === 3) type = parseInt(section) <= 3 ? ' Sayısal' : ' Eşit Ağırlık';
  if (grade === 4) type = parseInt(section) <= 5 ? ' Sayısal' : ' Eşit Ağırlık';
  return `${name}${type} (${cls})`;
}
