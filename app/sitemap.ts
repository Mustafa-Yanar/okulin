import type { MetadataRoute } from 'next';
import { APP_DOMAIN } from '@/lib/org';

// Apex tanıtım sitesi tek public giriş (SPA — landing tek indekslenebilir sayfa).
// Kurum panelleri subdomain'de + noindex olduğundan sitemap'e girmez.
const BASE = APP_DOMAIN ? `https://${APP_DOMAIN}` : 'https://okulin.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: new Date(), changeFrequency: 'monthly', priority: 1 },
  ];
}
