// Optik okuyucu `.dat` ayrıştırıcı (cp1254 / windows-1254 sabit genişlik).
// Tarayıcıda çalışır: bileşen dosyayı TextDecoder('windows-1254') ile metne çevirip
// parseDat(text, examType) çağırır → { students:[{name,kitapcik,answers}], warnings }.
// Çıktı düz cevap dizisi (flatSubjects sırası) → /api/deneme/exams/[id]/rows ile aynı.
//
// ⚠️ Kolon haritaları GERÇEK dosyalarla ampirik doğrulandı (345.dat 87 öğr, 345-AYT.dat
// 81 öğr + orijinal/merkez/BİLGİ SARMAL/TOPRAK ile çapraz). 222-krk Okulizyon optik şablonu:
//   col 54 = boş ayraç, col 55 = kitapçık (A/B), isim meta [3:54].
//   TYT (125): sol [56:121] (Türkçe40+Sosyal25) + sağ [142:202] (Mat30+Geo10+Fiz7+Kim7+Biy6).
//   AYT (160): sol [56:136] (Edeb-Sos1 40 + Sos2 40) + sağ [142:222] (Mat40+Fen40).
// Bloklar peş peşe birleşince flatSubjects sırasını birebir verir (template.js).
// ⚠️ TYT sol blok 60→65 oldu (Sosyal 20→25, din+felsefe seçmeli alternatifi). Sağ blok
//   (Mat+Fen) col 142'de sabit → mat/fen netleri bu değişiklikten ETKİLENMEZ. Yalnız sosyal
//   alt-kırılımı (din/felsefe seçmeli) gerçek .dat ile test sırasında doğrulanmalı.
// LGS/ortaokul .dat şablonu HENÜZ yok (farklı satır uzunlukları) → Faz 4.

export interface DatMap {
  lineLen: number;
  bookletCol: number;
  nameRange: [number, number];
  blocks: [number, number][];
  total: number;
}

// Kolon haritası = veri (sabit gömme mantık yerine tablo). Yeni şablon = yeni kayıt.
export const DAT_MAPS: Record<string, DatMap> = {
  TYT: {
    lineLen: 222,
    bookletCol: 55,
    nameRange: [3, 54],
    // [başlangıç, uzunluk] — peş peşe birleşir
    blocks: [
      [56, 65],
      [142, 60],
    ],
    total: 125,
  },
  AYT: {
    lineLen: 222,
    bookletCol: 55,
    nameRange: [3, 54],
    blocks: [
      [56, 80],
      [142, 80],
    ],
    total: 160,
  },
};

export interface DatStudent {
  name: string;
  kitapcik: string;
  answers: (string | null)[];
  answered: number;
}

export interface ParseDatResult {
  ok: boolean;
  error?: string;
  students: DatStudent[];
  warnings: string[];
  total: number;
}

export function datSupports(examType: string): boolean {
  return !!DAT_MAPS[examType];
}

function splitLines(text: unknown): string[] {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.replace(/\x00/g, '').trim() !== '');
}

function letterCount(s: string): number {
  return (s.match(/[A-Za-zÇĞİıÖŞÜçğöşü]/g) || []).length;
}

// İsim = meta bölgesindeki (2+ boşlukla ayrılmış) en çok harf içeren parça.
// Böylece sayısal öğrenci no / sınıf kodu (ör. "12S", "3 M") ismi ezmez.
function extractName(line: string, [a, b]: [number, number]): string {
  const meta = line.slice(a, b);
  const runs = meta
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!runs.length) return '';
  runs.sort((x, y) => letterCount(y) - letterCount(x));
  return runs[0];
}

function bookletAt(line: string, col: number): string {
  const ch = (col < line.length ? line[col] : ' ').toUpperCase();
  return ch === 'B' ? 'B' : 'A'; // varsayılan A
}

// Tek hücre: 'A'..'E' ya da null (boş/işaretsiz). İptal işareti '*' korunur.
function cellAt(line: string, i: number): string | null {
  const ch = i < line.length ? line[i] : ' ';
  const u = ch.toUpperCase();
  if (u === 'A' || u === 'B' || u === 'C' || u === 'D' || u === 'E') return u;
  if (ch === '*') return '*';
  return null;
}

// .dat metnini ayrıştır. examType: 'TYT' | 'AYT'. Döner:
// { ok, error?, students:[{name,kitapcik,answers,answered}], warnings:[], total }
export function parseDat(text: string, examType: string): ParseDatResult {
  const map = DAT_MAPS[examType];
  if (!map) {
    return { ok: false, error: `${examType} için .dat şablonu yok (yalnız TYT/AYT).`, students: [], warnings: [], total: 0 };
  }

  const lines = splitLines(text);
  if (!lines.length) {
    return { ok: false, error: 'Dosyada okunacak satır yok (boş ya da bozuk).', students: [], warnings: [], total: 0 };
  }

  const warnings: string[] = [];
  // Satır uzunluğu denetimi — şablon uyumsuzsa uyar
  const offLen = lines.filter((l) => Math.abs(l.length - map.lineLen) > 6).length;
  if (offLen > lines.length / 2) {
    warnings.push(
      `Satırların çoğu ${map.lineLen} karakter değil (bu ${examType} şablonu 222-krk optik içindir). Önizlemeyi mutlaka kontrol et.`
    );
  }

  const students = lines.map((line) => {
    const name = extractName(line, map.nameRange) || 'İsimsiz';
    const kitapcik = bookletAt(line, map.bookletCol);
    const answers: (string | null)[] = [];
    for (const [start, len] of map.blocks) {
      for (let i = 0; i < len; i++) answers.push(cellAt(line, start + i));
    }
    const answered = answers.filter((c) => c && c !== '*').length;
    return { name, kitapcik, answers, answered };
  });

  // Çoğu öğrenci çok az işaretliyse büyük ihtimalle yanlış sınav türü / şablon
  const lowFill = students.filter((s) => s.answered < map.total * 0.25).length;
  if (lowFill > students.length / 2) {
    warnings.push(
      'Öğrencilerin çoğunda çok az işaretli cevap var. Sınav türü (TYT/AYT) dosyayla uyumlu mu kontrol et.'
    );
  }

  return { ok: true, students, warnings, total: map.total };
}
