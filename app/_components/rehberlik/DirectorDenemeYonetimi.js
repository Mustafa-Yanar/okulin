'use client';

import { useEffect, useState } from 'react';
import { Upload, Trash2, ChevronDown } from 'lucide-react';

// Müdür: Excel yükle + isim eşleştir + deneme listesi/sil.
// Sekme çubuğu üst katmanda (DirectorPanel); hangi görünümün gösterileceği `view` prop'uyla gelir.
export default function DirectorDenemeYonetimi({ showToast, view = 'upload' }) {
  return view === 'list'
    ? <ListView showToast={showToast} />
    : <UploadView showToast={showToast} />;
}

function UploadView({ showToast }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  async function upload(e) {
    e.preventDefault();
    setResult(null);
    if (!file) return showToast('Excel dosyası seç.', 'error');
    if (!name.trim()) return showToast('Deneme adı gir.', 'error');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', name.trim());
      fd.append('examType', 'TYT');
      fd.append('date', new Date(date).toISOString());
      const res = await fetch('/api/deneme/exams/upload', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Yükleme başarısız.', 'error');
      setResult(data);
      showToast('Deneme yüklendi');
    } catch {
      showToast('Sunucuya ulaşılamadı.', 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <form onSubmit={upload} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-600 text-gray-600 mb-1" style={{ fontWeight: 600 }}>
                Deneme Adı
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="APOTEMİ TG 3 TYT"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-600 text-gray-600 mb-1" style={{ fontWeight: 600 }}>
                Tarih
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-600 text-gray-600 mb-1" style={{ fontWeight: 600 }}>
              Excel Dosyası (.xlsx)
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[var(--bg-muted)] file:text-[var(--text-secondary)] file:cursor-pointer hover:file:brightness-95"
              style={{ color: 'var(--text-secondary)' }}
            />
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="btn-primary !px-6 !py-2.5 flex items-center gap-2 disabled:opacity-60"
          >
            <Upload size={16} /> {uploading ? 'Yükleniyor...' : 'Yükle ve İşle'}
          </button>
        </form>
      </div>
      {result && <MatchBox result={result} showToast={showToast} />}
    </div>
  );
}

function MatchBox({ result, showToast }) {
  const [students, setStudents] = useState([]);
  const [matches, setMatches] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/students', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setStudents(Array.isArray(d) ? d : []));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const payload = Object.entries(matches)
        .filter(([, id]) => id)
        .map(([excelName, studentId]) => ({ excelName, studentId }));
      const res = await fetch(`/api/deneme/exams/${result.examId}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ matches: payload }),
      });
      if (res.ok) {
        setSaved(true);
        showToast('Eşleştirmeler kaydedildi');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-4 text-sm">
        {result.rowCount} satır, {result.matchedCount} tanesi otomatik eşleşti.
      </div>
      {result.unmatched.length === 0 ? (
        <p className="text-gray-500 text-sm">Tüm isimler eşleşti.</p>
      ) : (
        <>
          <h3 className="font-700 text-gray-700 mb-1" style={{ fontWeight: 700 }}>
            Eşleşmeyen İsimler ({result.unmatched.length})
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            Bu isimleri bir öğrenciyle eşle. Eşlemezsen o satır kimsenin sayfasına bağlanmaz.
          </p>
          <div className="space-y-2">
            {result.unmatched.map((excelName) => (
              <div key={excelName} className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-600 text-gray-700 min-w-[140px]" style={{ fontWeight: 600 }}>
                  {excelName}
                </span>
                <select
                  value={matches[excelName] || ''}
                  onChange={(e) => setMatches((m) => ({ ...m, [excelName]: e.target.value }))}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:border-indigo-400 focus:outline-none"
                >
                  <option value="">— eşleştirme —</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.cls})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button
            onClick={save}
            disabled={saving || saved}
            className="btn-primary !px-5 !py-2 mt-4 disabled:opacity-60"
          >
            {saved ? 'Kaydedildi' : saving ? 'Kaydediliyor...' : 'Eşleştirmeleri Kaydet'}
          </button>
        </>
      )}
    </div>
  );
}

function ListView({ showToast }) {
  const [exams, setExams] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [ranking, setRanking] = useState([]);

  async function load() {
    const res = await fetch('/api/deneme/exams', { credentials: 'same-origin' });
    if (res.ok) setExams((await res.json()).exams);
  }
  useEffect(() => {
    load();
  }, []);

  async function open(id) {
    if (openId === id) return setOpenId(null);
    const res = await fetch(`/api/deneme/exams/${id}`, { credentials: 'same-origin' });
    if (res.ok) {
      setRanking((await res.json()).ranking);
      setOpenId(id);
    }
  }

  async function remove(id) {
    if (!confirm('Bu denemeyi silmek istediğine emin misin?')) return;
    const res = await fetch(`/api/deneme/exams/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      setExams((prev) => prev.filter((e) => e.id !== id));
      if (openId === id) setOpenId(null);
      showToast('Deneme silindi');
    }
  }

  if (exams.length === 0) {
    return (
      <div className="card p-10 text-center text-gray-400">Henüz deneme yüklenmedi.</div>
    );
  }

  return (
    <div className="space-y-3">
      {exams.map((e) => (
        <div key={e.id} className="card overflow-hidden">
          <div className="p-4 flex items-center justify-between gap-3">
            <button onClick={() => open(e.id)} className="text-left flex-1 flex items-center gap-2">
              <ChevronDown
                size={16}
                className={`text-gray-400 transition-transform ${openId === e.id ? 'rotate-180' : ''}`}
              />
              <div>
                <div className="font-700 text-gray-800" style={{ fontWeight: 700 }}>
                  {e.name}
                </div>
                <div className="text-xs text-gray-400">
                  {e.examType} · {new Date(e.date).toLocaleDateString('tr-TR')}
                </div>
              </div>
            </button>
            <button onClick={() => remove(e.id)} className="text-gray-300 hover:text-red-600 transition-colors">
              <Trash2 size={16} />
            </button>
          </div>
          {openId === e.id && (
            <div className="border-t border-gray-100 max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-600" style={{ fontWeight: 600 }}>Sıra</th>
                    <th className="text-left px-4 py-2 font-600" style={{ fontWeight: 600 }}>İsim</th>
                    <th className="text-right px-4 py-2 font-600" style={{ fontWeight: 600 }}>Toplam Net</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r) => (
                    <tr key={r.rank} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-500">{r.rank}</td>
                      <td className="px-4 py-2 text-gray-700">
                        {r.excelName}
                        {!r.studentId && <span className="text-xs text-amber-500 ml-2">(eşleşmedi)</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-700 text-indigo-600" style={{ fontWeight: 700 }}>
                        {r.toplamNet.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
