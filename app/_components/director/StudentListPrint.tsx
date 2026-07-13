'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { Printer, X } from 'lucide-react';
import type { KurumBilgi } from '../types';
import type { Branding } from '@/lib/branding';

// Yazdırılabilir sınıf/şube öğrenci listesi. Kurum logolu başlık + tablo (ad/TC/tel/veli).
// SchedulePrint ile aynı print portal deseni (portal + window.print() + print CSS).

export interface PrintStudent { name: string; tcNo?: string; phone?: string; parentName?: string; parentPhone?: string; }

interface StudentListPrintProps {
  title: string;    // "Öğrenci Listesi"
  subtitle: string; // şube adı
  students: PrintStudent[];
  onClose: () => void;
}

export default function StudentListPrint({ title, subtitle, students, onClose }: StudentListPrintProps) {
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
  const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return createPortal(
    <div id="print-preview"
      className="fixed inset-0 z-50 bg-slate-800/60 overflow-auto p-4 print:bg-white print:static print:p-0 print:overflow-visible flex flex-col items-center gap-4">
      <div className="no-print sticky top-0 z-10 w-full max-w-[900px] flex items-center justify-between bg-white rounded-xl shadow-lg px-4 py-2.5">
        <span className="font-700 text-slate-700 text-sm" style={{ fontWeight: 700 }}>{title} — {subtitle} ({sorted.length})</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-600 hover:bg-indigo-700 transition-colors"
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
            <div className="text-[11px] text-slate-500 mt-0.5">{sorted.length} öğrenci</div>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">Bu şubede öğrenci bulunmuyor.</div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th className="text-left py-2 px-2 text-slate-500 font-700 w-9" style={{ fontWeight: 700 }}>#</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Ad Soyad</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>T.C. Kimlik No</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Öğrenci Tel</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Veli</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-700" style={{ fontWeight: 700 }}>Veli Tel</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td className="py-1.5 px-2 text-slate-400 font-600" style={{ fontWeight: 600 }}>{i + 1}</td>
                    <td className="py-1.5 px-2 text-slate-800 font-600" style={{ fontWeight: 600 }}>{s.name}</td>
                    <td className="py-1.5 px-2 text-slate-600">{s.tcNo || '—'}</td>
                    <td className="py-1.5 px-2 text-slate-600">{s.phone || '—'}</td>
                    <td className="py-1.5 px-2 text-slate-600">{s.parentName || '—'}</td>
                    <td className="py-1.5 px-2 text-slate-600">{s.parentPhone || '—'}</td>
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
