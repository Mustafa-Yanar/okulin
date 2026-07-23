'use client';
/* eslint-disable @next/next/no-img-element -- Yerel object URL optik-form önizlemesi Next Image optimizer'a gönderilmemeli. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';
import { Upload, ScanLine, FileText, Image as ImageIcon, Trash2, Plus, Save, ChevronDown, Keyboard, HardDriveDownload, AlertTriangle } from 'lucide-react';
import { getTemplate, boxLength, normalizeRaw, CHOICES } from '@/lib/deneme/template';
import { parseDat, datSupports, type ParseDatResult } from '@/lib/deneme/dat';
import { useConfirm } from '../ConfirmProvider';
import { useClasses } from '../ClassesContext';
import { classShort } from '@/lib/classCatalog';
import type { DenemeExam, DenemeRow } from '@/lib/deneme/types';
import type { ShowToast, StudentDTO } from '../types';

// Sınav satırı — store her satıra id verir (DenemeRow sözleşmesinde index imzasında).
export type ExamRowDTO = DenemeRow & { id: string };

// /api/optik'in döndürdüğü form + kullanıcı girilen isim.
interface OptikForm {
  page?: number;
  answers: (string | null)[];
  total?: number;
  name: string;
}

interface VeriGirisiProps {
  exam: DenemeExam;
  rows?: ExamRowDTO[];
  onChanged?: () => void;
  showToast: ShowToast;
}

// Sınav detayındaki "Veri Girişi" adımı: optik (foto/PDF) + manuel giriş + öğrenci eşleştirme.
// Excel yükleme kaldırıldı — girdi artık optik/.dat (.dat Faz 2b).
export default function VeriGirisi({ exam, rows = [], onChanged, showToast }: VeriGirisiProps) {
  const kitapciklar = (exam.kitapcikSayisi || 1) === 2 ? ['A', 'B'] : ['A'];
  const [kitapcik, setKitapcik] = useState('A');
  const [mode, setMode] = useState('optik'); // 'optik' | 'dat' | 'manuel'
  const datOk = datSupports(exam.examType);

  // Kitapçık seçici optik/manuel için (.dat kitapçığı dosyadan öğrenci-başına okur)
  const showKitapcik = kitapciklar.length > 1 && mode !== 'dat';

  return (
    <div className="space-y-5">
      {showKitapcik && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Kitapçık:</span>
          <div className="pill-tabs">
            {kitapciklar.map((k) => (
              <button key={k} onClick={() => setKitapcik(k)} className={`pill-tab${kitapcik === k ? ' is-active' : ''}`}>
                <span>{k}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pill-tabs">
        <button onClick={() => setMode('optik')} className={`pill-tab${mode === 'optik' ? ' is-active' : ''}`}>
          <ScanLine size={13} /> <span>Optik (foto/PDF)</span>
        </button>
        {datOk && (
          <button onClick={() => setMode('dat')} className={`pill-tab${mode === 'dat' ? ' is-active' : ''}`}>
            <HardDriveDownload size={13} /> <span>Optik .dat</span>
          </button>
        )}
        <button onClick={() => setMode('manuel')} className={`pill-tab${mode === 'manuel' ? ' is-active' : ''}`}>
          <Keyboard size={13} /> <span>Manuel</span>
        </button>
      </div>

      {mode === 'optik' && <OptikEkle exam={exam} kitapcik={kitapcik} onChanged={onChanged} showToast={showToast} />}
      {mode === 'dat' && datOk && <DatEkle exam={exam} onChanged={onChanged} showToast={showToast} />}
      {mode === 'manuel' && <ManuelEkle exam={exam} kitapcik={kitapcik} onChanged={onChanged} showToast={showToast} />}

      <KayitListesi exam={exam} rows={rows} onChanged={onChanged} showToast={showToast} />
    </div>
  );
}

interface DatEkleProps {
  exam: DenemeExam;
  onChanged?: () => void;
  showToast: ShowToast;
}

// ---- Optik .dat: okuyucu çıktısı (cp1254 sabit genişlik) → öğrenci-başına kitapçık + cevaplar ----
function DatEkle({ exam, onChanged, showToast }: DatEkleProps) {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseDatResult | null>(null); // { students, warnings, total }
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return showToast("Dosya 10 MB'dan büyük", 'error');
    try {
      const buf = await f.arrayBuffer();
      const text = new TextDecoder('windows-1254').decode(buf); // optik okuyucu cp1254 üretir
      const res = parseDat(text, exam.examType);
      if (!res.ok) {
        setParsed(null);
        return showToast(res.error || 'Dosya okunamadı', 'error');
      }
      setFileName(f.name);
      setParsed(res);
      showToast(`${res.students.length} öğrenci okundu — ilk satırı kontrol edip ekleyin`);
    } catch {
      showToast('Dosya okunamadı (cp1254 değil olabilir)', 'error');
    }
  }

  function setName(i: number, v: string) {
    setParsed((p) => ({ ...p!, students: p!.students.map((s, idx) => (idx === i ? { ...s, name: v } : s)) }));
  }
  function removeRow(i: number) {
    setParsed((p) => ({ ...p!, students: p!.students.filter((_, idx) => idx !== i) }));
  }

  async function addAll() {
    if (!parsed?.students?.length) return;
    const students = parsed.students.map((s) => ({
      name: (s.name || '').trim() || 'İsimsiz',
      kitapcik: s.kitapcik === 'B' ? 'B' : 'A',
      answers: s.answers,
    }));
    setSaving(true);
    try {
      const res = await fetch(`/api/deneme/exams/${exam.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ source: 'dat', students }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; added?: number; matched?: number; graded?: boolean };
      if (!res.ok) return showToast(data.error || 'Eklenemedi', 'error');
      const not = data.graded ? '' : ' (cevap anahtarı yok → puan 0, anahtar girince Hesapla)';
      showToast(`${data.added} kayıt eklendi, ${data.matched} eşleşti${not}`);
      setParsed(null); setFileName('');
      if (inputRef.current) inputRef.current.value = '';
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-5 text-center cursor-pointer hover:border-[color:var(--brand)] bg-brand-soft-hover transition"
      >
        <div className="flex flex-col items-center gap-1.5 text-gray-400">
          <HardDriveDownload size={28} />
          <p className="text-sm text-gray-700">{fileName || 'Optik okuyucu .dat dosyası yükle'}</p>
          <p className="text-xs">{exam.examType} · 222-karakter optik şablonu</p>
        </div>
        <input ref={inputRef} type="file" accept=".dat,text/plain" className="hidden" onChange={onFile} />
      </div>

      {parsed && (
        <div className="space-y-3">
          {parsed.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{w}</span>
            </div>
          ))}

          <div className="text-xs text-gray-500">
            <span style={{ fontWeight: 600 }}>{parsed.students.length}</span> öğrenci · her satır {parsed.total} soru.
            İlk satır doğru görünüyorsa şablon eşleşiyordur — isimleri kontrol edip ekleyin.
          </div>

          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {parsed.students.map((s, i) => (
              <div key={i} className={`flex items-center gap-2 p-2 ${i === 0 ? 'bg-brand-soft' : ''}`}>
                <span className="text-[10px] text-gray-400 w-7 shrink-0 text-right">{i + 1}.</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${s.kitapcik === 'B' ? 'bg-purple-100 text-purple-600' : 'bg-sky-100 text-sky-600'}`}>{s.kitapcik}</span>
                <input
                  value={s.name}
                  onChange={(e) => setName(i, e.target.value)}
                  placeholder="Öğrenci adı"
                  className="input !py-1 flex-1 text-sm"
                />
                <span className={`text-xs shrink-0 ${s.answered < parsed.total * 0.25 ? 'text-amber-500' : 'text-gray-400'}`}>{s.answered}/{parsed.total}</span>
                <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-600 shrink-0"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <button onClick={addAll} disabled={saving || !parsed.students.length} className="btn-primary !px-5 !py-2 flex items-center gap-2 disabled:opacity-60">
            <Plus size={15} /> {saving ? 'Ekleniyor…' : `${parsed.students.length} Kaydı Sınava Ekle`}
          </button>
        </div>
      )}
    </div>
  );
}

interface OptikEkleProps {
  exam: DenemeExam;
  kitapcik: string;
  onChanged?: () => void;
  showToast: ShowToast;
}

// ---- Optik: foto/PDF oku → isim ata → sınava ekle ----
function OptikEkle({ exam, kitapcik, onChanged, showToast }: OptikEkleProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [forms, setForms] = useState<OptikForm[] | null>(null); // [{page, answers, total, name}]
  const [saving, setSaving] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) return showToast("Dosya 50 MB'dan büyük", 'error');
    const pdf = f.type === 'application/pdf';
    setFile(f); setIsPdf(pdf); setFileName(f.name); setForms(null);
    if (!pdf) { const r = new FileReader(); r.onload = (ev) => setPreview(ev.target?.result as string); r.readAsDataURL(f); }
    else setPreview(null);
  }

  async function read() {
    if (!file) return;
    setLoading(true); setForms(null);
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
      const data = (await res.json().catch(() => ({}))) as { error?: string; forms?: Omit<OptikForm, 'name'>[]; pageCount?: number };
      if (!res.ok) throw new Error(data.error || 'Hata');
      if (data.forms) {
        setForms(data.forms.map((f) => ({ ...f, name: '' })));
        showToast(`${data.pageCount} form okundu — isim girip sınava ekleyin`);
      } else {
        showToast('Form okundu ama parse edilemedi', 'error');
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function setName(i: number, v: string) {
    setForms((prev) => (prev || []).map((f, idx) => (idx === i ? { ...f, name: v } : f)));
  }
  function setAnswer(fi: number, ai: number, v: string) {
    setForms((prev) => (prev || []).map((f, idx) => {
      if (idx !== fi) return f;
      const answers = [...f.answers]; answers[ai] = v || null; return { ...f, answers };
    }));
  }

  async function addAll() {
    if (!forms?.length) return;
    const students = forms.map((f) => ({ name: (f.name || '').trim() || 'İsimsiz', answers: f.answers }));
    setSaving(true);
    try {
      const res = await fetch(`/api/deneme/exams/${exam.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ source: 'optik', kitapcik, students }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; added?: number; matched?: number; graded?: boolean };
      if (!res.ok) return showToast(data.error || 'Eklenemedi', 'error');
      const not = data.graded ? '' : ' (cevap anahtarı yok → puan 0, anahtar girince Hesapla)';
      showToast(`${data.added} kayıt eklendi, ${data.matched} eşleşti${not}`);
      setForms(null); setFile(null); setPreview(null); setFileName('');
      if (inputRef.current) inputRef.current.value = '';
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-5 text-center cursor-pointer hover:border-[color:var(--brand)] bg-brand-soft-hover transition"
      >
        {preview ? (
          <img src={preview} alt="" className="max-h-40 mx-auto rounded object-contain" />
        ) : isPdf ? (
          <div className="flex flex-col items-center gap-1.5 text-brand">
            <FileText size={30} /><p className="text-sm text-gray-700">{fileName}</p>
            <p className="text-xs text-gray-400">PDF — çok sayfalı toplu okuma</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-gray-400">
            <Upload size={28} /><p className="text-sm">Optik form yükle</p>
            <p className="text-xs flex items-center gap-3">
              <span className="flex items-center gap-1"><FileText size={12} /> PDF</span>
              <span className="flex items-center gap-1"><ImageIcon size={12} /> JPG/PNG</span>
            </p>
          </div>
        )}
        <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
      </div>

      {file && !forms && (
        <button onClick={read} disabled={loading} className="btn-primary !px-5 !py-2 flex items-center gap-2 disabled:opacity-60">
          <ScanLine size={15} /> {loading ? 'Okunuyor…' : 'Formu Oku'}
        </button>
      )}

      {forms && (
        <div className="space-y-2">
          {forms.map((f, i) => (
            <div key={i} className="border border-gray-200 rounded-lg">
              <div className="flex items-center gap-2 p-2">
                <span className="text-xs text-gray-400 w-12 shrink-0">#{f.page ?? i + 1}</span>
                <input
                  value={f.name}
                  onChange={(e) => setName(i, e.target.value)}
                  placeholder="Öğrenci adı"
                  className="input !py-1.5 flex-1"
                />
                <span className="text-xs text-gray-400 shrink-0">{f.answers.length} cevap</span>
                <button onClick={() => setOpenIdx(openIdx === i ? null : i)} className="text-gray-400 hover:text-gray-600">
                  <ChevronDown size={16} className={openIdx === i ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
              </div>
              {openIdx === i && (
                <div className="p-2 pt-0 grid grid-cols-2 sm:grid-cols-5 gap-1">
                  {f.answers.map((a, ai) => (
                    <div key={ai} className="flex items-center gap-1 bg-gray-50 rounded px-1.5 py-0.5">
                      <span className="text-[10px] text-gray-400 w-5 text-right">{ai + 1}.</span>
                      <select value={a ?? ''} onChange={(e) => setAnswer(i, ai, e.target.value)} className="flex-1 text-xs bg-white border border-gray-200 rounded">
                        <option value="">—</option>
                        {CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button onClick={addAll} disabled={saving} className="btn-primary !px-5 !py-2 flex items-center gap-2 disabled:opacity-60">
            <Plus size={15} /> {saving ? 'Ekleniyor…' : `${forms.length} Kaydı Sınava Ekle`}
          </button>
        </div>
      )}
    </div>
  );
}

interface ManuelEkleProps {
  exam: DenemeExam;
  kitapcik: string;
  onChanged?: () => void;
  showToast: ShowToast;
}

// ---- Manuel: isim + kutu kutu cevap → tek öğrenci ekle ----
function ManuelEkle({ exam, kitapcik, onChanged, showToast }: ManuelEkleProps) {
  const template = getTemplate(exam.examType);
  const [name, setName] = useState('');
  const [boxes, setBoxes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!template) return null;

  function buildFlat(): (string | null)[] {
    // Kutuları booklet sırasında birleştir → düz cevap dizisi (her kutu tam uzunlukta).
    const flat: (string | null)[] = [];
    for (const box of template!.boxes) {
      const chars = normalizeRaw(boxes[box.key] || '');
      const len = boxLength(box);
      for (let i = 0; i < len; i++) flat.push(chars[i] && chars[i] !== ' ' ? chars[i] : null);
    }
    return flat;
  }

  async function add() {
    if (!name.trim()) return showToast('İsim gir', 'error');
    setSaving(true);
    try {
      const res = await fetch(`/api/deneme/exams/${exam.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ source: 'manual', kitapcik, students: [{ name: name.trim(), answers: buildFlat() }] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return showToast(data.error || 'Eklenemedi', 'error');
      showToast(`${name.trim()} eklendi`);
      setName(''); setBoxes({});
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Öğrenci adı" className="input" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {template.boxes.map((box) => {
          const exp = boxLength(box);
          const got = String(boxes[box.key] || '').replace(/\s/g, '').length;
          return (
            <div key={box.key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm" style={{ fontWeight: 600 }}>{box.label}</span>
                <span className={`text-xs ${got === exp ? 'text-emerald-600' : 'text-gray-400'}`}>{got}/{exp}</span>
              </div>
              <textarea
                value={boxes[box.key] || ''}
                onChange={(e) => setBoxes((p) => ({ ...p, [box.key]: e.target.value }))}
                rows={2} spellCheck={false}
                className="input font-mono uppercase"
                style={{ letterSpacing: '0.08em', resize: 'vertical' }}
              />
            </div>
          );
        })}
      </div>
      <button onClick={add} disabled={saving} className="btn-primary !px-5 !py-2 flex items-center gap-2 disabled:opacity-60">
        <Plus size={15} /> {saving ? 'Ekleniyor…' : 'Öğrenci Ekle'}
      </button>
    </div>
  );
}

interface KayitListesiProps {
  exam: DenemeExam;
  rows: ExamRowDTO[];
  onChanged?: () => void;
  showToast: ShowToast;
}

// ---- Kayıtlar + öğrenci eşleştirme ----
function KayitListesi({ exam, rows, onChanged, showToast }: KayitListesiProps) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad (öğrenci eşleştirme)
  const confirm = useConfirm();
  const [students, setStudents] = useState<StudentDTO[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({}); // rowId -> studentId
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/students', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: StudentDTO[]) => setStudents(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // rows değişince yerel eşleştirme taslağını sıfırla (kaydedilmişleri yansıt)
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const r of rows) init[r.id] = r.studentId || '';
    setMatches(init);
  }, [rows]);

  const dirty = useMemo(
    () => rows.some((r) => (matches[r.id] || '') !== (r.studentId || '')),
    [rows, matches]
  );

  async function del(rowId: string) {
    if (!(await confirm('Bu kaydı sil?'))) return;
    const res = await fetch(`/api/deneme/exams/${exam.id}/rows?rowId=${rowId}`, { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) { showToast('Kayıt silindi'); onChanged?.(); }
  }

  async function saveMatches() {
    const payload = rows
      .filter((r) => (matches[r.id] || '') !== (r.studentId || ''))
      .map((r) => ({ rowId: r.id, excelName: r.excelName, studentId: matches[r.id] || '' }));
    if (!payload.length) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/deneme/exams/${exam.id}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ matches: payload }),
      });
      if (res.ok) { showToast('Eşleştirmeler kaydedildi'); onChanged?.(); }
    } finally {
      setSaving(false);
    }
  }

  if (!rows.length) {
    return <div className="card p-6 text-center text-gray-400 text-sm">Henüz kayıt yok. Yukarıdan optik/manuel ekle.</div>;
  }

  const matchedCount = rows.filter((r) => matches[r.id]).length;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <span className="text-sm" style={{ fontWeight: 600 }}>Kayıtlar ({rows.length}) · {matchedCount} eşleşti</span>
        {dirty && (
          <button onClick={saveMatches} disabled={saving} className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5">
            <Save size={13} /> {saving ? 'Kaydediliyor…' : 'Eşleştirmeleri Kaydet'}
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>İsim</th>
              <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Net</th>
              <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>Öğrenci</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-50">
                <td className="px-3 py-1.5 text-gray-700">
                  {r.excelName}
                  <span className="text-[10px] text-gray-300 ml-1.5 uppercase">{r.source}</span>
                </td>
                <td className="px-3 py-1.5 text-right text-gray-500">{Number(r.toplamNet || 0).toFixed(2)}</td>
                <td className="px-3 py-1.5">
                  <select
                    value={matches[r.id] || ''}
                    onChange={(e) => setMatches((m) => ({ ...m, [r.id]: e.target.value }))}
                    className={`rounded-lg border px-2 py-1 text-xs bg-white focus:outline-none ${matches[r.id] ? 'border-gray-200' : 'border-amber-300'}`}
                  >
                    <option value="">— eşleştir —</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.cls ? ` (${classShort(classes, s.cls)})` : ''}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
