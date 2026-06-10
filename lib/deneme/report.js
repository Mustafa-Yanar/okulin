// Okulizyon biçimli sonuç liste modeli. SAF (xlsx/jspdf bağımsız) — hem ekran tablosu
// hem PDF/Excel çıktısı bu modelden üretilir. Puan türü başına bir liste:
//   TYT → [TYT]; AYT → [SAY, EA, SOZ]; LGS → [LGS]. Her liste tüm öğrencileri
//   o türün puanına (yoksa o türün ders netleri toplamına) göre sıralar + Okul Ortalaması.

import { getTemplate, flatSubjects, AYT_PUAN_TURU } from './template.js';
import { computePuanlar } from './score.js';

const LIST_LABELS = { TYT: 'TYT', SAY: 'Sayısal', EA: 'Eşit Ağırlık', SOZ: 'Sözel', LGS: 'LGS' };

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

function subjectLabels(examType) {
  const map = {};
  for (const s of flatSubjects(examType)) map[s.key] = s.label;
  return map;
}

// Bir listedeki ders kolonları (key sırası).
function listSubjectKeys(examType, listKey) {
  if (examType === 'AYT') return AYT_PUAN_TURU[listKey] || [];
  return flatSubjects(examType).map((s) => s.key);
}

// exam → { exam, lists[] }. opts.studentInfoById: { [studentId]: { name, cls } } (opsiyonel).
export function buildReports(exam, opts = {}) {
  const t = getTemplate(exam?.examType);
  if (!t) return { exam: null, lists: [] };
  const labels = subjectLabels(exam.examType);
  const infoById = opts.studentInfoById || {};
  const rows = Array.isArray(exam.rows) ? exam.rows : [];

  const listKeys =
    exam.examType === 'AYT' ? ['SAY', 'EA', 'SOZ'] : exam.examType === 'LGS' ? ['LGS'] : ['TYT'];

  const lists = listKeys.map((listKey) => {
    const subjKeys = listSubjectKeys(exam.examType, listKey);
    const subjects = subjKeys.map((k) => ({ key: k, label: labels[k] || k }));

    const built = rows.map((r) => {
      const puanObj = r.puan || computePuanlar(exam.examType, r.results || {});
      const info = r.studentId ? infoById[r.studentId] : null;
      const subj = {};
      for (const k of subjKeys) {
        const rr = r.results?.[k] || {};
        subj[k] = { dogru: rr.dogru || 0, yanlis: rr.yanlis || 0, bos: rr.bos || 0, net: round2(rr.net) };
      }
      return {
        name: (info?.name || r.excelName || 'İsimsiz'),
        cls: info?.cls || '',
        matched: !!r.studentId,
        source: r.source || '',
        subjects: subj,
        toplamNet: round2(r.toplamNet),
        puan: puanObj[listKey] ?? null,
      };
    });

    built.sort((a, b) => {
      if (a.puan != null && b.puan != null) return b.puan - a.puan;
      const sa = subjKeys.reduce((s, k) => s + (a.subjects[k]?.net || 0), 0);
      const sb = subjKeys.reduce((s, k) => s + (b.subjects[k]?.net || 0), 0);
      return sb - sa;
    });
    built.forEach((row, i) => { row.rank = i + 1; });

    const n = built.length || 1;
    const avgSubjects = {};
    for (const k of subjKeys) {
      avgSubjects[k] = round2(built.reduce((s, r) => s + (r.subjects[k]?.net || 0), 0) / n);
    }
    const avgToplam = round2(built.reduce((s, r) => s + (r.toplamNet || 0), 0) / n);
    const puanVals = built.map((r) => r.puan).filter((p) => p != null);
    const avgPuan = puanVals.length ? round2(puanVals.reduce((s, p) => s + p, 0) / puanVals.length) : null;

    return {
      key: listKey,
      label: LIST_LABELS[listKey] || listKey,
      subjects,
      rows: built,
      ortalama: { subjects: avgSubjects, toplamNet: avgToplam, puan: avgPuan },
    };
  });

  return {
    exam: { id: exam.id, name: exam.name, examType: exam.examType, date: exam.date },
    lists,
  };
}
