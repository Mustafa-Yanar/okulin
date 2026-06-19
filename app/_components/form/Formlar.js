'use client';
import { useState } from 'react';
import useSWR from 'swr';
import {
  ClipboardList, Plus, Trash2, X, Check, Send, BarChart3, Lock, Unlock,
  Type, CircleDot, CheckSquare, Star, GripVertical, Users,
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

const ROLE_LABEL = { student: 'Öğrenci', parent: 'Veli', teacher: 'Öğretmen' };
const QTYPE = {
  text: { label: 'Metin', icon: Type },
  single: { label: 'Tek Seçim', icon: CircleDot },
  multi: { label: 'Çoklu Seçim', icon: CheckSquare },
  rating: { label: 'Puan (1-5)', icon: Star },
};
function qid() { return 'q' + Math.random().toString(36).slice(2, 8); }
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ════════════════════ YÖNETİCİ ════════════════════
export function FormManager({ showToast }) {
  const confirm = useConfirm();
  const { data, isLoading, mutate } = useSWR('/api/form');
  const list = data?.formlar || [];
  const [building, setBuilding] = useState(false);
  const [resultsId, setResultsId] = useState(null);

  async function toggleClose(f) {
    try {
      await api('/api/form', { method: 'POST', body: JSON.stringify({ action: 'close', id: f.id, closed: !f.closed }) });
      mutate();
      showToast?.(f.closed ? 'Form açıldı' : 'Form kapatıldı');
    } catch (e) { showToast?.(e.message, 'error'); }
  }
  async function remove(f) {
    if (!(await confirm(`"${f.title}" formu ve tüm yanıtları silinsin mi?`))) return;
    try {
      await api(`/api/form?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      mutate({ formlar: list.filter(x => x.id !== f.id) }, { revalidate: false });
      showToast?.('Form silindi');
    } catch (e) { showToast?.(e.message, 'error'); }
  }

  return (
    <div className="max-w-2xl">
      {building ? (
        <FormBuilder showToast={showToast} onDone={() => { setBuilding(false); mutate(); }} onCancel={() => setBuilding(false)} />
      ) : (
        <button onClick={() => setBuilding(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={15} /> Yeni Form / Anket
        </button>
      )}

      <h4 className="text-subheading mt-7 mb-3">Formlar</h4>
      {isLoading ? (
        <p className="text-caption py-6 text-center">Yükleniyor…</p>
      ) : list.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Henüz form yok" description="Memnuniyet anketi, geri bildirim formu oluşturun." />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map(f => (
            <div key={f.id} className="rounded-xl p-3.5" style={{ border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{f.title}</p>
                  {f.desc && <p className="text-body-sm mt-0.5 line-clamp-2">{f.desc}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggleClose(f)} title={f.closed ? 'Aç' : 'Kapat'}
                    className="hover:text-indigo-600" style={{ color: 'var(--text-muted)' }}>
                    {f.closed ? <Lock size={15} /> : <Unlock size={15} />}
                  </button>
                  <button onClick={() => remove(f)} className="hover:text-rose-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap text-caption">
                {(f.audience?.roles || []).map(r => <span key={r} className="badge badge-info">{ROLE_LABEL[r]}</span>)}
                {f.anonymous && <span className="badge">anonim</span>}
                {f.closed && <span className="badge badge-warning">kapalı</span>}
                <span style={{ color: 'var(--text-muted)' }}>{f.questionCount} soru</span>
                <button onClick={() => setResultsId(f.id)} className="flex items-center gap-1 text-indigo-600 hover:underline ml-auto">
                  <BarChart3 size={12} /> {f.responseCount} yanıt
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {resultsId && <ResultsModal formId={resultsId} onClose={() => setResultsId(null)} />}
    </div>
  );
}

// ── Form oluşturucu ──
function FormBuilder({ showToast, onDone, onCancel }) {
  const { classes } = useClasses();
  const groups = groupedClasses(classes);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [roles, setRoles] = useState(['student']);
  const [sel, setSel] = useState([]); // sınıf hedefi (boş = hepsi)
  const [anonymous, setAnonymous] = useState(false);
  const [closeDate, setCloseDate] = useState('');
  const [questions, setQuestions] = useState([]);
  const [busy, setBusy] = useState(false);

  function toggleRole(r) { setRoles(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r]); }
  function toggleCls(id) { setSel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); }
  function toggleGroup(g) {
    const ids = g.items.map(i => i.id);
    const allOn = ids.every(id => sel.includes(id));
    setSel(p => allOn ? p.filter(x => !ids.includes(x)) : [...new Set([...p, ...ids])]);
  }
  function addQuestion(type) {
    setQuestions(p => [...p, { id: qid(), label: '', type, required: false, options: (type === 'single' || type === 'multi') ? ['', ''] : [] }]);
  }
  function updateQ(i, patch) { setQuestions(p => p.map((q, idx) => idx === i ? { ...q, ...patch } : q)); }
  function removeQ(i) { setQuestions(p => p.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!title.trim()) return showToast?.('Başlık gerekli', 'error');
    if (roles.length === 0) return showToast?.('En az bir hedef rol seçin', 'error');
    if (questions.length === 0) return showToast?.('En az bir soru ekleyin', 'error');
    for (const q of questions) {
      if (!q.label.trim()) return showToast?.('Tüm soruların başlığı dolu olmalı', 'error');
      if ((q.type === 'single' || q.type === 'multi')) {
        const opts = q.options.map(o => o.trim()).filter(Boolean);
        if (opts.length < 2) return showToast?.(`"${q.label}" için en az 2 seçenek gerekli`, 'error');
      }
    }
    const cleanQs = questions.map(q => ({
      id: q.id, label: q.label.trim(), type: q.type, required: !!q.required,
      ...((q.type === 'single' || q.type === 'multi') ? { options: q.options.map(o => o.trim()).filter(Boolean) } : {}),
    }));
    setBusy(true);
    try {
      await api('/api/form', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', title: title.trim(), desc: desc.trim(), audience: { roles, classes: sel }, questions: cleanQs, anonymous, closeDate }),
      });
      showToast?.('Form oluşturuldu');
      onDone?.();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  const showClassPicker = roles.includes('student') || roles.includes('parent');

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={18} className="text-indigo-600" />
        <h3 className="font-700" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Yeni Form / Anket</h3>
        <button onClick={onCancel} className="ml-auto text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><X size={13} /> Vazgeç</button>
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Form başlığı (ör. Veli Memnuniyet Anketi)" className="input !text-sm mb-2" />
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Açıklama (opsiyonel)" className="input !text-sm mb-3 resize-y" />

      {/* Hedef roller */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Kimler doldursun:</span>
        {Object.entries(ROLE_LABEL).map(([r, lbl]) => {
          const on = roles.includes(r);
          return (
            <button key={r} onClick={() => toggleRole(r)} className="text-xs px-2.5 py-1 rounded-md flex items-center gap-1"
              style={on ? { background: '#6366f1', color: '#fff', fontWeight: 600 } : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {on && <Check size={11} />} {lbl}
            </button>
          );
        })}
      </div>

      {/* Sınıf hedefi (öğrenci/veli seçiliyse) */}
      {showClassPicker && (
        <div className="rounded-lg p-2.5 mb-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            Sınıf hedefi: <span style={{ color: 'var(--text-secondary)' }}>{sel.length === 0 ? 'tüm sınıflar' : `${sel.length} sınıf`}</span>
          </p>
          {groups.length === 0 ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sınıf yok</span> : groups.map(g => {
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
                      <button key={c.id} onClick={() => toggleCls(c.id)}
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
      )}

      {/* Sorular */}
      <div className="mb-3">
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Sorular ({questions.length})</p>
        <div className="flex flex-col gap-2">
          {questions.map((q, i) => <QuestionEditor key={q.id} q={q} index={i} onChange={p => updateQ(i, p)} onRemove={() => removeQ(i)} />)}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {Object.entries(QTYPE).map(([t, { label, icon: Icon }]) => (
            <button key={t} onClick={() => addQuestion(t)} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1"
              style={{ border: '1px dashed var(--border-light)', color: 'var(--text-secondary)' }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Ayarlar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="text-xs flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} className="accent-indigo-600" /> Anonim (kişi görünmez)
        </label>
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Kapanış (ops.)
          <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2" />
        </label>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm">
          <Send size={14} /> {busy ? 'Oluşturuluyor…' : 'Oluştur & Gönder'}
        </button>
      </div>
    </div>
  );
}

function QuestionEditor({ q, index, onChange, onRemove }) {
  const { icon: Icon, label } = QTYPE[q.type];
  const isChoice = q.type === 'single' || q.type === 'multi';
  function setOpt(i, val) { onChange({ options: q.options.map((o, idx) => idx === i ? val : o) }); }
  function addOpt() { onChange({ options: [...q.options, ''] }); }
  function removeOpt(i) { onChange({ options: q.options.filter((_, idx) => idx !== i) }); }

  return (
    <div className="rounded-lg p-2.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
          <Icon size={11} /> {label}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Soru {index + 1}</span>
        <button onClick={onRemove} className="ml-auto hover:text-rose-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={13} /></button>
      </div>
      <input value={q.label} onChange={e => onChange({ label: e.target.value })} placeholder="Soru metni" className="input !text-sm mb-2" />
      {isChoice && (
        <div className="flex flex-col gap-1.5 pl-1 mb-1.5">
          {q.options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span style={{ color: 'var(--text-muted)' }}>{q.type === 'single' ? <CircleDot size={13} /> : <CheckSquare size={13} />}</span>
              <input value={o} onChange={e => setOpt(i, e.target.value)} placeholder={`Seçenek ${i + 1}`} className="input !text-xs !py-1 flex-1" />
              {q.options.length > 2 && <button onClick={() => removeOpt(i)} style={{ color: 'var(--text-muted)' }}><X size={13} /></button>}
            </div>
          ))}
          <button onClick={addOpt} className="text-xs text-indigo-600 hover:underline flex items-center gap-1 mt-0.5"><Plus size={12} /> Seçenek ekle</button>
        </div>
      )}
      <label className="text-[11px] flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={!!q.required} onChange={e => onChange({ required: e.target.checked })} className="accent-indigo-600" /> Zorunlu
      </label>
    </div>
  );
}

// ── Sonuç modalı ──
function ResultsModal({ formId, onClose }) {
  const { data, isLoading } = useSWR(`/api/form?id=${encodeURIComponent(formId)}`);
  const form = data?.form;
  const results = data?.results || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="min-w-0">
            <p className="font-700 truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{form?.title || 'Sonuçlar'}</p>
            {data && <p className="text-caption">{data.responseCount} / {data.eligibleCount} yanıt{form?.anonymous ? ' · anonim' : ''}</p>}
          </div>
          <button onClick={onClose} className="hover:opacity-70 shrink-0" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4">
          {isLoading ? <p className="text-caption">Yükleniyor…</p> : data?.responseCount === 0 ? (
            <p className="text-caption py-4">Henüz yanıt yok.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {results.map(r => <ResultItem key={r.id} r={r} total={data.responseCount} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultItem({ r, total }) {
  return (
    <div>
      <p className="text-sm font-600 mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</p>
      {(r.type === 'single' || r.type === 'multi') && (
        <div className="flex flex-col gap-1.5">
          {Object.entries(r.counts).map(([opt, n]) => {
            const pct = total ? Math.round((n / total) * 100) : 0;
            return (
              <div key={opt}>
                <div className="flex justify-between text-xs mb-0.5"><span style={{ color: 'var(--text-secondary)' }}>{opt}</span><span style={{ color: 'var(--text-muted)' }}>{n} (%{pct})</span></div>
                <div className="w-full rounded-full overflow-hidden" style={{ height: 7, background: 'var(--bg-muted)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--brand, #6366f1)' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {r.type === 'rating' && (
        <div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Ortalama: <strong style={{ color: 'var(--text-primary)' }}>{r.avg}</strong> / 5 ({r.count} yanıt)</p>
          <div className="flex items-end gap-1.5 mt-2" style={{ height: 48 }}>
            {[1, 2, 3, 4, 5].map(n => {
              const c = r.dist?.[n] || 0;
              const max = Math.max(1, ...Object.values(r.dist || {}));
              return (
                <div key={n} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{c}</span>
                  <div className="w-full rounded-t" style={{ height: `${Math.max(4, (c / max) * 100)}%`, background: 'color-mix(in srgb, var(--brand,#6366f1) 60%, transparent)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {r.type === 'text' && (
        <div className="flex flex-col gap-1.5">
          {(r.answers || []).length === 0 ? <p className="text-caption">Yanıt yok</p> : r.answers.map((a, i) => (
            <div key={i} className="rounded-lg p-2 text-sm" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }}>
              {a.text}{a.name ? <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>— {a.name}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════ YANITLAYAN (öğrenci / veli / öğretmen) ════════════════════
export function FormRespond({ showToast }) {
  const { data, isLoading, mutate } = useSWR('/api/form');
  const list = data?.formlar || [];
  const [openId, setOpenId] = useState(null);

  if (isLoading) return <p className="text-caption py-8 text-center">Yükleniyor…</p>;
  if (list.length === 0) return <EmptyState icon={ClipboardList} title="Form yok" description="Size yönlendirilen formlar burada görünür." />;

  return (
    <div className="max-w-2xl flex flex-col gap-2">
      {list.map(f => (
        <div key={f.id} className="rounded-xl p-3.5" style={{ border: '1px solid var(--border-subtle)' }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{f.title}</p>
              {f.desc && <p className="text-body-sm mt-0.5">{f.desc}</p>}
              <div className="flex items-center gap-2 mt-1 text-caption flex-wrap">
                <span style={{ color: 'var(--text-muted)' }}>{f.questionCount} soru</span>
                {f.anonymous && <span className="badge">anonim</span>}
                {f.answered && <span className="badge badge-success flex items-center gap-1"><Check size={11} /> yanıtlandı</span>}
                {(f.closed || (f.closeDate && f.closeDate < new Date().toISOString().slice(0, 10))) && <span className="badge badge-warning">kapalı</span>}
              </div>
            </div>
            <button onClick={() => setOpenId(f.id)} className="btn-primary !text-xs !px-3 !py-1.5 shrink-0">
              {f.answered ? 'Gör / Düzenle' : 'Doldur'}
            </button>
          </div>
        </div>
      ))}
      {openId && <FillModal formId={openId} onClose={() => setOpenId(null)} onSaved={() => { mutate(); }} showToast={showToast} />}
    </div>
  );
}

function FillModal({ formId, onClose, onSaved, showToast }) {
  const { data, isLoading } = useSWR(`/api/form?id=${encodeURIComponent(formId)}`);
  const form = data?.form;
  const mine = data?.mine;
  const [answers, setAnswers] = useState(null);
  const [busy, setBusy] = useState(false);

  // İlk yüklemede mevcut yanıtı doldur
  const init = answers === null && data;
  if (init) {
    setAnswers(mine?.answers ? { ...mine.answers } : {});
  }

  const closed = form && (form.closed || (form.closeDate && form.closeDate < new Date().toISOString().slice(0, 10)));

  function setAns(qid, val) { setAnswers(p => ({ ...p, [qid]: val })); }
  function toggleMulti(qid, opt) {
    setAnswers(p => {
      const arr = Array.isArray(p[qid]) ? p[qid] : [];
      return { ...p, [qid]: arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt] };
    });
  }

  async function submit() {
    setBusy(true);
    try {
      await api('/api/form', { method: 'POST', body: JSON.stringify({ action: 'submit', id: formId, answers: answers || {} }) });
      showToast?.('Yanıtınız alındı');
      onSaved?.();
      onClose();
    } catch (e) { showToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="modal w-full max-w-lg max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="min-w-0">
            <p className="font-700 truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{form?.title || 'Form'}</p>
            {form?.anonymous && <p className="text-caption">Yanıtınız anonim kaydedilir.</p>}
          </div>
          <button onClick={onClose} className="hover:opacity-70 shrink-0" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4 flex flex-col gap-4">
          {isLoading || answers === null ? <p className="text-caption">Yükleniyor…</p> : (
            <>
              {form?.desc && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{form.desc}</p>}
              {(form?.questions || []).map((q, i) => (
                <div key={q.id}>
                  <p className="text-sm font-600 mb-1.5" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {i + 1}. {q.label} {q.required && <span style={{ color: '#e11d48' }}>*</span>}
                  </p>
                  {q.type === 'text' && (
                    <textarea value={answers[q.id] || ''} disabled={closed} onChange={e => setAns(q.id, e.target.value)} rows={2} className="input !text-sm resize-y" placeholder="Yanıtınız" />
                  )}
                  {q.type === 'single' && (
                    <div className="flex flex-col gap-1.5">
                      {q.options.map(o => (
                        <label key={o} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                          <input type="radio" name={q.id} checked={answers[q.id] === o} disabled={closed} onChange={() => setAns(q.id, o)} className="accent-indigo-600" /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === 'multi' && (
                    <div className="flex flex-col gap-1.5">
                      {q.options.map(o => (
                        <label key={o} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                          <input type="checkbox" checked={Array.isArray(answers[q.id]) && answers[q.id].includes(o)} disabled={closed} onChange={() => toggleMulti(q.id, o)} className="accent-indigo-600" /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === 'rating' && (
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4, 5].map(n => {
                        const on = answers[q.id] === n;
                        return (
                          <button key={n} disabled={closed} onClick={() => setAns(q.id, n)}
                            className="w-9 h-9 rounded-lg text-sm font-600"
                            style={on ? { background: '#6366f1', color: '#fff', fontWeight: 600 } : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        {!closed && answers !== null && (
          <div className="px-4 py-3 flex justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button onClick={submit} disabled={busy} className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm">
              <Check size={14} /> {busy ? 'Gönderiliyor…' : mine ? 'Güncelle' : 'Gönder'}
            </button>
          </div>
        )}
        {closed && <div className="px-4 py-3 text-caption" style={{ borderTop: '1px solid var(--border-subtle)' }}>Bu form kapalı — yanıt değiştirilemez.</div>}
      </div>
    </div>
  );
}
