'use client';
// Rapor modelinden (lib/deneme/report.js buildReports çıktısı) Excel + PDF üretir.
// xlsx/jspdf YALNIZ tıklamada dinamik yüklenir (SSR güvenli, ana bundle'ı şişirmez).
// PDF Türkçe karakterleri için /public/fonts/Roboto-Turkish.ttf gömülür.

function fileSafe(s) {
  return String(s || 'rapor').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
}

function f2(n) {
  return (Math.round((n || 0) * 100) / 100).toFixed(2);
}

// Bir liste → { head, body, avgRow } (PDF/Excel ortak matris).
function listToMatrix(list) {
  const head = ['Sıra', 'İsim', 'Sınıf'];
  for (const s of list.subjects) head.push(`${s.label} D`, `${s.label} Y`, `${s.label} N`);
  head.push('Top. Net', 'Puan');

  const body = list.rows.map((r) => {
    const row = [r.rank, r.name, r.cls || ''];
    for (const s of list.subjects) {
      const c = r.subjects[s.key] || {};
      row.push(c.dogru ?? 0, c.yanlis ?? 0, f2(c.net));
    }
    row.push(f2(r.toplamNet), r.puan != null ? f2(r.puan) : '—');
    return row;
  });

  const avgRow = ['', 'OKUL ORTALAMASI', ''];
  for (const s of list.subjects) {
    avgRow.push('', '', f2(list.ortalama.subjects[s.key]));
  }
  avgRow.push(f2(list.ortalama.toplamNet), list.ortalama.puan != null ? f2(list.ortalama.puan) : '—');

  return { head, body, avgRow };
}

export async function exportExcel(report) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const list of report.lists) {
    const { head, body, avgRow } = listToMatrix(list);
    const ws = XLSX.utils.aoa_to_sheet([head, ...body, avgRow]);
    XLSX.utils.book_append_sheet(wb, ws, fileSafe(list.label).slice(0, 28) || 'Liste');
  }
  XLSX.writeFile(wb, `${fileSafe(report.exam.name)}_sonuc.xlsx`);
}

async function loadTurkishFont(doc) {
  try {
    const res = await fetch('/fonts/Roboto-Turkish.ttf');
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
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

export async function exportPdf(report) {
  const { jsPDF } = await import('jspdf');
  const autoTableMod = await import('jspdf-autotable');
  const autoTable = autoTableMod.default || autoTableMod.autoTable;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const hasFont = await loadTurkishFont(doc);
  const font = hasFont ? 'Roboto' : 'helvetica';

  report.lists.forEach((list, i) => {
    if (i > 0) doc.addPage();
    doc.setFont(font);
    doc.setFontSize(12);
    doc.text(`${report.exam.name} — ${list.label}`, 30, 28);
    doc.setFontSize(8);
    doc.text(new Date(report.exam.date).toLocaleDateString('tr-TR'), 30, 40);

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
