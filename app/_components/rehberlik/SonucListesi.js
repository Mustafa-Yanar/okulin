'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calculator, FileSpreadsheet, FileDown, AlertTriangle, Trophy } from 'lucide-react';
import { exportExcel, exportPdf } from './denemeExport';

// Sınav detayı "Sonuçlar" adımı: Hesapla → puan türü başına liste + Excel/PDF indir.
export default function SonucListesi({ exam, showToast }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [active, setActive] = useState(0);
  const [exporting, setExporting] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deneme/exams/${exam.id}/report`, { credentials: 'same-origin' });
      if (res.ok) setReport(await res.json());
    } finally {
      setLoading(false);
    }
  }, [exam.id]);

  useEffect(() => { load(); }, [load]);

  async function hesapla() {
    setComputing(true);
    try {
      const res = await fetch(`/api/deneme/exams/${exam.id}/compute`, { method: 'POST', credentials: 'same-origin' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return showToast(d.error || 'Hesaplanamadı', 'error');
      showToast(`${d.graded}/${d.count} kayıt puanlandı · ort. net ${d.ortalamaNet}`);
      await load();
    } finally {
      setComputing(false);
    }
  }

  async function doExport(kind) {
    if (!report?.lists?.length) return;
    setExporting(kind);
    try {
      if (kind === 'xlsx') await exportExcel(report);
      else await exportPdf(report);
    } catch (e) {
      showToast('Dışa aktarma hatası: ' + (e?.message || ''), 'error');
    } finally {
      setExporting('');
    }
  }

  if (loading) return <div className="card p-10 text-center text-gray-400">Yükleniyor…</div>;

  const lists = report?.lists || [];
  const list = lists[active] || null;
  const noKey = report && !report.hasKey;
  const noRows = (report?.rowCount || 0) === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={hesapla} disabled={computing || noRows} className="btn-primary !px-5 !py-2 flex items-center gap-2 disabled:opacity-60">
          <Calculator size={15} /> {computing ? 'Hesaplanıyor…' : 'Hesapla'}
        </button>
        {!!lists.length && (
          <>
            <button onClick={() => doExport('xlsx')} disabled={!!exporting} className="btn-ghost !px-4 !py-2 flex items-center gap-2 disabled:opacity-60">
              <FileSpreadsheet size={15} /> {exporting === 'xlsx' ? '…' : 'Excel'}
            </button>
            <button onClick={() => doExport('pdf')} disabled={!!exporting} className="btn-ghost !px-4 !py-2 flex items-center gap-2 disabled:opacity-60">
              <FileDown size={15} /> {exporting === 'pdf' ? '…' : 'PDF'}
            </button>
          </>
        )}
      </div>

      {noRows && (
        <div className="card p-8 text-center text-gray-400 text-sm">Henüz kayıt yok. Önce Veri Girişi'nden öğrenci ekle.</div>
      )}

      {noKey && !noRows && (
        <div className="flex items-start gap-2 text-sm bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>Cevap anahtarı girilmemiş. "Cevap Anahtarı" adımından gir, sonra Hesapla'ya bas.</span>
        </div>
      )}

      {!!lists.length && (
        <>
          {lists.length > 1 && (
            <div className="pill-tabs">
              {lists.map((l, i) => (
                <button key={l.key} onClick={() => setActive(i)} className={`pill-tab${active === i ? ' is-active' : ''}`}>
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400">
            Puan değerleri yaklaşıktır (ÖSYM kamuya açık katsayıları; gerçek puanı sınav sonrası ÖSYM ülke geneliyle hesaplar). Net ve sıralama kesindir.
          </p>

          {list && <ListeTablosu list={list} />}
        </>
      )}
    </div>
  );
}

function ListeTablosu({ list }) {
  const subjects = list.subjects;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>#</th>
            <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>İsim</th>
            {subjects.map((s) => (
              <th key={s.key} className="text-right px-2 py-2" style={{ fontWeight: 600 }} title={s.label}>{kisalt(s.label)}</th>
            ))}
            <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Net</th>
            <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Puan</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((r) => (
            <tr key={r.rank} className="border-t border-gray-50">
              <td className="px-3 py-1.5 text-gray-400">
                {r.rank <= 3 ? <Trophy size={13} className={`inline ${r.rank === 1 ? 'text-amber-400' : r.rank === 2 ? 'text-gray-400' : 'text-orange-400'}`} /> : r.rank}
              </td>
              <td className="px-3 py-1.5 text-gray-700">
                {r.name}
                {r.cls ? <span className="text-xs text-gray-300 ml-1.5">{r.cls}</span> : null}
                {!r.matched && <span className="text-[10px] text-amber-500 ml-1.5">eşleşmedi</span>}
              </td>
              {subjects.map((s) => (
                <td key={s.key} className="px-2 py-1.5 text-right text-gray-500">{(r.subjects[s.key]?.net ?? 0).toFixed(2)}</td>
              ))}
              <td className="px-3 py-1.5 text-right text-gray-700" style={{ fontWeight: 600 }}>{(r.toplamNet ?? 0).toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right text-indigo-600" style={{ fontWeight: 700 }}>{r.puan != null ? r.puan.toFixed(2) : '—'}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gray-200 bg-gray-50/60">
            <td className="px-3 py-2 text-gray-400" colSpan={2} style={{ fontWeight: 600 }}>Okul Ortalaması</td>
            {subjects.map((s) => (
              <td key={s.key} className="px-2 py-2 text-right text-gray-500">{(list.ortalama.subjects[s.key] ?? 0).toFixed(2)}</td>
            ))}
            <td className="px-3 py-2 text-right text-gray-600" style={{ fontWeight: 600 }}>{(list.ortalama.toplamNet ?? 0).toFixed(2)}</td>
            <td className="px-3 py-2 text-right text-indigo-500" style={{ fontWeight: 600 }}>{list.ortalama.puan != null ? list.ortalama.puan.toFixed(2) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Uzun ders adını başlık için kısalt (tooltip tam adı taşır).
function kisalt(label) {
  const map = {
    Türkçe: 'Tür', Matematik: 'Mat', Geometri: 'Geo', Fizik: 'Fiz', Kimya: 'Kim',
    Biyoloji: 'Biy', Tarih: 'Tar', Coğrafya: 'Coğ', 'Din Kültürü': 'Din', Felsefe: 'Fel',
    Edebiyat: 'Edb', 'Tarih-1': 'Tar1', 'Coğrafya-1': 'Coğ1', 'Tarih-2': 'Tar2',
    'Coğrafya-2': 'Coğ2', 'Felsefe Grubu': 'Fel', 'Fen Bilimleri': 'Fen',
    'T.C. İnkılap Tarihi': 'İnk', 'Yabancı Dil': 'Dil',
  };
  return map[label] || label.slice(0, 4);
}
