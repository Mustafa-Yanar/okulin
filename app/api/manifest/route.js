import { rawRedis, currentOrg } from '@/lib/tenant';
import { normalizeBranding } from '@/lib/branding';

// Kuruma özel PWA manifest'i (multi-tenant Faz B tamamlayıcısı).
// "Ana ekrana ekle" ile kurulan uygulamanın ADI / KISA ADI / TEMA RENGİ org'a göre gelir.
// Kurum host'tan (subdomain) çözülür → cookie GEREKMEZ. Her istekte taze (no-store).
export const dynamic = 'force-dynamic';

export async function GET() {
  const org = currentOrg();
  const rec = await rawRedis.get(`org:${org}`);
  const b = normalizeBranding(rec);

  const manifest = {
    name: b.name,
    short_name: b.shortName,
    description: 'Etüt takip ve rezervasyon sistemi',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: b.themeColor,
    orientation: 'portrait',
    // İkonlar şimdilik varsayılan (kuruma özel ikon yüklemesi ileride — ad/renk dinamik yeter).
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
