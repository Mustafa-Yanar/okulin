import type { MetadataRoute } from 'next';
import { APP_DOMAIN } from '@/lib/org';

// Apex tanıtım sitesi (okulin.com) crawl'a açık; API uçları hariç. Kurum subdomain'leri
// (panel) meta-robots noindex ile korunur (bkz app/layout.tsx generateMetadata).
const BASE = APP_DOMAIN ? `https://${APP_DOMAIN}` : 'https://okulin.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
