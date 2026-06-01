'use client';
import { useState, useRef } from 'react';
import { Upload, ScanLine, Copy, Check } from 'lucide-react';

const CHOICES = ['A', 'B', 'C', 'D', 'E'];

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

export default function OptikFormTab({ showToast }) {
  const [preview, setPreview] = useState(null);   // data URL
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState(null);   // string[] | null
  const [raw, setRaw] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { showToast('Dosya 5 MB\'dan büyük', 'error'); return; }
    setFile(f);
    setAnswers(null);
    setRaw('');
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  }

  async function readForm() {
    if (!file) return;
    setLoading(true);
    setAnswers(null);
    setRaw('');
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/optik', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Hata');
      if (data.answers) {
        setAnswers(data.answers);
        showToast(`${data.total} soru okundu`);
      } else {
        setRaw(data.raw || 'Cevap parse edilemedi');
        showToast('Form okundu ama parse edilemedi — ham çıktıya bakın', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function setAnswer(idx, val) {
    setAnswers(prev => { const next = [...prev]; next[idx] = val || null; return next; });
  }

  async function copyToClipboard() {
    if (!answers) return;
    const text = answers.map((a, i) => `${i + 1}. ${a ?? '-'}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // 5'erli gruplar halinde render
  function renderAnswerGrid() {
    if (!answers) return null;
    const rows = [];
    for (let i = 0; i < answers.length; i += 10) {
      const chunk = answers.slice(i, i + 10);
      rows.push(
        <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          {chunk.map((ans, j) => {
            const idx = i + j;
            return (
              <div key={idx} className="flex items-center gap-1.5 bg-slate-50 rounded px-2 py-1">
                <span className="text-xs text-slate-400 w-5 shrink-0 text-right">{idx + 1}.</span>
                <select
                  value={ans ?? ''}
                  onChange={e => setAnswer(idx, e.target.value)}
                  className="flex-1 text-xs border border-slate-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="">—</option>
                  {CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      );
    }
    return rows;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-5">
        <ScanLine size={20} className="text-indigo-600" />
        <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Optik Form Oku</h3>
      </div>

      {/* Upload alanı */}
      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition mb-4"
      >
        {preview ? (
          <img src={preview} alt="Form önizleme" className="max-h-48 mx-auto rounded object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Upload size={32} />
            <p className="text-sm">Optik form fotoğrafını seç</p>
            <p className="text-xs">jpg, png, webp — max 5 MB</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFileChange} />
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={readForm}
          disabled={!file || loading}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-40"
        >
          <ScanLine size={15} />
          {loading ? 'Okunuyor…' : 'Formu Oku'}
        </button>
        {preview && (
          <button
            onClick={() => { setFile(null); setPreview(null); setAnswers(null); setRaw(''); if (inputRef.current) inputRef.current.value = ''; }}
            className="px-4 py-2 text-sm text-slate-600 rounded hover:bg-slate-100"
          >
            Temizle
          </button>
        )}
      </div>

      {/* Ham çıktı (parse hatası) */}
      {raw && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs font-semibold text-amber-700 mb-1">Ham Gemini Çıktısı</p>
          <pre className="text-xs text-amber-800 whitespace-pre-wrap break-all">{raw}</pre>
        </div>
      )}

      {/* Cevap tablosu */}
      {answers && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-600 text-slate-700" style={{ fontWeight: 600 }}>
              {answers.length} soru — yanlış okunanları düzeltebilirsiniz
            </p>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded hover:bg-slate-100 text-slate-600"
            >
              {copied ? <><Check size={13} className="text-green-600" /> Kopyalandı</> : <><Copy size={13} /> Kopyala</>}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {renderAnswerGrid()}
          </div>
        </div>
      )}
    </div>
  );
}
