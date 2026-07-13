'use client';
import { useState, useRef } from 'react';
import { upload } from '@vercel/blob/client';
import { Upload, ScanLine, Copy, Check, FileText, Image } from 'lucide-react';
import type { ShowToast } from '../types';

const CHOICES = ['A', 'B', 'C', 'D', 'E'];

// /api/optik yanıtındaki tek form.
interface OptikFormResult {
  page?: number;
  answers: (string | null)[];
  total?: number;
}

interface OptikFormTabProps {
  showToast: ShowToast;
}

export default function OptikFormTab({ showToast }: OptikFormTabProps) {
  const [preview, setPreview] = useState<string | null>(null);   // data URL (sadece görüntü için)
  const [isPdf, setIsPdf] = useState(false);
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [forms, setForms] = useState<OptikFormResult[] | null>(null);       // [{page, answers, total}]
  const [raw, setRaw] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { showToast('Dosya 50 MB\'dan büyük', 'error'); return; }
    const pdf = f.type === 'application/pdf';
    setFile(f);
    setIsPdf(pdf);
    setFileName(f.name);
    setForms(null);
    setRaw('');
    if (!pdf) {
      const reader = new FileReader();
      reader.onload = ev => setPreview(ev.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
  }

  async function readForm() {
    if (!file) return;
    setLoading(true);
    setForms(null);
    setRaw('');
    try {
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/optik/upload',
        contentType: file.type,
      });
      const res = await fetch('/api/optik', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ url: blob.url, mimeType: file.type }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; forms?: OptikFormResult[]; pageCount?: number; raw?: string };
      if (!res.ok) throw new Error(data.error || 'Hata');
      if (data.forms) {
        setForms(data.forms);
        showToast(`${data.pageCount} form okundu`);
      } else {
        setRaw(data.raw || 'Cevap parse edilemedi');
        showToast('Form okundu ama parse edilemedi — ham çıktıya bakın', 'error');
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function setAnswer(formIdx: number, ansIdx: number, val: string) {
    setForms(prev => (prev || []).map((f, i) => {
      if (i !== formIdx) return f;
      const answers = [...f.answers];
      answers[ansIdx] = val || null;
      return { ...f, answers };
    }));
  }

  async function copyForm(idx: number) {
    const f = forms![idx];
    const text = f.answers.map((a, i) => `${i + 1}. ${a ?? '-'}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  function reset() {
    setFile(null); setPreview(null); setIsPdf(false); setFileName('');
    setForms(null); setRaw('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function renderAnswerGrid(formIdx: number, answers: (string | null)[]) {
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
                  onChange={e => setAnswer(formIdx, idx, e.target.value)}
                  className="flex-1 text-xs border border-slate-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-[color:var(--brand)]"
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
        <ScanLine size={20} className="text-brand" />
        <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Optik Form Oku</h3>
      </div>

      {/* Upload alanı */}
      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-[color:var(--brand)] bg-brand-soft-hover transition mb-4"
      >
        {preview ? (
          <img src={preview} alt="Form önizleme" className="max-h-48 mx-auto rounded object-contain" />
        ) : isPdf ? (
          <div className="flex flex-col items-center gap-2 text-brand">
            <FileText size={36} />
            <p className="text-sm font-medium text-slate-700">{fileName}</p>
            <p className="text-xs text-slate-400">PDF — tarayıcı çıktısı desteklenir, çok sayfalı toplu okuma</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Upload size={32} />
            <p className="text-sm">Optik form yükle</p>
            <p className="text-xs flex items-center gap-3">
              <span className="flex items-center gap-1"><FileText size={12} /> PDF (tarayıcı/MFP)</span>
              <span className="flex items-center gap-1"><Image size={12} /> JPG/PNG (fotoğraf)</span>
            </p>
            <p className="text-xs text-slate-300">Maks 50 MB</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={onFileChange} />
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={readForm}
          disabled={!file || loading}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm rounded disabled:opacity-40"
        >
          <ScanLine size={15} />
          {loading ? 'Okunuyor…' : 'Formu Oku'}
        </button>
        {file && (
          <button onClick={reset} className="px-4 py-2 text-sm text-slate-600 rounded hover:bg-slate-100">
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

      {/* Form listesi */}
      {forms && (
        <div className="flex flex-col gap-6">
          {forms.map((f, formIdx) => (
            <div key={formIdx} className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-600 text-slate-700" style={{ fontWeight: 600 }}>
                  {forms.length > 1 ? `Form ${f.page ?? formIdx + 1}` : 'Cevaplar'} — {f.answers.length} soru
                </p>
                <button
                  onClick={() => copyForm(formIdx)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded hover:bg-slate-100 text-slate-600"
                >
                  {copiedIdx === formIdx ? <><Check size={13} className="text-green-600" /> Kopyalandı</> : <><Copy size={13} /> Kopyala</>}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {renderAnswerGrid(formIdx, f.answers)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
