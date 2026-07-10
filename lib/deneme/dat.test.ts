import { describe, it, expect } from 'vitest';
import { DAT_MAPS, datSupports, parseDat } from './dat';

// 222-krk Okulizyon optik şablonuna uygun sentetik satır üreticileri.
// Kolon yerleşimi DAT_MAPS ile birebir: meta [3:54], ayraç 54, kitapçık 55,
// TYT blokları [56,+65] ve [142,+60]; AYT [56,+80] ve [142,+80].

function lineTYT({ no = '1234', name = 'AHMET YILMAZ', cls = '12A', booklet = 'A', block1 = '', block2 = '' } = {}) {
  const meta = `${no}  ${name}  ${cls}`.padEnd(51).slice(0, 51);
  return (
    '   ' + meta + ' ' + booklet +
    block1.padEnd(65).slice(0, 65) +
    ' '.repeat(21) +
    block2.padEnd(60).slice(0, 60)
  ).padEnd(222);
}

function lineAYT({ no = '5678', name = 'AYŞE KAYA', cls = '12B', booklet = 'B', block1 = '', block2 = '' } = {}) {
  const meta = `${no}  ${name}  ${cls}`.padEnd(51).slice(0, 51);
  return (
    '   ' + meta + ' ' + booklet +
    block1.padEnd(80).slice(0, 80) +
    ' '.repeat(6) +
    block2.padEnd(80).slice(0, 80)
  ).padEnd(222);
}

describe('datSupports', () => {
  it('TYT/AYT var, LGS yok', () => {
    expect(datSupports('TYT')).toBe(true);
    expect(datSupports('AYT')).toBe(true);
    expect(datSupports('LGS')).toBe(false);
  });

  it('desteklenmeyen tür parseDat ok:false', () => {
    expect(parseDat('xx', 'LGS').ok).toBe(false);
  });
});

describe('parseDat TYT (222 kolon)', () => {
  it('tam dolu satır: 125 cevap, blok sırası ve sınırları doğru', () => {
    const text = lineTYT({ block1: 'A'.repeat(65), block2: 'B'.repeat(60) });
    const r = parseDat(text, 'TYT');
    expect(r.ok).toBe(true);
    expect(r.total).toBe(125);
    expect(r.students).toHaveLength(1);
    const s = r.students[0];
    expect(s.answers).toHaveLength(125);
    expect(s.answers.slice(0, 65).every((c) => c === 'A')).toBe(true);  // sol blok
    expect(s.answers.slice(65).every((c) => c === 'B')).toBe(true);     // sağ blok
    expect(s.answered).toBe(125);
    expect(s.kitapcik).toBe('A');
  });

  it('isim meta bölgesinden seçilir: numara/sınıf kodu ismi ezmez', () => {
    const text = lineTYT({ no: '20394', name: 'ÇİĞDEM ŞÜKRÜOĞLU', cls: '12S' });
    const s = parseDat(text, 'TYT').students[0];
    expect(s.name).toBe('ÇİĞDEM ŞÜKRÜOĞLU');
  });

  it('meta bölgesi boşsa İsimsiz', () => {
    const text = lineTYT({ no: '', name: '', cls: '' });
    expect(parseDat(text, 'TYT').students[0].name).toBe('İsimsiz');
  });

  it('kitapçık: B → B; b → B; başka/boş karakter → A varsayılan', () => {
    expect(parseDat(lineTYT({ booklet: 'B' }), 'TYT').students[0].kitapcik).toBe('B');
    expect(parseDat(lineTYT({ booklet: 'b' }), 'TYT').students[0].kitapcik).toBe('B');
    expect(parseDat(lineTYT({ booklet: 'X' }), 'TYT').students[0].kitapcik).toBe('A');
    expect(parseDat(lineTYT({ booklet: ' ' }), 'TYT').students[0].kitapcik).toBe('A');
  });

  it('hücre sınıflandırma: küçük harf → büyük, * korunur, geçersiz/boş → null', () => {
    const text = lineTYT({ block1: 'aB*7 C' }); // 6 işaretli bölge, gerisi boş
    const s = parseDat(text, 'TYT').students[0];
    expect(s.answers.slice(0, 6)).toEqual(['A', 'B', '*', null, null, 'C']);
    expect(s.answered).toBe(3); // *, null sayılmaz
  });

  it('CRLF ve CR satır sonları; null-byte/boş satırlar atlanır', () => {
    const text = lineTYT({ name: 'ALI BIR' }) + '\r\n' + '\x00\x00' + '\r' + lineTYT({ name: 'VELI IKI' }) + '\n\n';
    const r = parseDat(text, 'TYT');
    expect(r.students.map((s) => s.name)).toEqual(['ALI BIR', 'VELI IKI']);
  });

  it('boş dosya ok:false', () => {
    expect(parseDat('', 'TYT').ok).toBe(false);
    expect(parseDat('\n\x00\n  \n', 'TYT').ok).toBe(false);
  });
});

describe('parseDat AYT (blok başlangıçları)', () => {
  it('160 cevap; sağ blok 81. sorudan başlar (col 142)', () => {
    const text = lineAYT({ block1: 'C'.repeat(80), block2: 'E'.repeat(80) });
    const r = parseDat(text, 'AYT');
    expect(r.ok).toBe(true);
    expect(r.total).toBe(160);
    const s = r.students[0];
    expect(s.answers).toHaveLength(160);
    expect(s.answers[79]).toBe('C');  // sol blok sonu
    expect(s.answers[80]).toBe('E');  // sağ blok başı
    expect(s.kitapcik).toBe('B');
  });
});

describe('uyarılar (yanlış şablon/tür yakalama)', () => {
  it('satırların çoğu 222 değilse şablon uyarısı', () => {
    const short = 'X'.repeat(100);
    const r = parseDat(short + '\n' + short, 'TYT');
    expect(r.ok).toBe(true); // yine de ayrıştırır
    expect(r.warnings.some((w) => w.includes('222'))).toBe(true);
  });

  it('öğrencilerin çoğu %25 altı işaretliyse tür uyarısı', () => {
    const az = lineTYT({ block1: 'A'.repeat(10) }); // 10/125
    const r = parseDat(az + '\n' + az, 'TYT');
    expect(r.warnings.some((w) => w.includes('Sınav türü'))).toBe(true);
  });

  it('dolu dosyada uyarı yok', () => {
    const text = lineTYT({ block1: 'A'.repeat(65), block2: 'B'.repeat(60) });
    expect(parseDat(text, 'TYT').warnings).toEqual([]);
  });
});

describe('DAT_MAPS değişmezleri', () => {
  it('blok uzunlukları toplamı = toplam soru', () => {
    for (const [type, map] of Object.entries(DAT_MAPS)) {
      const sum = map.blocks.reduce((n, [, len]) => n + len, 0);
      expect(sum, `${type} blok toplamı`).toBe(map.total);
    }
  });

  it('bloklar satır sınırı içinde', () => {
    for (const map of Object.values(DAT_MAPS)) {
      for (const [start, len] of map.blocks) {
        expect(start + len).toBeLessThanOrEqual(map.lineLen);
      }
    }
  });
});
