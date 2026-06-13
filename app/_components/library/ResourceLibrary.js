'use client';
import { useState, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { upload } from '@vercel/blob/client';
import EmptyState from '../EmptyState';
import {
  BookOpen, FileText, Youtube, Link2, Plus, Trash2, X, Upload,
  ExternalLink, Play, Filter, GraduationCap, ChevronDown,
} from 'lucide-react';
import { useClasses } from '../ClassesContext';
import { groupedClasses, classShort } from '@/lib/classCatalog';
import { MEBI_LINKS } from '@/lib/mebi-links';

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
  const { classes: regClasses } = useClasses();
  const { data, isLoading: loading, mutate } = useSWR('/api/resources');
  const resources = data?.resources || [];
  const [filterBranch, setFilterBranch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [video, setVideo] = useState(null); // {url, title} embed modal

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
      mutate({ resources: resources.filter(r => r.id !== id) }, { revalidate: false });
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
          <span className="text-caption">({resources.length})</span>
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

      {/* Küratörlü ücretsiz MEB/MEBİ kaynakları — salt link, herkese görünür */}
      <FreeResourcesShelf />

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
        <p className="text-caption py-8 text-center">Yükleniyor…</p>
      ) : filtered.length === 0 ? (
        <EmptyState icon={BookOpen}
          title={resources.length === 0 ? 'Henüz kaynak eklenmemiş' : 'Filtreye uygun kaynak yok'}
          description={resources.length === 0 ? 'PDF, video veya bağlantı ekleyerek kütüphaneyi oluşturun.' : 'Farklı bir filtre deneyin.'} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(r => {
            const meta = TYPE_META[r.type] || TYPE_META.link;
            const Icon = meta.icon;
            return (
              <div key={r.id} className="card p-3.5 flex flex-col gap-2">
                <div className="flex items-start gap-2.5">
                  <div className={`${meta.bg} ${meta.color} rounded-lg p-2 shrink-0`}>
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-600 leading-tight break-words" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.title}</p>
                    <p className="text-body-sm mt-0.5">{r.branch}{r.topic ? ` · ${r.topic}` : ''}</p>
                  </div>
                  {canManage && canDelete(r) && (
                    <button onClick={() => handleDelete(r.id)} className="text-slate-300 hover:text-rose-500 shrink-0">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {(r.classes || []).slice(0, 3).map(c => (
                    <span key={c} className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{classShort(regClasses, c)}</span>
                  ))}
                  {(r.classes || []).length > 3 && (
                    <span className="text-[10px] text-slate-400">+{r.classes.length - 3}</span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span className="text-caption truncate">{r.uploadedByName}</span>
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
          onSaved={(rec) => { mutate({ resources: [rec, ...resources] }, { revalidate: false }); setShowForm(false); showToast?.('Kaynak eklendi'); }}
          showToast={showToast}
        />
      )}

      {video && <VideoModal url={video.url} title={video.title} onClose={() => setVideo(null)} />}
    </div>
  );
}

// ----- Ücretsiz MEB/MEBİ kaynak rafı (küratörlü, salt link, kurum kurulumu gerekmez) -----
function FreeResourcesShelf() {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4 border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 hover:brightness-95"
        style={{ background: 'var(--surface-2, #f8fafc)' }}
      >
        <span className="flex items-center gap-2">
          <GraduationCap size={17} className="text-emerald-600" />
          <span className="text-sm font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Ücretsiz Eğitim Kaynakları</span>
          <span className="text-[10px] bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">MEB · ücretsiz</span>
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {MEBI_LINKS.map(l => (
            <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
              className="card p-3 flex flex-col gap-1 hover:border-emerald-300 transition group">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-600 leading-tight" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.title}</p>
                <ExternalLink size={13} className="text-slate-300 group-hover:text-emerald-500 shrink-0" />
              </div>
              <p className="text-body-sm leading-snug">{l.desc}</p>
              <span className="text-[10px] text-slate-400 mt-0.5">{l.tag}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Video embed modal -----
function VideoModal({ url, title, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal overflow-hidden w-full max-w-3xl" onClick={e => e.stopPropagation()}>
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
  const { classes: regClasses } = useClasses();
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
      <div role="dialog" aria-modal="true" className="modal w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 sticky top-0 bg-white">
          <h4 className="font-700" style={{ fontWeight: 700 }}>Kaynak Ekle</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3.5">
          {/* Tür */}
          <div>
            <label className="text-label block mb-1.5">Tür</label>
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
            <label className="text-label block mb-1.5">Başlık</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Örn: Türev Föyü - 1"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label block mb-1.5">Ders</label>
              <select value={branch} onChange={e => setBranch(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white">
                {branches.length === 0 && <option value="">—</option>}
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-label block mb-1.5">Konu <span className="font-400" style={{ color: 'var(--text-muted)' }}>(ops.)</span></label>
              <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Örn: Türev"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          </div>

          {/* PDF dosya veya URL */}
          {type === 'pdf' ? (
            <div>
              <label className="text-label block mb-1.5">PDF Dosyası</label>
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
              <label className="text-label block mb-1.5">
                {type === 'video' ? 'Video Linki (YouTube/Vimeo)' : 'Web Adresi'}
              </label>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          )}

          {/* Sınıf hedefleme */}
          <div>
            <label className="text-label block mb-1.5">
              Hedef Sınıflar <span className="font-400" style={{ color: 'var(--text-muted)' }}>({classes.size} seçili)</span>
            </label>
            <div className="border border-slate-200 rounded-lg p-2 max-h-52 overflow-y-auto flex flex-col gap-2.5">
              {groupedClasses(regClasses).map((g) => {
                const ids = g.items.map(i => i.id);
                const allIn = ids.length > 0 && ids.every(c => classes.has(c));
                return (
                  <div key={g.key}>
                    <button type="button" onClick={() => toggleGroup(ids)}
                      className={`text-[11px] font-600 mb-1 px-2 py-0.5 rounded ${allIn ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}
                      style={{ fontWeight: 600 }}>
                      {g.label} {allIn ? '✓' : 'tümü'}
                    </button>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1">
                      {g.items.map(c => (
                        <label key={c.id} className={`text-[11px] flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer border
                          ${classes.has(c.id) ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-150 text-slate-500 hover:bg-slate-50'}`}>
                          <input type="checkbox" checked={classes.has(c.id)} onChange={() => toggleClass(c.id)} className="hidden" />
                          {classShort(regClasses, c.id)}
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
