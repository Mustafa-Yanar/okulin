'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Scale, Plus, X, Trash2, Edit3,
  Users, Receipt, Calendar,
} from 'lucide-react';
import { EXPENSE_CATEGORIES } from '@/lib/constants';

function fmt(n) {
  return (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function ExpensePanel({ session, showToast }) {
  const [view, setView] = useState('personnel'); // 'personnel' | 'general'
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]); // gelir (öğrenci ödemeleri) — özet için
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(''); // '' = tüm zamanlar, yoksa YYYY-MM
  const [catFilter, setCatFilter] = useState('');
  const [staff, setStaff] = useState([]); // personel önerileri
  const [form, setForm] = useState(null); // {mode:'new'|'edit', type, data}

  const loadExpenses = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/expense', { credentials: 'same-origin' });
      const data = await res.json();
      setExpenses(Array.isArray(data) ? data : []);
    } catch { showToast?.('Giderler yüklenemedi', 'error'); }
  }, [showToast]);

  const loadIncome = useCallback(async () => {
    try {
      const res = await fetch('/api/finance', { credentials: 'same-origin' });
      const data = await res.json();
      const flat = [];
      (Array.isArray(data) ? data : []).forEach(item => {
        (item.finance?.payments || []).forEach(p => flat.push(p));
      });
      setPayments(flat);
    } catch { /* gelir özeti opsiyonel */ }
  }, []);

  const loadStaff = useCallback(async () => {
    const names = [];
    try {
      const tRes = await fetch('/api/teachers', { credentials: 'same-origin' });
      const t = await tRes.json();
      (Array.isArray(t) ? t : []).forEach(x => names.push({ id: x.id, name: x.name }));
    } catch { /* yoksay */ }
    try {
      const aRes = await fetch('/api/accountants', { credentials: 'same-origin' });
      if (aRes.ok) {
        const a = await aRes.json();
        (Array.isArray(a) ? a : []).forEach(x => names.push({ id: x.id, name: x.name }));
      }
    } catch { /* muhasebeci listesi müdüre özel — sessizce geç */ }
    setStaff(names);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadExpenses(), loadIncome(), loadStaff()]);
      setLoading(false);
    })();
  }, [loadExpenses, loadIncome, loadStaff]);

  // Dönem filtresi (client-side)
  const periodMatch = useCallback((dateStr, periodStr) => {
    if (!period) return true;
    return (periodStr || dateStr?.slice(0, 7)) === period;
  }, [period]);

  const filteredExpenses = useMemo(() => expenses.filter(e =>
    e.type === view &&
    periodMatch(e.date, e.period) &&
    (view !== 'general' || !catFilter || e.category === catFilter)
  ), [expenses, view, catFilter, periodMatch]);

  // Özet: gelir / gider / net (dönem filtresine saygılı)
  const summary = useMemo(() => {
    const income = payments
      .filter(p => periodMatch(p.date))
      .reduce((s, p) => s + (p.amount || 0), 0);
    const expense = expenses
      .filter(e => periodMatch(e.date, e.period))
      .reduce((s, e) => s + (e.amount || 0), 0);
    return { income, expense, net: income - expense };
  }, [payments, expenses, periodMatch]);

  async function handleDelete(exp) {
    const label = exp.type === 'personnel' ? exp.personnelName : exp.category;
    if (!confirm(`"${label}" gideri (₺${fmt(exp.amount)}) silinsin mi?`)) return;
    try {
      const res = await fetch('/api/finance/expense', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: exp.id }),
      });
      if (!res.ok) throw new Error('Silinemedi');
      setExpenses(prev => prev.filter(e => e.id !== exp.id));
      showToast?.('Gider silindi');
    } catch (err) { showToast?.(err.message, 'error'); }
  }

  function openNew() {
    setForm({ mode: 'new', type: view, data: null });
  }
  function openEdit(exp) {
    setForm({ mode: 'edit', type: exp.type, data: exp });
  }

  return (
    <div>
      {/* Özet kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Toplam Gelir', value: summary.income, icon: TrendingUp, color: 'from-emerald-500 to-green-600' },
          { label: 'Toplam Gider', value: summary.expense, icon: TrendingDown, color: 'from-rose-500 to-red-600' },
          { label: 'Net', value: summary.net, icon: Scale, color: summary.net >= 0 ? 'from-indigo-500 to-blue-600' : 'from-amber-500 to-orange-600' },
        ].map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`rounded-2xl p-4 text-white bg-gradient-to-br ${c.color} shadow-sm`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs opacity-90 font-600" style={{ fontWeight: 600 }}>{c.label}</span>
                <Icon size={16} className="opacity-80" />
              </div>
              <div className="text-2xl font-800" style={{ fontWeight: 800 }}>
                {c.value < 0 ? '−' : ''}₺{fmt(Math.abs(c.value))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Kontrol satırı: görünüm + dönem */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          {[['personnel', '👥 Personel Ödemeleri'], ['general', '🧾 Diğer Giderler']].map(([k, l]) => (
            <button key={k} onClick={() => { setView(k); setCatFilter(''); }}
              className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${view === k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              style={{ fontWeight: 600 }}>{l}</button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Calendar size={14} />
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
            {period && (
              <button onClick={() => setPeriod('')} className="text-gray-400 hover:text-gray-700" title="Tüm zamanlar">
                <X size={14} />
              </button>
            )}
          </div>
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            <Plus size={15} /> {view === 'personnel' ? 'Ödeme Ekle' : 'Gider Ekle'}
          </button>
        </div>
      </div>

      {/* Genel gider kategori filtresi */}
      {view === 'general' && (
        <div className="mb-3">
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">Tüm kategoriler</option>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <p className="text-sm text-gray-400 py-10 text-center">Yükleniyor…</p>
      ) : filteredExpenses.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {view === 'personnel' ? <Users size={36} className="mx-auto mb-2 opacity-40" /> : <Receipt size={36} className="mx-auto mb-2 opacity-40" />}
          <p className="text-sm">Kayıt yok.</p>
        </div>
      ) : view === 'personnel' ? (
        <PersonnelList items={filteredExpenses} onEdit={openEdit} onDelete={handleDelete} />
      ) : (
        <GeneralList items={filteredExpenses} onEdit={openEdit} onDelete={handleDelete} />
      )}

      {form && (
        <ExpenseForm
          mode={form.mode} type={form.type} initial={form.data} staff={staff}
          onClose={() => setForm(null)}
          onSaved={(rec, isEdit) => {
            setExpenses(prev => isEdit ? prev.map(e => e.id === rec.id ? rec : e) : [rec, ...prev]);
            setForm(null);
            showToast?.(isEdit ? 'Gider güncellendi' : 'Gider eklendi');
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ── Personel ödemeleri listesi ───────────────────────────────────────────────
function PersonnelList({ items, onEdit, onDelete }) {
  return (
    <div className="grid gap-2">
      {items.map(e => {
        const extrasTotal = (e.extras || []).reduce((s, x) => s + (x.amount || 0), 0);
        return (
          <div key={e.id} className="card px-4 py-3 flex items-center gap-3 hover:shadow-md transition-all">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white font-700 text-sm"
              style={{ background: 'linear-gradient(135deg,#6366f1,#4338ca)', fontWeight: 700 }}>
              {(e.personnelName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-600 text-gray-800 truncate" style={{ fontWeight: 600 }}>{e.personnelName}</div>
              <div className="text-xs text-gray-400">
                Dönem: {e.period} · Maaş ₺{fmt(e.salary)}
                {extrasTotal > 0 && <> · Ek ödeme ₺{fmt(extrasTotal)}</>}
                {e.description && <> · {e.description}</>}
              </div>
              {(e.extras || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {e.extras.map((x, i) => (
                    <span key={i} className="text-[10px] bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">
                      {x.label || 'Ek'}: ₺{fmt(x.amount)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="font-800 text-gray-900" style={{ fontWeight: 800 }}>₺{fmt(e.amount)}</div>
              <div className="text-[10px] text-gray-400">{e.date}</div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => onEdit(e)} className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600" title="Düzenle"><Edit3 size={14} /></button>
              <button onClick={() => onDelete(e)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Sil"><Trash2 size={14} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Diğer giderler listesi ───────────────────────────────────────────────────
function GeneralList({ items, onEdit, onDelete }) {
  return (
    <div className="grid gap-2">
      {items.map(e => (
        <div key={e.id} className="card px-4 py-3 flex items-center gap-3 hover:shadow-md transition-all">
          <span className="text-[11px] px-2.5 py-1 rounded-lg font-600 shrink-0" style={{ background: '#eef2ff', color: '#4338ca', fontWeight: 600 }}>
            {e.category}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-600 text-gray-800 truncate" style={{ fontWeight: 600 }}>{e.description || e.category}</div>
            <div className="text-xs text-gray-400">{e.date}</div>
          </div>
          <div className="font-800 text-gray-900 shrink-0" style={{ fontWeight: 800 }}>₺{fmt(e.amount)}</div>
          <div className="flex gap-1 shrink-0">
            <button onClick={() => onEdit(e)} className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600" title="Düzenle"><Edit3 size={14} /></button>
            <button onClick={() => onDelete(e)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Sil"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Ekleme/düzenleme formu ───────────────────────────────────────────────────
function ExpenseForm({ mode, type, initial, staff, onClose, onSaved, showToast }) {
  const isEdit = mode === 'edit';
  // ortak
  const [date, setDate] = useState(initial?.date || todayISO());
  const [description, setDescription] = useState(initial?.description || '');
  // personnel
  const [personnelName, setPersonnelName] = useState(initial?.personnelName || '');
  const [period, setPeriod] = useState(initial?.period || thisMonth());
  const [salary, setSalary] = useState(initial?.salary != null ? String(initial.salary) : '');
  const [extras, setExtras] = useState(initial?.extras?.length ? initial.extras.map(x => ({ ...x })) : []);
  // general
  const [category, setCategory] = useState(initial?.category || EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState(initial?.amount != null && type === 'general' ? String(initial.amount) : '');
  const [busy, setBusy] = useState(false);

  const extrasTotal = extras.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const personnelTotal = (parseFloat(salary) || 0) + extrasTotal;

  function addExtra() { setExtras(prev => [...prev, { label: '', amount: '' }]); }
  function setExtra(i, key, val) { setExtras(prev => prev.map((x, j) => j === i ? { ...x, [key]: val } : x)); }
  function removeExtra(i) { setExtras(prev => prev.filter((_, j) => j !== i)); }

  function pickStaff(name) {
    setPersonnelName(name);
  }

  async function submit() {
    if (type === 'personnel') {
      if (!personnelName.trim()) return showToast?.('Personel adı gerekli', 'error');
      if (personnelTotal <= 0) return showToast?.('Maaş veya ek ödeme girin', 'error');
    } else {
      if ((parseFloat(amount) || 0) <= 0) return showToast?.('Tutar girin', 'error');
    }

    const matched = staff.find(s => s.name === personnelName.trim());
    const body = type === 'personnel'
      ? {
          type, date, description,
          personnelName: personnelName.trim(),
          personnelId: matched?.id || null,
          period, salary: parseFloat(salary) || 0,
          extras: extras
            .map(x => ({ label: (x.label || '').trim(), amount: parseFloat(x.amount) || 0 }))
            .filter(x => x.amount > 0 || x.label),
        }
      : { type, date, description, category, amount: parseFloat(amount) || 0 };
    if (isEdit) body.id = initial.id;

    setBusy(true);
    try {
      const res = await fetch('/api/finance/expense', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
      onSaved(data.record, isEdit);
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const labelCls = 'block text-xs font-600 text-gray-500 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>
            {type === 'personnel' ? 'Personel Ödemesi' : 'Gider'} {isEdit ? 'Düzenle' : 'Ekle'}
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          {type === 'personnel' ? (
            <>
              <div>
                <label className={labelCls} style={{ fontWeight: 600 }}>Personel</label>
                <input value={personnelName} onChange={e => setPersonnelName(e.target.value)}
                  list="staff-suggestions" placeholder="İsim seç veya yaz"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
                <datalist id="staff-suggestions">
                  {staff.map(s => <option key={s.id} value={s.name} />)}
                </datalist>
                <p className="text-[10px] text-gray-400 mt-1">Listede yoksa elle yazabilirsiniz (temizlik, sekreter vb.)</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} style={{ fontWeight: 600 }}>Dönem (ay)</label>
                  <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
                </div>
                <div>
                  <label className={labelCls} style={{ fontWeight: 600 }}>Maaş (₺)</label>
                  <input type="number" inputMode="decimal" value={salary} onChange={e => setSalary(e.target.value)} placeholder="0"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
                </div>
              </div>

              {/* Ek ödemeler */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={labelCls + ' !mb-0'} style={{ fontWeight: 600 }}>Ek Ödemeler</label>
                  <button type="button" onClick={addExtra} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                    <Plus size={12} /> Satır ekle
                  </button>
                </div>
                {extras.length === 0 && <p className="text-[11px] text-gray-400">Prim, avans, ikramiye… (opsiyonel)</p>}
                <div className="space-y-2">
                  {extras.map((x, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={x.label} onChange={e => setExtra(i, 'label', e.target.value)} placeholder="Etiket (örn: Prim)"
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                      <input type="number" inputMode="decimal" value={x.amount} onChange={e => setExtra(i, 'amount', e.target.value)} placeholder="₺"
                        className="w-24 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                      <button type="button" onClick={() => removeExtra(i)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-indigo-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-indigo-500 font-600" style={{ fontWeight: 600 }}>Genel Toplam</span>
                <span className="text-lg font-800 text-indigo-700" style={{ fontWeight: 800 }}>₺{fmt(personnelTotal)}</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={labelCls} style={{ fontWeight: 600 }}>Kategori</label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none">
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} style={{ fontWeight: 600 }}>Tutar (₺)</label>
                <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ fontWeight: 600 }}>Tarih</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
            </div>
            <div>
              <label className={labelCls} style={{ fontWeight: 600 }}>Açıklama</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Opsiyonel"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">İptal</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'Kaydediliyor…' : isEdit ? 'Güncelle' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}
