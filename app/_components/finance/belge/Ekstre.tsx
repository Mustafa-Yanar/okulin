'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { trDate, money, TaksitListe, Ozet } from './Makbuz';
import type { KurumBilgi, FinanceDTO } from '../../types';

// Öğrenci Ödeme Ekstresi — bir öğrencinin güncel ödeme durumu (ödenen + kalan taksitler
// + toplam/ödenen/kalan). Makbuza bağlı değil; herhangi bir anda bağımsız çıktı.

function cleanCls(cls: string): string {
  return (cls || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
}

export interface EkstreOgrenci { name: string; cls: string; tc: string; }
export interface EkstreVeli { name: string; phone: string; }

interface EkstreProps {
  kurum: KurumBilgi;
  ogrenci: EkstreOgrenci;
  veli: EkstreVeli;
  finance: FinanceDTO;
  onClose: () => void;
}

export default function Ekstre({ kurum, ogrenci, veli, finance, onClose }: EkstreProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [mounted]);
  if (!mounted) return null;

  const paidInst = finance.installments.filter(i => i.paid);
  const unpaidInst = finance.installments.filter(i => !i.paid);
  const totalPaid = finance.netFee - finance.balance;
  const unvan = kurum.officialName || kurum.name || 'Kurum';
  const bugun = new Date().toISOString().slice(0, 10);

  return createPortal(
    <div id="print-preview"
      className="fixed inset-0 z-50 bg-slate-800/60 overflow-auto p-4 print:bg-white print:static print:p-0 print:overflow-visible flex flex-col items-center gap-4">
      <div className="no-print sticky top-0 z-10 w-full max-w-[820px] flex items-center justify-between bg-white rounded-xl shadow-lg px-4 py-2.5">
        <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>Ödeme Ekstresi — Önizleme</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-600 transition-colors"
            style={{ fontWeight: 600 }}><Printer size={14} /> Yazdır / PDF</button>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
      </div>

      <div className="print-page bg-white text-slate-800 w-full max-w-[820px] shadow-xl print:shadow-none" style={{ padding: '28px 32px' }}>
        {/* Başlık */}
        <div className="flex items-start justify-between gap-4 pb-4" style={{ borderBottom: '3px solid #4f46e5' }}>
          <div className="flex items-start gap-3.5 min-w-0">
            {kurum.logoUrl
              ? <img src={kurum.logoUrl} alt="" className="h-16 w-16 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
              : <div className="h-16 w-16 rounded-xl shrink-0 flex items-center justify-center text-white font-800" style={{ fontWeight: 800, background: 'linear-gradient(135deg,#4f46e5,#6366f1)' }}>{(kurum.name || 'K')[0]}</div>}
            <div className="min-w-0">
              <div className="font-800 text-[15px] leading-tight text-slate-900" style={{ fontWeight: 800 }}>{unvan}</div>
              {kurum.officialAddress && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{kurum.officialAddress}</div>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-800 text-indigo-600 text-lg leading-none" style={{ fontWeight: 800 }}>ÖDEME<br />EKSTRESİ</div>
            <div className="mt-2 text-[11px] text-slate-500">Çıktı Tarihi</div>
            <div className="font-700 text-slate-900 text-sm" style={{ fontWeight: 700 }}>{trDate(bugun)}</div>
          </div>
        </div>

        {/* Öğrenci / Veli */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-600 mb-1.5" style={{ fontWeight: 600 }}>Öğrenci</div>
            <div className="font-700 text-slate-900 text-sm" style={{ fontWeight: 700 }}>{ogrenci.name}</div>
            <div className="text-[12px] text-slate-600 mt-0.5">Sınıf: {cleanCls(ogrenci.cls) || '—'}</div>
            {ogrenci.tc && <div className="text-[12px] text-slate-600">T.C.: {ogrenci.tc}</div>}
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-600 mb-1.5" style={{ fontWeight: 600 }}>Veli</div>
            <div className="font-700 text-slate-900 text-sm" style={{ fontWeight: 700 }}>{veli.name || '—'}</div>
            {veli.phone && <div className="text-[12px] text-slate-600 mt-0.5">Tel: {veli.phone}</div>}
          </div>
        </div>

        {/* Kayıt özeti */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-600 mt-3 px-1">
          <span>Kayıt Tarihi: <b className="text-slate-800" style={{ fontWeight: 600 }}>{trDate(finance.registrationDate)}</b></span>
          <span>Ödeme Planı: <b className="text-slate-800" style={{ fontWeight: 600 }}>{finance.paymentPlan === 'taksitli' ? 'Taksitli' : 'Peşin'}</b></span>
          <span>Taksit Sayısı: <b className="text-slate-800" style={{ fontWeight: 600 }}>{finance.installments.length}</b></span>
          {finance.discount > 0 && <span>İndirim: <b className="text-emerald-600" style={{ fontWeight: 600 }}>{money(finance.discount)}</b></span>}
        </div>

        {/* Taksit dökümü */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <TaksitListe title="Ödenen Taksitler" rows={paidInst.map(i => ({ no: i.idx + 1, date: trDate(i.paidDate || i.dueDate), amount: i.amount }))} tone="paid" trDate={trDate} money={money} />
          <TaksitListe title="Kalan Taksitler" rows={unpaidInst.map(i => ({ no: i.idx + 1, date: trDate(i.dueDate), amount: i.amount }))} tone="unpaid" trDate={trDate} money={money} />
        </div>

        {/* Özet */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Ozet label="Toplam" value={money(finance.netFee)} color="#334155" />
          <Ozet label="Ödenen" value={money(totalPaid)} color="#059669" />
          <Ozet label="Kalan" value={money(finance.balance)} color={finance.balance > 0 ? '#dc2626' : '#059669'} />
        </div>
        {finance.balance <= 0 && (
          <div className="text-center text-[12px] text-emerald-600 font-600 mt-2" style={{ fontWeight: 600 }}>Ödeme tamamlanmıştır. Kalan borç yoktur.</div>
        )}

        <div className="text-[11px] text-slate-400 mt-6 pt-3" style={{ borderTop: '1px solid #e2e8f0' }}>
          Bu ekstre {trDate(bugun)} tarihli sistem verisinden üretilmiştir · {unvan}
        </div>
      </div>
    </div>,
    document.body
  );
}
