'use client';
/* eslint-disable @next/next/no-img-element -- Program yazdırma portalında logo native ve anında yüklenmeli. */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { Printer, X } from 'lucide-react';
import type { KurumBilgi } from '../types';
import type { Branding } from '@/lib/branding';

// Ortak, yazdırılabilir haftalık ders programı çıktısı (öğretmen VEYA sınıf).
// Kurum logolu başlık + estetik haftalık şema. Portal + window.print() + print CSS.
// Çağıran taraf `days` hazırlar; hücre içeriği moda göre değişir (öğretmen: sınıf adı /
// sınıf: öğretmen adı — hepsi `main` alanında).

export interface ScheduleLesson { main: string; sub: string; time: string; slotId: string; }
export interface ScheduleDay { dayIndex: number; dayLabel: string; weekend: boolean; lessons: ScheduleLesson[]; }

interface SchedulePrintProps {
  title: string;      // "Ders Programı"
  subtitle: string;   // öğretmen adı ya da sınıf adı
  weekLabel?: string;
  days: ScheduleDay[];
  onClose: () => void;
}

function slotNo(slotId: string): number {
  const m = /(\d+)$/.exec(slotId);
  return m ? parseInt(m[1], 10) : 0;
}

export default function SchedulePrint({ title, subtitle, weekLabel, days, onClose }: SchedulePrintProps) {
  const [mounted, setMounted] = useState(false);
  const { data: org } = useSWR<{ branding: Branding; legal?: KurumBilgi }>('/api/org');
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [mounted]);
  if (!mounted) return null;

  const kurumAd = org?.legal?.officialName || org?.branding?.name || 'Kurum';
  const logo = org?.branding?.logoUrl || '';

  const visibleDays = days
    .map(d => ({ ...d, lessons: [...d.lessons].sort((a, b) => slotNo(a.slotId) - slotNo(b.slotId)) }))
    .filter(d => d.lessons.length > 0);
  const maxLessons = visibleDays.reduce((m, d) => Math.max(m, d.lessons.length), 0);
  const rows = Array.from({ length: maxLessons }, (_, i) => ({
    no: i + 1,
    byDay: Object.fromEntries(visibleDays.map(d => [d.dayIndex, d.lessons[i] || null])) as Record<number, ScheduleLesson | null>,
  }));

  return createPortal(
    <div id="print-preview"
      className="fixed inset-0 z-50 bg-slate-800/60 overflow-auto p-4 print:bg-white print:static print:p-0 print:overflow-visible flex flex-col items-center gap-4">
      <div className="no-print sticky top-0 z-10 w-full max-w-[900px] flex items-center justify-between bg-white rounded-xl shadow-lg px-4 py-2.5">
        <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>{title} — {subtitle}</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-600 transition-colors"
            style={{ fontWeight: 600 }}><Printer size={14} /> Yazdır / PDF</button>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
      </div>

      <div className="print-page bg-white text-slate-800 w-full max-w-[900px] shadow-xl print:shadow-none" style={{ padding: '26px 30px' }}>
        {/* Başlık */}
        <div className="flex items-center justify-between gap-4 pb-3" style={{ borderBottom: '3px solid #4f46e5' }}>
          <div className="flex items-center gap-3 min-w-0">
            {logo
              ? <img src={logo} alt="" className="h-12 w-12 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
              : <div className="h-12 w-12 rounded-xl shrink-0 flex items-center justify-center text-white font-800" style={{ fontWeight: 800, background: 'linear-gradient(135deg,#4f46e5,#6366f1)' }}>{kurumAd[0]}</div>}
            <div className="min-w-0">
              <div className="font-800 text-[15px] leading-tight text-slate-900" style={{ fontWeight: 800 }}>{kurumAd}</div>
              <div className="text-[12px] text-indigo-600 font-700" style={{ fontWeight: 700 }}>{title.toUpperCase()}</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-800 text-slate-900 text-lg leading-tight" style={{ fontWeight: 800 }}>{subtitle}</div>
            {weekLabel && <div className="text-[11px] text-slate-500 mt-0.5">{weekLabel}</div>}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">Bu program için tanımlı ders bulunmuyor.</div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th className="text-left py-2 px-2 text-slate-400 font-700 w-9" style={{ fontWeight: 700 }}>#</th>
                  {visibleDays.map(day => (
                    <th key={day.dayIndex}
                      className={`text-center py-2 px-2 font-700 ${day.weekend ? 'text-indigo-600' : 'text-slate-700'}`}
                      style={{ fontWeight: 700, borderBottom: '2px solid #e2e8f0' }}>
                      {day.dayLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.no}>
                    <td className="py-1.5 px-2 text-slate-400 font-600 align-middle" style={{ fontWeight: 600 }}>{row.no}.</td>
                    {visibleDays.map(day => {
                      const l = row.byDay[day.dayIndex];
                      if (!l) return <td key={day.dayIndex} className="py-1 px-1"><div className="rounded-lg py-2 text-center text-slate-200 bg-slate-50 text-[10px]">—</div></td>;
                      return (
                        <td key={day.dayIndex} className="py-1 px-1">
                          <div className="rounded-lg py-1.5 px-2 text-center" style={{ background: '#eef2ff', border: '1px solid #c7d2fe' }}>
                            <div className="text-[11px] font-700 text-indigo-800 leading-tight truncate" style={{ fontWeight: 700 }}>{l.main}</div>
                            {l.sub && <div className="text-[10px] text-indigo-500 leading-tight truncate">{l.sub}</div>}
                            {l.time && <div className="text-[9px] text-slate-400 leading-tight">{l.time}</div>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-[11px] text-slate-400 mt-6 pt-3 flex justify-between" style={{ borderTop: '1px solid #e2e8f0' }}>
          <span>{kurumAd}</span>
          <span>{new Date().toLocaleDateString('tr-TR')}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
