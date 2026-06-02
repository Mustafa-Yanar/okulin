'use client';

import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';

function getInitialDark() {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem('theme');
  if (stored) return stored === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(getInitialDark());
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  return { dark, toggle };
}

export default function ThemeToggle({ collapsed }) {
  const { dark, toggle } = useDarkMode();

  return (
    <button
      onClick={toggle}
      title={dark ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all w-full
                 text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
      style={{ justifyContent: collapsed ? 'center' : undefined }}
    >
      {dark
        ? <Sun size={16} className="shrink-0" />
        : <Moon size={16} className="shrink-0" />
      }
      {!collapsed && <span className="text-xs">{dark ? 'Aydınlık' : 'Karanlık'}</span>}
    </button>
  );
}
