'use client';
/* eslint-disable @next/next/no-img-element -- Senet yazdırılırken kurum logosu optimizer/lazy-load olmadan hazır olmalı. */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { tutariYaziyaCevir } from '@/lib/tutar-yazi';
import type { KurumBilgi, InstallmentDTO } from '../../types';

// Taksit Senedi (bono / emre muharrer senet) — her taksit için bir senet; yalnız vade
// ve tutar değişir. Sayfa başına 3 senet. Metin SABİT (hukuki); kurum ünvanı + vade +
// yazıyla tutar dinamik doldurulur. Anlık üretim (snapshot dondurma sağlamlaştırma fazında).

function trDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}.${m}.${y}` : iso;
}
function money(n: number | undefined): string {
  return '₺' + (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface SenetOgrenci { name: string; tc: string; phone?: string; donem?: string; }
export interface SenetVeli { name: string; phone: string; address: string; tc: string; }

interface SenetProps {
  kurum: KurumBilgi;
  ogrenci: SenetOgrenci;
  veli: SenetVeli;
  installments: InstallmentDTO[];
  duzenlemeTarihi: string;
  onClose: () => void;
}

export default function Senet({ kurum, ogrenci, veli, installments, duzenlemeTarihi, onClose }: SenetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [mounted]);
  if (!mounted) return null;

  const unvan = kurum.officialName || kurum.name || 'Kurum';
  const rows = installments.filter(i => !i.paid); // ödenmemiş taksitler için senet
  // Her A4 sayfaya 3 senet; sayfa içinde dikey yayılır (senet-sheet + space-between).
  const chunks: InstallmentDTO[][] = [];
  for (let i = 0; i < rows.length; i += 3) chunks.push(rows.slice(i, i + 3));

  return createPortal(
    <div id="print-preview"
      className="fixed inset-0 z-50 bg-slate-800/60 overflow-auto p-4 print:bg-white print:static print:p-0 print:overflow-visible flex flex-col items-center gap-4">
      <div className="no-print sticky top-0 z-10 w-full max-w-[820px] flex items-center justify-between bg-white rounded-xl shadow-lg px-4 py-2.5">
        <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>
          Taksit Senedi — Önizleme <span className="text-slate-400 font-normal">({rows.length} senet)</span>
        </span>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-600 transition-colors"
            style={{ fontWeight: 600 }}><Printer size={14} /> Yazdır / PDF</button>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="print-page bg-white text-slate-800 w-full max-w-[820px] shadow-xl print:shadow-none" style={{ padding: '10px 20px' }}>
          <div className="text-center py-10 text-slate-400 text-sm">Ödenmemiş taksit yok — senet üretilecek kalem bulunmuyor.</div>
        </div>
      ) : chunks.map((chunk, ci) => (
        <div key={ci} className="print-page senet-sheet bg-white text-slate-800 w-full max-w-[820px] shadow-xl print:shadow-none" style={{ padding: '10px 20px' }}>
          {chunk.map((inst, i) => (
            <SenetKart key={i} no={ci * 3 + i + 1} toplam={rows.length} inst={inst}
              kurum={kurum} unvan={unvan} ogrenci={ogrenci} veli={veli} duzenlemeTarihi={duzenlemeTarihi} />
          ))}
        </div>
      ))}
    </div>,
    document.body
  );
}

function SenetKart({ no, toplam, inst, kurum, unvan, ogrenci, veli, duzenlemeTarihi }: {
  no: number; toplam: number; inst: InstallmentDTO; kurum: KurumBilgi; unvan: string;
  ogrenci: SenetOgrenci; veli: SenetVeli; duzenlemeTarihi: string;
}) {
  const yazi = tutariYaziyaCevir(inst.amount);
  const kurusYazi = yazi.kurus;
  return (
    <div className="rounded-xl border border-slate-300 overflow-hidden flex flex-col"
      style={{ breakInside: 'avoid', pageBreakInside: 'avoid', height: '80mm', marginBottom: '4mm' }}>
      {/* Üst şerit — gövdeyle AYNI kolon oranı (1.35/1) → sağ kutu bloğunun sol sınırı
          gövdedeki öğrenci kutusunun sol sınırıyla hizalanır. */}
      <div className="grid items-stretch" style={{ gridTemplateColumns: '1.35fr 1fr', borderBottom: '1px solid #cbd5e1' }}>
        <div className="flex items-center gap-2.5 px-3 py-2 min-w-0" style={{ background: '#f8fafc' }}>
          {kurum.logoUrl
            ? <img src={kurum.logoUrl} alt="" className="h-9 w-9 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
            : <div className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-800" style={{ fontWeight: 800, background: 'linear-gradient(135deg,#4f46e5,#6366f1)' }}>{(kurum.name || 'K')[0]}</div>}
          <div className="min-w-0">
            <div className="font-800 text-[12px] leading-tight text-slate-900 truncate" style={{ fontWeight: 800 }}>{unvan}</div>
            <div className="text-[10px] text-indigo-600 font-700" style={{ fontWeight: 700 }}>TAKSİT SENEDİ</div>
          </div>
        </div>
        <div className="grid grid-cols-3 text-center text-[10px]">
          <BoxHead label="Ödeme Günü" value={trDate(inst.dueDate)} />
          <BoxHead label="Tutar" value={money(inst.amount)} strong />
          <BoxHead label="Senet No" value={`${no} / ${toplam}`} />
        </div>
      </div>

      {/* Gövde: metin + taraf bilgileri — kalan yüksekliği doldurur (ayrı alt imza satırı YOK;
          imzalar sol metnin altına ve kefil bilgisinin sağına gömülü → yükseklik kazanılır). */}
      <div className="grid flex-1" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
        {/* Sol: bono metni + altta iki imza alanı */}
        <div className="px-3 py-2.5 flex flex-col" style={{ borderRight: '1px solid #e2e8f0' }}>
          <div className="text-[11px] text-slate-500 mb-1">
            Borçlu: <b className="text-slate-800" style={{ fontWeight: 600 }}>{veli.name || ogrenci.name}</b>
            {' · '}Taksit: <b className="text-slate-800" style={{ fontWeight: 600 }}>{inst.idx + 1}. Ay</b>
            {' · '}Vade: <b className="text-slate-800" style={{ fontWeight: 600 }}>{trDate(inst.dueDate)}</b>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-700" style={{ textAlign: 'justify' }}>
            İşbu nama muharrer senedim mukabilinde <b style={{ fontWeight: 600 }}>{trDate(inst.dueDate)}</b> tarihinde
            Sayın <b style={{ fontWeight: 600 }}>{unvan}</b> veyahut emruhavale yukarıda yazılı yalnız{' '}
            <b style={{ fontWeight: 700 }}>{yazi.lira} Türk Lirası {kurusYazi} Kuruş</b> ödeyeceğim. Bedeli ahzolunmuştur.
            İşbu bono vadesinde ödenmediği takdirde müteakip bonoların da muacceliyet kesbedeceğini, ihtilaf vukuunda
            {kurum.officialAddress ? '' : ' yetkili'} mahkemelerinin salahiyetini şimdiden kabul eylerim. Okudum.
          </p>
          <div className="text-[10px] text-slate-400 mt-1.5">Düzenleme Tarihi: {trDate(duzenlemeTarihi)}</div>
          {/* İmza alanları — bloğun alt çizgisine yakın, iki adet */}
          <div className="mt-auto flex items-end justify-around gap-4 pt-3">
            <div style={{ width: 110, borderTop: '1px solid #94a3b8' }} className="pt-0.5 text-[9px] text-slate-400 text-center">İMZA</div>
            <div style={{ width: 110, borderTop: '1px solid #94a3b8' }} className="pt-0.5 text-[9px] text-slate-400 text-center">İMZA</div>
          </div>
        </div>

        {/* Sağ: öğrenci / ödeyecek / kefil (kefil bilgisinin sağında imza) */}
        <div className="text-[10px] flex flex-col">
          <Taraf title="Öğrenci">
            <div className="text-slate-800 font-600" style={{ fontWeight: 600 }}>{ogrenci.name}</div>
            {ogrenci.tc && <div className="text-slate-500">T.C.: {ogrenci.tc}</div>}
            {ogrenci.phone && <div className="text-slate-500">Tel: {ogrenci.phone}</div>}
            {ogrenci.donem && <div className="text-slate-500">Dönem: {ogrenci.donem}</div>}
          </Taraf>
          <Taraf title="Ödeyecek">
            <div className="text-slate-800 font-600" style={{ fontWeight: 600 }}>{veli.name || '—'}</div>
            {veli.phone && <div className="text-slate-500">Tel: {veli.phone}</div>}
            {veli.address && <div className="text-slate-500 leading-snug">{veli.address}</div>}
            {veli.tc && <div className="text-slate-500">T.C.: {veli.tc}</div>}
          </Taraf>
          <Taraf title="Kefil" last>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="text-slate-300">İsim: ................</div>
                <div className="text-slate-300">T.C.: ................</div>
              </div>
              <div style={{ width: 66, borderTop: '1px solid #94a3b8' }} className="pt-0.5 text-[9px] text-slate-400 text-center shrink-0">İMZA</div>
            </div>
          </Taraf>
        </div>
      </div>
    </div>
  );
}

function BoxHead({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="px-2 py-2 flex flex-col justify-center">
      <div className="text-slate-400 uppercase tracking-wide" style={{ fontSize: 8 }}>{label}</div>
      <div className={strong ? 'font-800 text-indigo-700 text-[12px]' : 'font-700 text-slate-800 text-[11px]'} style={{ fontWeight: strong ? 800 : 700 }}>{value}</div>
    </div>
  );
}

function Taraf({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="px-2.5 py-1.5" style={{ borderBottom: last ? 'none' : '1px solid #f1f5f9' }}>
      <span className="uppercase tracking-wide text-slate-400 font-700" style={{ fontSize: 8, fontWeight: 700 }}>{title}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
