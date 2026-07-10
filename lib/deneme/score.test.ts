import { describe, it, expect } from 'vitest';
import {
  gradeOne, gradeSubject, gradeExam,
  tytPuan, aytHam, aytPuanlari, mergeYks, lgsAgirlikliNet,
  toplamNet, computePuanlar,
} from './score';
import { sliceExam, sliceFlat, flatSubjects } from './template';

// Golden-case testler: öğrenciye/veliye gösterilen net ve puanı kilitler.
// Beklenen değerler eldeki lineer modelden ELLE hesaplandı (katsayılar
// coefficients.js). Katsayı/şablon değişirse bu testler bilinçli güncellenir —
// sessiz kayma yakalamak tam olarak amaç.

describe('gradeOne (tek soru sınıflandırma)', () => {
  it('doğru / yanlış / boş ayrımı', () => {
    expect(gradeOne('A', 'A')).toBe('dogru');
    expect(gradeOne('C', 'A')).toBe('yanlis');
    expect(gradeOne('', 'A')).toBe('bos');
    expect(gradeOne(' ', 'A')).toBe('bos');
    expect(gradeOne(undefined, 'A')).toBe('bos');
  });

  it('tüm boş karakterleri tanır (- . _)', () => {
    expect(gradeOne('-', 'A')).toBe('bos');
    expect(gradeOne('.', 'A')).toBe('bos');
    expect(gradeOne('_', 'A')).toBe('bos');
  });

  it('küçük harf cevap/anahtar eşleşir (tr upper)', () => {
    expect(gradeOne('b', 'B')).toBe('dogru');
    expect(gradeOne('B', 'b')).toBe('dogru');
  });

  it('iptal: anahtar * veya boşsa cevaptan bağımsız iptal', () => {
    expect(gradeOne('A', '*')).toBe('iptal');
    expect(gradeOne('A', '')).toBe('iptal');
    expect(gradeOne('A', undefined)).toBe('iptal');
  });
});

describe('gradeSubject (ders neti)', () => {
  it('YKS: net = D − Y/4 (30D 8Y 2B → 28)', () => {
    const key = Array(40).fill('A');
    const answers = [...Array(30).fill('A'), ...Array(8).fill('B'), '', ''];
    expect(gradeSubject(answers, key)).toEqual({ dogru: 30, yanlis: 8, bos: 2, net: 28 });
  });

  it('çeyrek hassasiyet: 10D 3Y → 9.25', () => {
    const key = Array(13).fill('A');
    const answers = [...Array(10).fill('A'), 'B', 'B', 'B'];
    expect(gradeSubject(answers, key).net).toBe(9.25);
  });

  it('LGS bölücüsü: D − Y/3 (10D 6Y → 8)', () => {
    const key = Array(16).fill('A');
    const answers = [...Array(10).fill('A'), ...Array(6).fill('C')];
    expect(gradeSubject(answers, key, 3).net).toBe(8);
  });

  it('iptal soru hiçbir sayıma girmez', () => {
    // 3 soru: 1 normal doğru, 1 iptal (öğrenci yanlış işaretlemiş olsa da), 1 normal doğru
    expect(gradeSubject(['A', 'C', 'B'], ['A', '*', 'B'])).toEqual({ dogru: 2, yanlis: 0, bos: 0, net: 2 });
  });

  it('eksik cevap kuyruğu boş sayılır, fazlası anahtara göre kırpılır', () => {
    const key = ['A', 'A', 'A', 'A'];
    expect(gradeSubject(['A'], key)).toEqual({ dogru: 1, yanlis: 0, bos: 3, net: 1 });
    expect(gradeSubject(['A', 'A', 'A', 'A', 'B', 'B'], key).yanlis).toBe(0); // 5-6. soru yok
  });
});

// ─── TYT uçtan uca golden case ──────────────────────────────────────────────
// Kutu string'leri → sliceExam → gradeExam → puan. Optik/manuel girişin
// izlediği gerçek yol. Beklenen netler elle: turkce 28, tarih 5, cografya 2.5,
// felsefe 0, din 2, felsefe_secmeli 3.75, mat 19, geo 7, fizik 4.5, kimya 6, biyo 3.5.

const TYT_KEY = {
  turkce: 'A'.repeat(40),
  sosyal: 'B'.repeat(5) + 'C'.repeat(5) + 'D'.repeat(5) + 'E'.repeat(5) + 'A'.repeat(5),
  matematik: 'B'.repeat(30) + 'C'.repeat(10),
  fen: 'D'.repeat(7) + 'E'.repeat(7) + 'A'.repeat(6),
};
const TYT_STUDENT = {
  turkce: 'A'.repeat(30) + 'B'.repeat(8) + '  ',
  sosyal: 'BBBBB' + 'CCCAA' + '     ' + 'EE   ' + 'AAAAB',
  matematik: 'B'.repeat(20) + 'A'.repeat(4) + ' '.repeat(6) + 'C'.repeat(7) + '   ',
  fen: 'DDDDDAA' + 'EEEEEE ' + 'AAAABB',
};

function tytResults() {
  return gradeExam('TYT', sliceExam('TYT', TYT_STUDENT), sliceExam('TYT', TYT_KEY));
}

describe('TYT uçtan uca (sliceExam → gradeExam → puan)', () => {
  it('ders netleri birebir', () => {
    const r = tytResults();
    expect(r.turkce).toEqual({ dogru: 30, yanlis: 8, bos: 2, net: 28 });
    expect(r.tarih.net).toBe(5);
    expect(r.cografya).toEqual({ dogru: 3, yanlis: 2, bos: 0, net: 2.5 });
    expect(r.felsefe).toEqual({ dogru: 0, yanlis: 0, bos: 5, net: 0 });
    expect(r.din.net).toBe(2);
    expect(r.felsefe_secmeli.net).toBe(3.75);
    expect(r.matematik).toEqual({ dogru: 20, yanlis: 4, bos: 6, net: 19 });
    expect(r.geometri.net).toBe(7);
    expect(r.fizik.net).toBe(4.5);
    expect(r.kimya.net).toBe(6);
    expect(r.biyoloji.net).toBe(3.5);
  });

  it('toplam net: alternatif çiftte düşük olan (din 2 < seçmeli 3.75) dışlanır', () => {
    const r = tytResults();
    expect(toplamNet(r, 'TYT')).toBe(79.25); // din hariç
    expect(toplamNet(r)).toBe(81.25);        // examType yoksa hepsi toplanır
  });

  it('TYT puanı: 100 + 28×1.32 + 11.25×1.36 + 26×1.32 + 14×1.36 = 205.62', () => {
    expect(tytPuan(tytResults())).toBe(205.62);
    expect(computePuanlar('TYT', tytResults())).toEqual({ TYT: 205.62 });
  });

  it('tamamı doğru TYT → 260 (sosyalde alternatif çiftin teki sayılır)', () => {
    const full = gradeExam('TYT', sliceExam('TYT', TYT_KEY), sliceExam('TYT', TYT_KEY));
    expect(toplamNet(full, 'TYT')).toBe(120); // 125 soru − 5 alternatif
    expect(tytPuan(full)).toBe(260);
  });
});

describe('alternatif çift (din ↔ felsefe seçmeli) dışlama kuralı', () => {
  const base = {
    turkce: { net: 0 }, tarih: { net: 0 }, cografya: { net: 0 }, felsefe: { net: 0 },
    matematik: { net: 0 }, geometri: { net: 0 }, fizik: { net: 0 }, kimya: { net: 0 }, biyoloji: { net: 0 },
  };

  it('net yüksek olan puana girer', () => {
    const r = { ...base, din: { net: 2 }, felsefe_secmeli: { net: 5 } };
    expect(tytPuan(r)).toBe(round2(100 + 5 * 1.36)); // 106.8
  });

  it('eşit nette ikinci ders (seçmeli) dışlanır — çift sayım yok', () => {
    const r = { ...base, din: { net: 5 }, felsefe_secmeli: { net: 5 } };
    expect(tytPuan(r)).toBe(106.8); // 5×1.36, 10×1.36 DEĞİL
  });
});

function round2(n: number) { return Math.round(n * 100) / 100; }

// ─── AYT golden ─────────────────────────────────────────────────────────────

describe('AYT puanları', () => {
  it('tamamı doğru (sliceFlat ile uçtan uca): SAY 339.72, EA 339.98, SÖZ 337.46', () => {
    // Düz anahtar: flatSubjects sırasında her derse tek harf
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const flat: string[] = [];
    flatSubjects('AYT').forEach((s, si) => {
      for (let i = 0; i < s.count; i++) flat.push(letters[si % 5]);
    });
    expect(flat.length).toBe(160);
    const sliced = sliceFlat('AYT', flat);
    const r = gradeExam('AYT', sliced, sliced);
    expect(toplamNet(r)).toBe(160);
    expect(aytPuanlari(r)).toEqual({ SAY: 339.72, EA: 339.98, SOZ: 337.46 });
  });

  it('sayısalcı kısmi giriş: çözmediği dersler 0 katkı, 3 tür de hesaplanır', () => {
    const r = {
      matematik: { net: 25 }, geometri: { net: 8 },
      fizik: { net: 10 }, kimya: { net: 10 }, biyoloji: { net: 10 },
    };
    // SAY = 100 + 33×3.0 + 10×2.85 + 10×3.07 + 10×3.07 = 288.9
    expect(aytHam(r, 'SAY')).toBe(288.9);
    // EA = 100 + 33×3.0 (edebiyat/tarih/coğrafya çözmemiş) = 199
    expect(aytHam(r, 'EA')).toBe(199);
    expect(aytHam(r, 'SOZ')).toBe(100); // hiçbir SÖZ dersi yok → taban
    expect(computePuanlar('AYT', r)).toEqual({ SAY: 288.9, EA: 199, SOZ: 100 });
  });

  it('geometri matematik grubuna dahil (ayrı katsayı değil)', () => {
    const sadeceGeo = { geometri: { net: 10 } };
    expect(aytHam(sadeceGeo, 'SAY')).toBe(130); // 100 + 10×3.0
  });

  it('bilinmeyen puan türü → null', () => {
    expect(aytHam({}, 'DIL')).toBeNull();
  });
});

describe('mergeYks (TYT+AYT yerleştirme: 0.4×TYT + 0.6×AYT)', () => {
  it('golden: 300 TYT + 350 AYT → 330', () => {
    expect(mergeYks(300, 350)).toBe(330);
  });
  it('taraflardan biri yoksa null (yarım veri puan üretmez)', () => {
    expect(mergeYks(null, 350)).toBeNull();
    expect(mergeYks(300, null)).toBeNull();
  });
});

describe('LGS', () => {
  it('ağırlıklı net: (T+M+F)×4 + (İnk+Din+İng)×1', () => {
    const r = {
      turkce: { net: 15 }, matematik: { net: 12 }, fen: { net: 10 },
      inkilap: { net: 8 }, din: { net: 9 }, ingilizce: { net: 7 },
    };
    expect(lgsAgirlikliNet(r)).toBe(172); // 37×4 + 24
    expect(computePuanlar('LGS', r)).toEqual({ LGS: 172 });
  });

  it('eksik ders 0 katkı', () => {
    expect(lgsAgirlikliNet({ matematik: { net: 10 } })).toBe(40);
  });
});

describe('computePuanlar / toplamNet kenarları', () => {
  it('bilinmeyen sınav türü → boş obje', () => {
    expect(computePuanlar('YDT', {})).toEqual({});
    expect(gradeExam('YDT', {}, {})).toEqual({});
  });

  it('toplamNet float artıklarını 2 haneye yuvarlar', () => {
    expect(toplamNet({ a: { net: 1.1 }, b: { net: 2.2 } })).toBe(3.3);
  });
});
