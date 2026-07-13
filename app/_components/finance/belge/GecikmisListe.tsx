'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { trDate, money } from './Makbuz';
import type { KurumBilgi } from '../../types';

// Gecikmiş Ödemeler Listesi — kurum geneli rapor. Sınıf/şube bazlı gruplu; her öğrencinin
// vadesi geçmiş taksitleri + ara/genel toplam. Veri FinancePanel'de bellek içi hazırlanır.

export interface GecikmisTaksit { no: number; dueDate: string; amount: number }
export interface GecikmisOgrenci {
  name: string; tc: string; parentName: string; parentPhone: string;
  sonTahsil: string; taksitler: GecikmisTaksit[]; toplam: number;
}
export interface GecikmisGrup { baslik: string; ogrenciler: GecikmisOgrenci[]; araToplam: number }

interface GecikmisListeProps {
  kurum: KurumBilgi;
  gruplar: GecikmisGrup[];
  genelToplam: number;
  ogrenciSayisi: number;
  onClose: () => void;
}

export default function GecikmisListe({ kurum, gruplar, genelToplam, ogrenciSayisi, onClose }: GecikmisListeProps) {
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

  return createPortal(
    <div id="print-preview"
      className="fixed inset-0 z-50 bg-slate-800/60 overflow-auto p-4 print:bg-white print:static print:p-0 print:overflow-visible flex flex-col items-center gap-4">
      <div className="no-print sticky top-0 z-10 w-full max-w-[860px] flex items-center justify-between bg-white rounded-xl shadow-lg px-4 py-2.5">
        <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>Gecikmiş Ödemeler — Önizleme</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-600 transition-colors"
            style={{ fontWeight: 600 }}><Printer size={14} /> Yazdır / PDF</button>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
      </div>

      <div className="print-page bg-white text-slate-800 w-full max-w-[860px] shadow-xl print:shadow-none" style={{ padding: '26px 30px' }}>
        {/* Başlık */}
        <div className="flex items-center justify-between gap-4 pb-3" style={{ borderBottom: '3px solid #4f46e5' }}>
          <div className="flex items-center gap-3 min-w-0">
            {kurum.logoUrl
              ? <img src={kurum.logoUrl} alt="" className="h-12 w-12 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
              : <div className="h-12 w-12 rounded-xl shrink-0 flex items-center justify-center text-white font-800" style={{ fontWeight: 800, background: 'linear-gradient(135deg,#4f46e5,#6366f1)' }}>{(kurum.name || 'K')[0]}</div>}
            <div className="min-w-0">
              <div className="font-800 text-[15px] leading-tight text-slate-900" style={{ fontWeight: 800 }}>{unvan}</div>
              <div className="text-[12px] text-indigo-600 font-700" style={{ fontWeight: 700 }}>GECİKMİŞ ÖDEMELER LİSTESİ</div>
            </div>
          </div>
          <div className="text-right shrink-0 text-[11px] text-slate-500">
            <div>Tarih: <b className="text-slate-800" style={{ fontWeight: 600 }}>{trDate(bugun)}</b></div>
            <div>{ogrenciSayisi} öğrenci · {gruplar.length} sınıf</div>
          </div>
        </div>

        {gruplar.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">Vadesi geçmiş ödeme bulunmuyor.</div>
        ) : gruplar.map((g, gi) => (
          <div key={gi} className="mt-4" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            {/* Grup başlığı */}
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg"
              style={{ background: '#eef2ff' }}>
              <span className="font-700 text-indigo-700 text-[13px]" style={{ fontWeight: 700 }}>{g.baslik}</span>
              <span className="text-[11px] text-slate-500">{g.ogrenciler.length} öğrenci · <b className="text-slate-700" style={{ fontWeight: 600 }}>{money(g.araToplam)}</b></span>
            </div>
            {/* Öğrenciler */}
            <div className="mt-1">
              {g.ogrenciler.map((o, oi) => (
                <div key={oi} className="flex items-start gap-3 px-3 py-2 text-[12px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-700 text-slate-900" style={{ fontWeight: 700 }}>{o.name}</span>
                      {o.tc && <span className="text-[10px] text-slate-400">TC {o.tc}</span>}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {o.parentName}{o.parentPhone ? ` · ${o.parentPhone}` : ''}{o.sonTahsil ? ` · Son tahsil: ${trDate(o.sonTahsil)}` : ''}
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      {o.taksitler.map((t, ti) => (
                        <span key={ti} className="inline-block mr-2 whitespace-nowrap">
                          <span className="text-slate-400">{t.no}.</span> {trDate(t.dueDate)} <b style={{ fontWeight: 600 }}>{money(t.amount)}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[9px] uppercase tracking-wide text-slate-400">Beklenen</div>
                    <div className="font-800 text-red-600 text-[13px]" style={{ fontWeight: 800 }}>{money(o.toplam)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Genel toplam */}
        {gruplar.length > 0 && (
          <div className="flex items-center justify-between mt-5 pt-3 px-3" style={{ borderTop: '2px solid #4f46e5' }}>
            <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>GENEL TOPLAM</span>
            <span className="font-800 text-red-600 text-xl" style={{ fontWeight: 800 }}>{money(genelToplam)}</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
