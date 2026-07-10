'use client';

// Aktif sekmeyi URL'e (?sekme=...) yansıtan hafif routing hook'u.
// - Sekme değişince URL'e pushState → tarayıcı GERİ tuşu sekmeler arasında gezinir.
// - Sayfa yenilenince URL'deki sekme geri yüklenir (validTabs ile doğrulanır).
// - Native History API kullanır → Next.js yeniden render TETİKLEMEZ (gerçekten "shallow").
// Drop-in: `const [tab, setTab] = useUrlTab('teachers', ['teachers','students',...])`.

import { useState, useEffect, useCallback } from 'react';

const PARAM = 'sekme';

function readParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(PARAM);
}

function writeParam(value: string, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set(PARAM, value);
  const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  if (mode === 'push') window.history.pushState({}, '', url);
  else window.history.replaceState({}, '', url);
}

export function useUrlTab(defaultTab: string, validTabs?: string[]): [string, (value: string) => void] {
  const isValid = useCallback(
    (v: string | null): v is string => !!v && (!validTabs || validTabs.includes(v)),
    [validTabs]
  );

  // SSR/hydration güvenli: ilk render daima default; URL'i mount'tan sonra okuruz.
  const [tab, setTabState] = useState<string>(defaultTab);

  // Mount: URL'de geçerli sekme varsa onu yükle; yoksa default'u URL'e yaz (geçmişe eklemeden).
  useEffect(() => {
    const fromUrl = readParam();
    if (isValid(fromUrl)) setTabState(fromUrl);
    else writeParam(defaultTab, 'replace');
    // yalnız mount'ta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Geri/ileri tuşu → URL'den state'i geri oku.
  useEffect(() => {
    const onPop = () => {
      const fromUrl = readParam();
      setTabState(isValid(fromUrl) ? fromUrl : defaultTab);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [defaultTab, isValid]);

  const setTab = useCallback((value: string) => {
    setTabState(value);
    writeParam(value, 'push');
  }, []);

  return [tab, setTab];
}
