'use client';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import {
  ClipboardList, Send, Trash2, X, Check, Calendar, ChevronDown, ChevronUp,
  CheckCircle2, Clock, Users, BookOpen, RotateCcw, PencilLine,
} from 'lucide-react';
import { useClasses } from '../ClassesContext';
import { groupedClasses } from '@/lib/classCatalog';
import EmptyState from '../EmptyState';
import { useConfirm } from '../ConfirmProvider';
import { api } from '../shared';


function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtDue(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(d)) return ymd;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', weekday: 'short' });
}
function isOverdue(ymd) {
  if (!ymd) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(ymd + 'T00:00:00');
  return !isNaN(d) && d < today;
}

// ════════════════════ YÖNETİCİ / ÖĞRETMEN (ver + kontrol) ════════════════════
export function OdevManager({ showToast, userRole, userId }) {
  const confirm = useConfirm();
  const { data, isLoading: loading, mutate } = useSWR('/api/odev');
  const list = data?.odevler || [];
  const [detail, setDetail] = useState(null); // kontrol modalı

  async function remove(o) {
    if (!(await confirm(`"${o.title}" ödevi silinsin mi? Teslim kayıtları da silinir.`))) return;
    try {
      await api(`/api/odev?id=${encodeURIComponent(o.id)}`, { method: 'DELETE' });
      mutate({ odevler: list.filter(x => x.id !== o.id) }, { revalidate: false });
      showToast?.('Ödev silindi');
    } catch (e) { showToast?.(e.message, 'error'); }
  }

  function canDelete(o) {
    return userRole !== 'teacher' || o.createdBy === userId;
  }

  return (
    <div className="max-w-2xl">
      <OdevComposer showToast={showToast} onSent={mutate} />

      <h4 className="text-subheading mt-7 mb-3">Verilen Ödevler</h4>
      {loading ? (
        <p className="text-caption py-6 text-center">Yükleniyor…</p>
      ) : list.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Henüz ödev yok" description="Yukarıdan ilk ödevi verin." />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map(o => {
            const overdue = isOverdue(o.dueDate);
            return (
              <div key={o.id} className="rounded-xl p-3.5" style={{ border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => setDetail(o)} className="min-w-0 text-left flex-1">
                    <p className="font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.title}</p>
                    {o.desc && <p className="text-body-sm mt-0.5 line-clamp-2">{o.desc}</p>}
                  </button>
                  {canDelete(o) && (
                    <button onClick={() => remove(o)} className="shrink-0 hover:text-rose-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={15} /></button>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-2 text-caption flex-wrap">
                  {o.branch && <span className="badge badge-info">{o.branch}</span>}
                  {o.dueDate && (
                    <span className="flex items-center gap-1" style={{ color: overdue ? '#e11d48' : 'var(--text-muted)' }}>
                      <Calendar size={11} /> {fmtDue(o.dueDate)}
                    </span>
                  )}
                  <button onClick={() => setDetail(o)} className="flex items-center gap-1 text-indigo-600 hover:underline">
                    <Users size={11} /> {o.submittedCount}/{o.rosterCount} teslim
                  </button>
                  <span className="ml-auto">{fmtDate(o.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detail && <KontrolModal odev={detail} onClose={() => setDetail(null)} onChanged={mutate} showToast={showToast} />}
    </div>
  );
}

function OdevComposer({ showToast, onSent }) {
  const { classes } = useClasses();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [branch, setBranch] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sel, setSel] = useState([]); // seçili şube id'leri
  const [busy, setBusy] = useState(false);

  const groups = groupedClasses(classes);

  function toggle(id) {
    setSel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }
  function toggleGroup(g) {
    const ids = g.items.map(i => i.id);
    const allOn = ids.every(id => sel.includes(id));
    setSel(p => allOn ? p.filter(x => !ids.includes(x)) : [...new Set([...p, ...ids])]);
  }

  async function send() {
    if (!title.trim()) return showToast?.('Başlık gerekli', 'error');
    if (sel.length === 0) return showToast?.('En az bir sınıf seçin', 'error');
    setBusy(true);
    try {
      const r = await api('/api/odev', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', title: title.trim(), desc: desc.trim(), branch: branch.trim(), dueDate, classes: sel }),
      });
      showToast?.(`Ödev verildi (${r.rosterCount} öğrenci)`);
      setTitle(''); setDesc(''); setBranch(''); setDueDate(''); setSel([]);
      onSent?.();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={18} className="text-indigo-600" />
        <h3 className="font-700" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Yeni Ödev</h3>
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ödev başlığı (ör. Türev — 1. Bölüm test)"
        className="input !text-sm mb-2" />
      <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Açıklama (opsiyonel — sayfa/soru aralığı, yönerge…)" rows={2}
        className="input !text-sm mb-2 resize-y" />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={branch} onChange={e => setBranch(e.target.value)} placeholder="Ders / Branş"
          className="input !w-auto !text-xs !py-1.5 !px-2 flex-1 min-w-[120px]" />
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <Calendar size={13} /> Son tarih
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2" />
        </label>
      </div>

      {/* Sınıf seçimi (gruplu çoklu) */}
      <div className="rounded-lg p-2.5 mb-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Hangi sınıflara:</p>
        {groups.length === 0 ? (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sınıf bulunamadı</span>
        ) : groups.map(g => {
          const ids = g.items.map(i => i.id);
          const allOn = ids.every(id => sel.includes(id));
          return (
            <div key={g.key} className="mb-2 last:mb-0">
              <button onClick={() => toggleGroup(g)}
                className={`text-[11px] uppercase tracking-wide mb-1 ${allOn ? 'text-indigo-600' : ''}`}
                style={{ fontWeight: 700, color: allOn ? undefined : 'var(--text-muted)' }}>
                {g.label}
              </button>
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
        <button onClick={send} disabled={busy} className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm">
          <Send size={14} /> {busy ? 'Veriliyor…' : 'Ödev Ver'}
        </button>
      </div>
    </div>
  );
}

// Kontrol modalı — roster + her öğrencinin teslim durumu, puan/geri bildirim.
function KontrolModal({ odev, onClose, onChanged, showToast }) {
  const { data, isLoading, mutate } = useSWR(`/api/odev?id=${encodeURIComponent(odev.id)}`);
  const subs = data?.submissions || [];
  const [editing, setEditing] = useState(null); // studentId

  async function check(studentId, score, feedback, done = true) {
    try {
      await api('/api/odev', { method: 'POST', body: JSON.stringify({ action: 'check', id: odev.id, studentId, score, feedback, done }) });
      await mutate();
      onChanged?.(); // liste sayısı güncellensin
      setEditing(null);
      showToast?.(done ? 'Kontrol edildi' : 'Kontrol kaldırıldı');
    } catch (e) { showToast?.(e.message, 'error'); }
  }

  const teslimSayisi = subs.filter(s => s.sub).length;
  const kontrolSayisi = subs.filter(s => s.sub?.status === 'kontrol').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="min-w-0">
            <p className="font-700 truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{odev.title}</p>
            <p className="text-caption">{teslimSayisi} teslim · {kontrolSayisi} kontrol · {subs.length} öğrenci</p>
          </div>
          <button onClick={onClose} className="hover:opacity-70 shrink-0" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-2">
          {isLoading ? <p className="text-caption p-3">Yükleniyor…</p> : subs.length === 0 ? (
            <p className="text-caption p-3">Bu ödevin sınıflarında öğrenci yok.</p>
          ) : subs.map(s => {
            const st = s.sub?.status; // 'teslim' | 'kontrol' | undefined
            const isEd = editing === s.studentId;
            return (
              <div key={s.studentId} className="rounded-lg p-2.5 mb-1.5" style={{ background: 'var(--bg-surface-2)' }}>
                <div className="flex items-center gap-2">
                  {st === 'kontrol' ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    : st === 'teslim' ? <Clock size={16} className="text-amber-500 shrink-0" />
                      : <span className="w-4 h-4 rounded-full shrink-0" style={{ border: '1.5px solid var(--border-strong, #cbd5e1)' }} />}
                  <span className="text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                  {st === 'kontrol' && s.sub?.score && <span className="badge badge-success">{s.sub.score}</span>}
                  {st === 'kontrol' ? (
                    <button onClick={() => check(s.studentId, '', '', false)} title="Kontrolü kaldır"
                      className="text-xs flex items-center gap-1 hover:text-rose-500" style={{ color: 'var(--text-muted)' }}>
                      <RotateCcw size={13} />
                    </button>
                  ) : (
                    <button onClick={() => setEditing(isEd ? null : s.studentId)}
                      className="text-xs flex items-center gap-1 text-indigo-600 hover:underline">
                      <PencilLine size={13} /> Kontrol et
                    </button>
                  )}
                </div>
                {s.sub?.note && <p className="text-xs mt-1.5 pl-6 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>“{s.sub.note}”</p>}
                {st === 'kontrol' && s.sub?.feedback && <p className="text-xs mt-1 pl-6" style={{ color: 'var(--text-muted)' }}>Geri bildirim: {s.sub.feedback}</p>}
                {isEd && <CheckForm initial={s.sub} onSave={(score, fb) => check(s.studentId, score, fb, true)} onCancel={() => setEditing(null)} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CheckForm({ initial, onSave, onCancel }) {
  const [score, setScore] = useState(initial?.score || '');
  const [fb, setFb] = useState(initial?.feedback || '');
  return (
    <div className="mt-2 pl-6 flex flex-col gap-2">
      <div className="flex gap-2">
        <input value={score} onChange={e => setScore(e.target.value)} placeholder="Puan / not (ops.)" className="input !text-xs !py-1.5 !w-28" />
        <input value={fb} onChange={e => setFb(e.target.value)} placeholder="Geri bildirim (ops.)" className="input !text-xs !py-1.5 flex-1" />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>Vazgeç</button>
        <button onClick={() => onSave(score.trim(), fb.trim())} className="btn-primary !text-xs !px-3 !py-1.5 flex items-center gap-1">
          <Check size={12} /> Kontrol Et
        </button>
      </div>
    </div>
  );
}

// ════════════════════ ÖĞRENCİ (teslim) ════════════════════
export function OdevStudent({ showToast }) {
  const { data, isLoading: loading, mutate } = useSWR('/api/odev');
  const list = data?.odevler || [];

  if (loading) return <p className="text-caption py-8 text-center">Yükleniyor…</p>;
  if (list.length === 0) return (
    <EmptyState icon={ClipboardList} title="Ödev yok" description="Sana atanan ödevler burada görünür." />
  );

  return (
    <div className="max-w-2xl flex flex-col gap-2">
      {list.map(o => <StudentOdevCard key={o.id} odev={o} mutate={mutate} list={list} showToast={showToast} />)}
    </div>
  );
}

function StudentOdevCard({ odev, mutate, list, showToast }) {
  const st = odev.sub?.status; // teslim | kontrol | undefined
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(odev.sub?.note || '');
  const [busy, setBusy] = useState(false);
  const overdue = isOverdue(odev.dueDate) && !st;

  async function submit(done = true) {
    setBusy(true);
    try {
      const r = await api('/api/odev', { method: 'POST', body: JSON.stringify({ action: 'submit', id: odev.id, note: note.trim(), done }) });
      const newSub = done ? { ...(odev.sub || {}), status: r.status, note: note.trim() } : null;
      mutate({ odevler: list.map(x => x.id === odev.id ? { ...x, sub: newSub } : x) }, { revalidate: false });
      setOpen(false);
      showToast?.(done ? 'Teslim edildi' : 'Teslim geri alındı');
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{
      border: st === 'kontrol' ? '1px solid color-mix(in srgb, #10b981 45%, transparent)'
        : st === 'teslim' ? '1px solid color-mix(in srgb, #f59e0b 45%, transparent)'
          : overdue ? '1px solid color-mix(in srgb, #e11d48 45%, transparent)'
            : '1px solid var(--border-subtle)',
    }}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{odev.title}</p>
            <div className="flex items-center gap-2 text-caption mt-0.5 flex-wrap">
              {odev.branch && <span className="badge badge-info">{odev.branch}</span>}
              {odev.dueDate && (
                <span className="flex items-center gap-1" style={{ color: overdue ? '#e11d48' : 'var(--text-muted)' }}>
                  <Calendar size={11} /> {fmtDue(odev.dueDate)}{overdue ? ' · gecikti' : ''}
                </span>
              )}
              <span>{odev.createdByName}</span>
            </div>
          </div>
          {st === 'kontrol' ? <span className="badge badge-success flex items-center gap-1"><CheckCircle2 size={12} /> Kontrol edildi</span>
            : st === 'teslim' ? <span className="badge flex items-center gap-1" style={{ background: 'color-mix(in srgb,#f59e0b 18%,transparent)', color: '#b45309' }}><Clock size={12} /> Teslim edildi</span>
              : null}
        </div>

        {odev.desc && <p className="text-sm mt-2 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{odev.desc}</p>}

        {/* Öğretmen kontrol ettiyse puan + geri bildirim */}
        {st === 'kontrol' && (odev.sub?.score || odev.sub?.feedback) && (
          <div className="mt-2 rounded-lg p-2 text-sm" style={{ background: 'var(--bg-surface-2)' }}>
            {odev.sub.score && <span className="font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Puan: {odev.sub.score}</span>}
            {odev.sub.feedback && <p style={{ color: 'var(--text-secondary)' }}>{odev.sub.feedback}</p>}
          </div>
        )}

        {/* Eylemler */}
        <div className="mt-2.5">
          {!st && !open && (
            <button onClick={() => setOpen(true)} className="btn-primary !text-xs !px-3 !py-1.5 flex items-center gap-1">
              <Check size={13} /> Teslim Ettim
            </button>
          )}
          {!st && open && (
            <div className="flex flex-col gap-2">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Not (opsiyonel)" className="input !text-xs resize-y" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>Vazgeç</button>
                <button onClick={() => submit(true)} disabled={busy} className="btn-primary !text-xs !px-3 !py-1.5 flex items-center gap-1">
                  <Check size={13} /> {busy ? '…' : 'Teslim Et'}
                </button>
              </div>
            </div>
          )}
          {st === 'teslim' && (
            <button onClick={() => submit(false)} disabled={busy} className="text-xs flex items-center gap-1 hover:text-rose-500" style={{ color: 'var(--text-muted)' }}>
              <RotateCcw size={12} /> Teslimi geri al
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════ VELİ (salt-okunur takip) ════════════════════
// childId verilirse yalnız o çocuğun ödevleri/durumu gösterilir (panel çocuk seçiciyle uyumlu).
export function OdevParent({ showToast, childId }) {
  const { data, isLoading: loading } = useSWR('/api/odev');
  const all = data?.odevler || [];
  const list = childId
    ? all
        .map(o => ({ ...o, children: (o.children || []).filter(c => c.childId === childId) }))
        .filter(o => o.children.length > 0)
    : all;

  if (loading) return <p className="text-caption py-8 text-center">Yükleniyor…</p>;
  if (list.length === 0) return (
    <EmptyState icon={ClipboardList} title="Ödev yok" description="Çocuğunuza atanan ödevler burada görünür." />
  );

  return (
    <div className="max-w-2xl flex flex-col gap-2">
      {list.map(o => {
        const overdue = isOverdue(o.dueDate);
        return (
          <div key={o.id} className="rounded-xl p-3.5" style={{ border: '1px solid var(--border-subtle)' }}>
            <p className="text-sm font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.title}</p>
            <div className="flex items-center gap-2 text-caption mt-0.5 flex-wrap">
              {o.branch && <span className="badge badge-info">{o.branch}</span>}
              {o.dueDate && (
                <span className="flex items-center gap-1" style={{ color: overdue ? '#e11d48' : 'var(--text-muted)' }}>
                  <Calendar size={11} /> {fmtDue(o.dueDate)}
                </span>
              )}
              <span>{o.createdByName}</span>
            </div>
            {o.desc && <p className="text-sm mt-1.5 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{o.desc}</p>}
            <div className="mt-2 flex flex-col gap-1">
              {(o.children || []).map(ch => {
                const st = ch.sub?.status;
                return (
                  <div key={ch.childId} className="flex items-center gap-2 text-sm">
                    {st === 'kontrol' ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                      : st === 'teslim' ? <Clock size={15} className="text-amber-500 shrink-0" />
                        : <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ border: '1.5px solid var(--border-strong, #cbd5e1)' }} />}
                    <span style={{ color: 'var(--text-primary)' }}>{ch.childName}</span>
                    <span className="text-caption">
                      {st === 'kontrol' ? `kontrol edildi${ch.sub?.score ? ` · ${ch.sub.score}` : ''}` : st === 'teslim' ? 'teslim edildi' : 'teslim edilmedi'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
