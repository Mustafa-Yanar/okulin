import * as XLSX from 'xlsx';
import { TYT_GROUPS, calcNet } from './config';

// Excel ders başlığı -> sistem subjectKey eşlemesi (anahtar kelimeyle).
// TYT'de numaralandırma (Tarih-1, Matematik-1) yok sayılır.
const HEADER_MATCHERS = [
  { key: 'turkce', test: (h) => h.includes('turkce') },
  { key: 'tarih', test: (h) => h.includes('tarih') },
  { key: 'cografya', test: (h) => h.includes('cografya') || h.includes('cogr') },
  { key: 'felsefe_secmeli', test: (h) => h.includes('felsefe') && h.includes('secmeli') },
  { key: 'din', test: (h) => h.includes('din') || (h.includes('ahl') && !h.includes('felsefe')) },
  { key: 'felsefe', test: (h) => h.includes('felsefe') },
  { key: 'matematik', test: (h) => h.includes('matematik') || h.includes('mat') },
  { key: 'geometri', test: (h) => h.includes('geometri') || h.includes('geo') },
  { key: 'fizik', test: (h) => h.includes('fizik') },
  { key: 'kimya', test: (h) => h.includes('kimya') },
  { key: 'biyoloji', test: (h) => h.includes('biyoloji') || h.includes('biyo') },
];

function norm(s) {
  return String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

function matchSubjectKey(header) {
  const h = norm(header);
  if (!h) return null;
  for (const m of HEADER_MATCHERS) {
    if (m.test(h)) return m.key;
  }
  return null;
}

const TYT_SUBJECT_KEYS = new Set(
  TYT_GROUPS.flatMap((g) => g.subjects.map((s) => s.key))
);

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Yayıncı "Okul Net Listesi" Excel'ini parse eder (TYT).
 * Yapı: üstte başlık satırları, ders başlık satırı + altında D/Y/N,
 * sonra ortalama satırları, sonra öğrenci satırları.
 * Döner: { subjectKeys, rows: [{ excelName, results }], warnings }
 */
export function parseTytExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });

  const warnings = [];

  // 1) Ders başlığı satırını bul: en çok subjectKey eşleşen satır
  let headerRowIdx = -1;
  let bestMatches = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    let matches = 0;
    for (const cell of grid[r]) {
      if (matchSubjectKey(String(cell))) matches++;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      headerRowIdx = r;
    }
  }
  if (headerRowIdx < 0 || bestMatches < 2) {
    throw new Error(
      'Ders başlıkları bulunamadı. Dosyanın yayıncı net listesi formatında olduğundan emin ol.'
    );
  }

  const headerRow = grid[headerRowIdx];
  const dynRow = grid[headerRowIdx + 1] || [];

  // 2) Her ders için D/Y/N sütun indeksleri
  const subjCols = [];
  const seen = new Set();

  for (let c = 0; c < headerRow.length; c++) {
    const key = matchSubjectKey(String(headerRow[c]));
    if (!key) continue;
    if (!TYT_SUBJECT_KEYS.has(key)) continue;
    if (seen.has(key)) continue;

    const findLabel = (label, from, span = 4) => {
      for (let i = from; i < from + span && i < dynRow.length; i++) {
        if (norm(String(dynRow[i])) === label) return i;
      }
      return -1;
    };
    const di = findLabel('d', c);
    const yi = findLabel('y', c);
    const ni = findLabel('n', c);

    if (di >= 0 && yi >= 0) {
      subjCols.push({ key, d: di, y: yi, n: ni });
      seen.add(key);
    }
  }

  if (subjCols.length < 2) {
    throw new Error('Ders sütunları (D/Y/N) çözümlenemedi.');
  }

  // 3) İsim sütunu
  let nameCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = norm(String(headerRow[c]));
    if (h === 'isim' || h === 'ad' || h === 'ad soyad' || h.includes('isim')) {
      nameCol = c;
      break;
    }
  }
  const firstSubjCol = Math.min(...subjCols.map((s) => s.d));
  if (nameCol < 0 || nameCol >= firstSubjCol) {
    nameCol = 2;
  }

  // 4) Öğrenci satırları
  const rows = [];
  const skipNames = ['genel ortalama', 'okul ortalamasi', 'ortalama', 'il ortalamasi'];

  for (let r = headerRowIdx + 2; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const rawName = String(row[nameCol] ?? '').trim();
    const nName = norm(rawName);
    if (!rawName) continue;
    if (skipNames.some((s) => nName.includes(s))) continue;
    if (/^\d+([.,]\d+)?$/.test(rawName)) continue;

    const results = {};
    let hasAny = false;
    for (const sc of subjCols) {
      const dogru = num(row[sc.d]);
      const yanlis = num(row[sc.y]);
      const net = sc.n >= 0 ? num(row[sc.n]) : calcNet(dogru, yanlis);
      if (dogru || yanlis || net) hasAny = true;
      results[sc.key] = { dogru, yanlis, net, bos: 0 };
    }
    if (!hasAny) continue;
    rows.push({ excelName: rawName, results });
  }

  if (rows.length === 0) {
    throw new Error('Öğrenci satırı bulunamadı.');
  }

  return { subjectKeys: subjCols.map((s) => s.key), rows, warnings };
}
