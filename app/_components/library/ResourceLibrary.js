'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { upload } from '@vercel/blob/client';
import {
  BookOpen, FileText, Youtube, Link2, Plus, Trash2, X, Upload,
  ExternalLink, Play, Filter,
} from 'lucide-react';
import { STUDENT_GROUPS, classLabel } from '@/lib/constants';

const TYPE_META = {
  pdf:   { label: 'PDF Föy', icon: FileText, color: 'text-rose-600',   bg: 'bg-rose-50' },
  video: { label: 'Video',   icon: Youtube,  color: 'text-red-600',    bg: 'bg-red-50' },
  link:  { label: 'Link',    icon: Link2,    color: 'text-sky-600',    bg: 'bg-sky-50' },
};

// YouTube / Vimeo linkini gömülebilir (embed) URL'e çevir; değilse null.
function embedUrl(url) {
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

export default function ResourceLibrary({ canManage, branches = [], userRole, userId, showToast }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [video, setVideo] = useState(null); // {url, title} embed modal

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/resources', { credentials: 'same-origin' });
      const data = await res.json();
      if (res.ok) setResources(data.resources || []);
    } catch { /* sessiz */ }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => resources.filter(r =>
    (!filterBranch || r.branch === filterBranch) &&
    (!filterType || r.type === filterType)
  ), [resources, filterBranch, filterType]);

  const branchOptions = useMemo(() => {
    const set = new Set(resources.map(r => r.branch));
    return [...set].sort();
  }, [resources]);

  async function handleDelete(id) {
    if (!confirm('Bu kaynak silinsin mi?')) return;
    try {
      const res = await fetch(`/api/resources?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Silinemedi');
      setResources(prev => prev.filter(r => r.id !== id));
      showToast?.('Kaynak silindi');
    } catch (err) { showToast?.(err.message, 'error'); }
  }

  function canDelete(r) {
    if (userRole === 'director') return true;
    if (userRole === 'teacher') return r.uploadedBy === userId;
    return false;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-indigo-600" />
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Kütüphane</h3>
          <span className="text-xs text-slate-400">({resources.length})</span>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            <Plus size={15} /> Kaynak Ekle
          </button>
        )}
      </div>

      {/* Filtreler */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter size={14} className="text-slate-400" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
          <option value="">Tüm türler</option>
          <option value="pdf">PDF</option>
          <option value="video">Video</option>
          <option value="link">Link</option>
        </select>
        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
          <option value="">Tüm dersler</option>
          {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Yükleniyor…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <BookOpen size={36} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">{resources.length === 0 ? 'Henüz kaynak eklenmemiş.' : 'Filtreye uygun kaynak yok.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(r => {
            const meta = TYPE_META[r.type] || TYPE_META.link;
            const Icon = meta.icon;
            return (
              <div key={r.id} className="border border-slate-200 rounded-xl p-3.5 flex flex-col gap-2 hover:shadow-sm transition">
                <div className="flex items-start gap-2.5">
                  <div className={`${meta.bg} ${meta.color} rounded-lg p-2 shrink-0`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-600 text-slate-800 leading-tight break-words" style={{ fontWeight: 600 }}>{r.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{r.branch}{r.topic ? ` · ${r.topic}` : ''}</p>
                  </div>
                  {canManage && canDelete(r) && (
                    <button onClick={() => handleDelete(r.id)} className="text-slate-300 hover:text-rose-500 shrink-0">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {(r.classes || []).slice(0, 3).map(c => (
                    <span key={c} className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{c}</span>
                  ))}
                  {(r.classes || []).length > 3 && (
                    <span className="text-[10px] text-slate-400">+{r.classes.length - 3}</span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px] text-slate-400 truncate">{r.uploadedByName}</span>
                  {r.type === 'video' && embedUrl(r.url) ? (
                    <button onClick={() => setVideo({ url: embedUrl(r.url), title: r.title })}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:underline shrink-0">
                      <Play size={13} /> İzle
                    </button>
                  ) : (
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:underline shrink-0">
                      {r.type === 'pdf' ? <><FileText size={13} /> Aç</> : <><ExternalLink size={13} /> Aç</>}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <ResourceForm
          branches={branches}
          onClose={() => setShowForm(false)}
          onSaved={(rec) => { setResources(prev => [rec, ...prev]); setShowForm(false); showToast?.('Kaynak eklendi'); }}
          showToast={showToast}
        />
      )}

      {video && <VideoModal url={video.url} title={video.title} onClose={() => setVideo(null)} />}
    </div>
  );
}

// ----- Video embed modal -----
function VideoModal({ url, title, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl overflow-hidden w-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
          <p className="text-sm font-600 truncate" style={{ fontWeight: 600 }}>{title}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe src={url} title={title} className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen />
        </div>
      </div>
    </div>
  );
}

// ----- Ekleme formu -----
function ResourceForm({ branches, onClose, onSaved, showToast }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('pdf');
  const [branch, setBranch] = useState(branches[0] || '');
  const [topic, setTopic] = useState('');
  const [url, setUrl] = useState('');
  const [classes, setClasses] = useState(() => new Set());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  function toggleClass(c) {
    setClasses(prev => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  }
  function toggleGroup(groupClasses) {
    setClasses(prev => {
      const next = new Set(prev);
      const allIn = groupClasses.every(c => next.has(c));
      groupClasses.forEach(c => allIn ? next.delete(c) : next.add(c));
      return next;
    });
  }

  async function submit() {
    if (!title.trim()) return showToast?.('Başlık gerekli', 'error');
    if (!branch) return showToast?.('Ders seçin', 'error');
    if (classes.size === 0) return showToast?.('En az bir sınıf seçin', 'error');

    setBusy(true);
    try {
      let finalUrl = url.trim();

      if (type === 'pdf') {
        if (!file) { setBusy(false); return showToast?.('PDF dosyası seçin', 'error'); }
        if (file.size > 20 * 1024 * 1024) { setBusy(false); return showToast?.('Dosya 20 MB\'dan büyük', 'error'); }
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/resources/upload',
          contentType: 'application/pdf',
        });
        finalUrl = blob.url;
      } else {
        if (!finalUrl) { setBusy(false); return showToast?.('URL girin', 'error'); }
        try { new URL(finalUrl); } catch { setBusy(false); return showToast?.('Geçerli bir URL girin', 'error'); }
      }

      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: title.trim(), type, url: finalUrl, branch,
          topic: topic.trim() || undefined, classes: [...classes],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
      onSaved(data.resource);
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 sticky top-0 bg-white">
          <h4 className="font-700" style={{ fontWeight: 700 }}>Kaynak Ekle</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3.5">
          {/* Tür */}
          <div>
            <label className="text-xs font-600 text-slate-600 block mb-1.5" style={{ fontWeight: 600 }}>Tür</label>
            <div className="flex gap-2">
              {Object.entries(TYPE_META).map(([key, m]) => {
                const Icon = m.icon;
                return (
                  <button key={key} type="button" onClick={() => setType(key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs transition
                      ${type === key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    <Icon size={14} /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-600 text-slate-600 block mb-1.5" style={{ fontWeight: 600 }}>Başlık</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Örn: Türev Föyü - 1"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-600 text-slate-600 block mb-1.5" style={{ fontWeight: 600 }}>Ders</label>
              <select value={branch} onChange={e => setBranch(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white">
                {branches.length === 0 && <option value="">—</option>}
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-600 text-slate-600 block mb-1.5" style={{ fontWeight: 600 }}>Konu <span className="text-slate-300">(ops.)</span></label>
              <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Örn: Türev"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          </div>

          {/* PDF dosya veya URL */}
          {type === 'pdf' ? (
            <div>
              <label className="text-xs font-600 text-slate-600 block mb-1.5" style={{ fontWeight: 600 }}>PDF Dosyası</label>
              <div onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30">
                {file ? (
                  <p className="text-sm text-slate-700 flex items-center justify-center gap-1.5"><FileText size={15} className="text-rose-500" /> {file.name}</p>
                ) : (
                  <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5"><Upload size={14} /> PDF seç (maks 20 MB)</p>
                )}
                <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
                  onChange={e => setFile(e.target.files?.[0] || null)} />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-600 text-slate-600 block mb-1.5" style={{ fontWeight: 600 }}>
                {type === 'video' ? 'Video Linki (YouTube/Vimeo)' : 'Web Adresi'}
              </label>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          )}

          {/* Sınıf hedefleme */}
          <div>
            <label className="text-xs font-600 text-slate-600 block mb-1.5" style={{ fontWeight: 600 }}>
              Hedef Sınıflar <span className="text-slate-400">({classes.size} seçili)</span>
            </label>
            <div className="border border-slate-200 rounded-lg p-2 max-h-52 overflow-y-auto flex flex-col gap-2.5">
              {Object.entries(STUDENT_GROUPS).map(([gKey, g]) => {
                const allIn = g.classes.every(c => classes.has(c));
                return (
                  <div key={gKey}>
                    <button type="button" onClick={() => toggleGroup(g.classes)}
                      className={`text-[11px] font-600 mb-1 px-2 py-0.5 rounded ${allIn ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}
                      style={{ fontWeight: 600 }}>
                      {g.label} {allIn ? '✓' : 'tümü'}
                    </button>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1">
                      {g.classes.map(c => (
                        <label key={c} className={`text-[11px] flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer border
                          ${classes.has(c) ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-150 text-slate-500 hover:bg-slate-50'}`}>
                          <input type="checkbox" checked={classes.has(c)} onChange={() => toggleClass(c)} className="hidden" />
                          {c}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 rounded-lg hover:bg-slate-100">İptal</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}
