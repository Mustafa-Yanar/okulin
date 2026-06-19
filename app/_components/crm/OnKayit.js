'use client';
import { useState } from 'react';
import useSWR from 'swr';
import {
  UserPlus, Plus, Trash2, X, Phone, ChevronDown, ChevronUp, Send, Clock,
} from 'lucide-react';
import EmptyState from '../EmptyState';
import { useConfirm } from '../ConfirmProvider';

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

const SOURCE_LABEL = {
  tavsiye: 'Tavsiye', sosyal: 'Sosyal medya', web: 'Web', afis: 'Afiş/broşür',
  telefon: 'Telefon', ziyaret: 'Ziyaret', diger: 'Diğer',
};
const STATUSES = ['yeni', 'arandi', 'gorusme', 'kayit', 'kayip'];
const STATUS = {
  yeni: { label: 'Yeni', badge: 'badge-info' },
  arandi: { label: 'Arandı', badge: 'badge-warning' },
  gorusme: { label: 'Görüşme', badge: 'badge' },
  kayit: { label: 'Kayıt oldu', badge: 'badge-success' },
  kayip: { label: 'Kaybedildi', badge: 'badge-danger' },
};

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ════════════════════ YÖNETİCİ (müdür / rehber) ════════════════════
export function OnKayitManager({ showToast }) {
  const confirm = useConfirm();
  const { data, isLoading, mutate } = useSWR('/api/onkayit');
  const list = data?.leadler || [];
  const stats = data?.stats || {};
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('hepsi');

  const filtered = filter === 'hepsi' ? list : list.filter(l => l.status === filter);

  async function remove(l) {
    if (!(await confirm(`"${l.studentName}" aday kaydı silinsin mi?`))) return;
    try {
      await api(`/api/onkayit?id=${encodeURIComponent(l.id)}`, { method: 'DELETE' });
      mutate();
      showToast?.('Aday silindi');
    } catch (e) { showToast?.(e.message, 'error'); }
  }

  return (
    <div className="max-w-2xl">
      {adding ? (
        <LeadForm showToast={showToast} onDone={() => { setAdding(false); mutate(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={15} /> Yeni Aday
        </button>
      )}

      {/* Huni sayıları + filtre */}
      <div className="flex flex-wrap gap-1.5 mt-5 mb-4">
        <FilterChip active={filter === 'hepsi'} onClick={() => setFilter('hepsi')} label="Hepsi" count={list.length} />
        {STATUSES.map(s => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} label={STATUS[s].label} count={stats[s] || 0} badge={STATUS[s].badge} />
        ))}
      </div>

      {isLoading ? (
        <p className="text-caption py-6 text-center">Yükleniyor…</p>
      ) : list.length === 0 ? (
        <EmptyState icon={UserPlus} title="Henüz aday yok" description="Arayan/gelen velileri buraya kaydedip takip edin." />
      ) : filtered.length === 0 ? (
        <p className="text-caption py-6 text-center">Bu durumda aday yok.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(l => <LeadCard key={l.id} lead={l} showToast={showToast} onChange={mutate} onRemove={() => remove(l)} />)}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count, badge }) {
  return (
    <button onClick={onClick} className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
      style={active
        ? { background: '#6366f1', color: '#fff', fontWeight: 600 }
        : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
      {label}
      <span className="text-[11px] px-1.5 rounded-full" style={active ? { background: 'rgba(255,255,255,.25)' } : { background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>{count}</span>
    </button>
  );
}

// ── Yeni aday formu ──
function LeadForm({ showToast, onDone, onCancel }) {
  const [studentName, setStudentName] = useState('');
  const [parentName, setParentName] = useState('');
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('telefon');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!studentName.trim()) return showToast?.('Aday adı gerekli', 'error');
    setBusy(true);
    try {
      await api('/api/onkayit', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', studentName: studentName.trim(), parentName, phone, level, source, note }),
      });
      showToast?.('Aday eklendi');
      onDone?.();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <UserPlus size={18} className="text-indigo-600" />
        <h3 className="font-700" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Yeni Aday</h3>
        <button onClick={onCancel} className="ml-auto text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><X size={13} /> Vazgeç</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="Aday öğrenci adı *" className="input !text-sm" />
        <input value={parentName} onChange={e => setParentName(e.target.value)} placeholder="Veli adı" className="input !text-sm" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Telefon" className="input !text-sm" inputMode="tel" />
        <input value={level} onChange={e => setLevel(e.target.value)} placeholder="İlgilenilen sınıf (ör. 11. sınıf)" className="input !text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Kaynak
          <select value={source} onChange={e => setSource(e.target.value)} className="input !w-auto !text-xs !py-1.5">
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Not / görüşme detayı (opsiyonel)" className="input !text-sm mb-3 resize-y" />
      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm">
          <Plus size={14} /> {busy ? 'Ekleniyor…' : 'Ekle'}
        </button>
      </div>
    </div>
  );
}

// ── Aday kartı ──
function LeadCard({ lead, showToast, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);
  const st = STATUS[lead.status] || STATUS.yeni;

  async function patch(body, okMsg) {
    setBusy(true);
    try {
      await api('/api/onkayit', { method: 'POST', body: JSON.stringify({ action: 'update', id: lead.id, ...body }) });
      if (okMsg) showToast?.(okMsg);
      onChange?.();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }
  async function addFollowUp() {
    if (!followUp.trim()) return;
    await patch({ followUp: followUp.trim() }, 'Takip notu eklendi');
    setFollowUp('');
  }

  const history = [...(lead.history || [])].reverse();

  return (
    <div className="rounded-xl p-3.5" style={{ border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lead.studentName}</p>
            <span className={`badge ${st.badge}`}>{st.label}</span>
            {lead.level && <span className="text-caption">{lead.level}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1 text-body-sm flex-wrap">
            {lead.parentName && <span style={{ color: 'var(--text-secondary)' }}>{lead.parentName}</span>}
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1 text-indigo-600 hover:underline">
                <Phone size={12} /> {lead.phone}
              </a>
            )}
            <span className="badge">{SOURCE_LABEL[lead.source] || 'Diğer'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setOpen(o => !o)} className="hover:text-indigo-600 flex items-center gap-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            Takip {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={onRemove} className="hover:text-rose-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={15} /></button>
        </div>
      </div>

      {open && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {/* Durum değiştir */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {STATUSES.map(s => {
              const on = lead.status === s;
              return (
                <button key={s} disabled={busy || on} onClick={() => patch({ status: s }, `Durum: ${STATUS[s].label}`)}
                  className="text-xs px-2.5 py-1 rounded-md"
                  style={on
                    ? { background: '#6366f1', color: '#fff', fontWeight: 600 }
                    : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                  {STATUS[s].label}
                </button>
              );
            })}
          </div>

          {/* Takip notu ekle */}
          <div className="flex items-center gap-1.5 mb-3">
            <input value={followUp} onChange={e => setFollowUp(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addFollowUp(); }}
              placeholder="Takip notu ekle…" className="input !text-sm flex-1" />
            <button onClick={addFollowUp} disabled={busy || !followUp.trim()} className="btn-primary !px-3 !py-2 shrink-0"><Send size={14} /></button>
          </div>

          {/* Zaman çizelgesi */}
          {history.length === 0 ? (
            <p className="text-caption">Henüz takip kaydı yok.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((h, i) => (
                <div key={i} className="flex gap-2 text-body-sm">
                  <Clock size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                  <div className="min-w-0">
                    <span style={{ color: 'var(--text-secondary)' }}>{h.text}</span>
                    <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {fmtDateTime(h.at)}{h.byName ? ` · ${h.byName}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
