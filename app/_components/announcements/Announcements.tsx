'use client';
import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import {
  Megaphone, Send, Trash2, X, Check, Users, Eye, ChevronDown, ChevronUp, Mail, MailOpen,
} from 'lucide-react';
import { useClasses } from '../ClassesContext';
import { groupedClasses } from '@/lib/classCatalog';
import EmptyState from '../EmptyState';
import { useConfirm } from '../ConfirmProvider';
import { api } from '../shared';
import type { ShowToast, TeacherDTO } from '../types';


// GET /api/announcements liste elemanı — gönderen listesinde audienceLabel/recipientCount/
// readCount, alıcı gelen kutusunda read dolu gelir (aynı uç, rol dallanması; route.ts).
interface AnnouncementItemDTO {
  id?: string;
  title?: string;
  body?: string;
  senderName?: string;
  createdAt?: string;
  audienceLabel?: string;
  recipientCount?: number;
  readCount?: number;
  read?: boolean;
}
// GET /api/announcements?id=… okundu detayı.
interface ReadDetailDTO {
  id?: string;
  title?: string;
  recipients: { id: string; name: string; read: boolean }[];
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface AnnouncementSenderProps {
  showToast?: ShowToast;
}

// ════════════════════ GÖNDEREN (müdür + rehber) ════════════════════
export function AnnouncementSender({ showToast }: AnnouncementSenderProps) {
  const confirm = useConfirm();
  const { data, isLoading: loading, mutate } = useSWR<{ announcements?: AnnouncementItemDTO[] }>('/api/announcements');
  const list = data?.announcements || [];
  const [detail, setDetail] = useState<AnnouncementItemDTO | null>(null); // kim okudu modalı

  async function remove(a: AnnouncementItemDTO) {
    if (!(await confirm(`"${a.title}" duyurusu silinsin mi?`))) return;
    try {
      await api(`/api/announcements?id=${encodeURIComponent(a.id || '')}`, { method: 'DELETE' });
      mutate({ announcements: list.filter(x => x.id !== a.id) }, { revalidate: false });
      showToast?.('Duyuru silindi');
    }
    catch (e) { showToast?.((e as Error).message, 'error'); }
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
                <button onClick={() => setDetail(a)} className="flex items-center gap-1 text-brand hover:underline">
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

interface ComposerProps {
  showToast?: ShowToast;
  onSent?: () => void;
}

function Composer({ showToast, onSent }: ComposerProps) {
  const { classes } = useClasses();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [role, setRole] = useState('parent');     // parent | student | teacher
  const [scope, setScope] = useState('all');       // all | group | class | selected | branch
  const [group, setGroup] = useState('lise');
  const [cls, setCls] = useState('');
  const [teacherIds, setTeacherIds] = useState<string[]>([]); // teacher 'selected'
  const [branches, setBranches] = useState<string[]>([]);     // teacher 'branch'
  const [busy, setBusy] = useState(false);

  // Öğretmen 'selected'/'branch' için liste — yalnız role==='teacher' iken çek (koşullu SWR anahtarı).
  const { data: teachersData } = useSWR<TeacherDTO[]>(role === 'teacher' ? '/api/teachers' : null);
  const teachers = Array.isArray(teachersData) ? teachersData : [];

  // Branş seçici — kurumdaki öğretmenlerin fiilen sahip olduğu branşların birleşimi (sıra korunur).
  const availableBranches = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    teachers.forEach(t => (t.branches || []).forEach(b => { if (!seen.has(b)) { seen.add(b); out.push(b); } }));
    return out;
  }, [teachers]);

  // Rol değişince kapsamı geçerli hale getir (öğretmen-özel/diğer-özel kapsamları temizle)
  useEffect(() => {
    if (role === 'teacher' && (scope === 'group' || scope === 'class')) setScope('all');
    else if (role !== 'teacher' && (scope === 'branch' || scope === 'selected')) setScope('all');
  }, [role]); // eslint-disable-line

  // Hedefleme listeleri registry'den (özel şube isimleri/grupları görünür); kayıtsızsa
  // getClasses constants'tan sanal liste döndüğü için davranış bit-bit aynı.
  const classGroups = groupedClasses(classes);
  const allClasses = classGroups.flatMap(g => g.items); // [{id, ad}]

  async function send() {
    if (!title.trim() || !body.trim()) return showToast?.('Başlık ve içerik gerekli', 'error');
    const audience: { role: string; scope: string; group?: string; cls?: string; ids?: string[]; branches?: string[] } = { role, scope };
    if (scope === 'group') audience.group = group;
    if (scope === 'class') { if (!cls) return showToast?.('Sınıf seçin', 'error'); audience.cls = cls; }
    if (scope === 'selected') {
      if (role !== 'teacher') return showToast?.('Seçili kişi yalnız öğretmen için', 'error');
      if (teacherIds.length === 0) return showToast?.('En az bir öğretmen seçin', 'error');
      audience.ids = teacherIds;
    }
    if (scope === 'branch') {
      if (role !== 'teacher') return showToast?.('Branş hedefi yalnız öğretmen için', 'error');
      if (branches.length === 0) return showToast?.('En az bir branş seçin', 'error');
      audience.branches = branches;
    }
    setBusy(true);
    try {
      const r = await api<{ recipientCount: number }>('/api/announcements', { method: 'POST', body: JSON.stringify({ action: 'send', title: title.trim(), body: body.trim(), audience }) });
      showToast?.(`${r.recipientCount} kişiye gönderildi`);
      setTitle(''); setBody(''); setTeacherIds([]); setBranches([]);
      onSent?.();
    } catch (e) { showToast?.((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  const scopeOptions = role === 'teacher'
    ? [['all', 'Tümü'], ['branch', 'Branş'], ['selected', 'Seçili']]
    : [['all', 'Tümü'], ['group', 'Grup'], ['class', 'Sınıf']];

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Megaphone size={18} className="text-brand" />
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
              <label key={t.id} className={`text-xs flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer ${on ? 'bg-brand-soft text-brand' : 'hover:bg-[var(--bg-muted)]'}`}
                style={on ? undefined : { color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={on} onChange={() => setTeacherIds(p => on ? p.filter(x => x !== t.id) : [...p, t.id])} className="hidden" />
                {on ? <Check size={12} /> : <span className="w-3" />} {t.name}
              </label>
            );
          })}
        </div>
      )}

      {/* Öğretmen branş → çoklu seçim (seçilen branştan en az birine sahip öğretmenlere gider) */}
      {role === 'teacher' && scope === 'branch' && (
        <div className="rounded-lg p-2 mb-3 flex flex-wrap gap-1.5"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          {availableBranches.length === 0 ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Branşı tanımlı öğretmen yok</span> : availableBranches.map(b => {
            const on = branches.includes(b);
            return (
              <button type="button" key={b} onClick={() => setBranches(p => on ? p.filter(x => x !== b) : [...p, b])}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200 hover:border-[color:var(--brand)]'}`}>
                {b}
              </button>
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

interface ReadDetailModalProps {
  ann: AnnouncementItemDTO;
  onClose: () => void;
}

function ReadDetailModal({ ann, onClose }: ReadDetailModalProps) {
  const [data, setData] = useState<ReadDetailDTO | null>(null);
  useEffect(() => {
    api<ReadDetailDTO>(`/api/announcements?id=${encodeURIComponent(ann.id || '')}`).then(setData).catch(() => setData({ recipients: [] }));
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

interface AnnouncementInboxProps {
  showToast?: ShowToast;
}

// ════════════════════ ALICI GELEN KUTUSU (öğretmen/öğrenci/veli) ════════════════════
export function AnnouncementInbox({ showToast }: AnnouncementInboxProps) {
  const { data, isLoading: loading, mutate } = useSWR<{ announcements?: AnnouncementItemDTO[] }>('/api/announcements');
  const list = data?.announcements || [];
  const [openId, setOpenId] = useState<string | null>(null);

  async function toggle(a: AnnouncementItemDTO) {
    if (openId === a.id) { setOpenId(null); return; }
    setOpenId(a.id || null);
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
              border: a.read ? '1px solid var(--border-subtle)' : '1px solid color-mix(in srgb, var(--brand,#6366f1) 50%, transparent)',
              background: a.read ? 'transparent' : 'color-mix(in srgb, var(--brand,#6366f1) 8%, transparent)',
            }}>
            <button onClick={() => toggle(a)} className="w-full flex items-center gap-2.5 px-4 py-3 text-left">
              {!a.read && <span className="w-2 h-2 rounded-full bg-brand shrink-0" />}
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
