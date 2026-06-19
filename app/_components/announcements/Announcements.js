'use client';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import {
  Megaphone, Send, Trash2, X, Check, Users, Eye, ChevronDown, ChevronUp, Mail, MailOpen,
} from 'lucide-react';
import { useClasses } from '../ClassesContext';
import { groupedClasses } from '@/lib/classCatalog';
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

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ════════════════════ GÖNDEREN (müdür + rehber) ════════════════════
export function AnnouncementSender({ showToast }) {
  const confirm = useConfirm();
  const { data, isLoading: loading, mutate } = useSWR('/api/announcements');
  const list = data?.announcements || [];
  const [detail, setDetail] = useState(null); // kim okudu modalı

  async function remove(a) {
    if (!(await confirm(`"${a.title}" duyurusu silinsin mi?`))) return;
    try {
      await api(`/api/announcements?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      mutate({ announcements: list.filter(x => x.id !== a.id) }, { revalidate: false });
      showToast?.('Duyuru silindi');
    }
    catch (e) { showToast?.(e.message, 'error'); }
  }

  return (
    <div className="max-w-2xl">
      <Composer showToast={showToast} onSent={mutate} />

      <h4 className="text-subheading mt-7 mb-3">Gönderilen Duyurular</h4>
      {loading ? (
        <p className="text-caption py-6 text-center">Yükleniyor…</p>
      ) : list.length === 0 ? (
        <p className="text-caption py-6 text-center">Henüz duyuru gönderilmedi.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map(a => (
            <div key={a.id} className="rounded-xl p-3.5" style={{ border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.title}</p>
                  <p className="text-body-sm mt-0.5 line-clamp-2">{a.body}</p>
                </div>
                <button onClick={() => remove(a)} className="shrink-0 hover:text-rose-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={15} /></button>
              </div>
              <div className="flex items-center gap-3 mt-2 text-caption flex-wrap">
                <span className="badge badge-info">{a.audienceLabel}</span>
                <span className="flex items-center gap-1"><Users size={11} /> {a.recipientCount}</span>
                <button onClick={() => setDetail(a)} className="flex items-center gap-1 text-indigo-600 hover:underline">
                  <Eye size={11} /> {a.readCount}/{a.recipientCount} okudu
                </button>
                <span className="ml-auto">{fmtDate(a.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && <ReadDetailModal ann={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Composer({ showToast, onSent }) {
  const { classes } = useClasses();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [role, setRole] = useState('parent');     // parent | student | teacher
  const [scope, setScope] = useState('all');       // all | group | class | selected
  const [group, setGroup] = useState('lise');
  const [cls, setCls] = useState('');
  const [teacherIds, setTeacherIds] = useState([]); // teacher 'selected'
  const [busy, setBusy] = useState(false);

  // Öğretmen 'selected' için liste — yalnız role==='teacher' iken çek (koşullu SWR anahtarı).
  const { data: teachersData } = useSWR(role === 'teacher' ? '/api/teachers' : null);
  const teachers = Array.isArray(teachersData) ? teachersData : [];

  // Rol değişince kapsamı geçerli hale getir
  useEffect(() => {
    if (role === 'teacher' && (scope === 'group' || scope === 'class')) setScope('all');
  }, [role]); // eslint-disable-line

  // Hedefleme listeleri registry'den (özel şube isimleri/grupları görünür); kayıtsızsa
  // getClasses constants'tan sanal liste döndüğü için davranış bit-bit aynı.
  const classGroups = groupedClasses(classes);
  const allClasses = classGroups.flatMap(g => g.items); // [{id, ad}]

  async function send() {
    if (!title.trim() || !body.trim()) return showToast?.('Başlık ve içerik gerekli', 'error');
    const audience = { role, scope };
    if (scope === 'group') audience.group = group;
    if (scope === 'class') { if (!cls) return showToast?.('Sınıf seçin', 'error'); audience.cls = cls; }
    if (scope === 'selected') {
      if (role !== 'teacher') return showToast?.('Seçili kişi yalnız öğretmen için', 'error');
      if (teacherIds.length === 0) return showToast?.('En az bir öğretmen seçin', 'error');
      audience.ids = teacherIds;
    }
    setBusy(true);
    try {
      const r = await api('/api/announcements', { method: 'POST', body: JSON.stringify({ action: 'send', title: title.trim(), body: body.trim(), audience }) });
      showToast?.(`${r.recipientCount} kişiye gönderildi`);
      setTitle(''); setBody(''); setTeacherIds([]);
      onSent?.();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  const scopeOptions = role === 'teacher'
    ? [['all', 'Tümü'], ['selected', 'Seçili']]
    : [['all', 'Tümü'], ['group', 'Grup'], ['class', 'Sınıf']];

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Megaphone size={18} className="text-indigo-600" />
        <h3 className="font-700" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Yeni Duyuru</h3>
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Başlık"
        className="input !text-sm mb-2" />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Duyuru metni…" rows={3}
        className="input !text-sm mb-3 resize-y" />

      {/* Hedef seçici */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Kime:</span>
        <select value={role} onChange={e => setRole(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2">
          <option value="parent">Veliler</option>
          <option value="student">Öğrenciler</option>
          <option value="teacher">Öğretmenler</option>
        </select>
        <select value={scope} onChange={e => setScope(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2">
          {scopeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {scope === 'group' && (
          <select value={group} onChange={e => setGroup(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2">
            {classGroups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        )}
        {scope === 'class' && (
          <select value={cls} onChange={e => setCls(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2">
            <option value="">Sınıf seç…</option>
            {allClasses.map(c => <option key={c.id} value={c.id}>{c.ad}</option>)}
          </select>
        )}
      </div>

      {/* Öğretmen seçili → çoklu seçim */}
      {role === 'teacher' && scope === 'selected' && (
        <div className="rounded-lg p-2 mb-3 max-h-40 overflow-y-auto grid grid-cols-2 gap-1"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          {teachers.length === 0 ? <span className="text-xs col-span-2" style={{ color: 'var(--text-muted)' }}>Öğretmen yok</span> : teachers.map(t => {
            const on = teacherIds.includes(t.id);
            return (
              <label key={t.id} className={`text-xs flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer ${on ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-[var(--bg-muted)]'}`}
                style={on ? undefined : { color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={on} onChange={() => setTeacherIds(p => on ? p.filter(x => x !== t.id) : [...p, t.id])} className="hidden" />
                {on ? <Check size={12} /> : <span className="w-3" />} {t.name}
              </label>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={send} disabled={busy} className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm">
          <Send size={14} /> {busy ? 'Gönderiliyor…' : 'Gönder'}
        </button>
      </div>
    </div>
  );
}

function ReadDetailModal({ ann, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/announcements?id=${encodeURIComponent(ann.id)}`).then(setData).catch(() => setData({ recipients: [] }));
  }, [ann.id]);
  const readCount = data?.recipients?.filter(r => r.read).length || 0;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal w-full max-w-sm max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="min-w-0">
            <p className="font-700 truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{ann.title}</p>
            {data && <p className="text-caption">{readCount}/{data.recipients.length} okudu</p>}
          </div>
          <button onClick={onClose} className="hover:opacity-70" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-2">
          {!data ? <p className="text-caption p-3">Yükleniyor…</p> :
            data.recipients.map(r => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                {r.read ? <MailOpen size={14} className="text-green-600 shrink-0" /> : <Mail size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />}
                <span className="truncate" style={{ color: r.read ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.name}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════ ALICI GELEN KUTUSU (öğretmen/öğrenci/veli) ════════════════════
export function AnnouncementInbox({ showToast }) {
  const { data, isLoading: loading, mutate } = useSWR('/api/announcements');
  const list = data?.announcements || [];
  const [openId, setOpenId] = useState(null);

  async function toggle(a) {
    if (openId === a.id) { setOpenId(null); return; }
    setOpenId(a.id);
    if (!a.read) {
      // Okundu işaretini iyimser uygula (refetch yok), sonra sunucuya bildir.
      mutate({ announcements: list.map(x => x.id === a.id ? { ...x, read: true } : x) }, { revalidate: false });
      try { await api('/api/announcements', { method: 'POST', body: JSON.stringify({ action: 'read', id: a.id }) }); }
      catch { /* sessiz */ }
    }
  }

  if (loading) return <p className="text-caption py-8 text-center">Yükleniyor…</p>;
  if (list.length === 0) return (
    <EmptyState icon={Megaphone} title="Henüz duyuru yok" description="Gönderilen duyurular burada listelenir." />
  );

  return (
    <div className="max-w-2xl flex flex-col gap-2">
      {list.map(a => {
        const open = openId === a.id;
        return (
          <div key={a.id} className="rounded-xl overflow-hidden"
            style={{
              border: a.read ? '1px solid var(--border-subtle)' : '1px solid color-mix(in srgb, #6366f1 50%, transparent)',
              background: a.read ? 'transparent' : 'color-mix(in srgb, #6366f1 8%, transparent)',
            }}>
            <button onClick={() => toggle(a)} className="w-full flex items-center gap-2.5 px-4 py-3 text-left">
              {!a.read && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${a.read ? 'font-500' : 'font-700'}`} style={{ fontWeight: a.read ? 500 : 700, color: 'var(--text-primary)' }}>{a.title}</p>
                <p className="text-caption">{a.senderName} · {fmtDate(a.createdAt)}</p>
              </div>
              {open ? <ChevronUp size={16} className="shrink-0" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} className="shrink-0" style={{ color: 'var(--text-muted)' }} />}
            </button>
            {open && (
              <div className="px-4 pb-3.5 -mt-1">
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{a.body}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
