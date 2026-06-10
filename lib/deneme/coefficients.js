// YKS puan katsayıları — PARAMETRİK (sınav/yıl bazında override edilebilir, sabit gömme yok).
//
// ⚠️ AŞAĞIDAKİ DEĞERLER GEÇİCİDİR (placeholder). Hedef: OGM Materyal (EBA) ile BİREBİR.
// Kesin katsayılar https://ogmmateryal.eba.gov.tr/yks-puan-hesaplama üzerinde lineer probla
// çıkarılacak (tüm-netler-0 → taban; tek ders net=10, gerisi 0 → katsayı=(puan−taban)/10).
// Web kotası açılınca yapılacak; sonuç buraya parametre olarak girer. O zamana kadar
// kamuya açık yaklaşık değerlerle çalışır (motor doğru, sayı yaklaşık).
//
// Formül lineer: puan = taban + Σ(dersGrubuNeti × katsayı).
// AYT'de geometri matematiğe dahildir (matematik grubu = matematik + geometri).

// TYT katsayı keys → hangi şablon ders key'leri o gruba toplanır.
export const TYT_COEF_GROUPS = {
  turkce: ['turkce'],
  sosyal: ['tarih', 'cografya', 'din', 'felsefe'],
  matematik: ['matematik', 'geometri'],
  fen: ['fizik', 'kimya', 'biyoloji'],
};

// AYT katsayı keys → şablon ders key'leri.
export const AYT_COEF_GROUPS = {
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

export const DEFAULT_COEFFICIENTS = {
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
export const LGS_WEIGHTS = {
  turkce: 4,
  matematik: 4,
  fen: 4,
  inkilap: 1,
  din: 1,
  ingilizce: 1,
};
