// YKS puan katsayıları — PARAMETRİK (sınav/yıl bazında override edilebilir, sabit gömme yok).
//
// DEĞERLER: kamuya açık ÖSYM/YKS ağırlık katsayıları (TYT Türkçe/Mat 1.32, Sosyal/Fen 1.36;
// AYT SAY Mat 3.0 vb.). OGM Materyal de aynı lineer modeli kullanır.
// ⚠️ BİREBİR OGM puanı MÜMKÜN DEĞİL: ÖSYM her yıl gerçek katsayıları sınav SONRASI, ülke
// geneli başarıya göre yeniden dengeler (standardizasyon). Sınav öncesi hiçbir araç —OGM dahil—
// gerçek puanı veremez; hepsi bu sabit lineer modelle TAHMİN eder. Bizimki de tahmin.
// → Net ve sıralama KESİN (D−Y/4); puan YAKLAŞIK. Kurum-içi deneme sıralaması için yeterli.
// İnce ayar gerekirse: OGM'den birkaç örnek netle puanı karşılaştır, katsayıyı buradan düzelt.
//
// Formül lineer: puan = taban + Σ(dersGrubuNeti × katsayı).
// AYT'de geometri matematiğe dahildir (matematik grubu = matematik + geometri).

export type AytTuru = 'SAY' | 'EA' | 'SOZ';

// TYT katsayı keys → hangi şablon ders key'leri o gruba toplanır.
// Sosyal grubu 5 dersi de içerir; din ↔ felsefe_secmeli alternatif çiftinde
// NET'i düşük olan score.js'de (altExcluded) puana girmeden elenir.
export const TYT_COEF_GROUPS: Record<string, string[]> = {
  turkce: ['turkce'],
  sosyal: ['tarih', 'cografya', 'felsefe', 'din', 'felsefe_secmeli'],
  matematik: ['matematik', 'geometri'],
  fen: ['fizik', 'kimya', 'biyoloji'],
};

// AYT katsayı keys → şablon ders key'leri.
export const AYT_COEF_GROUPS: Record<string, string[]> = {
  matematik: ['matematik', 'geometri'],
  fizik: ['fizik'],
  kimya: ['kimya'],
  biyoloji: ['biyoloji'],
  edebiyat: ['edebiyat_1'],
  tarih_1: ['tarih_1'],
  cografya_1: ['cografya_1'],
  tarih_2: ['tarih_2'],
  cografya_2: ['cografya_2'],
  felsefe: ['felsefe'],
  din: ['din'],
};

export interface TytCoef {
  base: number;
  perSubject: Record<string, number>;
}

export interface AytCoef {
  base: number;
  SAY: Record<string, number>;
  EA: Record<string, number>;
  SOZ: Record<string, number>;
}

export interface MergeCoef {
  tytWeight: number;
  aytWeight: number;
}

export interface Coefficients {
  TYT: TytCoef;
  AYT: AytCoef;
  merge: MergeCoef;
}

export const DEFAULT_COEFFICIENTS: Coefficients = {
  TYT: {
    base: 100,
    perSubject: { turkce: 1.32, sosyal: 1.36, matematik: 1.32, fen: 1.36 },
  },

  AYT: {
    base: 100,
    // puan türü → { coefKey: katsayı }. Yalnız o türe giren dersler.
    SAY: { matematik: 3.0, fizik: 2.85, kimya: 3.07, biyoloji: 3.07 },
    EA: { matematik: 3.0, edebiyat: 3.0, tarih_1: 2.8, cografya_1: 3.33 },
    SOZ: {
      edebiyat: 3.0,
      tarih_1: 2.8,
      cografya_1: 2.91,
      tarih_2: 2.91,
      cografya_2: 2.91,
      felsefe: 3.0,
      din: 3.33,
    },
  },

  // TYT+AYT birleştirme (OGM Materyal dinamik mod): yerleştirme = 0.4×TYT + 0.6×AYT.
  // (OBP hariç — OBP ertelendi.) Okulizyon ise TYT'yi sabit katar; biz OGM Materyal'i
  // hedefliyoruz → dinamik. Kalibrasyonda teyit edilecek.
  merge: { tytWeight: 0.4, aytWeight: 0.6 },
};

// LGS ders ağırlıkları (ağırlıklı net, kurum-içi sıralama için).
// Türkçe/Matematik/Fen ×4; İnkılap/Din/Yabancı Dil ×1.
export const LGS_WEIGHTS: Record<string, number> = {
  turkce: 4,
  matematik: 4,
  fen: 4,
  inkilap: 1,
  din: 1,
  ingilizce: 1,
};
