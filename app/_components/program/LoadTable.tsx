'use client';

import { useMemo, useState } from 'react';
import type { Load, Grouping } from './program-types';
import { ORDER, COURSE_COLOR, LOAD_COLUMNS, parsePattern, defaultSplit } from './program-logic';

interface LoadTableProps {
  load: Load;
  setLoad: (updater: (prev: Load) => Load) => void;
  grouping: Grouping;
  setGrouping: (updater: (prev: Grouping) => Grouping) => void;
  cols: typeof LOAD_COLUMNS;
  courseMap: Record<string, string[]>;
}

// ── Ders yükü tablosu: sütunlar dikey, satırlar dersler ──
// Her hücre iki girişli: üstte toplam SAAT, altta gruplama deseni (örn "3-2-2").
// Desen boşsa varsayılan 2'li bölme uygulanır. Desen girilince saat = desen toplamı.
export default function LoadTable({ load, setLoad, grouping, setGrouping, cols, courseMap }: LoadTableProps) {
  // Bilinen sıradaki çekirdek dersler önce, kurumun özel dersleri (courseMap'te olup
  // ORDER'da olmayan) sona eklenir — böylece "Paragraf" gibi dersler satırlardan düşmez.
  const allCourses = useMemo(() => {
    const used = new Set<string>();
    for (const c of cols) for (const d of (courseMap[c.key] || [])) used.add(d);
    const known = ORDER.filter(d => used.has(d));
    const extra = [...used].filter(d => !ORDER.includes(d));
    return [...known, ...extra];
  }, [cols, courseMap]);
  const [editing, setEditing] = useState<Record<string, string>>({}); // "colKey|ders" → yazım halindeki ham desen

  const clearPattern = (key: string, d: string) => setGrouping(prev => {
    if (prev[key]?.[d] == null) return prev;
    const nk = { ...(prev[key] || {}) }; delete nk[d];
    const next = { ...prev, [key]: nk };
    if (!Object.keys(nk).length) delete next[key];
    return next;
  });

  const set = (key: string, d: string, val: string) => {
    setLoad(prev => ({...prev,[key]:{...(prev[key]||{}),[d]:Math.max(0,parseInt(val)||0)}}));
    clearPattern(key, d); // saat değişince eski desen toplamla çelişir — varsayılana dön
  };

  // Desen commit (blur): geçerliyse normalize edip sakla, saat = desen toplamı.
  const commitPattern = (key: string, d: string, raw: string) => {
    setEditing(s => { const n = {...s}; delete n[key+'|'+d]; return n; });
    const pat = parsePattern(raw);
    const cur = grouping?.[key]?.[d] || '';
    if (!pat.length) { if (cur) clearPattern(key, d); return; }
    const norm = pat.join('-');
    const sum = pat.reduce((a,b)=>a+b,0);
    if (norm === cur && sum === ((load[key]?.[d])||0)) return; // değişiklik yok
    setGrouping(prev => ({...prev, [key]: {...(prev[key]||{}), [d]: norm}}));
    setLoad(prev => ({...prev, [key]: {...(prev[key]||{}), [d]: sum}}));
  };

  const sumFor = (key: string) => (courseMap[key]||[]).reduce((s,d)=>s+((load[key]?.[d])||0),0);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full" style={{borderCollapse:'collapse', tableLayout:'fixed'}}>
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-gray-400 sticky left-0 bg-white" style={{fontWeight:600, width:120}}>Ders</th>
            {cols.map(c => (
              <th key={c.key} className="px-1 py-1 text-gray-600 text-center" style={{fontWeight:700, width:64}}>
                {/* Dikey yazı */}
                <div style={{writingMode:'vertical-rl', transform:'rotate(180deg)', whiteSpace:'nowrap', height:90, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11}}>
                  {c.label}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allCourses.map(d => (
            <tr key={d} className="border-t border-gray-50">
              <td className="px-2 py-1.5 sticky left-0 bg-white" style={{fontWeight:600}}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:COURSE_COLOR[d] || '#94a3b8'}} />
                  {d}
                </span>
              </td>
              {cols.map(c => {
                if (!courseMap[c.key]?.includes(d))
                  return <td key={c.key} className="text-center text-gray-100 px-1 py-1">–</td>;
                const h = (load[c.key]?.[d]) || 0;
                const ek = c.key + '|' + d;
                return (
                  <td key={c.key} className="text-center px-1 py-1 align-top">
                    <input type="number" min="0" value={h}
                      onChange={e=>set(c.key,d,e.target.value)}
                      className="input !w-full !py-1.5 text-center text-sm" />
                    <input type="text" inputMode="numeric"
                      value={editing[ek] ?? grouping?.[c.key]?.[d] ?? ''}
                      placeholder={h > 0 ? defaultSplit(h).join('-') : '—'}
                      onChange={e=>setEditing(s=>({...s,[ek]:e.target.value}))}
                      onBlur={e=>commitPattern(c.key,d,e.target.value)}
                      className="input !w-full !py-1 text-center mt-1"
                      style={{fontSize:10, color:'var(--text-muted)'}}
                      title="Gruplama — örn 3-2-2 (boş = 2'li bloklar, tek kalan saat 1'lik)" />
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{background:'var(--bg-muted)'}} className="border-t-2 border-gray-200">
            <td className="px-2 py-2 sticky left-0 font-700" style={{background:'var(--bg-muted)',color:'var(--text-secondary)',fontWeight:700}}>Σ saat</td>
            {cols.map(c => {
              const s=sumFor(c.key);
              const cap = c.key.startsWith('Mezun') ? 24 : 200;
              return <td key={c.key} className="text-center px-1 py-2" style={{fontWeight:700,color:s>cap?'#dc2626':'var(--text-secondary)'}}>{s}</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
