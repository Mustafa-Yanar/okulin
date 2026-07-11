'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Eye } from 'lucide-react';
import type { TeacherDTO } from '../types';
import type { SolveResult, Assigned } from './program-types';
import { DAYS, COURSE_COLOR, slotLabel } from './program-logic';

interface PrintPreviewProps {
  type: string;
  id: string | null;
  result: SolveResult;
  teachers: TeacherDTO[];
  classes: string[];
  labelOf: (cls: string) => string;
  brandName?: string;
  onClose: () => void;
}

// ── Yazdırma önizleme (print-only div) ──
export default function PrintPreview({ type, id, result, teachers, classes, labelOf, brandName, onClose }: PrintPreviewProps) {
  // Bir öğretmenin programını veya bir sınıfın programını oluştur
  const pages = useMemo(() => {
    if (type==='teacher') {
      return teachers.map(t => {
        const lessons = result.assigned.filter(a=>a.teacherId===t.id);
        return { key:t.id, title:`${t.name} — ${(t.branches||[]).join(', ')}`, lessons };
      });
    } else {
      return classes.map(cls => {
        const lessons = result.assigned.filter(a=>a.cls===cls);
        return { key:cls, title:`${labelOf(cls)} Sınıfı Ders Programı`, lessons };
      });
    }
  }, [type, result, teachers, classes, labelOf]);

  const filteredPages = id ? pages.filter(p => p.key === id) : pages;

  // Önizlemeyi PORTAL ile doğrudan document.body'ye render et. Böylece #print-preview
  // body'nin DOĞRUDAN çocuğu olur → print CSS'i "body > *:not(#print-preview) gizle"
  // basit ve güvenilir kuralıyla çalışır (derin DOM'da :has()/visibility desenleri boş
  // sayfa/sidebar sızması üretiyordu). SSR-safe: mount olana dek null döner.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const content = (
    <div className="fixed inset-0 bg-white z-50 overflow-auto print:static" id="print-preview">
      <div className="no-print p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
        <span className="font-700 text-sm" style={{fontWeight:700}}>
          <Eye size={14} className="inline mr-1"/>
          {type==='teacher'?'Öğretmen Programları':'Sınıf Programları'} — {filteredPages.length} sayfa
        </span>
        <div className="flex gap-2">
          <button onClick={()=>window.print()} className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5">
            <Download size={13}/> PDF / Yazdır
          </button>
          <button onClick={onClose} className="btn-ghost !px-3 !py-2">Kapat</button>
        </div>
      </div>
      {filteredPages.map((pg,pi)=>(
        <SchedulePage key={pi} title={pg.title} lessons={pg.lessons} labelOf={labelOf} brandName={brandName} />
      ))}
    </div>
  );

  return createPortal(content, document.body);
}

interface SchedulePageProps {
  title: string;
  lessons: Assigned[];
  labelOf: (cls: string) => string;
  brandName?: string;
}

function SchedulePage({ title, lessons, labelOf, brandName }: SchedulePageProps) {
  const usedDays = [...new Set(lessons.map(a=>a.day))].sort((a,b)=>a-b);
  // Ders GERÇEK slot satırına oturur (Sıra = gerçek ders no) — güne göre yukarı
  // sıkıştırma yapılmaz, yoksa "5. ders" etiketli ders 1. satırda görünür.
  // Satır aralığı: kullanılan en erken–en geç slot; aradaki boş saatler boş hücre.
  const bySlot = new Map<number, Map<number, Assigned>>(usedDays.map(d => [d, new Map()]));
  let minSlot = Infinity, maxSlot = -1;
  for (const a of lessons) {
    bySlot.get(a.day)!.set(a.slot, a);
    if (a.slot < minSlot) minSlot = a.slot;
    if (a.slot > maxSlot) maxSlot = a.slot;
  }
  const rowSlots = maxSlot < 0 ? [] : Array.from({length: maxSlot - minSlot + 1}, (_, i) => minSlot + i);

  return (
    <div className="print-page p-8" style={{pageBreakAfter:'always',minHeight:'100vh'}}>
      <div className="mb-4 border-b pb-2">
        <h2 style={{fontWeight:700,fontSize:16}}>{title}</h2>
        <p style={{fontSize:11,color:'#9ca3af'}}>{brandName ? `${brandName} — ` : ''}Haftalık Ders Programı</p>
      </div>
      {lessons.length===0 ? (
        <p style={{color:'#9ca3af',fontSize:12}}>Bu program için tanımlı ders bulunmuyor.</p>
      ) : (
        <table style={{borderCollapse:'collapse',width:'100%',fontSize:11}}>
          <thead>
            <tr>
              <th style={{border:'1px solid #e5e7eb',padding:'6px 8px',background:'#f9fafb',textAlign:'center',color:'#9ca3af',width:36}}>Sıra</th>
              {usedDays.map(d => (
                <th key={d} style={{border:'1px solid #e5e7eb',borderLeft:'3px solid #6366f1',padding:'6px 8px',background:'#eef2ff',textAlign:'center',fontWeight:700,color:'#4338ca'}}>
                  {DAYS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowSlots.map(s => (
              <tr key={s}>
                <td style={{border:'1px solid #e5e7eb',padding:'5px 8px',color:'#9ca3af',textAlign:'center',fontWeight:600,background:'#f9fafb'}}>{s+1}</td>
                {usedDays.map(d => {
                  const a = bySlot.get(d)!.get(s);
                  if (!a) return <td key={d+'-'+s} style={{border:'1px solid #e5e7eb',borderLeft:'3px solid #6366f130',background:'#fafafa'}}/>;
                  const col = COURSE_COLOR[a.course]||'#6366f1';
                  return (
                    <td key={d+'-'+s} style={{border:`1px solid ${col}30`,borderLeft:`3px solid ${col}60`,background:`${col}12`,padding:'5px 8px',textAlign:'center'}}>
                      <div style={{fontWeight:700,color:col,fontSize:11}}>{a.course}</div>
                      <div style={{fontSize:10,color:'#6b7280'}}>{slotLabel(d, a.slot)}</div>
                      <div style={{fontSize:10,color:'#9ca3af'}}>{labelOf(a.cls)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
