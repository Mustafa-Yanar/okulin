'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  Megaphone, Send, Trash2, X, Check, Users, Eye, ChevronDown, ChevronUp, Mail, MailOpen,
} from 'lucide-react';
import { STUDENT_GROUPS, classLabel } from '@/lib/constants';

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
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null); // kim okudu modalı

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api('/api/announcements'); setList(d.announcements || []); }
    catch { /* sessiz */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(a) {
    if (!confirm(`"${a.title}" duyurusu silinsin mi?`)) return;
    try { await api(`/api/announcements?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' }); setList(p => p.filter(x => x.id !== a.id)); showToast?.('Duyuru silindi'); }
    catch (e) { showToast?.(e.message, 'error'); }
  }

  return (
    <div className="max-w-2xl">
      <Composer showToast={showToast} onSent={load} />

      <h4 className="text-sm font-700 text-gray-700 mt-7 mb-3" style={{ fontWeight: 700 }}>Gönderilen Duyurular</h4>
      {loading ? (
        <p className="text-sm text-gray-400 py-6 text-center">Yükleniyor…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Henüz duyuru gönderilmedi.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map(a => (
            <div key={a.id} className="border border-gray-200 rounded-xl p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-600 text-gray-800 truncate" style={{ fontWeight: 600 }}>{a.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{a.body}</p>
                </div>
                <button onClick={() => remove(a)} className="text-gray-300 hover:text-rose-500 shrink-0"><Trash2 size={15} /></button>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 flex-wrap">
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded">{a.audienceLabel}</span>
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
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [role, setRole] = useState('parent');     // parent | student | teacher
  const [scope, setScope] = useState('all');       // all | group | class | selected
  const [group, setGroup] = useState('lise');
  const [cls, setCls] = useState('');
  const [teacherIds, setTeacherIds] = useState([]); // teacher 'selected'
  const [teachers, setTeachers] = useState([]);
  const [busy, setBusy] = useState(false);

  // Öğretmen 'selected' için liste
  useEffect(() => {
    if (role === 'teacher') {
      api('/api/teachers').then(d => setTeachers(Array.isArray(d) ? d : [])).catch(() => {});
    }
  }, [role]);

  // Rol değişince kapsamı geçerli hale getir
  useEffect(() => {
    if (role === 'teacher' && (scope === 'group' || scope === 'class')) setScope('all');
  }, [role]); // eslint-disable-line

  const allClasses = Object.values(STUDENT_GROUPS).flatMap(g => g.classes);

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
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
      <div className="flex items-center gap-2 mb-3">
        <Megaphone size={18} className="text-indigo-600" />
        <h3 className="font-700" style={{ fontWeight: 700 }}>Yeni Duyuru</h3>
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Başlık"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Duyuru metni…" rows={3}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-y" />

      {/* Hedef seçici */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs text-gray-500">Kime:</span>
        <select value={role} onChange={e => setRole(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
          <option value="parent">Veliler</option>
          <option value="student">Öğrenciler</option>
          <option value="teacher">Öğretmenler</option>
        </select>
        <select value={scope} onChange={e => setScope(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
          {scopeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {scope === 'group' && (
          <select value={group} onChange={e => setGroup(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            {Object.entries(STUDENT_GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
          </select>
        )}
        {scope === 'class' && (
          <select value={cls} onChange={e => setCls(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">Sınıf seç…</option>
            {allClasses.map(c => <option key={c} value={c}>{classLabel(c)}</option>)}
          </select>
        )}
      </div>

      {/* Öğretmen seçili → çoklu seçim */}
      {role === 'teacher' && scope === 'selected' && (
        <div className="border border-gray-200 rounded-lg p-2 mb-3 max-h-40 overflow-y-auto grid grid-cols-2 gap-1 bg-white">
          {teachers.length === 0 ? <span className="text-xs text-gray-400 col-span-2">Öğretmen yok</span> : teachers.map(t => {
            const on = teacherIds.includes(t.id);
            return (
              <label key={t.id} className={`text-xs flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer ${on ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50 text-gray-600'}`}>
                <input type="checkbox" checked={on} onChange={() => setTeacherIds(p => on ? p.filter(x => x !== t.id) : [...p, t.id])} className="hidden" />
                {on ? <Check size={12} /> : <span className="w-3" />} {t.name}
              </label>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={send} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
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
      <div className="bg-white rounded-xl w-full max-w-sm max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <p className="font-700 truncate" style={{ fontWeight: 700 }}>{ann.title}</p>
            {data && <p className="text-xs text-gray-400">{readCount}/{data.recipients.length} okudu</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-2">
          {!data ? <p className="text-sm text-gray-400 p-3">Yükleniyor…</p> :
            data.recipients.map(r => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                {r.read ? <MailOpen size={14} className="text-green-600 shrink-0" /> : <Mail size={14} className="text-gray-300 shrink-0" />}
                <span className={`truncate ${r.read ? 'text-gray-700' : 'text-gray-400'}`}>{r.name}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════ ALICI GELEN KUTUSU (öğretmen/öğrenci/veli) ════════════════════
export function AnnouncementInbox({ showToast }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api('/api/announcements'); setList(d.announcements || []); }
    catch { /* sessiz */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(a) {
    if (openId === a.id) { setOpenId(null); return; }
    setOpenId(a.id);
    if (!a.read) {
      setList(p => p.map(x => x.id === a.id ? { ...x, read: true } : x));
      try { await api('/api/announcements', { method: 'POST', body: JSON.stringify({ action: 'read', id: a.id }) }); }
      catch { /* sessiz */ }
    }
  }

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Yükleniyor…</p>;
  if (list.length === 0) return (
    <div className="text-center py-12 text-gray-400">
      <Megaphone size={36} className="mx-auto mb-2 opacity-40" />
      <p className="text-sm">Henüz duyuru yok.</p>
    </div>
  );

  return (
    <div className="max-w-2xl flex flex-col gap-2">
      {list.map(a => {
        const open = openId === a.id;
        return (
          <div key={a.id} className={`border rounded-xl overflow-hidden ${a.read ? 'border-gray-200' : 'border-indigo-300 bg-indigo-50/30'}`}>
            <button onClick={() => toggle(a)} className="w-full flex items-center gap-2.5 px-4 py-3 text-left">
              {!a.read && <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${a.read ? 'font-500 text-gray-700' : 'font-700 text-gray-900'}`} style={{ fontWeight: a.read ? 500 : 700 }}>{a.title}</p>
                <p className="text-[11px] text-gray-400">{a.senderName} · {fmtDate(a.createdAt)}</p>
              </div>
              {open ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
            </button>
            {open && (
              <div className="px-4 pb-3.5 -mt-1">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.body}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
