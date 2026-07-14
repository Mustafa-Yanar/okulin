'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { trDate, money } from './Makbuz';
import type { KurumBilgi } from '../../types';

// Öğrenci ödemeleri listesi — yazdırılabilir/PDF. Ekrandaki AKTİF filtreye göre süzülmüş
// satırlar FinancePanel'den hazır gelir (sınıf adı çözülmüş). Ortak print portal deseni.

export interface FinanceListRow {
  name: string; cls: string; net: number; paid: number; balance: number; status: string;
}

interface Props {
  kurum: KurumBilgi;
  rows: FinanceListRow[];
  subtitle?: string; // aktif filtre özeti (ör. "Sınıf: 10-A · Durum: Ödenmedi")
  onClose: () => void;
}

export default function FinanceListePrint({ kurum, rows, subtitle, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [mounted]);
  if (!mounted) return null;

  const unvan = kurum.officialName || kurum.name || 'Kurum';
  const bugun = new Date().toISOString().slice(0, 10);
  const tot = rows.reduce((a, r) => ({ net: a.net + r.net, paid: a.paid + r.paid, balance: a.balance + r.balance }), { net: 0, paid: 0, balance: 0 });

  return createPortal(
    <div id="print-preview"
      className="fixed inset-0 z-50 bg-slate-800/60 overflow-auto p-4 print:bg-white print:static print:p-0 print:overflow-visible flex flex-col items-center gap-4">
      <div className="no-print sticky top-0 z-10 w-full max-w-[900px] flex items-center justify-between bg-white rounded-xl shadow-lg px-4 py-2.5">
        <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>Öğrenci Ödemeleri — Önizleme ({rows.length})</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-600 transition-colors"
            style={{ fontWeight: 600 }}><Printer size={14} /> Yazdır / PDF</button>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
      </div>

      <div className="print-page bg-white text-slate-800 w-full max-w-[900px] shadow-xl print:shadow-none" style={{ padding: '26px 30px' }}>
        <div className="flex items-center justify-between gap-4 pb-3" style={{ borderBottom: '3px solid #4f46e5' }}>
          <div className="flex items-center gap-3 min-w-0">
            {kurum.logoUrl
              ? <img src={kurum.logoUrl} alt="" className="h-12 w-12 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
              : <div className="h-12 w-12 rounded-xl shrink-0 flex items-center justify-center text-white font-800" style={{ fontWeight: 800, background: 'linear-gradient(135deg,#4f46e5,#6366f1)' }}>{(kurum.name || 'K')[0]}</div>}
            <div className="min-w-0">
              <div className="font-800 text-[15px] leading-tight text-slate-900" style={{ fontWeight: 800 }}>{unvan}</div>
              <div className="text-[12px] text-indigo-600 font-700" style={{ fontWeight: 700 }}>ÖĞRENCİ ÖDEMELERİ LİSTESİ</div>
            </div>
          </div>
          <div className="text-right shrink-0 text-[11px] text-slate-500">
            <div>Tarih: <b className="text-slate-800" style={{ fontWeight: 600 }}>{trDate(bugun)}</b></div>
            {subtitle && <div className="text-slate-700 max-w-[280px]" style={{ fontWeight: 600 }}>{subtitle}</div>}
            <div>{rows.length} öğrenci</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">Görüntülenecek kayıt yok.</div>
        ) : (
          <table className="w-full text-xs mt-4" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th className="text-left py-2 px-2 text-slate-500 font-700 w-8" style={{ fontWeight: 700 }}>#</th>
                <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Ad Soyad</th>
                <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Sınıf</th>
                <th className="text-right py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Net Ücret</th>
                <th className="text-right py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Ödenen</th>
                <th className="text-right py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Kalan</th>
                <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td className="py-1.5 px-2 text-slate-400 font-600 tabular-nums" style={{ fontWeight: 600 }}>{i + 1}</td>
                  <td className="py-1.5 px-2 text-slate-800 font-600" style={{ fontWeight: 600 }}>{r.name}</td>
                  <td className="py-1.5 px-2 text-slate-600">{r.cls || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-700 text-right tabular-nums">{money(r.net)}</td>
                  <td className="py-1.5 px-2 text-green-700 text-right tabular-nums">{money(r.paid)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: r.balance > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>{money(r.balance)}</td>
                  <td className="py-1.5 px-2 text-slate-600">{r.status}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #4f46e5' }}>
                <td className="py-2 px-2 font-700 text-slate-700" style={{ fontWeight: 700 }} colSpan={3}>GENEL TOPLAM</td>
                <td className="py-2 px-2 text-right font-800 text-slate-900 tabular-nums" style={{ fontWeight: 800 }}>{money(tot.net)}</td>
                <td className="py-2 px-2 text-right font-800 text-green-700 tabular-nums" style={{ fontWeight: 800 }}>{money(tot.paid)}</td>
                <td className="py-2 px-2 text-right font-800 tabular-nums" style={{ fontWeight: 800, color: tot.balance > 0 ? '#dc2626' : '#16a34a' }}>{money(tot.balance)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>,
    document.body
  );
}
