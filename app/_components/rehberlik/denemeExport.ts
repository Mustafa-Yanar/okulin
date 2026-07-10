'use client';
// Rapor modelinden (lib/deneme/report.js buildReports çıktısı) Excel + PDF üretir.
// xlsx/jspdf YALNIZ tıklamada dinamik yüklenir (SSR güvenli, ana bundle'ı şişirmez).
// PDF Türkçe karakterleri için /public/fonts/Roboto-Turkish.ttf gömülür.

import type { jsPDF } from 'jspdf';

// ── İstemci DTO'ları: lib/deneme/report.ts buildReports/buildMergeReport çıktısı
// (route JSON'u) ile birebir; SonucListesi/MergeListesi de bu tipleri tüketir. ──
export interface ReportSubjectCellDTO {
  dogru?: number;
  yanlis?: number;
  bos?: number;
  net?: number;
}
export interface ReportRowDTO {
  rank: number;
  name: string;
  cls: string;
  matched: boolean;
  source: string;
  subjects: Record<string, ReportSubjectCellDTO>;
  toplamNet: number;
  puan: number | null;
}
export interface ReportListDTO {
  key: string;
  label: string;
  subjects: { key: string; label: string }[];
  rows: ReportRowDTO[];
  ortalama: { subjects: Record<string, number>; toplamNet: number; puan: number | null };
}
// GET /api/deneme/exams/[id]/report yanıtı (buildReports + hasKey/rowCount).
export interface DenemeReportDTO {
  exam: { id: string; name: string; examType: string; date?: string | null };
  lists: ReportListDTO[];
  hasKey?: boolean;
  rowCount?: number;
}
export interface MergeRowDTO {
  rank: number;
  name: string;
  cls: string;
  tytPuan: number | null;
  aytPuan: number | null;
  yerlestirme: number | null;
}
export interface MergeListDTO {
  key: string;
  label: string;
  rows: MergeRowDTO[];
  ortalama: { tytPuan?: number | null; aytPuan?: number | null; yerlestirme?: number | null };
}
// GET /api/deneme/merge yanıtı.
export interface MergeReportDTO {
  tyt?: { id?: string; name?: string } | null;
  ayt?: { id?: string; name?: string } | null;
  matchedCount: number;
  lists: MergeListDTO[];
}

type MatrixCell = string | number;

function fileSafe(s: string | undefined): string {
  return String(s || 'rapor').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
}

function f2(n: number | null | undefined): string {
  return (Math.round((n || 0) * 100) / 100).toFixed(2);
}

// Bir liste → { head, body, avgRow } (PDF/Excel ortak matris).
function listToMatrix(list: ReportListDTO) {
  const head: MatrixCell[] = ['Sıra', 'İsim', 'Sınıf'];
  for (const s of list.subjects) head.push(`${s.label} D`, `${s.label} Y`, `${s.label} N`);
  head.push('Top. Net', 'Puan');

  const body = list.rows.map((r) => {
    const row: MatrixCell[] = [r.rank, r.name, r.cls || ''];
    for (const s of list.subjects) {
      const c = r.subjects[s.key] || {};
      row.push(c.dogru ?? 0, c.yanlis ?? 0, f2(c.net));
    }
    row.push(f2(r.toplamNet), r.puan != null ? f2(r.puan) : '—');
    return row;
  });

  const avgRow: MatrixCell[] = ['', 'OKUL ORTALAMASI', ''];
  for (const s of list.subjects) {
    avgRow.push('', '', f2(list.ortalama.subjects[s.key]));
  }
  avgRow.push(f2(list.ortalama.toplamNet), list.ortalama.puan != null ? f2(list.ortalama.puan) : '—');

  return { head, body, avgRow };
}

export async function exportExcel(report: DenemeReportDTO) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const list of report.lists) {
    const { head, body, avgRow } = listToMatrix(list);
    const ws = XLSX.utils.aoa_to_sheet([head, ...body, avgRow]);
    XLSX.utils.book_append_sheet(wb, ws, fileSafe(list.label).slice(0, 28) || 'Liste');
  }
  XLSX.writeFile(wb, `${fileSafe(report.exam.name)}_sonuc.xlsx`);
}

async function loadTurkishFont(doc: jsPDF): Promise<boolean> {
  try {
    const res = await fetch('/fonts/Roboto-Turkish.ttf');
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      // fromCharCode.apply sayısal dizi bekler; Uint8Array alt-dizisi çalışma anında aynı.
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
    }
    const b64 = btoa(bin);
    doc.addFileToVFS('Roboto-Turkish.ttf', b64);
    doc.addFont('Roboto-Turkish.ttf', 'Roboto', 'normal');
    doc.setFont('Roboto');
    return true;
  } catch {
    return false; // font yüklenmezse varsayılan font (Türkçe karakter bozuk olabilir)
  }
}

// ---- TYT+AYT birleştirme çıktısı (kolonlar: Sıra/İsim/Sınıf/TYT/AYT/Yerleştirme) ----

function mergeListToMatrix(list: MergeListDTO) {
  const head: MatrixCell[] = ['Sıra', 'İsim', 'Sınıf', 'TYT', 'AYT', 'Yerleştirme'];
  const body = list.rows.map((r): MatrixCell[] => [
    r.rank,
    r.name,
    r.cls || '',
    r.tytPuan != null ? f2(r.tytPuan) : '—',
    r.aytPuan != null ? f2(r.aytPuan) : '—',
    r.yerlestirme != null ? f2(r.yerlestirme) : '—',
  ]);
  const o = list.ortalama || {};
  const avgRow: MatrixCell[] = [
    '', 'OKUL ORTALAMASI', '',
    o.tytPuan != null ? f2(o.tytPuan) : '—',
    o.aytPuan != null ? f2(o.aytPuan) : '—',
    o.yerlestirme != null ? f2(o.yerlestirme) : '—',
  ];
  return { head, body, avgRow };
}

function mergeFileBase(report: MergeReportDTO): string {
  return fileSafe(`${report.tyt?.name || 'TYT'}_${report.ayt?.name || 'AYT'}_birlestirme`);
}

export async function exportMergeExcel(report: MergeReportDTO) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const list of report.lists) {
    const { head, body, avgRow } = mergeListToMatrix(list);
    const ws = XLSX.utils.aoa_to_sheet([head, ...body, avgRow]);
    XLSX.utils.book_append_sheet(wb, ws, fileSafe(list.label).slice(0, 28) || 'Liste');
  }
  XLSX.writeFile(wb, `${mergeFileBase(report)}.xlsx`);
}

export async function exportMergePdf(report: MergeReportDTO) {
  const { jsPDF } = await import('jspdf');
  const autoTableMod = await import('jspdf-autotable');
  const autoTable = autoTableMod.default || (autoTableMod as { autoTable?: typeof autoTableMod.default }).autoTable;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const hasFont = await loadTurkishFont(doc);
  const font = hasFont ? 'Roboto' : 'helvetica';

  report.lists.forEach((list, i) => {
    if (i > 0) doc.addPage();
    doc.setFont(font);
    doc.setFontSize(12);
    doc.text(`Yerleştirme — ${list.label}`, 30, 28);
    doc.setFontSize(8);
    doc.text(`${report.tyt?.name || ''} + ${report.ayt?.name || ''}  (OBP hariç)`, 30, 40);

    const { head, body, avgRow } = mergeListToMatrix(list);
    autoTable(doc, {
      head: [head],
      body: [...body, avgRow],
      startY: 48,
      styles: { font, fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { font, fillColor: [79, 70, 229], textColor: 255, fontSize: 8 },
      columnStyles: { 1: { cellWidth: 160 } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === body.length) {
          data.cell.styles.fillColor = [241, 242, 245];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  });

  doc.save(`${mergeFileBase(report)}.pdf`);
}

export async function exportPdf(report: DenemeReportDTO) {
  const { jsPDF } = await import('jspdf');
  const autoTableMod = await import('jspdf-autotable');
  const autoTable = autoTableMod.default || (autoTableMod as { autoTable?: typeof autoTableMod.default }).autoTable;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const hasFont = await loadTurkishFont(doc);
  const font = hasFont ? 'Roboto' : 'helvetica';

  report.lists.forEach((list, i) => {
    if (i > 0) doc.addPage();
    doc.setFont(font);
    doc.setFontSize(12);
    doc.text(`${report.exam.name} — ${list.label}`, 30, 28);
    doc.setFontSize(8);
    // date null/undefined gelirse orijinal JS davranışı korunur (Date(null)=1970, Date(undefined)=Invalid).
    doc.text(new Date(report.exam.date as string).toLocaleDateString('tr-TR'), 30, 40);

    const { head, body, avgRow } = listToMatrix(list);
    autoTable(doc, {
      head: [head],
      body: [...body, avgRow],
      startY: 48,
      styles: { font, fontSize: 6, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { font, fillColor: [79, 70, 229], textColor: 255, fontSize: 6 },
      columnStyles: { 1: { cellWidth: 70 } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === body.length) {
          data.cell.styles.fillColor = [241, 242, 245];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  });

  doc.save(`${fileSafe(report.exam.name)}_sonuc.pdf`);
}
