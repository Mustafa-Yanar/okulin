'use client';

// Global istemci sağlayıcıları. Şu an: SWR (stale-while-revalidate veri katmanı).
// Ortak fetcher + global ayarlar burada tanımlanır; tüm useSWR çağrıları bunu miras alır.
// Mutasyonlar (POST/PATCH/DELETE) ham fetch ile kalır, sonra ilgili anahtar mutate() ile tazelenir.

import { SWRConfig } from 'swr';

// Ortak fetcher — JSON döner, hata durumunda status + body taşıyan Error fırlatır.
// (Bileşenler error.status / error.info ile ayrım yapabilir.)
async function fetcher(resource, init) {
  const res = await fetch(resource, init);
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    const err = new Error(body.error || `İstek başarısız (${res.status})`);
    err.status = res.status;
    err.info = body;
    throw err;
  }
  return res.json();
}

export default function Providers({ children }) {
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
      {children}
    </SWRConfig>
  );
}
