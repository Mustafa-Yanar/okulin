'use client';

import { useState } from 'react';
import { ChevronLeft, GitMerge, FileSpreadsheet, FileDown, AlertTriangle, Trophy } from 'lucide-react';
import { exportMergeExcel, exportMergePdf } from './denemeExport';

// TYT + AYT sınavını öğrenci bazında birleştir → 3 türde (SAY/EA/SÖZ) yerleştirme listesi.
// Anlık: iki sınav seç → /api/deneme/merge → liste + Excel/PDF. Kalıcı kayıt yok.
export default function MergeListesi({ exams, showToast, onBack }) {
  const tytList = (exams || []).filter((e) => e.examType === 'TYT');
  const aytList = (exams || []).filter((e) => e.examType === 'AYT');
  const [tytId, setTytId] = useState('');
  const [aytId, setAytId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [exporting, setExporting] = useState('');

  async function birlestir() {
    if (!tytId || !aytId) return showToast('Bir TYT ve bir AYT sınavı seç.', 'error');
    setLoading(true);
    try {
      const res = await fetch(
        `/api/deneme/merge?tyt=${encodeURIComponent(tytId)}&ayt=${encodeURIComponent(aytId)}`,
        { credentials: 'same-origin' }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return showToast(d.error || 'Birleştirilemedi', 'error');
      setReport(d);
      setActive(0);
    } finally {
      setLoading(false);
    }
  }

  async function doExport(kind) {
    if (!report?.lists?.length) return;
    setExporting(kind);
    try {
      if (kind === 'xlsx') await exportMergeExcel(report);
      else await exportMergePdf(report);
    } catch (e) {
      showToast('Dışa aktarma hatası: ' + (e?.message || ''), 'error');
    } finally {
      setExporting('');
    }
  }

  const lists = report?.lists || [];
  const list = lists[active] || null;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500 flex items-center gap-1 hover:text-gray-700">
        <ChevronLeft size={15} /> Sınavlar
      </button>

      <div className="flex items-center gap-2">
        <GitMerge size={18} className="text-indigo-500" />
        <h2 className="font-700 text-xl" style={{ fontWeight: 700 }}>TYT + AYT Birleştirme</h2>
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1" style={{ fontWeight: 600 }}>TYT Sınavı</label>
            <select value={tytId} onChange={(e) => setTytId(e.target.value)} className="input">
              <option value="">Seç…</option>
              {tytList.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1" style={{ fontWeight: 600 }}>AYT Sınavı</label>
            <select value={aytId} onChange={(e) => setAytId(e.target.value)} className="input">
              <option value="">Seç…</option>
              {aytList.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={birlestir}
          disabled={loading || !tytId || !aytId}
          className="btn-primary !px-5 !py-2 flex items-center gap-2 disabled:opacity-60"
        >
          <GitMerge size={15} /> {loading ? 'Birleştiriliyor…' : 'Birleştir'}
        </button>
        {(tytList.length === 0 || aytList.length === 0) && (
          <p className="text-xs text-amber-600">Birleştirme için en az bir TYT ve bir AYT sınavı gerekir.</p>
        )}
      </div>

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span><b style={{ fontWeight: 700 }}>{report.matchedCount}</b> ortak öğrenci</span>
            {!!lists.length && !!report.matchedCount && (
              <>
                <button onClick={() => doExport('xlsx')} disabled={!!exporting} className="btn-ghost !px-4 !py-2 flex items-center gap-2 disabled:opacity-60 ml-auto">
                  <FileSpreadsheet size={15} /> {exporting === 'xlsx' ? '…' : 'Excel'}
                </button>
                <button onClick={() => doExport('pdf')} disabled={!!exporting} className="btn-ghost !px-4 !py-2 flex items-center gap-2 disabled:opacity-60">
                  <FileDown size={15} /> {exporting === 'pdf' ? '…' : 'PDF'}
                </button>
              </>
            )}
          </div>

          {!report.matchedCount ? (
            <div className="flex items-start gap-2 text-sm bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>İki sınavda da eşleşmiş ortak öğrenci yok. Önce her iki sınavın Veri Girişi'nde öğrencileri eşleştir.</span>
            </div>
          ) : (
            <>
              <div className="pill-tabs">
                {lists.map((l, i) => (
                  <button key={l.key} onClick={() => setActive(i)} className={`pill-tab${active === i ? ' is-active' : ''}`}>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                Yerleştirme = 0.4×TYT + 0.6×AYT (OBP hariç). Puanlar yaklaşıktır; sıralama kesindir.
              </p>
              {list && <MergeTablo list={list} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

function MergeTablo({ list }) {
  const o = list.ortalama || {};
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>#</th>
            <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>İsim</th>
            <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>TYT</th>
            <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>AYT</th>
            <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Yerleştirme</th>
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
              </td>
              <td className="px-3 py-1.5 text-right text-gray-500">{r.tytPuan != null ? r.tytPuan.toFixed(2) : '—'}</td>
              <td className="px-3 py-1.5 text-right text-gray-500">{r.aytPuan != null ? r.aytPuan.toFixed(2) : '—'}</td>
              <td className="px-3 py-1.5 text-right text-indigo-600" style={{ fontWeight: 700 }}>{r.yerlestirme != null ? r.yerlestirme.toFixed(2) : '—'}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gray-200 bg-gray-50/60">
            <td className="px-3 py-2 text-gray-400" colSpan={2} style={{ fontWeight: 600 }}>Okul Ortalaması</td>
            <td className="px-3 py-2 text-right text-gray-600">{o.tytPuan != null ? o.tytPuan.toFixed(2) : '—'}</td>
            <td className="px-3 py-2 text-right text-gray-600">{o.aytPuan != null ? o.aytPuan.toFixed(2) : '—'}</td>
            <td className="px-3 py-2 text-right text-indigo-500" style={{ fontWeight: 600 }}>{o.yerlestirme != null ? o.yerlestirme.toFixed(2) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
