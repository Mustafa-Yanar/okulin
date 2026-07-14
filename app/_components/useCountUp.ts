'use client';

import { useEffect, useRef, useState } from 'react';
import React from 'react';

// Sayı hedefe yumuşak sayar (ease-out cubic, ~1s). Mevcut değerden hedefe geçer
// (veri yenilenince zıplamaz). prefers-reduced-motion'da anında hedefe oturur.
export function useCountUp(target: number, durationMs = 1000): number {
  const [val, setVal] = useState(0);
  const valRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      valRef.current = target; setVal(target); return;
    }
    const from = valRef.current;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min((t - start) / durationMs, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const cur = from + (target - from) * e;
      valRef.current = cur; setVal(cur);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);

  return val;
}

// Sayaç metni — tam sayıya yuvarlar, TR binlik ayraçla gösterir (tabular hizalama
// çağıran .kpi-num/.nums'tan gelir). Para/ön-ek işaretleri çağıranda.
export function CountUp({ value }: { value: number }): React.ReactElement {
  const v = useCountUp(value);
  return React.createElement(React.Fragment, null, Math.round(v).toLocaleString('tr-TR'));
}
