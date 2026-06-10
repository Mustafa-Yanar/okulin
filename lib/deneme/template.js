// Sabit soru şablonu (ÖSYM/MEB yapısı). Cevap anahtarı ve öğrenci cevabı
// BOŞLUKSUZ tek string olarak girilir; ders sınırları buradan dilimlenir.
// Box sırası = cevap-anahtarı formundaki kutu sırası = string'deki sıra (Drive mockup).
// subjects[].key, lib/deneme/config.js (TYT_GROUPS / AYT_CATEGORIES) ile uyumlu.
//
// ⚠️ Bir kutudaki subjects SIRASI = öğretmenin anahtarı yazdığı sıra = optik/kitapçık
// sırası olmalı. Yanlış sıra netleri sessizce yanlış derse atar. Sıralar Mustafa'nın
// mockup'ına göre dizildi; kitapçık değişirse buradan güncellenir (tek nokta).

export const CHOICES = ['A', 'B', 'C', 'D', 'E'];

// Cevap karakteri sınıflandırması
export const BLANK_CHARS = ['', ' ', '-', '.', '_']; // boş bırakılmış soru
export const CANCEL_CHAR = '*';                       // iptal edilen soru (anahtarda)

export const TEMPLATES = {
  TYT: {
    label: 'TYT',
    totalQuestions: 120,
    wrongDivisor: 4, // net = D − Y/4
    boxes: [
      {
        key: 'turkce',
        label: 'Türkçe',
        subjects: [{ key: 'turkce', label: 'Türkçe', count: 40 }],
      },
      {
        key: 'sosyal',
        label: 'Sosyal Bilimler',
        subjects: [
          { key: 'tarih', label: 'Tarih', count: 5 },
          { key: 'cografya', label: 'Coğrafya', count: 5 },
          { key: 'din', label: 'Din Kültürü', count: 5 },
          { key: 'felsefe', label: 'Felsefe', count: 5 },
        ],
      },
      {
        key: 'matematik',
        label: 'Matematik',
        subjects: [
          { key: 'matematik', label: 'Matematik', count: 30 },
          { key: 'geometri', label: 'Geometri', count: 10 },
        ],
      },
      {
        key: 'fen',
        label: 'Fen Bilimleri',
        subjects: [
          { key: 'fizik', label: 'Fizik', count: 7 },
          { key: 'kimya', label: 'Kimya', count: 7 },
          { key: 'biyoloji', label: 'Biyoloji', count: 6 },
        ],
      },
    ],
  },

  AYT: {
    label: 'AYT',
    totalQuestions: 160,
    wrongDivisor: 4,
    boxes: [
      {
        key: 'edeb_sosyal_1',
        label: 'Edebiyat – Sosyal Bilimler-1',
        subjects: [
          { key: 'edebiyat_1', label: 'Edebiyat', count: 24 },
          { key: 'tarih_1', label: 'Tarih-1', count: 10 },
          { key: 'cografya_1', label: 'Coğrafya-1', count: 6 },
        ],
      },
      {
        key: 'sosyal_2',
        label: 'Sosyal Bilimler-2',
        subjects: [
          { key: 'tarih_2', label: 'Tarih-2', count: 11 },
          { key: 'cografya_2', label: 'Coğrafya-2', count: 11 },
          { key: 'felsefe', label: 'Felsefe Grubu', count: 12 },
          { key: 'din', label: 'Din Kültürü', count: 6 },
        ],
      },
      {
        key: 'matematik',
        label: 'Matematik',
        subjects: [
          { key: 'matematik', label: 'Matematik', count: 30 },
          { key: 'geometri', label: 'Geometri', count: 10 },
        ],
      },
      {
        key: 'fen',
        label: 'Fen Bilimleri',
        subjects: [
          { key: 'fizik', label: 'Fizik', count: 14 },
          { key: 'kimya', label: 'Kimya', count: 13 },
          { key: 'biyoloji', label: 'Biyoloji', count: 13 },
        ],
      },
    ],
  },

  LGS: {
    label: 'LGS',
    totalQuestions: 90,
    wrongDivisor: 3, // LGS net = D − Y/3
    boxes: [
      {
        key: 'sozel',
        label: 'Sözel Bölüm',
        subjects: [
          { key: 'turkce', label: 'Türkçe', count: 20 },
          { key: 'inkilap', label: 'T.C. İnkılap Tarihi', count: 10 },
          { key: 'din', label: 'Din Kültürü', count: 10 },
          { key: 'ingilizce', label: 'Yabancı Dil', count: 10 },
        ],
      },
      {
        key: 'sayisal',
        label: 'Sayısal Bölüm',
        subjects: [
          { key: 'matematik', label: 'Matematik', count: 20 },
          { key: 'fen', label: 'Fen Bilimleri', count: 20 },
        ],
      },
    ],
  },
};

// AYT puan türü → katkıda bulunan ders key'leri (geometri matematiğe dahil).
// Öğrenci hepsini çözmese de 3 türün hepsi hesaplanır; çözmediği ders neti 0 olur.
export const AYT_PUAN_TURU = {
  SAY: ['matematik', 'geometri', 'fizik', 'kimya', 'biyoloji'],
  EA: ['edebiyat_1', 'tarih_1', 'cografya_1', 'matematik', 'geometri'],
  SOZ: ['edebiyat_1', 'tarih_1', 'cografya_1', 'tarih_2', 'cografya_2', 'felsefe', 'din'],
};

export function getTemplate(examType) {
  return TEMPLATES[examType] || null;
}

// Bir kutunun toplam soru sayısı (anahtar/cevap string uzunluğu beklentisi).
export function boxLength(box) {
  return box.subjects.reduce((n, s) => n + s.count, 0);
}

// Sınav türündeki tüm dersleri (sıralı) düz liste olarak ver.
export function flatSubjects(examType) {
  const t = getTemplate(examType);
  if (!t) return [];
  return t.boxes.flatMap((b) => b.subjects);
}

// Ham string'i normalize et: büyük harf, sadece A–E + iptal işareti; boşluk = boş.
// Geriye karakter dizisi döner (her eleman tek soru).
export function normalizeRaw(raw) {
  return String(raw ?? '')
    .toLocaleUpperCase('tr')
    .replace(/İ/g, 'I')
    .split('')
    .map((c) => (CHOICES.includes(c) || c === CANCEL_CHAR ? c : ' '));
}

// Bir kutudaki boşluksuz string'i ders ders diz: { dersKey: ['A','B', ...] }.
// Eksik karakterler boş ( ' ' ) sayılır; fazlası kırpılır.
export function sliceBox(box, raw) {
  const chars = normalizeRaw(raw);
  const out = {};
  let i = 0;
  for (const s of box.subjects) {
    const arr = chars.slice(i, i + s.count);
    while (arr.length < s.count) arr.push(' ');
    out[s.key] = arr;
    i += s.count;
  }
  return out;
}

// Tüm kutuları birleştir → { dersKey: cevapDizisi }. boxesRaw: { [box.key]: rawString }.
export function sliceExam(examType, boxesRaw) {
  const t = getTemplate(examType);
  if (!t) return {};
  const out = {};
  for (const box of t.boxes) {
    Object.assign(out, sliceBox(box, boxesRaw?.[box.key] ?? ''));
  }
  return out;
}
