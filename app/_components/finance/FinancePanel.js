'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Users, Plus, X, Check,
  ChevronDown, ChevronUp, Printer, Trash2, AlertCircle, Edit3,
  Search, CreditCard, Banknote, Building2
} from 'lucide-react';

const DERSHANE = {
  name: 'Akyazı Çözüm Özel Öğretim Kursu',
  address: 'Akyazı / Sakarya',
};

const METHODS = ['Nakit', 'Havale/EFT', 'Kredi Kartı'];

function fmt(n) {
  return (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(todayISO());
}

// ── Makbuz yazdırma bileşeni ─────────────────────────────────────────────────
function ReceiptPrintArea({ data, onClose }) {
  const { studentName, studentCls, payment, dershane } = data;

  useEffect(() => {
    const timer = setTimeout(() => window.print(), 200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <span className="font-700 text-gray-800" style={{ fontWeight: 700 }}>Makbuz Önizlemesi</span>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-600 hover:bg-indigo-700 transition-colors"
              style={{ fontWeight: 600 }}
            >
              <Printer size={14} /> Yazdır
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div id="print-area" className="p-6">
          {/* Makbuz içeriği */}
          <div className="text-center border-b border-gray-200 pb-4 mb-4">
            <div className="font-800 text-lg text-gray-900" style={{ fontWeight: 800 }}>{dershane.name}</div>
            <div className="text-sm text-gray-500">{dershane.address}</div>
          </div>
          <div className="text-center mb-4">
            <div className="text-xs uppercase tracking-widest text-gray-400 font-600" style={{ fontWeight: 600 }}>Ödeme Makbuzu</div>
            <div className="text-2xl font-800 text-indigo-600 mt-1" style={{ fontWeight: 800 }}>{payment.receiptNo}</div>
          </div>
          <table className="w-full text-sm mb-4">
            <tbody>
              {[
                ['Öğrenci Adı', studentName],
                ['Sınıf', studentCls?.toUpperCase()],
                ['Tarih', payment.date],
                ['Ödeme Yöntemi', payment.method],
                ...(payment.note ? [['Açıklama', payment.note]] : []),
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-gray-50">
                  <td className="py-2 text-gray-500 w-36">{k}</td>
                  <td className="py-2 text-gray-800 font-600" style={{ fontWeight: 600 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bg-indigo-50 rounded-xl p-4 text-center">
            <div className="text-xs text-indigo-500 uppercase tracking-wide mb-1 font-600" style={{ fontWeight: 600 }}>Tahsil Edilen Tutar</div>
            <div className="text-3xl font-800 text-indigo-700" style={{ fontWeight: 800 }}>₺{fmt(payment.amount)}</div>
          </div>
          <div className="text-center text-xs text-gray-400 mt-4">
            Kaydeden: {payment.recordedBy}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body > *:not(#print-area) { display: none !important; }
          .no-print { position: fixed !important; inset: 0 !important; background: white !important; display: flex !important; align-items: center !important; justify-content: center !important; }
          #print-area { display: block !important; padding: 24px !important; }
          button, .no-print > div > div:first-child { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ── Ödeme ekleme modalı ──────────────────────────────────────────────────────
function AddPaymentModal({ studentId, studentName, balance, installments, onClose, onSuccess, showToast }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('Nakit');
  const [note, setNote] = useState('');
  const [installmentIdx, setInstallmentIdx] = useState('');
  const [saving, setSaving] = useState(false);

  const unpaidInstallments = (installments || []).filter(inst => !inst.paid);

  async function submit(e) {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) { showToast('Geçerli bir tutar girin', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/finance/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          studentId, amount: parseFloat(amount), date, method, note,
          installmentIdx: installmentIdx !== '' ? parseInt(installmentIdx) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Hata');
      onSuccess(data);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Ödeme Ekle — {studentName}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm text-amber-700">Kalan Borç</span>
            <span className="text-lg font-800 text-amber-700" style={{ fontWeight: 800 }}>₺{fmt(balance)}</span>
          </div>

          {unpaidInstallments.length > 0 && (
            <div>
              <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Taksit Seç (opsiyonel)</label>
              <select
                value={installmentIdx}
                onChange={e => {
                  setInstallmentIdx(e.target.value);
                  if (e.target.value !== '') {
                    const inst = installments[parseInt(e.target.value)];
                    if (inst) setAmount(String(inst.amount));
                  }
                }}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
              >
                <option value="">— Genel ödeme —</option>
                {unpaidInstallments.map(inst => (
                  <option key={inst.idx} value={inst.idx}>
                    {inst.idx + 1}. Taksit — {inst.dueDate} — ₺{fmt(inst.amount)}
                    {isOverdue(inst.dueDate) ? ' ⚠ Vadesi Geçti' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Tutar (₺)</label>
            <input
              type="number" min="0.01" step="0.01"
              value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
              placeholder="0,00" required autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Tarih</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Ödeme Yöntemi</label>
            <div className="flex gap-2">
              {METHODS.map(m => (
                <button
                  key={m} type="button"
                  onClick={() => setMethod(m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-600 border transition-all ${method === m ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                  style={{ fontWeight: 600 }}
                >{m}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Not (opsiyonel)</label>
            <input
              type="text" value={note} onChange={e => setNote(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
              placeholder="Örn: 1. dönem ödemesi"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-700 text-sm hover:from-indigo-600 hover:to-indigo-700 transition-all disabled:opacity-50"
              style={{ fontWeight: 700 }}
            >{saving ? 'Kaydediliyor…' : 'Ödemeyi Kaydet & Makbuz Al'}</button>
            <button type="button" onClick={onClose} className="px-4 py-3 rounded-xl bg-gray-100 text-gray-600 font-600 text-sm hover:bg-gray-200 transition-colors" style={{ fontWeight: 600 }}>İptal</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Finansal kayıt oluşturma / düzenleme modalı ─────────────────────────────
function FinanceRegisterModal({ student, existing, onClose, onSuccess, showToast }) {
  const [totalFee, setTotalFee] = useState(existing?.totalFee ? String(existing.totalFee) : '');
  const [discount, setDiscount] = useState(existing?.discount ? String(existing.discount) : '0');
  const [plan, setPlan] = useState(existing?.paymentPlan || 'pesin');
  const [installmentCount, setInstallmentCount] = useState(existing?.installments?.length || 3);
  const [installments, setInstallments] = useState(() => {
    if (existing?.installments?.length) return existing.installments;
    return [];
  });
  const [saving, setSaving] = useState(false);

  const netFee = Math.max(0, (parseFloat(totalFee) || 0) - (parseFloat(discount) || 0));

  function buildInstallments(count, net) {
    const perInst = net > 0 ? Math.round((net / count) * 100) / 100 : 0;
    const today = new Date();
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(today);
      d.setMonth(d.getMonth() + i + 1);
      return {
        idx: i,
        dueDate: d.toISOString().slice(0, 10),
        amount: i === count - 1 ? Math.round((net - perInst * (count - 1)) * 100) / 100 : perInst,
        paid: existing?.installments?.[i]?.paid || false,
        paidDate: existing?.installments?.[i]?.paidDate || null,
        paidAmount: existing?.installments?.[i]?.paidAmount || null,
        method: existing?.installments?.[i]?.method || null,
        receiptNo: existing?.installments?.[i]?.receiptNo || null,
      };
    });
  }

  useEffect(() => {
    if (plan === 'taksitli' && totalFee) {
      setInstallments(buildInstallments(installmentCount, netFee));
    }
  }, [plan, installmentCount, totalFee, discount]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        studentId: student.id || student.studentId,
        studentName: student.name || student.studentName,
        studentCls: student.cls || student.studentCls,
        totalFee: parseFloat(totalFee),
        discount: parseFloat(discount) || 0,
        paymentPlan: plan,
        installments: plan === 'taksitli' ? installments : [],
      };
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Hata');
      onSuccess(data.record);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>
            {existing ? 'Kaydı Güncelle' : 'Finansal Kayıt Oluştur'} — {student.name || student.studentName}
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Toplam Ücret (₺)</label>
              <input type="number" min="0" step="0.01" value={totalFee} onChange={e => setTotalFee(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
                placeholder="0,00" required />
            </div>
            <div>
              <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>İndirim (₺)</label>
              <input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
                placeholder="0,00" />
            </div>
          </div>

          {totalFee && (
            <div className="bg-indigo-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm text-indigo-600">Net Ücret</span>
              <span className="text-lg font-800 text-indigo-700" style={{ fontWeight: 800 }}>₺{fmt(netFee)}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Ödeme Planı</label>
            <div className="flex gap-2">
              {[['pesin', 'Peşin'], ['taksitli', 'Taksitli']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setPlan(v)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-600 border transition-all ${plan === v ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                  style={{ fontWeight: 600 }}>{l}</button>
              ))}
            </div>
          </div>

          {plan === 'taksitli' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-600 text-gray-500 uppercase tracking-wide" style={{ fontWeight: 600 }}>Taksit Sayısı</label>
                <select value={installmentCount} onChange={e => setInstallmentCount(parseInt(e.target.value))}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:border-indigo-400 focus:outline-none">
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => <option key={n} value={n}>{n} Taksit</option>)}
                </select>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {installments.map((inst, i) => (
                  <div key={i} className={`flex items-center gap-2 p-2 rounded-lg border ${inst.paid ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <span className="text-xs text-gray-500 w-6 text-center font-600" style={{ fontWeight: 600 }}>{i + 1}.</span>
                    <input type="date" value={inst.dueDate}
                      onChange={e => setInstallments(prev => prev.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))}
                      className="bg-white border border-gray-200 rounded px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none flex-1"
                      disabled={inst.paid}
                    />
                    <input type="number" value={inst.amount}
                      onChange={e => setInstallments(prev => prev.map((x, j) => j === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))}
                      className="bg-white border border-gray-200 rounded px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none w-24 text-right"
                      disabled={inst.paid}
                    />
                    {inst.paid && <Check size={12} className="text-green-600 shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-700 text-sm hover:from-indigo-600 hover:to-indigo-700 transition-all disabled:opacity-50"
              style={{ fontWeight: 700 }}
            >{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
            <button type="button" onClick={onClose} className="px-4 py-3 rounded-xl bg-gray-100 text-gray-600 font-600 text-sm hover:bg-gray-200 transition-colors" style={{ fontWeight: 600 }}>İptal</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Öğrenci finansal detay satırı ───────────────────────────────────────────
function StudentFinanceRow({ item, onRefresh, showToast, session }) {
  const [open, setOpen] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [printData, setPrintData] = useState(null);

  const { studentId, studentName, studentCls, finance } = item;

  const status = !finance ? 'unregistered'
    : finance.balance <= 0 ? 'paid'
    : finance.balance < finance.netFee ? 'partial'
    : 'unpaid';

  const statusConfig = {
    unregistered: { color: 'bg-gray-100 text-gray-500', label: 'Kayıt Yok', dot: 'bg-gray-400' },
    paid:         { color: 'bg-green-100 text-green-700', label: 'Ödendi', dot: 'bg-green-500' },
    partial:      { color: 'bg-amber-100 text-amber-700', label: 'Kısmen Ödendi', dot: 'bg-amber-500' },
    unpaid:       { color: 'bg-red-100 text-red-700', label: 'Ödenmedi', dot: 'bg-red-500' },
  };
  const sc = statusConfig[status];

  const overdueInstallments = (finance?.installments || []).filter(inst => !inst.paid && isOverdue(inst.dueDate));

  async function handleDeletePayment(paymentId) {
    if (!confirm('Bu ödemeyi geri almak istiyor musunuz?')) return;
    try {
      const res = await fetch('/api/finance/payment', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ studentId, paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Hata');
      showToast('Ödeme geri alındı');
      onRefresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <>
      <div className={`card overflow-hidden transition-all duration-200 ${open ? '' : 'hover:shadow-md hover:-translate-y-px'}`}>
        <button
          onClick={() => finance && setOpen(!open)}
          className="w-full flex items-center px-4 py-3.5 gap-3 text-left"
        >
          {/* Durum dot */}
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${sc.dot}`} />

          {/* İsim ve sınıf */}
          <div className="flex-1 min-w-0">
            <div className="font-600 text-gray-800" style={{ fontWeight: 600 }}>{studentName}</div>
            <div className="text-xs text-gray-500">{studentCls?.toUpperCase()}</div>
            {overdueInstallments.length > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-red-500 mt-0.5">
                <AlertCircle size={10} />
                {overdueInstallments.length} vadesi geçmiş taksit
              </div>
            )}
          </div>

          {/* Finansal özet */}
          {finance ? (
            <div className="text-right shrink-0">
              <div className="text-xs text-gray-400">Toplam / Kalan</div>
              <div className="text-sm font-700 text-gray-800" style={{ fontWeight: 700 }}>
                ₺{fmt(finance.netFee)} / <span className={finance.balance > 0 ? 'text-red-500' : 'text-green-600'}>₺{fmt(finance.balance)}</span>
              </div>
            </div>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setShowRegister(true); }}
              className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-600 hover:bg-indigo-100 transition-colors"
              style={{ fontWeight: 600 }}
            >+ Kayıt Oluştur</button>
          )}

          {/* Durum badge */}
          <span className={`px-2.5 py-1 rounded-lg text-xs font-600 ${sc.color} shrink-0`} style={{ fontWeight: 600 }}>
            {sc.label}
          </span>

          {finance && (
            <div className="text-gray-400 shrink-0">
              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          )}
        </button>

        {/* Açılır detay paneli */}
        {open && finance && (
          <div className="border-t border-gray-100 bg-gray-50/50">
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-gray-100">
              {[
                { label: 'Kayıt Ücreti', value: `₺${fmt(finance.totalFee)}`, color: 'text-gray-700' },
                { label: 'İndirim', value: `₺${fmt(finance.discount)}`, color: 'text-emerald-600' },
                { label: 'Net Ücret', value: `₺${fmt(finance.netFee)}`, color: 'text-indigo-700' },
                { label: 'Kalan Borç', value: `₺${fmt(finance.balance)}`, color: finance.balance > 0 ? 'text-red-600' : 'text-green-600' },
              ].map(item => (
                <div key={item.label} className="bg-white rounded-xl p-3 text-center shadow-sm">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 font-600" style={{ fontWeight: 600 }}>{item.label}</div>
                  <div className={`text-base font-800 ${item.color}`} style={{ fontWeight: 800 }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Taksit takvimi */}
            {finance.installments && finance.installments.length > 0 && (
              <div className="p-4 border-b border-gray-100">
                <div className="text-xs font-700 text-gray-500 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Taksit Takvimi</div>
                <div className="space-y-1.5">
                  {finance.installments.map((inst, i) => {
                    const overdue = !inst.paid && isOverdue(inst.dueDate);
                    return (
                      <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${inst.paid ? 'bg-green-50 border border-green-200' : overdue ? 'bg-red-50 border border-red-200' : 'bg-white border border-gray-200'}`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${inst.paid ? 'bg-green-500' : overdue ? 'bg-red-400' : 'bg-gray-200'}`}>
                          {inst.paid ? <Check size={10} color="white" /> : overdue ? <AlertCircle size={10} color="white" /> : <span className="text-[9px] text-gray-500 font-700">{i + 1}</span>}
                        </div>
                        <span className={`flex-1 text-xs ${overdue ? 'text-red-600 font-600' : inst.paid ? 'text-green-700' : 'text-gray-600'}`} style={{ fontWeight: inst.paid || overdue ? 600 : 400 }}>
                          {inst.dueDate}
                          {overdue && ' — Vadesi Geçti!'}
                          {inst.paid && ` — Ödendi (${inst.paidDate})`}
                        </span>
                        <span className="font-700 text-xs" style={{ fontWeight: 700 }}>₺{fmt(inst.amount)}</span>
                        {inst.receiptNo && <span className="text-[10px] text-gray-400">{inst.receiptNo}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ödeme geçmişi */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-700 text-gray-500 uppercase tracking-wide" style={{ fontWeight: 700 }}>
                  Ödeme Geçmişi ({(finance.payments || []).length})
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowRegister(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-600 hover:bg-gray-200 transition-colors"
                    style={{ fontWeight: 600 }}
                  ><Edit3 size={11} /> Kaydı Düzenle</button>
                  {finance.balance > 0 && (
                    <button
                      onClick={() => setShowAddPayment(true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-600 hover:bg-indigo-700 transition-colors"
                      style={{ fontWeight: 600 }}
                    ><Plus size={11} /> Ödeme Al</button>
                  )}
                </div>
              </div>
              {(finance.payments || []).length === 0 ? (
                <div className="text-center py-4 text-gray-400 text-xs">Henüz ödeme yok</div>
              ) : (
                <div className="space-y-1.5">
                  {[...(finance.payments || [])].reverse().map(p => (
                    <div key={p.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-600 text-gray-700" style={{ fontWeight: 600 }}>{p.date}</span>
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{p.method}</span>
                          <span className="text-[10px] text-indigo-400">{p.receiptNo}</span>
                        </div>
                        {p.note && <div className="text-[10px] text-gray-400 mt-0.5">{p.note}</div>}
                      </div>
                      <span className="font-800 text-green-600 text-sm shrink-0" style={{ fontWeight: 800 }}>+₺{fmt(p.amount)}</span>
                      <button
                        onClick={() => setPrintData({ studentName, studentCls, payment: p, dershane: DERSHANE })}
                        className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 transition-colors"
                        title="Makbuz yazdır"
                      ><Printer size={13} /></button>
                      <button
                        onClick={() => handleDeletePayment(p.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
                        title="Ödemeyi geri al"
                      ><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showAddPayment && (
        <AddPaymentModal
          studentId={studentId}
          studentName={studentName}
          balance={finance?.balance || 0}
          installments={finance?.installments || []}
          onClose={() => setShowAddPayment(false)}
          onSuccess={data => {
            setShowAddPayment(false);
            showToast(`Ödeme kaydedildi — ${data.receiptNo}`);
            onRefresh();
          }}
          showToast={showToast}
        />
      )}

      {showRegister && (
        <FinanceRegisterModal
          student={{ id: studentId, name: studentName, cls: studentCls }}
          existing={finance}
          onClose={() => setShowRegister(false)}
          onSuccess={() => { setShowRegister(false); showToast('Kayıt güncellendi'); onRefresh(); }}
          showToast={showToast}
        />
      )}

      {printData && <ReceiptPrintArea data={printData} onClose={() => setPrintData(null)} />}
    </>
  );
}

// ── Ana panel ────────────────────────────────────────────────────────────────
export default function FinancePanel({ session, showToast }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance', { credentials: 'same-origin' });
      const data = await res.json();
      setList(Array.isArray(data) ? data : []);
    } catch { showToast('Veri yüklenemedi', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Özet istatistikler
  const stats = list.reduce((acc, item) => {
    if (!item.finance) return acc;
    acc.totalStudents++;
    acc.totalFee += item.finance.netFee || 0;
    acc.totalPaid += (item.finance.netFee || 0) - (item.finance.balance || 0);
    acc.totalBalance += item.finance.balance || 0;
    return acc;
  }, { totalStudents: 0, totalFee: 0, totalPaid: 0, totalBalance: 0 });

  // Filtrele
  const filtered = list.filter(item => {
    const q = search.toLowerCase();
    const nameMatch = !q || item.studentName.toLowerCase().includes(q) || item.studentCls?.toLowerCase().includes(q);
    if (!nameMatch) return false;
    if (filterStatus === 'all') return true;
    if (filterStatus === 'unregistered') return !item.finance;
    if (filterStatus === 'paid') return item.finance && item.finance.balance <= 0;
    if (filterStatus === 'partial') return item.finance && item.finance.balance > 0 && item.finance.balance < item.finance.netFee;
    if (filterStatus === 'unpaid') return item.finance && item.finance.balance >= item.finance.netFee;
    if (filterStatus === 'overdue') return item.finance && (item.finance.installments || []).some(inst => !inst.paid && isOverdue(inst.dueDate));
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      {/* Özet kartları */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Kayıtlı Öğrenci', value: stats.totalStudents, icon: Users, color: 'from-violet-500 to-purple-600', suffix: '' },
          { label: 'Toplam Alacak', value: fmt(stats.totalFee), icon: DollarSign, color: 'from-blue-500 to-indigo-600', suffix: '₺' },
          { label: 'Tahsil Edilen', value: fmt(stats.totalPaid), icon: TrendingUp, color: 'from-emerald-500 to-green-600', suffix: '₺' },
          { label: 'Kalan Borç', value: fmt(stats.totalBalance), icon: TrendingDown, color: 'from-rose-500 to-red-600', suffix: '₺' },
        ].map(card => (
          <div key={card.label} className={`rounded-2xl bg-gradient-to-br ${card.color} p-4 text-white shadow-lg`}>
            <div className="flex items-center justify-between mb-2">
              <card.icon size={18} opacity={0.8} />
            </div>
            <div className="text-xl font-800" style={{ fontWeight: 800 }}>{card.suffix}{card.value}</div>
            <div className="text-xs opacity-75 mt-0.5 font-500" style={{ fontWeight: 500 }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Arama ve filtre */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="İsim veya sınıf ara..."
          />
        </div>
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto">
          {[
            ['all', 'Tümü'],
            ['unpaid', '🔴 Ödenmedi'],
            ['partial', '🟡 Kısmen'],
            ['paid', '🟢 Ödendi'],
            ['overdue', '⚠ Vadesi Geçmiş'],
            ['unregistered', 'Kayıtsız'],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-600 whitespace-nowrap transition-all ${filterStatus === v ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              style={{ fontWeight: 600 }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Liste */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            {search || filterStatus !== 'all' ? 'Eşleşen öğrenci bulunamadı' : 'Henüz öğrenci kaydı yok'}
          </div>
        ) : (
          filtered.map(item => (
            <StudentFinanceRow
              key={item.studentId}
              item={item}
              onRefresh={load}
              showToast={showToast}
              session={session}
            />
          ))
        )}
      </div>
    </div>
  );
}
