import { describe, it, expect } from 'vitest';
import {
  TEMPLATES, getTemplate, boxLength, flatSubjects,
  normalizeRaw, sliceBox, sliceFlat, sliceExam, validateBoxes,
} from './template.js';
import { TYT_COEF_GROUPS, AYT_COEF_GROUPS, LGS_WEIGHTS } from './coefficients.js';

// Şablon değişmezleri: kutudaki ders sırası/sayısı kayarsa netler SESSİZCE yanlış
// derse gider (template.js'deki uyarı). Bu testler o kaymayı gürültüye çevirir.

describe('şablon bütünlüğü (soru sayıları)', () => {
  it.each([
    ['TYT', 125],
    ['AYT', 160],
    ['LGS', 90],
  ])('%s: flatSubjects toplamı = totalQuestions (%i)', (type, total) => {
    const sum = flatSubjects(type).reduce((n, s) => n + s.count, 0);
    expect(sum).toBe(total);
    expect(getTemplate(type).totalQuestions).toBe(total);
  });

  it('her kutunun uzunluğu ders sayılarının toplamı', () => {
    for (const t of Object.values(TEMPLATES)) {
      for (const box of t.boxes) {
        expect(boxLength(box)).toBe(box.subjects.reduce((n, s) => n + s.count, 0));
      }
    }
  });

  it('LGS yanlış bölücüsü 3, YKS 4', () => {
    expect(getTemplate('LGS').wrongDivisor).toBe(3);
    expect(getTemplate('TYT').wrongDivisor).toBe(4);
    expect(getTemplate('AYT').wrongDivisor).toBe(4);
  });
});

describe('katsayı grupları şablonu tam kapsar (yeni ders sessizce puansız kalamaz)', () => {
  it('TYT: her ders tam bir katsayı grubunda', () => {
    const inGroups = Object.values(TYT_COEF_GROUPS).flat().sort();
    const inTemplate = flatSubjects('TYT').map((s) => s.key).sort();
    expect(inGroups).toEqual(inTemplate);
  });

  it('AYT: her ders tam bir katsayı grubunda', () => {
    const inGroups = Object.values(AYT_COEF_GROUPS).flat().sort();
    const inTemplate = flatSubjects('AYT').map((s) => s.key).sort();
    expect(inGroups).toEqual(inTemplate);
  });

  it('LGS: ağırlık anahtarları şablon dersleriyle birebir', () => {
    const weighted = Object.keys(LGS_WEIGHTS).sort();
    const inTemplate = flatSubjects('LGS').map((s) => s.key).sort();
    expect(weighted).toEqual(inTemplate);
  });
});

describe('normalizeRaw', () => {
  it('A–E büyük harfe çevrilir, iptal (*) korunur, gerisi boş', () => {
    expect(normalizeRaw('abcde*')).toEqual(['A', 'B', 'C', 'D', 'E', '*']);
    expect(normalizeRaw('x1?F')).toEqual([' ', ' ', ' ', ' ']);
  });

  it('Türkçe i tuzağı: i → İ → I, şık değil → boş (kaza ile E/A olmaz)', () => {
    expect(normalizeRaw('i')).toEqual([' ']);
  });
});

describe('sliceBox / sliceExam', () => {
  const sosyal = getTemplate('TYT').boxes.find((b) => b.key === 'sosyal');

  it('ders sınırları doğru dilimlenir (TYT sosyal 5×5)', () => {
    const out = sliceBox(sosyal, 'AAAAABBBBBCCCCCDDDDDEEEEE');
    expect(out.tarih).toEqual(['A', 'A', 'A', 'A', 'A']);
    expect(out.cografya[0]).toBe('B');
    expect(out.felsefe[0]).toBe('C');
    expect(out.din[0]).toBe('D');
    expect(out.felsefe_secmeli).toEqual(['E', 'E', 'E', 'E', 'E']);
  });

  it('eksik string boşla tamamlanır, fazlası kırpılır', () => {
    const out = sliceBox(sosyal, 'AB');
    expect(out.tarih).toEqual(['A', 'B', ' ', ' ', ' ']);
    expect(out.felsefe_secmeli).toEqual([' ', ' ', ' ', ' ', ' ']);
    const uzun = sliceBox(sosyal, 'A'.repeat(99));
    expect(uzun.felsefe_secmeli).toEqual(['A', 'A', 'A', 'A', 'A']);
  });

  it('sliceExam: tüm dersler mevcut, eksik kutu tamamen boş', () => {
    const out = sliceExam('TYT', { turkce: 'A'.repeat(40) }); // diğer kutular yok
    expect(Object.keys(out).sort()).toEqual(flatSubjects('TYT').map((s) => s.key).sort());
    expect(out.turkce[39]).toBe('A');
    expect(out.matematik.every((c) => c === ' ')).toBe(true);
  });
});

describe('sliceFlat (optik/.dat düz dizisi)', () => {
  it('ders başlangıç indeksleri kitapçık sırasına oturur', () => {
    const flat = Array(125).fill(null);
    flat[0] = 'a';     // turkce 1. soru (küçük harf normalize)
    flat[64] = 'E';    // felsefe_secmeli son soru (40+25 = 65. soru)
    flat[65] = 'B';    // matematik 1. soru
    flat[124] = '*';   // biyoloji son soru, iptal işareti korunur
    const out = sliceFlat('TYT', flat);
    expect(out.turkce[0]).toBe('A');
    expect(out.felsefe_secmeli[4]).toBe('E');
    expect(out.matematik[0]).toBe('B');
    expect(out.biyoloji[5]).toBe('*');
    expect(out.turkce[1]).toBe(' '); // null → boş
  });

  it('dizi olmayan girdi → tamamen boş dersler (patlamaz)', () => {
    const out = sliceFlat('TYT', undefined);
    expect(out.turkce.length).toBe(40);
    expect(out.turkce.every((c) => c === ' ')).toBe(true);
  });
});

describe('validateBoxes (anahtar uzunluk denetimi)', () => {
  it('doğru uzunluklar geçer (boşluklar sayılmaz)', () => {
    const v = validateBoxes('TYT', {
      turkce: 'A'.repeat(40),
      sosyal: 'A'.repeat(10) + '  ' + 'A'.repeat(15), // 25 işaret + 2 boşluk
      matematik: 'A'.repeat(40),
      fen: 'A'.repeat(20),
    });
    expect(v.ok).toBe(true);
  });

  it('eksik kutu yakalanır (beklenen/gelen ile)', () => {
    const v = validateBoxes('TYT', {
      turkce: 'A'.repeat(39), // 1 eksik
      sosyal: 'A'.repeat(25),
      matematik: 'A'.repeat(40),
      fen: 'A'.repeat(20),
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual([expect.objectContaining({ box: 'turkce', expected: 40, got: 39 })]);
  });

  it('geçersiz sınav türü ok:false', () => {
    expect(validateBoxes('YDT', {}).ok).toBe(false);
  });
});
