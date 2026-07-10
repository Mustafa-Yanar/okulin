// Bir öğrenci satırını sınavın cevap anahtarına göre puanla.
// Veri girişi (optik/.dat) ve Faz 3 "Hesapla" ortak kullanır → tek doğruluk noktası.
// Çıktı mevcut `results` şekli ({ dersKey:{dogru,yanlis,bos,net} }) → alt akış aynen besler.

import { sliceFlat, sliceExam, getTemplate } from './template';
import { gradeExam, toplamNet } from './score';
import type { DenemeExam, Results } from './types';

// exam.answerKey[kitapcik] (boxesRaw) → { dersKey: anahtarDizisi }.
export function keyToSubjects(exam: DenemeExam, kitapcik = 'A'): Record<string, string[]> | null {
  const boxesRaw = exam?.answerKey?.[kitapcik] || exam?.answerKey?.A || null;
  if (!boxesRaw) return null;
  return sliceExam(exam.examType, boxesRaw);
}

// Bu sınav için seçili kitapçığın cevap anahtarı var mı?
export function hasAnswerKey(exam: DenemeExam, kitapcik = 'A'): boolean {
  const k = exam?.answerKey?.[kitapcik] || exam?.answerKey?.A;
  return !!k && Object.keys(k).length > 0;
}

// Düz cevap dizisini (optik/.dat) sınava göre puanla → { results, toplamNet }.
// Anahtar yoksa null döner (çağıran ham veriyi saklar, sonra Hesapla'da puanlanır).
export function gradeFlat(exam: DenemeExam, flatAnswers: (string | null)[], kitapcik = 'A'): { results: Results; toplamNet: number } | null {
  if (!getTemplate(exam.examType)) return null;
  const keyBySubject = keyToSubjects(exam, kitapcik);
  if (!keyBySubject) return null;
  const answersBySubject = sliceFlat(exam.examType, flatAnswers);
  const results = gradeExam(exam.examType, answersBySubject, keyBySubject);
  return { results, toplamNet: toplamNet(results, exam.examType) };
}
