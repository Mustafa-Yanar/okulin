'use client';

// Global istemci sağlayıcıları. Şu an: SWR (stale-while-revalidate veri katmanı).
// Ortak fetcher + global ayarlar burada tanımlanır; tüm useSWR çağrıları bunu miras alır.
// Mutasyonlar (POST/PATCH/DELETE) ham fetch ile kalır, sonra ilgili anahtar mutate() ile tazelenir.

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ConfirmProvider } from './ConfirmProvider';

// status + info taşıyan hata — bileşenler error.status / error.info ile ayrım yapabilir.
interface FetchError extends Error {
  status?: number;
  info?: unknown;
}

// Ortak fetcher — JSON döner, hata durumunda status + body taşıyan Error fırlatır.
// (Bileşenler error.status / error.info ile ayrım yapabilir.)
async function fetcher(resource: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(resource, init);
  if (!res.ok) {
    let body: { error?: string } = {};
    try { body = await res.json(); } catch {}
    // Error nesnesine status/info alanları ekleniyor; genişletilmiş FetchError tipine daraltmak için as zorunlu
    const err = new Error(body.error || `İstek başarısız (${res.status})`) as FetchError;
    err.status = res.status;
    err.info = body;
    throw err;
  }
  return res.json();
}

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: true,      // sekmeye dönünce tazele
        revalidateOnReconnect: true,  // ağ geri gelince tazele
        dedupingInterval: 5000,       // 5sn içinde aynı anahtar tek istek
        shouldRetryOnError: false,    // hatada otomatik tekrar deneme (yetki/4xx için gürültü olmasın)
      }}
    >
      <ConfirmProvider>{children}</ConfirmProvider>
    </SWRConfig>
  );
}
