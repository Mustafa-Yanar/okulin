// Öğrenci paneli saf yardımcıları — rehberlik ders listesi + grup etiketleri.
import type { ClassRecord } from '@/lib/classes';
import type { CourseRecord } from '@/lib/courses';

// Sınıfın YAPILANDIRILMIŞ ders listesini (registry: class.dersler → ders adı) tercih eder;
// kayıt yoksa (kayıtsız kurum / eski sayısal kod) guidanceSubjectsFor kod-parse'ına düşer.
// Özel şubelerde cls = s_UUID → eski kod parseInt→NaN ile BOŞ dönüyordu (rehberlik/konu
// takibi boş görünüyordu); bu, sınıfın gerçek derslerini kullanarak sorunu çözer.
export function subjectsForClass(
  cls: string | undefined,
  classes: ClassRecord[] | undefined,
  courses: CourseRecord[] | undefined,
): string[] {
  if (cls && classes && classes.length) {
    const rec = classes.find((c) => c.id === cls);
    if (rec && rec.dersler && rec.dersler.length) {
      return rec.dersler.map((key) => (courses || []).find((x) => x.key === key)?.ad || key);
    }
  }
  return guidanceSubjectsFor(cls);
}

// Rehberlik ders listesi seçimi (ESKİ sayısal sınıf kodu fallback'i — registry yoksa)
export function guidanceSubjectsFor(cls: string | undefined): string[] {
  if (!cls) return [];
  if (cls.startsWith('7')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'];
  }
  if (cls.startsWith('8')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'];
  }
  let isSayisal = false;
  let isEA = false;
  let grade = 0;
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    isSayisal = n <= 5;
    isEA = n > 5;
    grade = 12;
  } else {
    grade = Math.floor(parseInt(cls) / 100);
    const sec = parseInt(cls.slice(1));
    if (grade === 3) { isSayisal = sec <= 3; isEA = sec > 3; }
    if (grade === 4) { isSayisal = sec <= 5; isEA = sec > 5; }
  }
  if (grade === 1 || grade === 2) {
    return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (grade === 3) {
    if (isSayisal) return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji'];
    return ['Türkçe', 'Matematik', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (isSayisal) {
    return [
      'Türkçe',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik', 'AYT Fizik',
      'TYT Kimya', 'AYT Kimya',
      'TYT Biyoloji', 'AYT Biyoloji',
      'TYT Tarih',
      'TYT Coğrafya',
      'TYT Felsefe',
      'Din Kültürü',
    ];
  }
  if (isEA) {
    return [
      'Türkçe', 'Edebiyat',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik',
      'TYT Kimya',
      'TYT Biyoloji',
      'TYT Tarih', 'AYT Tarih',
      'TYT Coğrafya', 'AYT Coğrafya',
      'TYT Felsefe', 'AYT Felsefe',
      'Din Kültürü',
    ];
  }
  return [];
}

export const GROUPS: Record<string, string> = { ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };
