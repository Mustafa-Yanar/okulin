'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import {
  TrendingUp, TrendingDown, Scale, Plus, X, Trash2, Edit3,
  Users, Receipt, Calendar,
} from 'lucide-react';
import { EXPENSE_CATEGORIES } from '@/lib/constants';
import { CountUp } from '../useCountUp';
import { useConfirm } from '../ConfirmProvider';
import type { Session } from '@/lib/auth';
import type { ShowToast, FinanceListItemDTO } from '../types';
import type { PaymentEntry } from '@/lib/finance';

// app/api/finance/expense/route.ts ExpenseData ile birebir.
interface ExpenseDTO {
  id: string;
  type: 'personnel' | 'general';
  date: string;
  description: string;
  amount: number;
  personnelId?: string | null;
  personnelName?: string;
  period?: string;
  salary?: number;
  extras?: { label: string; amount: number }[];
  category?: string;
  createdBy?: string;
  createdByRole?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

function fmt(n: number | undefined): string {
  return (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface ExpensePanelProps {
  session?: Session | null;
  showToast?: ShowToast;
}

export default function ExpensePanel({ session, showToast }: ExpensePanelProps) {
  const confirm = useConfirm();
  const [view, setView] = useState('personnel'); // 'personnel' | 'general'
  const [period, setPeriod] = useState(''); // '' = tüm zamanlar, yoksa YYYY-MM
  const [catFilter, setCatFilter] = useState('');
  const [form, setForm] = useState<{ mode: 'new' | 'edit'; type: string; data: ExpenseDTO | null } | null>(null);

  // Giderler (ana veri) — SWR. mutateExpenses ile silme/ekleme sonrası iyimser güncellenir.
  const { data: expData, isLoading: loading, mutate: mutateExpenses } = useSWR<ExpenseDTO[]>('/api/finance/expense');
  const expenses = useMemo(() => (Array.isArray(expData) ? expData : []), [expData]);

  // Gider kategorileri kurum konfigürasyonundan (yoksa sabit liste). "Diğer" daima sonda.
  const { data: cfgData } = useSWR<{ expenseCategories?: string[] }>('/api/config');
  const categories = useMemo(() => {
    const list = Array.isArray(cfgData?.expenseCategories) && cfgData.expenseCategories.length
      ? cfgData.expenseCategories : EXPENSE_CATEGORIES;
    const rest = list.filter(c => c !== 'Diğer');
    return list.includes('Diğer') ? [...rest, 'Diğer'] : rest;
  }, [cfgData]);

  // Gelir (öğrenci ödemeleri) — özet için. FinancePanel ile aynı anahtar → SWR paylaşır.
  const { data: incomeData } = useSWR<FinanceListItemDTO[]>('/api/finance');
  const payments = useMemo(() => {
    const flat: PaymentEntry[] = [];
    (Array.isArray(incomeData) ? incomeData : []).forEach(item => {
      (item.finance?.payments || []).forEach(p => flat.push(p));
    });
    return flat;
  }, [incomeData]);

  // Personel önerileri — iki endpoint birleşimi (öğretmen + muhasebeci), SWR'a uygun değil → manuel.
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    (async () => {
      const names: { id: string; name: string }[] = [];
      try {
        const tRes = await fetch('/api/teachers', { credentials: 'same-origin' });
        const t = (await tRes.json()) as { id: string; name: string }[];
        (Array.isArray(t) ? t : []).forEach(x => names.push({ id: x.id, name: x.name }));
      } catch { /* yoksay */ }
      try {
        const aRes = await fetch('/api/accountants', { credentials: 'same-origin' });
        if (aRes.ok) {
          const a = (await aRes.json()) as { id: string; name: string }[];
          (Array.isArray(a) ? a : []).forEach(x => names.push({ id: x.id, name: x.name }));
        }
      } catch { /* muhasebeci listesi müdüre özel — sessizce geç */ }
      setStaff(names);
    })();
  }, []);

  // Dönem filtresi (client-side)
  const periodMatch = useCallback((dateStr: string | undefined, periodStr?: string) => {
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

  async function handleDelete(exp: ExpenseDTO) {
    const label = exp.type === 'personnel' ? exp.personnelName : exp.category;
    if (!(await confirm(`"${label}" gideri (₺${fmt(exp.amount)}) silinsin mi?`))) return;
    try {
      const res = await fetch('/api/finance/expense', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: exp.id }),
      });
      if (!res.ok) throw new Error('Silinemedi');
      mutateExpenses(expenses.filter(e => e.id !== exp.id), { revalidate: false });
      showToast?.('Gider silindi');
    } catch (err) { showToast?.((err as Error).message, 'error'); }
  }

  function openNew() {
    setForm({ mode: 'new', type: view, data: null });
  }
  function openEdit(exp: ExpenseDTO) {
    setForm({ mode: 'edit', type: exp.type, data: exp });
  }

  return (
    <div>
      {/* Özet kartları — enerjik KPI: gradyan + beyaz metin + sayaç + brand-tint gölge +
          hover lift. Net pozitif=kurum rengi (white-label), negatif=amber uyarı. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 reveal-stagger">
        {[
          { label: 'Toplam Gelir', value: summary.income, icon: TrendingUp, cls: 'kpi-emerald' },
          { label: 'Toplam Gider', value: summary.expense, icon: TrendingDown, cls: 'kpi-rose' },
          { label: 'Net', value: summary.net, icon: Scale, cls: summary.net >= 0 ? 'kpi-brand' : 'kpi-amber' },
        ].map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`kpi-card ${c.cls} hover-lift`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="kpi-label">{c.label}</span>
                <Icon size={16} className="opacity-80" />
              </div>
              <div className="kpi-num">
                {c.value < 0 ? '−' : ''}₺<CountUp value={Math.abs(c.value)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Kontrol satırı: görünüm + dönem */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="pill-tabs">
          {[['personnel', 'Personel Ödemeleri'], ['general', 'Diğer Giderler']].map(([k, l]) => (
            <button key={k} onClick={() => { setView(k); setCatFilter(''); }}
              className={`pill-tab${view === k ? ' is-active' : ''}`}>
              <span>{l}</span>
            </button>
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
            className="flex items-center gap-1.5 px-3 py-2 bg-brand text-white text-sm rounded-lg">
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
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <p className="text-caption py-10 text-center">Yükleniyor…</p>
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
          mode={form.mode} type={form.type} initial={form.data} staff={staff} categories={categories}
          onClose={() => setForm(null)}
          onSaved={(rec, isEdit) => {
            mutateExpenses(isEdit ? expenses.map(e => e.id === rec.id ? rec : e) : [rec, ...expenses], { revalidate: false });
            setForm(null);
            showToast?.(isEdit ? 'Gider güncellendi' : 'Gider eklendi');
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

interface ExpenseListProps {
  items: ExpenseDTO[];
  onEdit: (exp: ExpenseDTO) => void;
  onDelete: (exp: ExpenseDTO) => void;
}

// ── Personel ödemeleri listesi ───────────────────────────────────────────────
function PersonnelList({ items, onEdit, onDelete }: ExpenseListProps) {
  return (
    <div className="grid gap-2">
      {items.map(e => {
        const extrasTotal = (e.extras || []).reduce((s, x) => s + (x.amount || 0), 0);
        return (
          <div key={e.id} className="card card-interactive px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white font-700 text-sm"
              style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))', fontWeight: 700 }}>
              {(e.personnelName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{e.personnelName}</div>
              <div className="text-caption">
                Dönem: {e.period} · Maaş ₺{fmt(e.salary)}
                {extrasTotal > 0 && <> · Ek ödeme ₺{fmt(extrasTotal)}</>}
                {e.description && <> · {e.description}</>}
              </div>
              {(e.extras || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(e.extras || []).map((x, i) => (
                    <span key={i} className="text-[10px] bg-brand-soft text-brand rounded px-1.5 py-0.5">
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
              <button onClick={() => onEdit(e)} className="btn-icon btn-icon-primary" title="Düzenle"><Edit3 size={14} /></button>
              <button onClick={() => onDelete(e)} className="btn-icon btn-icon-danger" title="Sil"><Trash2 size={14} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Diğer giderler listesi ───────────────────────────────────────────────────
function GeneralList({ items, onEdit, onDelete }: ExpenseListProps) {
  return (
    <div className="grid gap-2">
      {items.map(e => (
        <div key={e.id} className="card card-interactive px-4 py-3 flex items-center gap-3">
          <span className="badge shrink-0" style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 12%, transparent)', color: 'var(--brand,#6366f1)' }}>
            {e.category}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{e.description || e.category}</div>
            <div className="text-caption">{e.date}</div>
          </div>
          <div className="font-800 shrink-0" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>₺{fmt(e.amount)}</div>
          <div className="flex gap-1 shrink-0">
            <button onClick={() => onEdit(e)} className="btn-icon btn-icon-primary" title="Düzenle"><Edit3 size={14} /></button>
            <button onClick={() => onDelete(e)} className="btn-icon btn-icon-danger" title="Sil"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ExpenseFormProps {
  mode: 'new' | 'edit';
  type: string;
  initial: ExpenseDTO | null;
  staff: { id: string; name: string }[];
  categories: string[];
  onClose: () => void;
  onSaved: (rec: ExpenseDTO, isEdit: boolean) => void;
  showToast?: ShowToast;
}

// ── Ekleme/düzenleme formu ───────────────────────────────────────────────────
function ExpenseForm({ mode, type, initial, staff, categories, onClose, onSaved, showToast }: ExpenseFormProps) {
  const cats = (Array.isArray(categories) && categories.length) ? categories : EXPENSE_CATEGORIES;
  const isEdit = mode === 'edit';
  // ortak
  const [date, setDate] = useState(initial?.date || todayISO());
  const [description, setDescription] = useState(initial?.description || '');
  // personnel
  const [personnelName, setPersonnelName] = useState(initial?.personnelName || '');
  const [period, setPeriod] = useState(initial?.period || thisMonth());
  const [salary, setSalary] = useState(initial?.salary != null ? String(initial.salary) : '');
  // Yeni satır boş string amount ile açılır; kayıtlı satır sayı taşır (form içinde karışık).
  const [extras, setExtras] = useState<{ label: string; amount: number | string }[]>(
    initial?.extras?.length ? initial.extras.map(x => ({ ...x })) : []
  );
  // general
  const [category, setCategory] = useState(initial?.category || cats[0]);
  const [amount, setAmount] = useState(initial?.amount != null && type === 'general' ? String(initial.amount) : '');
  const [busy, setBusy] = useState(false);

  const extrasTotal = extras.reduce((s, x) => s + (parseFloat(String(x.amount)) || 0), 0);
  const personnelTotal = (parseFloat(salary) || 0) + extrasTotal;

  function addExtra() { setExtras(prev => [...prev, { label: '', amount: '' }]); }
  function setExtra(i: number, key: 'label' | 'amount', val: string) { setExtras(prev => prev.map((x, j) => j === i ? { ...x, [key]: val } : x)); }
  function removeExtra(i: number) { setExtras(prev => prev.filter((_, j) => j !== i)); }

  function pickStaff(name: string) {
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
    const body: Record<string, unknown> = type === 'personnel'
      ? {
          type, date, description,
          personnelName: personnelName.trim(),
          personnelId: matched?.id || null,
          period, salary: parseFloat(salary) || 0,
          extras: extras
            .map(x => ({ label: (x.label || '').trim(), amount: parseFloat(String(x.amount)) || 0 }))
            .filter(x => x.amount > 0 || x.label),
        }
      : { type, date, description, category, amount: parseFloat(amount) || 0 };
    if (isEdit) body.id = initial!.id;

    setBusy(true);
    try {
      const res = await fetch('/api/finance/expense', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; record: ExpenseDTO };
      if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
      onSaved(data.record, isEdit);
    } catch (err) {
      showToast?.((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const labelCls = 'text-label block mb-1.5';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" className="modal w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>
            {type === 'personnel' ? 'Personel Ödemesi' : 'Gider'} {isEdit ? 'Düzenle' : 'Ekle'}
          </h3>
          <button onClick={onClose} className="btn-icon"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3.5">
          {type === 'personnel' ? (
            <>
              <div>
                <label className={labelCls}>Personel</label>
                <input value={personnelName} onChange={e => setPersonnelName(e.target.value)}
                  list="staff-suggestions" placeholder="İsim seç veya yaz"
                  className="input" />
                <datalist id="staff-suggestions">
                  {staff.map(s => <option key={s.id} value={s.name} />)}
                </datalist>
                <p className="text-[10px] text-gray-400 mt-1">Listede yoksa elle yazabilirsiniz (temizlik, sekreter vb.)</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Dönem (ay)</label>
                  <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                    className="input" />
                </div>
                <div>
                  <label className={labelCls}>Maaş (₺)</label>
                  <input type="number" inputMode="decimal" value={salary} onChange={e => setSalary(e.target.value)} placeholder="0"
                    className="input" />
                </div>
              </div>

              {/* Ek ödemeler */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={labelCls + ' !mb-0'}>Ek Ödemeler</label>
                  <button type="button" onClick={addExtra} className="text-xs text-brand hover:underline flex items-center gap-1">
                    <Plus size={12} /> Satır ekle
                  </button>
                </div>
                {extras.length === 0 && <p className="text-caption">Prim, avans, ikramiye… (opsiyonel)</p>}
                <div className="space-y-2">
                  {extras.map((x, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={x.label} onChange={e => setExtra(i, 'label', e.target.value)} placeholder="Etiket (örn: Prim)"
                        className="input flex-1" />
                      <input type="number" inputMode="decimal" value={x.amount} onChange={e => setExtra(i, 'amount', e.target.value)} placeholder="₺"
                        className="input w-24" />
                      <button type="button" onClick={() => removeExtra(i)} className="btn-icon btn-icon-danger"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-brand-soft rounded-xl px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-brand font-600" style={{ fontWeight: 600 }}>Genel Toplam</span>
                <span className="text-lg font-800 text-brand" style={{ fontWeight: 800 }}>₺{fmt(personnelTotal)}</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={labelCls}>Kategori</label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                  className="input">
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tutar (₺)</label>
                <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                  className="input" />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tarih</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="input" />
            </div>
            <div>
              <label className={labelCls}>Açıklama</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Opsiyonel"
                className="input" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 sticky bottom-0" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button onClick={onClose} className="btn-ghost !px-4 !py-2 text-sm">İptal</button>
          <button onClick={submit} disabled={busy} className="btn-primary !px-4 !py-2 text-sm">
            {busy ? 'Kaydediliyor…' : isEdit ? 'Güncelle' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}
