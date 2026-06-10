// Saf puanlama çekirdeği. UI/Redis bağımsız, test edilebilir.
// Girdi: ders→cevap dizisi + ders→anahtar dizisi. Çıktı: mevcut `results` şekli
// ({ dersKey: {dogru,yanlis,bos,net} }) → DenemeAnaliz/NetChart aynen besler.

import { getTemplate, BLANK_CHARS, CANCEL_CHAR, AYT_PUAN_TURU } from './template.js';
import {
  DEFAULT_COEFFICIENTS,
  TYT_COEF_GROUPS,
  AYT_COEF_GROUPS,
  LGS_WEIGHTS,
} from './coefficients.js';

const BLANKS = new Set(BLANK_CHARS);

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Tek soru: 'dogru' | 'yanlis' | 'bos' | 'iptal'
export function gradeOne(answer, key) {
  const k = String(key ?? '').toLocaleUpperCase('tr');
  if (k === CANCEL_CHAR || k === '') return 'iptal';
  const a = String(answer ?? '').toLocaleUpperCase('tr');
  if (BLANKS.has(a)) return 'bos';
  return a === k ? 'dogru' : 'yanlis';
}

// Bir ders: cevap dizisi + anahtar dizisi → { dogru, yanlis, bos, net }.
// İptal soru hiçbir sayıma girmez (kimse için doğru/yanlış değil).
export function gradeSubject(answers, key, wrongDivisor = 4) {
  let d = 0, y = 0, b = 0;
  const n = (key || []).length;
  for (let i = 0; i < n; i++) {
    const g = gradeOne(answers?.[i], key[i]);
    if (g === 'dogru') d++;
    else if (g === 'yanlis') y++;
    else if (g === 'bos') b++;
  }
  return { dogru: d, yanlis: y, bos: b, net: round2(d - y / wrongDivisor) };
}

// Sınav: ders→cevap + ders→anahtar → results { dersKey: {dogru,yanlis,bos,net} }.
export function gradeExam(examType, answersBySubject, keyBySubject) {
  const t = getTemplate(examType);
  if (!t) return {};
  const wd = t.wrongDivisor || 4;
  const results = {};
  for (const box of t.boxes) {
    for (const s of box.subjects) {
      results[s.key] = gradeSubject(
        answersBySubject?.[s.key],
        keyBySubject?.[s.key] || [],
        wd
      );
    }
  }
  return results;
}

// Bir ders grubunun toplam neti.
function groupNet(results, keys) {
  let sum = 0;
  for (const k of keys) sum += results?.[k]?.net || 0;
  return sum;
}

// ---- Puan hesapları (parametrik katsayı) ----

export function tytPuan(results, coef = DEFAULT_COEFFICIENTS.TYT) {
  let p = coef.base;
  for (const [coefKey, subjKeys] of Object.entries(TYT_COEF_GROUPS)) {
    p += groupNet(results, subjKeys) * (coef.perSubject[coefKey] || 0);
  }
  return round2(p);
}

// Tek puan türü için AYT ham puanı (TYT katkısı yok — bağımsız).
export function aytHam(results, turu, coef = DEFAULT_COEFFICIENTS.AYT) {
  const table = coef[turu];
  if (!table) return null;
  let p = coef.base;
  for (const [coefKey, katsayi] of Object.entries(table)) {
    const subjKeys = AYT_COEF_GROUPS[coefKey] || [coefKey];
    p += groupNet(results, subjKeys) * katsayi;
  }
  return round2(p);
}

// Üç türü birden: { SAY, EA, SOZ }.
export function aytPuanlari(results, coef = DEFAULT_COEFFICIENTS.AYT) {
  const out = {};
  for (const turu of Object.keys(AYT_PUAN_TURU)) {
    out[turu] = aytHam(results, turu, coef);
  }
  return out;
}

// TYT+AYT birleştirme (OGM Materyal dinamik): yerleştirme = 0.4×TYT + 0.6×AYTham.
export function mergeYks(tytP, aytHamP, merge = DEFAULT_COEFFICIENTS.merge) {
  if (tytP == null || aytHamP == null) return null;
  return round2(merge.tytWeight * tytP + merge.aytWeight * aytHamP);
}

// LGS ağırlıklı net (kurum-içi sıralama; resmi standart-puan ertelendi).
export function lgsAgirlikliNet(results, weights = LGS_WEIGHTS) {
  let sum = 0;
  for (const [key, w] of Object.entries(weights)) {
    sum += (results?.[key]?.net || 0) * w;
  }
  return round2(sum);
}

// Toplam net (alternatif çift YOK — mockup Sosyal 20). Tüm ders netleri toplamı.
export function toplamNet(results) {
  let sum = 0;
  for (const r of Object.values(results || {})) sum += r?.net || 0;
  return round2(sum);
}
