'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import useSWR from 'swr';
import LoadingBox from '../Loading';
import { CountUp } from '../useCountUp';
import {
  TrendingUp, TrendingDown, DollarSign, Users, Plus, X, Check,
  ChevronDown, ChevronUp, Printer, Trash2, AlertCircle, Edit3,
  Search, CreditCard, Banknote, Building2, FileText, CalendarClock
} from 'lucide-react';
import EmptyState from '../EmptyState';
import { useConfirm } from '../ConfirmProvider';
import { useClasses } from '../ClassesContext';
import { classShortUpper } from '@/lib/classCatalog';
import type { Session } from '@/lib/auth';
import { formatTurkishMobile } from '@/lib/phone';
import type { PaymentEntry } from '@/lib/finance';
import { dagitTutar, dagitTarihler, sonOdenmisIdx } from '@/lib/finance-plan';
import type { ShowToast, FinanceDTO, FinanceListItemDTO, InstallmentDTO, KurumBilgi } from '../types';
import type { Branding } from '@/lib/branding';
import Makbuz from './belge/Makbuz';
import Senet from './belge/Senet';
import Ekstre from './belge/Ekstre';
import GecikmisListe, { type GecikmisGrup, type GecikmisOgrenci } from './belge/GecikmisListe';
import FinanceListePrint, { type FinanceListRow } from './belge/FinanceListePrint';

const METHODS = ['Nakit', 'Havale/EFT', 'Kredi Kartı'];

function fmt(n: number | undefined): string {
  return (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// YEREL tarih → YYYY-MM-DD. toISOString() UTC'ye çevirir; TR (UTC+3) gece yarısını bir
// gün geriye kaydırırdı (05 seçilen taksit 04 kaydolurdu). Yerel getFullYear/Month/Date
// kayma üretmez — tarih girişleri (taksit vadesi, ödeme tarihi) doğru gün olarak yazılır.
function localYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayISO(): string {
  return localYMD(new Date());
}

// Öğretim dönemi (akademik yıl) — kayıt tarihinden türetilir; Temmuz'dan (yeni sezon
// kayıtları) itibaren yeni dönem. GEÇİCİ: dönem yönetimi (kurumun aktif dönemi seçmesi)
// UI/UX ayrı çalışmada config'e taşınacak. Şimdilik registrationDate'ten hesaplanır.
function academicYearOf(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const y = d.getFullYear();
  return d.getMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(todayISO());
}


interface AddPaymentModalProps {
  studentId: string;
  studentName: string;
  balance: number;
  installments: InstallmentDTO[];
  onClose: () => void;
  onSuccess: (data: { receiptNo?: string }) => void;
  showToast: ShowToast;
}

// ── Ödeme ekleme modalı ──────────────────────────────────────────────────────
function AddPaymentModal({ studentId, studentName, balance, installments, onClose, onSuccess, showToast }: AddPaymentModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('Nakit');
  const [note, setNote] = useState('');
  const [installmentIdx, setInstallmentIdx] = useState('');
  const [saving, setSaving] = useState(false);

  const unpaidInstallments = (installments || []).filter(inst => !inst.paid);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
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
      const data = (await res.json()) as { error?: string; receiptNo?: string };
      if (!res.ok) throw new Error(data.error || 'Hata');
      onSuccess(data);
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" >
      <div role="dialog" aria-modal="true" aria-label="Ödeme ekle" className="modal w-full max-w-md animate-modal-in">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Ödeme Ekle — {studentName}</h3>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm text-amber-700">Kalan Borç</span>
            <span className="text-lg font-800 text-amber-700" style={{ fontWeight: 800 }}>₺{fmt(balance)}</span>
          </div>

          {unpaidInstallments.length > 0 && (
            <div>
              <label className="text-label block mb-1.5">Taksit Seç (opsiyonel)</label>
              <select
                value={installmentIdx}
                onChange={e => {
                  setInstallmentIdx(e.target.value);
                  if (e.target.value !== '') {
                    const inst = installments[parseInt(e.target.value)];
                    if (inst) setAmount(String(inst.amount));
                  }
                }}
                className="input"
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
            <label className="text-label block mb-1.5">Tutar (₺)</label>
            <input
              type="number" min="0.01" step="0.01"
              value={amount} onChange={e => setAmount(e.target.value)}
              readOnly={installmentIdx !== ''}
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none ${installmentIdx !== '' ? 'bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed' : 'bg-gray-50 border-gray-200 focus:border-[var(--brand,#6366f1)]'}`}
              placeholder="0,00" required autoFocus={installmentIdx === ''}
            />
            {installmentIdx !== '' && (
              <p className="text-caption mt-1">Taksitin tamamı ödenir — kısmi ödeme alınmaz.</p>
            )}
          </div>

          <div>
            <label className="text-label block mb-1.5">Tarih</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="text-label block mb-1.5">Ödeme Yöntemi</label>
            <div className="flex gap-2">
              {METHODS.map(m => (
                <button
                  key={m} type="button"
                  onClick={() => setMethod(m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-600 border transition ${method === m ? 'bg-brand-soft border-brand-soft text-brand' : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                  style={{ fontWeight: 600 }}
                >{m}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-label block mb-1.5">Not (opsiyonel)</label>
            <input
              type="text" value={note} onChange={e => setNote(e.target.value)}
              className="input"
              placeholder="Örn: 1. dönem ödemesi"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Kaydediliyor…' : 'Ödemeyi Kaydet & Makbuz Al'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost">İptal</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// FinanceRegisterModal'ın öğrenci görünümü — satırdan {id,name,cls} kurulur,
// alternatif alan adları (studentId/studentName/studentCls) da desteklenir.
interface RegisterStudent {
  id?: string;
  name?: string;
  cls?: string;
  studentId?: string;
  studentName?: string;
  studentCls?: string;
}

// Senet borçlusu seçimi için veli bilgisi (finans liste satırından gelir).
interface VeliBilgi {
  parentName?: string;
  parentPhone?: string;
  parentTcNo?: string;
  parentAddress?: string;
  parent2Name?: string;
  parent2Phone?: string;
}

interface FinanceRegisterModalProps {
  student: RegisterStudent;
  veli?: VeliBilgi;
  existing: FinanceDTO | null;
  onClose: () => void;
  onSuccess: (record: FinanceDTO | null) => void;
  showToast: ShowToast;
}

// ── Finansal kayıt oluşturma / düzenleme modalı ─────────────────────────────
function FinanceRegisterModal({ student, veli, existing, onClose, onSuccess, showToast }: FinanceRegisterModalProps) {
  const [totalFee, setTotalFee] = useState(existing?.totalFee ? String(existing.totalFee) : '');
  const [discount, setDiscount] = useState(existing?.discount ? String(existing.discount) : '0');
  const [plan, setPlan] = useState(existing?.paymentPlan || 'pesin');
  const [installmentCount, setInstallmentCount] = useState(existing?.installments?.length || 3);
  // Ödenmiş taksit silinemez → taksit sayısı en az (son ödenmiş indeks + 1) olmalı.
  // Taban 1: "tek seferde ama ileri tarihte ödeyecek" veli için 1 taksitli plan kurulabilir.
  const minTaksit = Math.max(1, sonOdenmisIdx((existing?.installments || []).map((x, i) => ({ ...x, idx: x.idx ?? i }))) + 1);
  // İlk taksit tarihi — varsayılan: mevcut ilk taksit ya da bir sonraki ayın bugünü.
  // Veli farklı bir güne (ör. her ayın 1'i / 15'i) sabitlenmek isteyebilir.
  const [firstDate, setFirstDate] = useState<string>(() => {
    if (existing?.installments?.[0]?.dueDate) return existing.installments[0].dueDate;
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    return localYMD(d);
  });
  const [installments, setInstallments] = useState<InstallmentDTO[]>(() => {
    if (existing?.installments?.length) return existing.installments;
    return [];
  });
  // Senet borçlusu: varsayılan 1. veli; 2. veli seçilebilir ya da tamamen elle girilir
  // (veliden farklı biri de olabilir). Seçim yalnız alanları DOLDURUR — alanlar her
  // durumda düzenlenebilir kalır; kaydedilen, alanlardaki son değerlerdir.
  // 1. veli ön-doldurması YALNIZ borçlusu hiç kaydedilmemiş (eski) kayıtta yapılır.
  // Alan-bazlı `?? veli1` KİRLETİRDİ: 2. veli borçlusunun bilinçli boş (null) TC/adresi
  // yeniden açılışta 1. velininkiyle dolar, ilgisiz bir güncellemede karışık kimlik
  // kaydedilirdi (Codex denetim bulgusu).
  const hasDebtor = !!(existing && (existing.debtorKind || existing.debtorName || existing.debtorPhone || existing.debtorTcNo || existing.debtorAddress));
  const [debtorKind, setDebtorKind] = useState<'veli1' | 'veli2' | 'manuel'>(existing?.debtorKind || (hasDebtor ? 'manuel' : 'veli1'));
  const [debtorName, setDebtorName] = useState(hasDebtor ? (existing?.debtorName || '') : (veli?.parentName || ''));
  const [debtorPhone, setDebtorPhone] = useState(hasDebtor ? (existing?.debtorPhone || '') : (veli?.parentPhone ? formatTurkishMobile(veli.parentPhone) : ''));
  const [debtorTcNo, setDebtorTcNo] = useState(hasDebtor ? (existing?.debtorTcNo || '') : (veli?.parentTcNo || ''));
  const [debtorAddress, setDebtorAddress] = useState(hasDebtor ? (existing?.debtorAddress || '') : (veli?.parentAddress || ''));
  const hasVeli2 = !!(veli?.parent2Name || veli?.parent2Phone);

  function selectDebtor(kind: 'veli1' | 'veli2' | 'manuel') {
    setDebtorKind(kind);
    if (kind === 'veli1') {
      setDebtorName(veli?.parentName || '');
      setDebtorPhone(veli?.parentPhone ? formatTurkishMobile(veli.parentPhone) : '');
      setDebtorTcNo(veli?.parentTcNo || '');
      setDebtorAddress(veli?.parentAddress || '');
    } else if (kind === 'veli2') {
      setDebtorName(veli?.parent2Name || '');
      setDebtorPhone(veli?.parent2Phone ? formatTurkishMobile(veli.parent2Phone) : '');
      // 2. velinin TC/adresi öğrenci kaydında tutulmuyor — muhasebeci elle tamamlar.
      setDebtorTcNo('');
      setDebtorAddress('');
    }
    // manuel: alanlar olduğu gibi kalır, muhasebeci serbestçe düzenler.
  }

  // Peşin ödeme (yalnız yeni kayıt): kayıt anında ödeme al, tarihi seçilebilir.
  // Tutar boş bırakılırsa net ücretin tamamı alınır; tarih varsayılan bugün.
  const [pesinDate, setPesinDate] = useState<string>(todayISO());
  const [pesinAmount, setPesinAmount] = useState('');
  const [pesinMethod, setPesinMethod] = useState('Nakit');
  const [saving, setSaving] = useState(false);

  const netFee = Math.max(0, (parseFloat(totalFee) || 0) - (parseFloat(discount) || 0));

  function buildInstallments(count: number, net: number): InstallmentDTO[] {
    // İlk taksit = seçilen başlangıç tarihi; sonrakiler birer ay artar.
    const start = firstDate ? new Date(firstDate + 'T00:00:00') : new Date();
    const rows = Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      const prev = existing?.installments?.[i];
      return {
        idx: i,
        dueDate: localYMD(d),
        amount: prev?.amount || 0, // dagitTutar dolduracak (ödenmişlerin tutarı korunur)
        paid: prev?.paid || false,
        paidDate: prev?.paidDate || null,
        paidAmount: prev?.paidAmount || null,
        method: prev?.method || null,
        receiptNo: prev?.receiptNo || null,
      };
    });
    return dagitTutar(rows, net);
  }

  // Taksit yapısını kur: plan/taksit sayısı/ilk tarih değişince tarihleri OTOMATİK dağıt
  // (ilk taksitten aylık) + tutarları eşit böl. Manuel tarih düzenlemesi bundan SONRA
  // yapılır; ücret/indirim değişince aşağıdaki effect yalnız tutarı günceller, tarihi korur.
  useEffect(() => {
    if (plan === 'taksitli' && totalFee) {
      setInstallments(buildInstallments(installmentCount, netFee));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, installmentCount, firstDate]);

  // Ücret/indirim değişince YALNIZ tutarları yeniden böl; taksit tarihlerini (kullanıcının
  // elle düzenlediği dahil) ve ödenmiş taksitleri koru — manuel tarih düzenlemesi silinmez.
  // Dağıtım lib/finance-plan.dagitTutar'da: ödenmişlerin tutarı sabit, KALAN yalnız
  // ödenmemişlere bölünür. Eskiden net ücret TÜM taksitlere bölünüp ödenmişler eski
  // tutarında bırakılıyordu → plan toplamı net ücretten sapıyor, para kayboluyordu.
  useEffect(() => {
    if (plan !== 'taksitli' || !totalFee) return;
    setInstallments(prev => prev.length ? dagitTutar(prev, netFee) : buildInstallments(installmentCount, netFee));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalFee, discount]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Taksitli planda senet borçlusuz kalmasın: ad zorunlu (varsayılan 1. veliyle dolu
    // gelir; boşsa kullanıcı bilinçli silmiştir — sessizce 1. veliye düşmek yerine uyar).
    if (plan === 'taksitli' && !debtorName.trim()) {
      showToast('Senet borçlusunun adını girin (1. veya 2. veliyi seçebilirsiniz)', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        studentId: student.id || student.studentId,
        studentName: student.name || student.studentName,
        studentCls: student.cls || student.studentCls,
        totalFee: parseFloat(totalFee),
        discount: parseFloat(discount) || 0,
        paymentPlan: plan,
        // Borçlu yalnız taksitli planda gönderilir (senet = taksit senedi). Peşin planda
        // göndermek görünmeyen bir veli1 anlık görüntüsü kaydeder; kayıt sonradan
        // taksitliye çevrilince modal güncel veli yerine o bayat veriyi getirirdi.
        ...(plan === 'taksitli' ? { debtorKind, debtorName, debtorPhone, debtorTcNo, debtorAddress } : {}),
        installments: plan === 'taksitli' ? installments : [],
      };
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; record: FinanceDTO | null };
      if (!res.ok) throw new Error(data.error || 'Hata');
      // Peşin plan (yeni kayıt): kaydın ardından peşin ödemeyi SEÇİLEN tarihte al.
      // Tutar boşsa net ücretin tamamı. Kayıt otomatik "ödendi" olmaz — ödeme burada,
      // kullanıcının seçtiği tarihle işlenir (kayıt tarihine sabitlenmez).
      if (plan === 'pesin' && !existing) {
        const amt = pesinAmount !== '' ? (parseFloat(pesinAmount) || 0) : netFee;
        if (amt > 0) {
          const payRes = await fetch('/api/finance/payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              studentId: student.id || student.studentId,
              amount: amt, date: pesinDate, method: pesinMethod,
              note: 'Peşin ödeme', installmentIdx: null,
            }),
          });
          const payData = (await payRes.json()) as { error?: string };
          if (!payRes.ok) throw new Error(payData.error || 'Peşin ödeme kaydedilemedi');
        }
      }
      onSuccess(data.record);
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" >
      <div role="dialog" aria-modal="true" aria-label="Finansal kayıt" className="modal w-full max-w-lg animate-modal-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>
            {existing ? 'Kaydı Güncelle' : 'Finansal Kayıt Oluştur'} — {student.name || student.studentName}
          </h3>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label block mb-1.5">Toplam Ücret (₺)</label>
              <input type="number" min="0" step="0.01" value={totalFee} onChange={e => setTotalFee(e.target.value)}
                className="input"
                placeholder="0,00" required />
            </div>
            <div>
              <label className="text-label block mb-1.5">İndirim (₺)</label>
              <input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)}
                className="input"
                placeholder="0,00" />
            </div>
          </div>

          {totalFee && (
            <div className="bg-brand-soft rounded-xl px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm text-brand">Net Ücret</span>
              <span className="text-lg font-800 text-brand" style={{ fontWeight: 800 }}>₺{fmt(netFee)}</span>
            </div>
          )}

          <div>
            <label className="text-label block mb-1.5">Ödeme Planı</label>
            <div className="flex gap-2">
              {[['pesin', 'Peşin'], ['taksitli', 'Taksitli']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setPlan(v)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-600 border transition ${plan === v ? 'bg-brand-soft border-brand-soft text-brand' : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                  style={{ fontWeight: 600 }}>{l}</button>
              ))}
            </div>
          </div>

          {plan === 'pesin' && !existing && (
            <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <p className="text-xs font-600 text-gray-500" style={{ fontWeight: 600 }}>Peşin Ödeme</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-label block mb-1.5">Ödeme Tarihi</label>
                  <input type="date" value={pesinDate} onChange={e => setPesinDate(e.target.value)}
                    className="input" />
                </div>
                <div>
                  <label className="text-label block mb-1.5">Tutar (₺)</label>
                  <input type="number" min="0" step="0.01" value={pesinAmount} onChange={e => setPesinAmount(e.target.value)}
                    placeholder={totalFee ? fmt(netFee) : '0,00'}
                    className="input" />
                </div>
              </div>
              <div>
                <label className="text-label block mb-1.5">Ödeme Yöntemi</label>
                <div className="flex gap-2">
                  {METHODS.map(m => (
                    <button key={m} type="button" onClick={() => setPesinMethod(m)}
                      className={`flex-1 py-2 rounded-lg text-xs font-600 border transition ${pesinMethod === m ? 'bg-brand-soft border-brand-soft text-brand' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                      style={{ fontWeight: 600 }}>{m}</button>
                  ))}
                </div>
              </div>
              <p className="text-caption text-gray-400">Tutar boş bırakılırsa net ücretin tamamı{totalFee ? ` (${fmt(netFee)} ₺)` : ''} peşin alınır. Ödeme almak istemiyorsan tutarı 0 yap.</p>
            </div>
          )}

          {plan === 'taksitli' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-label">İlk Taksit Tarihi</label>
                <input type="date" value={firstDate} onChange={e => setFirstDate(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:border-[var(--brand,#6366f1)] focus:outline-none" />
              </div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-label">Taksit Sayısı</label>
                <select value={installmentCount} onChange={e => setInstallmentCount(parseInt(e.target.value))}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:border-[var(--brand,#6366f1)] focus:outline-none">
                  {/* Ödenmiş taksitin altına inilemez — makbuzu kesilmiş taksit silinemez
                      (sunucu da reddeder: finance-plan.odenmisTaksitHatasi). */}
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(n => n >= minTaksit).map(n => <option key={n} value={n}>{n === 1 ? '1 Taksit (tek ödeme)' : `${n} Taksit`}</option>)}
                </select>
              </div>
              <p className="text-caption mb-2">Tarihler ilk taksitten itibaren aylık otomatik dağıtılır. Bir taksit tarihini elle değiştirirseniz sonraki taksitler o tarihten itibaren aylık yeniden dağıtılır; tutarlar elle düzenlenebilir.
                {minTaksit > 1 && ` Ödenmiş taksit bulunduğu için taksit sayısı ${minTaksit}'in altına indirilemez.`}</p>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {installments.map((inst, i) => (
                  <div key={i} className={`flex items-center gap-2 p-2 rounded-lg border ${inst.paid ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <span className="text-xs text-gray-500 w-6 text-center font-600" style={{ fontWeight: 600 }}>{i + 1}.</span>
                    <input type="date" value={inst.dueDate}
                      // Elle girilen tarihten SONRAKİ (ödenmemiş) taksitler o tarihten aylık
                      // yeniden akar — ilk N taksit elle girilir, kalanı otomatik dağılır.
                      onChange={e => setInstallments(prev => dagitTarihler(prev, i, e.target.value))}
                      className="bg-white border border-gray-200 rounded px-2 py-1 text-xs focus:border-[var(--brand,#6366f1)] focus:outline-none flex-1"
                      disabled={inst.paid}
                    />
                    <input type="number" value={inst.amount}
                      onChange={e => setInstallments(prev => prev.map((x, j) => j === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))}
                      className="bg-white border border-gray-200 rounded px-2 py-1 text-xs focus:border-[var(--brand,#6366f1)] focus:outline-none w-24 text-right"
                      disabled={inst.paid}
                    />
                    {inst.paid && <Check size={12} className="text-green-600 shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan === 'taksitli' && (
            <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <p className="text-xs font-600 text-gray-500" style={{ fontWeight: 600 }}>Senet Borçlusu</p>
              <div className="flex gap-2">
                {([['veli1', '1. Veli'], ...(hasVeli2 ? [['veli2', '2. Veli']] : []), ['manuel', 'Farklı Kişi']] as [typeof debtorKind, string][]).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => selectDebtor(v)}
                    className={`flex-1 py-2 rounded-lg text-xs font-600 border transition ${debtorKind === v ? 'bg-brand-soft border-brand-soft text-brand' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                    style={{ fontWeight: 600 }}>{l}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-label block mb-1.5">Ad Soyad</label>
                  <input type="text" value={debtorName} onChange={e => { setDebtorName(e.target.value); setDebtorKind('manuel'); }}
                    className="input" placeholder="Borçlunun adı soyadı" />
                </div>
                <div>
                  <label className="text-label block mb-1.5">Telefon</label>
                  <input type="tel" inputMode="tel" value={debtorPhone} onChange={e => { setDebtorPhone(e.target.value); setDebtorKind('manuel'); }}
                    className="input" placeholder="05XX XXX XX XX" />
                </div>
                <div>
                  <label className="text-label block mb-1.5">TC Kimlik No</label>
                  <input type="text" inputMode="numeric" maxLength={11} value={debtorTcNo}
                    onChange={e => { setDebtorTcNo(e.target.value.replace(/\D/g, '')); setDebtorKind('manuel'); }}
                    className="input" placeholder="Senet için (opsiyonel)" />
                </div>
                <div>
                  <label className="text-label block mb-1.5">Adres</label>
                  <input type="text" value={debtorAddress} onChange={e => { setDebtorAddress(e.target.value); setDebtorKind('manuel'); }}
                    className="input" placeholder="Senet için (opsiyonel)" />
                </div>
              </div>
              <p className="text-caption text-gray-400">Senetlerde &quot;Borçlu / Ödeyecek&quot; olarak bu bilgiler basılır. 1. veya 2. veliyi seçmek alanları doldurur; alanları düzenlersen kayıt &quot;farklı kişi&quot; olur.</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost">İptal</button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface StudentFinanceRowProps {
  item: FinanceListItemDTO;
  onRefresh: () => void;
  showToast: ShowToast;
  session?: Session | null;
  kurum: KurumBilgi;
}

// ── Öğrenci finansal detay satırı ───────────────────────────────────────────
function StudentFinanceRow({ item, onRefresh, showToast, session, kurum }: StudentFinanceRowProps) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [makbuzPayment, setMakbuzPayment] = useState<PaymentEntry | null>(null);
  const [showSenet, setShowSenet] = useState(false);
  const [showEkstre, setShowEkstre] = useState(false);

  const { studentId, studentName, studentCls, finance } = item;

  const status = !finance ? 'unregistered'
    : finance.balance <= 0 ? 'paid'
    : finance.balance < finance.netFee ? 'partial'
    : 'unpaid';

  const statusConfig: Record<string, { color: string; label: string; dot: string }> = {
    unregistered: { color: 'bg-gray-100 text-gray-500', label: 'Kayıt Yok', dot: 'bg-gray-400' },
    paid:         { color: 'bg-green-100 text-green-700', label: 'Ödendi', dot: 'bg-green-500' },
    partial:      { color: 'bg-amber-100 text-amber-700', label: 'Kısmen Ödendi', dot: 'bg-amber-500' },
    unpaid:       { color: 'bg-red-100 text-red-700', label: 'Ödenmedi', dot: 'bg-red-500' },
  };
  const sc = statusConfig[status];

  const overdueInstallments = (finance?.installments || []).filter(inst => !inst.paid && isOverdue(inst.dueDate));

  async function handleDeletePayment(paymentId: string) {
    if (!(await confirm({ message: 'Bu ödemeyi geri almak istiyor musunuz?', confirmLabel: 'Geri Al' }))) return;
    try {
      const res = await fetch('/api/finance/payment', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ studentId, paymentId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Hata');
      showToast('Ödeme geri alındı');
      onRefresh();
    } catch (err) { showToast((err as Error).message, 'error'); }
  }

  // İç içe <button> yasak (Codex): kart aç/kapa yalnız finans kaydı VARKEN anlamlı →
  // finance varsa satır <button> (aria-expanded), yoksa <div> (içindeki "Kayıt Oluştur"
  // tek geçerli buton kalır). Nested interactive giderilir.
  const RowTag = (finance ? 'button' : 'div') as 'button';
  return (
    <>
      <div className={`card overflow-hidden ${open ? '' : 'card-interactive'}`}>
        <RowTag
          onClick={finance ? () => setOpen(!open) : undefined}
          aria-expanded={finance ? open : undefined}
          className="w-full flex items-center px-4 py-3.5 gap-3 text-left"
        >
          {/* Durum dot */}
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${sc.dot}`} />

          {/* İsim ve sınıf */}
          <div className="flex-1 min-w-0">
            <div className="font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{studentName}</div>
            <div className="text-body-sm">{classShortUpper(classes, studentCls || '')}</div>
            {overdueInstallments.length > 0 && (
              <div className="flex items-center gap-1 text-caption mt-0.5" style={{ color: 'var(--color-danger)' }}>
                <AlertCircle size={10} />
                {overdueInstallments.length} vadesi geçmiş taksit
              </div>
            )}
          </div>

          {/* Finansal özet */}
          {finance ? (
            <div className="text-right shrink-0">
              <div className="text-caption">Toplam / Kalan</div>
              <div className="text-sm tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                ₺{fmt(finance.netFee)} / <span style={{ color: finance.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>₺{fmt(finance.balance)}</span>
              </div>
            </div>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setShowRegister(true); }}
              className="px-3 py-1.5 rounded-lg bg-brand-soft text-brand text-xs font-600 bg-brand-soft-hover transition-colors"
              style={{ fontWeight: 600 }}
            >+ Kayıt Oluştur</button>
          )}

          {/* Durum badge */}
          <span className={`badge shrink-0 ${
            status === 'paid' ? 'badge-success' :
            status === 'partial' ? 'badge-warning' :
            status === 'unpaid' ? 'badge-danger' : ''
          }`} style={status === 'unregistered' ? { background: 'var(--bg-muted)', color: 'var(--text-muted)' } : {}}>
            {sc.label}
          </span>

          {finance && (
            <div className="text-gray-400 shrink-0">
              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          )}
        </RowTag>

        {/* Açılır detay paneli */}
        {open && finance && (
          <div className="border-t" style={{ borderColor:'var(--border-light)', background:'var(--bg-surface-2)' }}>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
              {[
                { label: 'Kayıt Ücreti', value: `₺${fmt(finance.totalFee)}`, color: 'var(--text-secondary)' },
                { label: 'İndirim', value: `₺${fmt(finance.discount)}`, color: 'var(--color-success)' },
                { label: 'Net Ücret', value: `₺${fmt(finance.netFee)}`, color: 'var(--brand,#6366f1)' },
                { label: 'Kalan Borç', value: `₺${fmt(finance.balance)}`, color: finance.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)' },
              ].map(item => (
                <div key={item.label}>
                  <div className="text-label mb-1">{item.label}</div>
                  <div className="text-base tabular-nums" style={{ fontWeight: 800, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Taksit takvimi */}
            {finance.installments && finance.installments.length > 0 && (
              <div className="p-4 border-b border-gray-100">
                <div className="text-label mb-2">Taksit Takvimi</div>
                <div className="space-y-1.5">
                  {finance.installments.map((inst, i) => {
                    const overdue = !inst.paid && isOverdue(inst.dueDate);
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm border"
                        style={inst.paid
                          ? { background:'var(--color-success-bg)', borderColor:'var(--color-success-border)' }
                          : overdue
                          ? { background:'var(--color-danger-bg)', borderColor:'var(--color-danger-border)' }
                          : { background:'var(--bg-surface)', borderColor:'var(--border-light)' }}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${inst.paid ? 'bg-green-500' : overdue ? 'bg-red-400' : ''}`}
                          style={inst.paid || overdue ? undefined : { background: 'var(--bg-muted)' }}>
                          {inst.paid ? <Check size={10} color="white" /> : overdue ? <AlertCircle size={10} color="white" /> : <span className="text-[9px] font-700" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>}
                        </div>
                        <span className="flex-1 text-xs" style={{ fontWeight: inst.paid || overdue ? 600 : 400, color: overdue ? 'var(--color-danger)' : inst.paid ? 'var(--color-success)' : 'var(--text-secondary)' }}>
                          {inst.dueDate}
                          {overdue && ' — Vadesi Geçti!'}
                          {inst.paid && ` — Ödendi (${inst.paidDate})`}
                        </span>
                        <span className="font-700 text-xs" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>₺{fmt(inst.amount)}</span>
                        {inst.receiptNo && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{inst.receiptNo}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ödeme geçmişi */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-label">
                  Ödeme Geçmişi ({(finance.payments || []).length})
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowEkstre(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-600 hover:bg-slate-200 transition-colors"
                    style={{ fontWeight: 600 }}
                  ><FileText size={11} /> Ekstre</button>
                  {(finance.installments || []).length > 0 && (
                    <button
                      onClick={() => setShowSenet(true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-600 hover:bg-slate-200 transition-colors"
                      style={{ fontWeight: 600 }}
                    ><FileText size={11} /> Senet</button>
                  )}
                  <button
                    onClick={() => setShowRegister(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-600 hover:bg-gray-200 transition-colors"
                    style={{ fontWeight: 600 }}
                  ><Edit3 size={11} /> Kaydı Düzenle</button>
                  {finance.balance > 0 && (
                    <button
                      onClick={() => setShowAddPayment(true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand text-white text-xs font-600 transition-colors"
                      style={{ fontWeight: 600 }}
                    ><Plus size={11} /> Ödeme Al</button>
                  )}
                </div>
              </div>
              {(finance.payments || []).length === 0 ? (
                <div className="text-center py-4 text-caption">Henüz ödeme yok</div>
              ) : (
                <div className="space-y-1.5">
                  {[...(finance.payments || [])].reverse().map(p => (
                    <div key={p.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.date}</span>
                          <span className="text-caption px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-muted)' }}>{p.method}</span>
                          <span className="text-caption" style={{ color: 'var(--color-info)' }}>{p.receiptNo}</span>
                        </div>
                        {p.note && <div className="text-caption mt-0.5">{p.note}</div>}
                      </div>
                      <span className="font-800 text-green-600 text-sm shrink-0" style={{ fontWeight: 800 }}>+₺{fmt(p.amount)}</span>
                      <button
                        onClick={() => setMakbuzPayment(p)}
                        className="btn-icon btn-icon-primary"
                        title="Makbuz yazdır"
                      ><Printer size={13} /></button>
                      <button
                        onClick={() => handleDeletePayment(p.id)}
                        className="btn-icon btn-icon-danger"
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
          veli={{ parentName: item.parentName, parentPhone: item.parentPhone, parentTcNo: item.parentTcNo,
            parentAddress: item.parentAddress, parent2Name: item.parent2Name, parent2Phone: item.parent2Phone }}
          existing={finance}
          onClose={() => setShowRegister(false)}
          onSuccess={() => { setShowRegister(false); showToast('Kayıt güncellendi'); onRefresh(); }}
          showToast={showToast}
        />
      )}

      {makbuzPayment && finance && (
        <Makbuz
          kurum={kurum}
          ogrenci={{ name: studentName, cls: item.className || classShortUpper(classes, studentCls || ''), tc: item.studentTc || '' }}
          veli={{ name: item.parentName || '', phone: item.parentPhone || '' }}
          payment={makbuzPayment}
          finance={finance}
          onClose={() => setMakbuzPayment(null)}
        />
      )}

      {showSenet && finance && (
        <Senet
          kurum={kurum}
          ogrenci={{ name: studentName, tc: item.studentTc || '', phone: item.studentPhone || '', donem: academicYearOf(finance.registrationDate) }}
          // Borçlu: kayıtta SEÇİM yapılmışsa (debtorKind/debtorName) alanlar olduğu gibi
          // basılır; yalnız borçlusu hiç kaydedilmemiş eski kayıt 1. veliye düşer.
          veli={(finance.debtorKind || finance.debtorName)
            ? { name: finance.debtorName || '', phone: finance.debtorPhone || '', address: finance.debtorAddress || '', tc: finance.debtorTcNo || '' }
            : { name: item.parentName || '', phone: item.parentPhone || '', address: item.parentAddress || '', tc: item.parentTcNo || '' }}
          installments={finance.installments}
          duzenlemeTarihi={finance.registrationDate || todayISO()}
          onClose={() => setShowSenet(false)}
        />
      )}

      {showEkstre && finance && (
        <Ekstre
          kurum={kurum}
          ogrenci={{ name: studentName, cls: item.className || classShortUpper(classes, studentCls || ''), tc: item.studentTc || '' }}
          veli={{ name: item.parentName || '', phone: item.parentPhone || '' }}
          finance={finance}
          onClose={() => setShowEkstre(false)}
        />
      )}
    </>
  );
}

// Gecikmiş ödemeler raporu için veri: vadesi geçmiş taksiti olan öğrencileri sınıf/şube
// (className) bazlı grupla, ara/genel toplam çıkar. Bellek içi (finans listesinden).
function buildGecikmis(list: FinanceListItemDTO[]): { gruplar: GecikmisGrup[]; genelToplam: number; ogrenciSayisi: number } {
  const bugun = new Date().toISOString().slice(0, 10);
  const grupMap = new Map<string, GecikmisOgrenci[]>();
  for (const item of list) {
    if (!item.finance) continue;
    const overdue = item.finance.installments.filter(i => !i.paid && i.dueDate && i.dueDate < bugun);
    if (overdue.length === 0) continue;
    const paidDates = item.finance.installments.filter(i => i.paid && i.paidDate).map(i => i.paidDate as string);
    const payDates = (item.finance.payments || []).map(p => p.date);
    const sonTahsil = [...paidDates, ...payDates].filter(Boolean).sort().pop() || '';
    const ogr: GecikmisOgrenci = {
      name: item.studentName, tc: item.studentTc || '',
      parentName: item.parentName || '', parentPhone: item.parentPhone || '', sonTahsil,
      taksitler: overdue.map(i => ({ no: i.idx + 1, dueDate: i.dueDate, amount: i.amount })),
      toplam: overdue.reduce((s, i) => s + (i.amount || 0), 0),
    };
    const key = item.className || item.studentCls || 'Diğer';
    (grupMap.get(key) || grupMap.set(key, []).get(key)!).push(ogr);
  }
  const gruplar: GecikmisGrup[] = [...grupMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
    .map(([baslik, ogrenciler]) => ({
      baslik,
      ogrenciler: ogrenciler.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
      araToplam: ogrenciler.reduce((s, o) => s + o.toplam, 0),
    }));
  return {
    gruplar,
    genelToplam: gruplar.reduce((s, g) => s + g.araToplam, 0),
    ogrenciSayisi: gruplar.reduce((s, g) => s + g.ogrenciler.length, 0),
  };
}

// Beklenen ödemeler: [start,end] tarih aralığında vadesi dolan ÖDENMEMİŞ taksitler,
// sınıf/şube bazlı gruplu (gecikmiş raporuyla aynı yapı; yalnız filtre tarih aralığı).
function buildBeklenen(list: FinanceListItemDTO[], start: string, end: string): { gruplar: GecikmisGrup[]; genelToplam: number; ogrenciSayisi: number } {
  const grupMap = new Map<string, GecikmisOgrenci[]>();
  for (const item of list) {
    if (!item.finance) continue;
    const matched = item.finance.installments.filter(i => !i.paid && i.dueDate && i.dueDate >= start && i.dueDate <= end);
    if (matched.length === 0) continue;
    const paidDates = item.finance.installments.filter(i => i.paid && i.paidDate).map(i => i.paidDate as string);
    const payDates = (item.finance.payments || []).map(p => p.date);
    const sonTahsil = [...paidDates, ...payDates].filter(Boolean).sort().pop() || '';
    const ogr: GecikmisOgrenci = {
      name: item.studentName, tc: item.studentTc || '',
      parentName: item.parentName || '', parentPhone: item.parentPhone || '', sonTahsil,
      taksitler: matched.map(i => ({ no: i.idx + 1, dueDate: i.dueDate, amount: i.amount })),
      toplam: matched.reduce((s, i) => s + (i.amount || 0), 0),
    };
    const key = item.className || item.studentCls || 'Diğer';
    (grupMap.get(key) || grupMap.set(key, []).get(key)!).push(ogr);
  }
  const gruplar: GecikmisGrup[] = [...grupMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'tr'))
    .map(([baslik, ogrenciler]) => ({
      baslik,
      ogrenciler: ogrenciler.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
      araToplam: ogrenciler.reduce((s, o) => s + o.toplam, 0),
    }));
  return {
    gruplar,
    genelToplam: gruplar.reduce((s, g) => s + g.araToplam, 0),
    ogrenciSayisi: gruplar.reduce((s, g) => s + g.ogrenciler.length, 0),
  };
}

// Tarih aralığı seçici (Beklenen Ödemeler için). Varsayılan: içinde bulunulan ay.
function BeklenenPicker({ onOpen, onClose }: { onOpen: (start: string, end: string) => void; onClose: () => void }) {
  const now = new Date();
  const first = localYMD(new Date(now.getFullYear(), now.getMonth(), 1));
  const last = localYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const [start, setStart] = useState(first);
  const [end, setEnd] = useState(last);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-label="Beklenen ödemeler tarih aralığı" className="modal w-full max-w-sm animate-modal-in">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Beklenen Ödemeler</h3>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-caption">Seçilen tarih aralığında vadesi dolacak (ödenmemiş) taksitler sınıf bazlı listelenir.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label block mb-1.5">Başlangıç</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} className="input" />
            </div>
            <div>
              <label className="text-label block mb-1.5">Bitiş</label>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="input" />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => onOpen(start, end)} disabled={!start || !end || start > end} className="btn-primary flex-1">Raporu Aç</button>
            <button onClick={onClose} className="btn-ghost">İptal</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Filtre dropdown ──────────────────────────────────────────────────────────
const FILTER_OPTIONS: { value: string; label: string; dot: string | null }[] = [
  { value: 'all',          label: 'Tümü',           dot: null },
  { value: 'unpaid',       label: 'Ödenmedi',        dot: '#ef4444' },
  { value: 'partial',      label: 'Kısmen Ödendi',   dot: '#f59e0b' },
  { value: 'paid',         label: 'Ödendi',          dot: '#22c55e' },
  { value: 'overdue',      label: 'Vadesi Geçmiş',   dot: '#f97316' },
  { value: 'unregistered', label: 'Kayıtsız',        dot: '#9ca3af' },
];

interface FilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

function FilterDropdown({ value, onChange }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = FILTER_OPTIONS.find(o => o.value === value) || FILTER_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-colors"
        style={{
          background: 'var(--bg-muted)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          fontWeight: 600,
          minWidth: '148px',
        }}
      >
        {current.dot && (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: current.dot }} />
        )}
        <span className="flex-1 text-left">{current.label}</span>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Duruma göre filtrele"
          className="absolute left-0 top-full mt-1.5 z-30 rounded-xl overflow-hidden animate-slide-in"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            minWidth: '180px',
          }}
        >
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              role="option"
              aria-selected={value === opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--bg-muted)]"
              style={{
                color: value === opt.value ? 'var(--brand, #6366f1)' : 'var(--text-primary)',
                fontWeight: value === opt.value ? 600 : 400,
                background: value === opt.value ? 'color-mix(in srgb, var(--brand, #6366f1) 8%, transparent)' : undefined,
              }}
            >
              {opt.dot
                ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: opt.dot }} />
                : <span className="w-2 h-2 shrink-0" />
              }
              {opt.label}
              {value === opt.value && <Check size={13} className="ml-auto" style={{ color: 'var(--brand, #6366f1)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FinancePanelProps {
  session?: Session | null;
  showToast: ShowToast;
  initialSearch?: string;
}

// ── Ana panel ────────────────────────────────────────────────────────────────
// initialSearch: kayıt akışı kısayolu — yeni kaydedilen öğrencinin adı aramaya
// önceden yazılır (mount'ta bir kez okunur; kullanıcı serbestçe değiştirir).
export default function FinancePanel({ session, showToast, initialSearch }: FinancePanelProps) {
  const { data: financeData, isLoading: loading, mutate: load } = useSWR<FinanceListItemDTO[]>('/api/finance');
  const list = useMemo(() => (Array.isArray(financeData) ? financeData : []), [financeData]);
  // Kurum bilgisi (marka + resmi bilgi) — makbuz/senet belgelerinde kullanılır.
  const { data: orgData } = useSWR<{ branding: Branding; legal?: KurumBilgi }>('/api/org');
  const kurum: KurumBilgi = {
    name: orgData?.branding?.name || '',
    logoUrl: orgData?.branding?.logoUrl || '',
    officialName: orgData?.legal?.officialName || '',
    taxOffice: orgData?.legal?.taxOffice || '',
    taxNo: orgData?.legal?.taxNo || '',
    officialAddress: orgData?.legal?.officialAddress || '',
  };
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad
  const [search, setSearch] = useState(initialSearch || '');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterClass, setFilterClass] = useState('all'); // sınıf-bazlı filtre (aramayla KESİŞİR)
  const [showGecikmis, setShowGecikmis] = useState(false);
  const [showBeklenenPicker, setShowBeklenenPicker] = useState(false); // tarih aralığı seçici
  const [beklenen, setBeklenen] = useState<{ start: string; end: string } | null>(null); // rapor
  const [showListPrint, setShowListPrint] = useState(false); // öğrenci ödemeleri listesi PDF

  // Listede geçen sınıflar (id → ad), ada göre sıralı — sınıf filtre menüsü için.
  const classOptions = useMemo(() => {
    const ids = [...new Set(list.map(i => i.studentCls).filter((c): c is string => !!c))];
    return ids
      .map(id => ({ id, label: classShortUpper(classes, id) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
  }, [list, classes]);

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
    // Sınıf filtresi arama/durum ile KESİŞİR (hepsi birlikte daraltır).
    if (filterClass !== 'all' && item.studentCls !== filterClass) return false;
    if (filterStatus === 'all') return true;
    if (filterStatus === 'unregistered') return !item.finance;
    if (filterStatus === 'paid') return item.finance && item.finance.balance <= 0;
    if (filterStatus === 'partial') return item.finance && item.finance.balance > 0 && item.finance.balance < item.finance.netFee;
    if (filterStatus === 'unpaid') return item.finance && item.finance.balance >= item.finance.netFee;
    if (filterStatus === 'overdue') return item.finance && (item.finance.installments || []).some(inst => !inst.paid && isOverdue(inst.dueDate));
    return true;
  });

  if (loading) return <LoadingBox height="h-64" />;

  return (
    <div>
      {/* Özet — enerjik KPI: gradyan dolgu + beyaz metin + sayaç + tabular. Renkler
          anlam taşır (öğrenci=kurum, alacak=mor, tahsil=yeşil, borç=kırmızı); dekoratif
          daire + brand-tint gölge + hover lift. Sayaç 0→hedef yumuşak sayar. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 reveal-stagger">
        {[
          { label: 'Kayıtlı Öğrenci', value: stats.totalStudents, icon: Users, cls: 'kpi-brand', money: false },
          { label: 'Toplam Alacak', value: stats.totalFee, icon: DollarSign, cls: 'kpi-violet', money: true },
          { label: 'Tahsil Edilen', value: stats.totalPaid, icon: TrendingUp, cls: 'kpi-emerald', money: true },
          { label: 'Kalan Borç', value: stats.totalBalance, icon: TrendingDown, cls: 'kpi-rose', money: true },
        ].map(card => (
          <div key={card.label} className={`kpi-card ${card.cls} hover-lift`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="kpi-label">{card.label}</p>
                <div className="kpi-num">{card.money ? '₺' : ''}<CountUp value={card.value} /></div>
              </div>
              <div className="kpi-ic"><card.icon size={18} /></div>
            </div>
          </div>
        ))}
      </div>

      {/* Arama ve filtre */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9"
            placeholder="İsim veya sınıf ara..."
          />
        </div>
        <FilterDropdown value={filterStatus} onChange={setFilterStatus} />
        {classOptions.length > 0 && (
          <select
            value={filterClass}
            onChange={e => setFilterClass(e.target.value)}
            aria-label="Sınıfa göre filtrele"
            className="input sm:w-auto sm:min-w-[9rem]"
          >
            <option value="all">Tüm sınıflar</option>
            {classOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        <button
          onClick={() => setShowBeklenenPicker(true)}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-brand-soft text-brand text-sm font-600 hover:bg-brand-soft-hover transition-colors whitespace-nowrap"
          style={{ fontWeight: 600 }}
        ><CalendarClock size={14} /> Beklenen Ödemeler</button>
        <button
          onClick={() => setShowGecikmis(true)}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-600 hover:bg-red-100 transition-colors whitespace-nowrap"
          style={{ fontWeight: 600 }}
        ><AlertCircle size={14} /> Gecikmiş Rapor</button>
        <button
          onClick={() => setShowListPrint(true)}
          title="Görünen listeyi PDF/yazdır"
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-sm font-600 whitespace-nowrap transition-colors hover:bg-[var(--bg-surface-2)]"
          style={{ fontWeight: 600, borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}
        ><Printer size={14} /> PDF</button>
      </div>

      {/* Liste */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <EmptyState icon={Users}
            title={search || filterStatus !== 'all' ? 'Eşleşen öğrenci bulunamadı' : 'Henüz öğrenci kaydı yok'}
            description={search || filterStatus !== 'all' ? 'Aramayı veya filtreyi değiştirin.' : undefined} />
        ) : (
          filtered.map(item => (
            <StudentFinanceRow
              key={item.studentId}
              item={item}
              onRefresh={load}
              showToast={showToast}
              session={session}
              kurum={kurum}
            />
          ))
        )}
      </div>

      {showGecikmis && (() => {
        const g = buildGecikmis(list);
        return <GecikmisListe kurum={kurum} gruplar={g.gruplar} genelToplam={g.genelToplam} ogrenciSayisi={g.ogrenciSayisi} onClose={() => setShowGecikmis(false)} />;
      })()}

      {showBeklenenPicker && (
        <BeklenenPicker
          onClose={() => setShowBeklenenPicker(false)}
          onOpen={(start, end) => { setShowBeklenenPicker(false); setBeklenen({ start, end }); }}
        />
      )}
      {beklenen && (() => {
        const b = buildBeklenen(list, beklenen.start, beklenen.end);
        const fmtD = (s: string) => s.split('-').reverse().join('.');
        return <GecikmisListe kurum={kurum} gruplar={b.gruplar} genelToplam={b.genelToplam} ogrenciSayisi={b.ogrenciSayisi}
          title="BEKLENEN ÖDEMELER LİSTESİ" subtitle={`${fmtD(beklenen.start)} – ${fmtD(beklenen.end)}`}
          emptyText="Bu tarih aralığında beklenen ödeme bulunmuyor." onClose={() => setBeklenen(null)} />;
      })()}
      {showListPrint && (() => {
        const rows: FinanceListRow[] = filtered.map(item => {
          const net = item.finance?.netFee || 0;
          const balance = item.finance?.balance || 0;
          return {
            name: item.studentName,
            cls: classShortUpper(classes, item.studentCls || ''),
            net, paid: net - balance, balance,
            status: !item.finance ? 'Kayıt Yok' : balance <= 0 ? 'Ödendi' : balance < net ? 'Kısmen' : 'Ödenmedi',
          };
        });
        const desc = [
          filterClass !== 'all' ? `Sınıf: ${classShortUpper(classes, filterClass)}` : '',
          filterStatus !== 'all' ? `Durum: ${FILTER_OPTIONS.find(o => o.value === filterStatus)?.label || ''}` : '',
          search ? `Arama: "${search}"` : '',
        ].filter(Boolean).join(' · ');
        return <FinanceListePrint kurum={kurum} rows={rows} subtitle={desc || undefined} onClose={() => setShowListPrint(false)} />;
      })()}
    </div>
  );
}
