'use client';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  Star, ThumbsUp, ThumbsDown, Trash2, Search, ChevronDown, ChevronUp, Plus, Award,
} from 'lucide-react';
import { useClasses } from '../ClassesContext';
import { groupedClasses } from '@/lib/classCatalog';
import EmptyState from '../EmptyState';
import { useConfirm } from '../ConfirmProvider';
import { api } from '../shared';


const PRESETS = {
  olumlu: [
    { reason: 'Derse katılım', points: 5 },
    { reason: 'Ödevini yaptı', points: 5 },
    { reason: 'Yardımseverlik', points: 5 },
    { reason: 'Örnek davranış', points: 10 },
    { reason: 'Başarı', points: 10 },
  ],
  olumsuz: [
    { reason: 'Ödev yapmadı', points: -5 },
    { reason: 'Geç geldi', points: -3 },
    { reason: 'Dersi böldü', points: -5 },
    { reason: 'Saygısızlık', points: -10 },
  ],
};

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function totalBadge(total) {
  if (total > 0) return 'badge-success';
  if (total < 0) return 'badge-danger';
  return 'badge';
}
function isManagerRole(role) { return role === 'director' || role === 'counselor'; }

// ════════════════════ YÖNETİCİ / ÖĞRETMEN ════════════════════
export function DavranisManager({ showToast, userRole, userId }) {
  const { data, isLoading, mutate } = useSWR('/api/davranis');
  const { classes } = useClasses();
  const groups = useMemo(() => groupedClasses(classes), [classes]);
  const clsLabel = useMemo(() => new Map((classes || []).map(c => [c.id, c.ad])), [classes]);
  const [q, setQ] = useState('');
  const [clsFilter, setClsFilter] = useState('');
  const [openId, setOpenId] = useState(null);

  const roster = data?.roster || [];
  const filtered = roster.filter(r =>
    (!clsFilter || r.cls === clsFilter) &&
    (!q.trim() || (r.name || '').toLowerCase().includes(q.trim().toLowerCase()))
  );

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Öğrenci ara…" className="input !text-sm !pl-8" />
        </div>
        <select value={clsFilter} onChange={e => setClsFilter(e.target.value)} className="input !w-auto !text-sm">
          <option value="">Tüm sınıflar</option>
          {groups.map(g => (
            <optgroup key={g.key} label={g.label}>
              {g.items.map(c => <option key={c.id} value={c.id}>{c.ad}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-caption py-6 text-center">Yükleniyor…</p>
      ) : roster.length === 0 ? (
        <EmptyState icon={Star} title="Öğrenci yok" description="Önce öğrenci ekleyin." />
      ) : filtered.length === 0 ? (
        <p className="text-caption py-6 text-center">Eşleşen öğrenci yok.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(r => (
            <div key={r.id} className="rounded-xl" style={{ border: '1px solid var(--border-subtle)' }}>
              <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="w-full flex items-center gap-2 p-3 text-left">
                <div className="min-w-0 flex-1">
                  <p className="font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</p>
                  <p className="text-caption">{clsLabel.get(r.cls) || r.cls || '—'}</p>
                </div>
                <span className={`badge ${totalBadge(r.total)}`} style={{ fontWeight: 700 }}>{r.total > 0 ? '+' : ''}{r.total}</span>
                {openId === r.id ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
              </button>
              {openId === r.id && (
                <StudentDetail studentId={r.id} showToast={showToast} userRole={userRole} userId={userId} onChanged={mutate} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudentDetail({ studentId, showToast, userRole, userId, onChanged }) {
  const confirm = useConfirm();
  const { data, isLoading, mutate } = useSWR(`/api/davranis?studentId=${encodeURIComponent(studentId)}`);
  const entries = data?.entries || [];
  const [reason, setReason] = useState('');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canDelete = e => isManagerRole(userRole) || e.by === userId;

  async function give(body, msg) {
    setBusy(true);
    try {
      await api('/api/davranis', { method: 'POST', body: JSON.stringify({ action: 'add', studentId, ...body }) });
      showToast?.(msg || 'Eklendi');
      mutate(); onChanged?.();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }
  async function addCustom() {
    const p = parseInt(points, 10);
    if (!reason.trim()) return showToast?.('Sebep gerekli', 'error');
    if (!Number.isFinite(p) || p === 0) return showToast?.('Geçerli puan girin (0 olamaz)', 'error');
    await give({ reason: reason.trim(), points: p, note: note.trim() }, 'Puan eklendi');
    setReason(''); setPoints(''); setNote('');
  }
  async function remove(e) {
    if (!(await confirm('Bu davranış kaydı silinsin mi?'))) return;
    try {
      await api(`/api/davranis?studentId=${encodeURIComponent(studentId)}&entryId=${encodeURIComponent(e.id)}`, { method: 'DELETE' });
      showToast?.('Silindi');
      mutate(); onChanged?.();
    } catch (err) { showToast?.(err.message, 'error'); }
  }

  return (
    <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      {/* Hızlı butonlar */}
      <div className="mb-2">
        <p className="text-[11px] mb-1 flex items-center gap-1" style={{ color: 'var(--color-success, #16a34a)', fontWeight: 600 }}><ThumbsUp size={12} /> Olumlu</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.olumlu.map(pr => (
            <button key={pr.reason} disabled={busy} onClick={() => give(pr, `+${pr.points} ${pr.reason}`)}
              className="text-xs px-2 py-1 rounded-md" style={{ border: '1px solid var(--color-success-border)', color: 'var(--color-success)' }}>
              {pr.reason} +{pr.points}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3">
        <p className="text-[11px] mb-1 flex items-center gap-1" style={{ color: 'var(--color-danger, #dc2626)', fontWeight: 600 }}><ThumbsDown size={12} /> Olumsuz</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.olumsuz.map(pr => (
            <button key={pr.reason} disabled={busy} onClick={() => give(pr, `${pr.points} ${pr.reason}`)}
              className="text-xs px-2 py-1 rounded-md" style={{ border: '1px solid var(--color-danger-border)', color: 'var(--color-danger)' }}>
              {pr.reason} {pr.points}
            </button>
          ))}
        </div>
      </div>

      {/* Özel puan */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Özel sebep" className="input !text-sm flex-1 min-w-[120px]" />
        <input value={points} onChange={e => setPoints(e.target.value)} placeholder="±Puan" className="input !text-sm !w-20" inputMode="numeric" />
        <button onClick={addCustom} disabled={busy} className="btn-primary !px-3 !py-2 flex items-center gap-1 text-sm"><Plus size={14} /> Ekle</button>
      </div>

      {/* Geçmiş */}
      {isLoading ? (
        <p className="text-caption">Yükleniyor…</p>
      ) : entries.length === 0 ? (
        <p className="text-caption">Henüz davranış kaydı yok.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg p-2" style={{ background: 'var(--bg-surface-2)' }}>
              <span className="font-700 text-sm shrink-0 w-9 text-center" style={{ color: e.points > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
                {e.points > 0 ? '+' : ''}{e.points}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm" style={{ color: 'var(--text-secondary)' }}>{e.reason}{e.note ? ` — ${e.note}` : ''}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtDateTime(e.at)}{e.byName ? ` · ${e.byName}` : ''}</p>
              </div>
              {canDelete(e) && <button onClick={() => remove(e)} className="hover:text-rose-500 shrink-0" style={{ color: 'var(--text-muted)' }}><Trash2 size={14} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════ ÖĞRENCİ / VELİ (salt okunur) ════════════════════
export function DavranisView({ studentId }) {
  const url = studentId ? `/api/davranis?studentId=${encodeURIComponent(studentId)}` : '/api/davranis';
  const { data, isLoading } = useSWR(url);
  const total = data?.total || 0;
  const entries = data?.entries || [];

  if (isLoading) return <p className="text-caption py-8 text-center">Yükleniyor…</p>;

  return (
    <div className="max-w-2xl">
      {/* Toplam kart */}
      <div className="rounded-xl p-4 mb-4 flex items-center gap-3" style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
        <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: total >= 0 ? 'var(--color-success-bg)' : 'var(--color-danger-bg)', color: total >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
          <Award size={22} />
        </div>
        <div>
          <p className="text-caption">Davranış puanı</p>
          <p className="text-2xl font-800" style={{ fontWeight: 800, color: total >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{total > 0 ? '+' : ''}{total}</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={Star} title="Kayıt yok" description="Henüz davranış puanı verilmemiş." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg p-2.5" style={{ border: '1px solid var(--border-subtle)' }}>
              <span className="font-700 text-sm shrink-0 w-9 text-center" style={{ color: e.points > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
                {e.points > 0 ? '+' : ''}{e.points}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm" style={{ color: 'var(--text-secondary)' }}>{e.reason}{e.note ? ` — ${e.note}` : ''}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtDateTime(e.at)}{e.byName ? ` · ${e.byName}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
