import { headers } from 'next/headers';
import { rawRedis, currentOrg } from '@/lib/tenant';
import { normalizeBranding } from '@/lib/branding';
import { isApexHost, PLATFORM_BRANDING } from '@/lib/org';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// Kuruma özel PWA manifest'i (multi-tenant Faz B tamamlayıcısı).
// "Ana ekrana ekle" ile kurulan uygulamanın ADI / KISA ADI / TEMA RENGİ org'a göre gelir.
// Apex (okulin.com) → platform (okulin) markası. Kurum host'tan çözülür → cookie GEREKMEZ.
export const dynamic = 'force-dynamic';

export async function GET() {
  const apex = isApexHost(headers().get('host'));
  const org = currentOrg();
  const rec = apex
    ? null
    : (isSqlEnabled() ? await tdb().org.findFirst({ where: { slug: org } }) : await rawRedis.get(`org:${org}`));
  const b = apex ? PLATFORM_BRANDING : normalizeBranding(rec);

  // Kuruma özel ikon: iconUrl (varsa) > logoUrl > varsayılan. Custom ikon arbitrer
  // görsel olabildiğinden (kare olmayabilir) purpose 'any' — maskable kırpma yok.
  const customIcon = (rec?.iconUrl || rec?.logoUrl || '').trim();
  const icons = customIcon
    ? [
        { src: customIcon, sizes: '192x192', purpose: 'any' },
        { src: customIcon, sizes: '512x512', purpose: 'any' },
      ]
    : [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ];

  const manifest = {
    name: b.name,
    short_name: b.shortName,
    description: apex ? 'Eğitim kurumu yönetim platformu' : 'Etüt takip ve rezervasyon sistemi',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: b.themeColor,
    orientation: 'portrait',
    icons,
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
