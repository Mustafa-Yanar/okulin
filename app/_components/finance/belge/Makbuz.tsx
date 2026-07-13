'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { tutariYaziyaCevir } from '@/lib/tutar-yazi';
import type { KurumBilgi, FinanceDTO } from '../../types';
import type { PaymentEntry } from '@/lib/finance';

// Tahsilat Makbuzu — modern, yazdırılabilir belge. Portal + window.print() + print CSS
// (globals.css #print-preview). Excel-tablo değil; kart/tipografi tabanlı ama tüm resmi
// alanlar eksiksiz (makbuz no, öğrenci/veli TC, ödeme şekli, yazıyla tutar, taksit dökümü).

// Ortak belge yardımcıları (Ekstre de kullanır).
export function trDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}.${m}.${y}` : iso;
}
export function money(n: number | undefined): string {
  return '₺' + (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Sınıf etiketinden şube kodunu (parantez içi) atar: "12.Sınıf Sayısal (401)" → "12.Sınıf Sayısal".
// Şube zamanla değişebildiği için belgelerde yalnız düzey/alan yazılır.
function cleanCls(cls: string): string {
  return (cls || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
}

export interface MakbuzOgrenci { name: string; cls: string; tc: string; }
export interface MakbuzVeli { name: string; phone: string; }

interface MakbuzProps {
  kurum: KurumBilgi;
  ogrenci: MakbuzOgrenci;
  veli: MakbuzVeli;
  payment: PaymentEntry;
  finance: FinanceDTO;
  donem?: string;
  onClose: () => void;
}

export default function Makbuz({ kurum, ogrenci, veli, payment, finance, donem, onClose }: MakbuzProps) {
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
  const thisInst = finance.installments.find(i => i.receiptNo === payment.receiptNo);
  const yazi = tutariYaziyaCevir(payment.amount);
  const unvan = kurum.officialName || kurum.name || 'Kurum';
  const kurusYazi = yazi.kurus === 'Sıfır' ? 'Sıfır' : yazi.kurus;

  return createPortal(
    <div id="print-preview"
      className="fixed inset-0 z-50 bg-slate-800/60 overflow-auto p-4 print:bg-white print:static print:p-0 print:overflow-visible flex flex-col items-center gap-4">
      {/* Üst bar — yazdırmada gizli */}
      <div className="no-print sticky top-0 z-10 w-full max-w-[820px] flex items-center justify-between bg-white rounded-xl shadow-lg px-4 py-2.5">
        <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>Tahsilat Makbuzu — Önizleme</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-600 transition-colors"
            style={{ fontWeight: 600 }}><Printer size={14} /> Yazdır / PDF</button>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
      </div>

      {/* A4 belge */}
      <div className="print-page bg-white text-slate-800 w-full max-w-[820px] shadow-xl print:shadow-none"
        style={{ padding: '28px 32px' }}>

        {/* ── Başlık: logo + kurum + makbuz meta ── */}
        <div className="flex items-start justify-between gap-4 pb-4"
          style={{ borderBottom: '3px solid #4f46e5' }}>
          <div className="flex items-start gap-3.5 min-w-0">
            {kurum.logoUrl
              ? <img src={kurum.logoUrl} alt="" className="h-16 w-16 object-contain shrink-0"
                  style={{ imageRendering: 'auto' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
              : <div className="h-16 w-16 rounded-xl shrink-0 flex items-center justify-center text-white font-800"
                  style={{ fontWeight: 800, background: 'linear-gradient(135deg,#4f46e5,#6366f1)' }}>{(kurum.name || 'K')[0]}</div>}
            <div className="min-w-0">
              <div className="font-800 text-[15px] leading-tight text-slate-900" style={{ fontWeight: 800 }}>{unvan}</div>
              {kurum.officialAddress && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{kurum.officialAddress}</div>}
              {(kurum.taxOffice || kurum.taxNo) && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {kurum.taxOffice && <>V.D.: <b style={{ fontWeight: 600 }}>{kurum.taxOffice}</b></>}
                  {kurum.taxOffice && kurum.taxNo && ' · '}
                  {kurum.taxNo && <>V.No: <b style={{ fontWeight: 600 }}>{kurum.taxNo}</b></>}
                </div>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-800 text-indigo-600 text-lg leading-none" style={{ fontWeight: 800 }}>TAHSİLAT<br />MAKBUZU</div>
            <div className="mt-2 text-[11px] text-slate-500">Makbuz No</div>
            <div className="font-700 text-slate-900 text-sm tracking-wide" style={{ fontWeight: 700 }}>{payment.receiptNo}</div>
            <div className="mt-1.5 text-[11px] text-slate-500">Tarih: <b className="text-slate-700" style={{ fontWeight: 600 }}>{trDate(payment.date)}</b></div>
            {donem && <div className="text-[11px] text-slate-500">Dönem: {donem}</div>}
          </div>
        </div>

        {/* ── Öğrenci / Veli ── */}
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

        {/* ── Tahsilat vurgu ── */}
        <div className="rounded-xl mt-3 p-4 flex items-center justify-between gap-4"
          style={{ background: '#eef2ff', border: '1px solid #c7d2fe' }}>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-indigo-500 font-700 mb-1" style={{ fontWeight: 700 }}>Tahsil Edilen</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-slate-600">
              <span>Ödeme Şekli: <b className="text-slate-800" style={{ fontWeight: 600 }}>{payment.method}</b></span>
              <span>Kalem: <b className="text-slate-800" style={{ fontWeight: 600 }}>Eğitim Ücreti</b></span>
              {thisInst && <span>Taksit: <b className="text-slate-800" style={{ fontWeight: 600 }}>{thisInst.idx + 1}. ({trDate(thisInst.dueDate)})</b></span>}
            </div>
          </div>
          <div className="text-3xl font-800 text-indigo-700 shrink-0" style={{ fontWeight: 800 }}>{money(payment.amount)}</div>
        </div>
        <div className="text-[12.5px] text-slate-700 mt-2 px-1">
          <span className="text-slate-400">Yalnız</span> <b style={{ fontWeight: 700 }}>{yazi.lira} Türk Lirası {kurusYazi} Kuruş</b> <span className="text-slate-400">tahsil edilmiştir.</span>
        </div>

        {/* ── Taksit dökümü ── */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <TaksitListe title="Ödenen Taksitler" rows={paidInst.map(i => ({ no: i.idx + 1, date: trDate(i.paidDate || i.dueDate), amount: i.amount }))} tone="paid" trDate={trDate} money={money} />
          <TaksitListe title="Kalan Taksitler" rows={unpaidInst.map(i => ({ no: i.idx + 1, date: trDate(i.dueDate), amount: i.amount }))} tone="unpaid" trDate={trDate} money={money} />
        </div>

        {/* ── Özet ── */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Ozet label="Toplam" value={money(finance.netFee)} color="#334155" />
          <Ozet label="Ödenen" value={money(totalPaid)} color="#059669" />
          <Ozet label="Kalan" value={money(finance.balance)} color={finance.balance > 0 ? '#dc2626' : '#059669'} />
        </div>
        {finance.balance <= 0 && (
          <div className="text-center text-[12px] text-emerald-600 font-600 mt-2" style={{ fontWeight: 600 }}>Ödeme tamamlanmıştır. Kalan taksit yoktur.</div>
        )}

        {/* ── Footer ── */}
        <div className="flex items-end justify-between gap-4 mt-6 pt-3" style={{ borderTop: '1px solid #e2e8f0' }}>
          <div className="text-[12px] text-slate-500">
            Ödemeyi Alan<br />
            <span className="font-700 text-slate-800 text-sm" style={{ fontWeight: 700 }}>{payment.recordedBy || '—'}</span>
          </div>
          <div className="text-center">
            <div style={{ width: 150, borderTop: '1px solid #94a3b8' }} className="pt-1 text-[11px] text-slate-400">İmza / Kaşe</div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Taksit döküm listesi — modern satırlar (çizgili tablo değil). Ekstre de kullanır.
export function TaksitListe({ title, rows, tone, money }: {
  title: string;
  rows: { no: number; date: string; amount: number }[];
  tone: 'paid' | 'unpaid';
  trDate: (s: string | null | undefined) => string;
  money: (n: number | undefined) => string;
}) {
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const dot = tone === 'paid' ? '#10b981' : '#cbd5e1';
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-3 py-1.5 text-[11px] font-700 text-slate-600" style={{ fontWeight: 700, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        {title} <span className="text-slate-400 font-normal">({rows.length})</span>
      </div>
      <div>
        {rows.length === 0
          ? <div className="px-3 py-3 text-[11px] text-slate-400 text-center">—</div>
          : rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
              style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
              <span className="text-slate-400 w-5">{r.no}.</span>
              <span className="text-slate-600 flex-1">{r.date}</span>
              <span className="font-600 text-slate-800" style={{ fontWeight: 600 }}>{money(r.amount)}</span>
            </div>
          ))}
        <div className="flex items-center justify-between px-3 py-1.5 text-[12px] font-700"
          style={{ fontWeight: 700, background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
          <span className="text-slate-500">Toplam</span>
          <span className="text-slate-800">{money(total)}</span>
        </div>
      </div>
    </div>
  );
}

export function Ozet({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-600 mb-1" style={{ fontWeight: 600 }}>{label}</div>
      <div className="text-base font-800" style={{ fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
