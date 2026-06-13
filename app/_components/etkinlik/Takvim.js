'use client';
import { useState, useMemo, useEffect } from 'react';
import useSWR from 'swr';
import {
  CalendarDays, Plus, Trash2, X, Check, Send, PencilLine, ChevronDown, Users,
} from 'lucide-react';
import { useClasses } from '../ClassesContext';
import { groupedClasses } from '@/lib/classCatalog';
import EmptyState from '../EmptyState';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

// Tür → etiket + renk (dark-mode'da color-mix tonlarıyla çalışır).
const TYPES = [
  { key: 'tatil', label: 'Tatil', color: '#16a34a' },
  { key: 'sinav', label: 'Sınav', color: '#e11d48' },
  { key: 'toplanti', label: 'Toplantı', color: '#6366f1' },
  { key: 'gezi', label: 'Gezi', color: '#f59e0b' },
  { key: 'etkinlik', label: 'Etkinlik', color: '#8b5cf6' },
  { key: 'diger', label: 'Diğer', color: '#64748b' },
];
const TYPE_MAP = Object.fromEntries(TYPES.map(t => [t.key, t]));

const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const DOW = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];

function parseYmd(ymd) {
  if (!ymd) return null;
  const d = new Date(ymd + 'T00:00:00');
  return isNaN(d) ? null : d;
}
function todayYmd() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function isPast(ev) {
  return (ev.endDate || ev.startDate) < todayYmd();
}
function monthKey(ymd) { return (ymd || '').slice(0, 7); }
function monthLabel(ymd) {
  const d = parseYmd(ymd); if (!d) return '';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function rangeLabel(ev) {
  const s = parseYmd(ev.startDate); if (!s) return '';
  const sLbl = `${s.getDate()} ${MONTHS[s.getMonth()]} ${DOW[s.getDay()]}`;
  if (ev.endDate && ev.endDate !== ev.startDate) {
    const e = parseYmd(ev.endDate);
    if (e) return `${sLbl} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
  }
  return sLbl;
}

// ════════════════════ Ortak etkinlik kartı ════════════════════
function EventCard({ ev, classMap, onEdit, onDelete }) {
  const t = TYPE_MAP[ev.type] || TYPE_MAP.diger;
  const d = parseYmd(ev.startDate);
  const cl = Array.isArray(ev.classes) ? ev.classes : [];
  const scope = cl.length === 0
    ? 'Herkese açık'
    : cl.map(c => classMap.get(c) || c).join(', ');

  return (
    <div className="rounded-xl p-3 flex gap-3" style={{ border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${t.color}` }}>
      {/* Tarih bloğu */}
      <div className="shrink-0 w-12 text-center">
        <div className="text-lg leading-none font-700" style={{ fontWeight: 700, color: t.color }}>{d ? d.getDate() : '?'}</div>
        <div className="text-[10px] uppercase mt-0.5" style={{ color: 'var(--text-muted)' }}>{d ? MONTHS[d.getMonth()].slice(0, 3) : ''}</div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{d ? DOW[d.getDay()] : ''}</div>
      </div>

      {/* İçerik */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="font-600 flex-1 min-w-0" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ev.title}</p>
          {(onEdit || onDelete) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {onEdit && <button onClick={() => onEdit(ev)} className="hover:text-indigo-600" style={{ color: 'var(--text-muted)' }} title="Düzenle"><PencilLine size={14} /></button>}
              {onDelete && <button onClick={() => onDelete(ev)} className="hover:text-rose-500" style={{ color: 'var(--text-muted)' }} title="Sil"><Trash2 size={14} /></button>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap text-caption">
          <span className="badge" style={{ background: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color, border: `1px solid color-mix(in srgb, ${t.color} 30%, transparent)` }}>{t.label}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{rangeLabel(ev)}</span>
          <span className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><Users size={11} /> {scope}</span>
        </div>
        {ev.desc && <p className="text-sm mt-1.5 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{ev.desc}</p>}
      </div>
    </div>
  );
}

// Aylara göre grupla + render
function MonthGroups({ events, classMap, onEdit, onDelete }) {
  const groups = useMemo(() => {
    const map = new Map();
    events.forEach(ev => {
      const k = monthKey(ev.startDate);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(ev);
    });
    return [...map.entries()];
  }, [events]);

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([k, evs]) => (
        <div key={k}>
          <h4 className="text-xs uppercase tracking-wide mb-2" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{monthLabel(evs[0].startDate)}</h4>
          <div className="flex flex-col gap-2">
            {evs.map(ev => <EventCard key={ev.id} ev={ev} classMap={classMap} onEdit={onEdit} onDelete={onDelete} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function useClassMap() {
  const { classes } = useClasses();
  return useMemo(() => new Map((classes || []).map(c => [c.id, c.ad])), [classes]);
}

// Yaklaşan + geçmiş ayrımı (paylaşılan)
function splitEvents(list) {
  const upcoming = list.filter(ev => !isPast(ev));            // artan (API zaten artan döner)
  const past = list.filter(ev => isPast(ev)).reverse();       // en yeni geçmiş önce
  return { upcoming, past };
}

// ════════════════════ YÖNETİCİ ════════════════════
export function TakvimManager({ showToast }) {
  const { data, isLoading, mutate } = useSWR('/api/etkinlik');
  const list = data?.etkinlikler || [];
  const classMap = useClassMap();
  const [editing, setEditing] = useState(null); // düzenlenen etkinlik
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past } = splitEvents(list);

  async function remove(ev) {
    if (!confirm(`"${ev.title}" etkinliği silinsin mi?`)) return;
    try {
      await api(`/api/etkinlik?id=${encodeURIComponent(ev.id)}`, { method: 'DELETE' });
      mutate({ ...data, etkinlikler: list.filter(x => x.id !== ev.id) }, { revalidate: false });
      if (editing?.id === ev.id) setEditing(null);
      showToast?.('Etkinlik silindi');
    } catch (e) { showToast?.(e.message, 'error'); }
  }

  return (
    <div className="max-w-2xl">
      <TakvimComposer showToast={showToast} editing={editing} onDone={() => { setEditing(null); mutate(); }} onCancel={() => setEditing(null)} />

      <h4 className="text-subheading mt-7 mb-3">Yaklaşan</h4>
      {isLoading ? (
        <p className="text-caption py-6 text-center">Yükleniyor…</p>
      ) : upcoming.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Yaklaşan etkinlik yok" description="Yukarıdan tatil, sınav, toplantı ekleyin." />
      ) : (
        <MonthGroups events={upcoming} classMap={classMap} onEdit={setEditing} onDelete={remove} />
      )}

      {past.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowPast(v => !v)} className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            <ChevronDown size={15} className={`transition-transform ${showPast ? 'rotate-180' : ''}`} />
            Geçmiş etkinlikler ({past.length})
          </button>
          {showPast && <div className="mt-3 opacity-75"><MonthGroups events={past} classMap={classMap} onEdit={setEditing} onDelete={remove} /></div>}
        </div>
      )}
    </div>
  );
}

function TakvimComposer({ showToast, editing, onDone, onCancel }) {
  const { classes } = useClasses();
  const groups = groupedClasses(classes);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState('etkinlik');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sel, setSel] = useState([]); // boş = herkes
  const [busy, setBusy] = useState(false);
  const [edId, setEdId] = useState(null);

  // editing değişince formu doldur
  useEffect(() => {
    if (editing) {
      setEdId(editing.id);
      setTitle(editing.title || '');
      setDesc(editing.desc || '');
      setType(editing.type || 'etkinlik');
      setStartDate(editing.startDate || '');
      setEndDate(editing.endDate || '');
      setSel(Array.isArray(editing.classes) ? editing.classes : []);
    }
  }, [editing]);

  function reset() {
    setEdId(null); setTitle(''); setDesc(''); setType('etkinlik'); setStartDate(''); setEndDate(''); setSel([]);
  }
  function toggle(id) { setSel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); }
  function toggleGroup(g) {
    const ids = g.items.map(i => i.id);
    const allOn = ids.every(id => sel.includes(id));
    setSel(p => allOn ? p.filter(x => !ids.includes(x)) : [...new Set([...p, ...ids])]);
  }

  async function save() {
    if (!title.trim()) return showToast?.('Başlık gerekli', 'error');
    if (!startDate) return showToast?.('Tarih gerekli', 'error');
    setBusy(true);
    try {
      const body = {
        action: edId ? 'update' : 'create',
        ...(edId ? { id: edId } : {}),
        title: title.trim(), desc: desc.trim(), type, startDate, endDate, classes: sel,
      };
      await api('/api/etkinlik', { method: 'POST', body: JSON.stringify(body) });
      showToast?.(edId ? 'Etkinlik güncellendi' : 'Etkinlik eklendi');
      reset();
      onDone?.();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays size={18} className="text-indigo-600" />
        <h3 className="font-700" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{edId ? 'Etkinliği Düzenle' : 'Yeni Etkinlik'}</h3>
        {edId && <button onClick={() => { reset(); onCancel?.(); }} className="ml-auto text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><X size={13} /> Vazgeç</button>}
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Başlık (ör. 1. Dönem 2. Yazılı / Veli Toplantısı)" className="input !text-sm mb-2" />

      {/* Tür seçimi */}
      <div className="flex flex-wrap gap-1 mb-2">
        {TYPES.map(t => {
          const on = type === t.key;
          return (
            <button key={t.key} onClick={() => setType(t.key)}
              className="text-xs px-2.5 py-1 rounded-md"
              style={on
                ? { background: t.color, color: '#fff', fontWeight: 600 }
                : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Başlangıç
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2" />
        </label>
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Bitiş (ops.)
          <input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2" />
        </label>
      </div>

      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Açıklama (opsiyonel)" className="input !text-sm mb-2 resize-y" />

      {/* Sınıf hedefi (opsiyonel) */}
      <div className="rounded-lg p-2.5 mb-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          Kimlere görünsün: <span style={{ color: sel.length === 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{sel.length === 0 ? 'herkese açık' : `${sel.length} sınıf`}</span>
        </p>
        {groups.length === 0 ? (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sınıf bulunamadı</span>
        ) : groups.map(g => {
          const ids = g.items.map(i => i.id);
          const allOn = ids.every(id => sel.includes(id));
          return (
            <div key={g.key} className="mb-2 last:mb-0">
              <button onClick={() => toggleGroup(g)} className={`text-[11px] uppercase tracking-wide mb-1 ${allOn ? 'text-indigo-600' : ''}`}
                style={{ fontWeight: 700, color: allOn ? undefined : 'var(--text-muted)' }}>{g.label}</button>
              <div className="flex flex-wrap gap-1">
                {g.items.map(c => {
                  const on = sel.includes(c.id);
                  return (
                    <button key={c.id} onClick={() => toggle(c.id)}
                      className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 ${on ? 'bg-indigo-600 text-white' : 'hover:bg-[var(--bg-muted)]'}`}
                      style={on ? undefined : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                      {on && <Check size={11} />} {c.ad}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm">
          {edId ? <Check size={14} /> : <Plus size={14} />} {busy ? 'Kaydediliyor…' : edId ? 'Güncelle' : 'Ekle'}
        </button>
      </div>
    </div>
  );
}

// ════════════════════ SALT-OKUNUR (öğrenci / veli / öğretmen) ════════════════════
export function TakvimView() {
  const { data, isLoading } = useSWR('/api/etkinlik');
  const list = data?.etkinlikler || [];
  const classMap = useClassMap();
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past } = splitEvents(list);

  if (isLoading) return <p className="text-caption py-8 text-center">Yükleniyor…</p>;
  if (list.length === 0) return <EmptyState icon={CalendarDays} title="Etkinlik yok" description="Okul takvimi etkinlikleri burada görünür." />;

  return (
    <div className="max-w-2xl">
      {upcoming.length > 0 ? (
        <MonthGroups events={upcoming} classMap={classMap} />
      ) : (
        <p className="text-caption py-4">Yaklaşan etkinlik yok.</p>
      )}
      {past.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowPast(v => !v)} className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            <ChevronDown size={15} className={`transition-transform ${showPast ? 'rotate-180' : ''}`} />
            Geçmiş etkinlikler ({past.length})
          </button>
          {showPast && <div className="mt-3 opacity-75"><MonthGroups events={past} classMap={classMap} /></div>}
        </div>
      )}
    </div>
  );
}
