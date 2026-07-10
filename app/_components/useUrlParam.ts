'use client';

// Tek bir URL query parametresini state'e bağlayan hafif hook (useUrlTab kardeşi).
// İnline detay sayfaları için: ?ogrenci=<id> / ?ogretmen=<id> gibi.
// - set(value): pushState → GERİ tuşu detaydan listeye döner.
// - set(null): parametreyi URL'den siler (listeye dön).
// - Sayfa yenilenince URL'deki değer geri yüklenir.
// Native History API → Next.js yeniden render tetiklemez (shallow).

import { useState, useEffect, useCallback } from 'react';

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

function write(key: string, value: string | null | undefined, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (value == null || value === '') params.delete(key);
  else params.set(key, value);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  if (mode === 'push') window.history.pushState({}, '', url);
  else window.history.replaceState({}, '', url);
}

export function useUrlParam(key: string): [string | null, (v: string | null) => void] {
  const [value, setValueState] = useState<string | null>(null);

  // Mount: URL'deki değeri oku (SSR güvenli — ilk render null).
  useEffect(() => {
    setValueState(read(key));
    // yalnız mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Geri/ileri → URL'den geri oku.
  useEffect(() => {
    const onPop = () => setValueState(read(key));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [key]);

  const setValue = useCallback((v: string | null) => {
    setValueState(v || null);
    write(key, v, 'push');
  }, [key]);

  return [value, setValue];
}
