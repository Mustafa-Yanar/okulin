'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Check } from 'lucide-react';
import { BG_SCENES, getBgScene, setBgScene } from './BackgroundScene';

interface Props {
  collapsed: boolean;
}

// Kişisel arka plan sahnesi seçici — sidebar alt bloğunda ThemeToggle komşusu.
// Tercih localStorage'da (BackgroundScene ile aynı anahtar/olay), tüm rollerde çalışır.
export default function BackgroundScenePicker({ collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>('combo');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActive(getBgScene()); }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (key: string) => { setBgScene(key); setActive(key); setOpen(false); };
  const activeName = BG_SCENES.find(s => s.key === active)?.name ?? 'Mesh + Ağ';

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={collapsed ? `Arka plan: ${activeName}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition w-full
                   text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
        style={{ justifyContent: collapsed ? 'center' : undefined }}
      >
        <Sparkles size={16} className="shrink-0" />
        {!collapsed && (
          <span className="flex items-center justify-between flex-1 min-w-0">
            <span className="text-xs">Arka plan</span>
            <span className="text-[11px] truncate ml-2" style={{ color: 'var(--text-muted)' }}>{activeName}</span>
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 z-50 rounded-xl p-1.5 animate-enter-scale"
          style={{
            width: 216, maxHeight: 340, overflowY: 'auto',
            background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
            boxShadow: 'var(--sh-lg)',
          }}
        >
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-widest" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>
            Arka plan sahnesi
          </div>
          {BG_SCENES.map(s => {
            const on = s.key === active;
            return (
              <button
                key={s.key}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => pick(s.key)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition hover:bg-[var(--bg-muted)]"
                style={on ? { background: 'color-mix(in srgb, var(--brand,#6366f1) 12%, transparent)' } : undefined}
              >
                <span className="w-[18px] h-[18px] rounded-md shrink-0" style={{ background: s.swatch, border: '1px solid var(--border-subtle)' }} />
                <span className="flex-1 text-left text-[13px]" style={{ fontWeight: on ? 700 : 500, color: on ? 'var(--brand,#6366f1)' : 'var(--text-primary)' }}>{s.name}</span>
                {on && <Check size={14} style={{ color: 'var(--brand,#6366f1)' }} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
