// Saf puanlama çekirdeği. UI/Redis bağımsız, test edilebilir.
// Girdi: ders→cevap dizisi + ders→anahtar dizisi. Çıktı: mevcut `results` şekli
// ({ dersKey: {dogru,yanlis,bos,net} }) → DenemeAnaliz/NetChart aynen besler.

import { getTemplate, BLANK_CHARS, CANCEL_CHAR, AYT_PUAN_TURU } from './template';
import {
  DEFAULT_COEFFICIENTS,
  TYT_COEF_GROUPS,
  AYT_COEF_GROUPS,
  LGS_WEIGHTS,
  type AytCoef,
  type AytTuru,
  type Coefficients,
  type MergeCoef,
  type TytCoef,
} from './coefficients';
import type { Results, ResultsLike, SubjectResult } from './types';

const BLANKS = new Set(BLANK_CHARS);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Tek soru: 'dogru' | 'yanlis' | 'bos' | 'iptal'
export function gradeOne(answer: unknown, key: unknown): 'dogru' | 'yanlis' | 'bos' | 'iptal' {
  const k = String(key ?? '').toLocaleUpperCase('tr');
  if (k === CANCEL_CHAR || k === '') return 'iptal';
  const a = String(answer ?? '').toLocaleUpperCase('tr');
  if (BLANKS.has(a)) return 'bos';
  return a === k ? 'dogru' : 'yanlis';
}

// Bir ders: cevap dizisi + anahtar dizisi → { dogru, yanlis, bos, net }.
// İptal soru hiçbir sayıma girmez (kimse için doğru/yanlış değil).
export function gradeSubject(answers: (string | null)[] | null | undefined, key: string[], wrongDivisor = 4): SubjectResult {
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
export function gradeExam(
  examType: string,
  answersBySubject: Record<string, (string | null)[]> | null | undefined,
  keyBySubject: Record<string, string[]> | null | undefined,
): Results {
  const t = getTemplate(examType);
  if (!t) return {};
  const wd = t.wrongDivisor || 4;
  const results: Results = {};
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

// Alternatif çiftte (TYT: din 16-20 ↔ felsefe seçmeli 21-25) öğrenci ikisini de
// çözebilir; NET'i DÜŞÜK olan toplama/puana GİRMEZ. Dışlanacak ders key'lerinin
// Set'ini döndür (yoksa null). Eşit netse ikinci ders dışlanır.
function altExcluded(results: ResultsLike | null | undefined, examType: string): Set<string> | null {
  const pairs = getTemplate(examType)?.alternativePairs;
  if (!pairs?.length) return null;
  const excl = new Set<string>();
  for (const [a, b] of pairs) {
    const na = results?.[a]?.net || 0;
    const nb = results?.[b]?.net || 0;
    excl.add(nb > na ? a : b);
  }
  return excl;
}

// Bir ders grubunun toplam neti (excl Set'indeki dersler atlanır).
function groupNet(results: ResultsLike | null | undefined, keys: string[], excl?: Set<string> | null): number {
  let sum = 0;
  for (const k of keys) {
    if (excl?.has(k)) continue;
    sum += results?.[k]?.net || 0;
  }
  return sum;
}

// ---- Puan hesapları (parametrik katsayı) ----

export function tytPuan(results: ResultsLike, coef: TytCoef = DEFAULT_COEFFICIENTS.TYT, examType = 'TYT'): number {
  const excl = altExcluded(results, examType);
  let p = coef.base;
  for (const [coefKey, subjKeys] of Object.entries(TYT_COEF_GROUPS)) {
    p += groupNet(results, subjKeys, excl) * (coef.perSubject[coefKey] || 0);
  }
  return round2(p);
}

// Tek puan türü için AYT ham puanı (TYT katkısı yok — bağımsız).
export function aytHam(results: ResultsLike, turu: string, coef: AytCoef = DEFAULT_COEFFICIENTS.AYT): number | null {
  // bilinmeyen tür → undefined → null (eski davranış)
  const table: Record<string, number> | undefined = coef[turu as AytTuru];
  if (!table) return null;
  let p = coef.base;
  for (const [coefKey, katsayi] of Object.entries(table)) {
    const subjKeys = AYT_COEF_GROUPS[coefKey] || [coefKey];
    p += groupNet(results, subjKeys) * katsayi;
  }
  return round2(p);
}

// Üç türü birden: { SAY, EA, SOZ }.
export function aytPuanlari(results: ResultsLike, coef: AytCoef = DEFAULT_COEFFICIENTS.AYT): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const turu of Object.keys(AYT_PUAN_TURU) as AytTuru[]) {
    out[turu] = aytHam(results, turu, coef);
  }
  return out;
}

// TYT+AYT birleştirme (OGM Materyal dinamik): yerleştirme = 0.4×TYT + 0.6×AYTham.
export function mergeYks(tytP: number | null | undefined, aytHamP: number | null | undefined, merge: MergeCoef = DEFAULT_COEFFICIENTS.merge): number | null {
  if (tytP == null || aytHamP == null) return null;
  return round2(merge.tytWeight * tytP + merge.aytWeight * aytHamP);
}

// LGS ağırlıklı net (kurum-içi sıralama; resmi standart-puan ertelendi).
export function lgsAgirlikliNet(results: ResultsLike, weights: Record<string, number> = LGS_WEIGHTS): number {
  let sum = 0;
  for (const [key, w] of Object.entries(weights)) {
    sum += (results?.[key]?.net || 0) * w;
  }
  return round2(sum);
}

// Toplam net. examType verilirse alternatif çiftin düşük neti hariç tutulur
// (TYT Sosyal: din ↔ felsefe seçmeli). Verilmezse tüm ders netleri toplanır.
export function toplamNet(results: ResultsLike | null | undefined, examType?: string): number {
  const excl = examType ? altExcluded(results, examType) : null;
  let sum = 0;
  for (const [k, r] of Object.entries(results || {})) {
    if (excl?.has(k)) continue;
    sum += r?.net || 0;
  }
  return round2(sum);
}

// Sınav türüne göre tüm puanları üret. TYT → {TYT}; AYT → {SAY,EA,SOZ}; LGS → {LGS}.
// coef: DEFAULT_COEFFICIENTS biçiminde (sınav bazlı override edilebilir).
export function computePuanlar(examType: string, results: ResultsLike, coef: Coefficients = DEFAULT_COEFFICIENTS): Record<string, number | null> {
  if (examType === 'TYT') return { TYT: tytPuan(results, coef.TYT, examType) };
  if (examType === 'AYT') return aytPuanlari(results, coef.AYT);
  if (examType === 'LGS') return { LGS: lgsAgirlikliNet(results) };
  return {};
}
