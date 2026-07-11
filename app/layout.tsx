import './globals.css';
import { cache } from 'react';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { resolveOrg, isApexHost, PLATFORM_BRANDING, APP_DOMAIN } from '@/lib/org';
import { normalizeBranding } from '@/lib/branding';
import { tdb } from '@/lib/sqldb';
import Providers from './_components/Providers';

// İstek başına bir kez okunur (React cache dedupe) — metadata + viewport aynı çağrıyı paylaşır.
// NOT: middleware yalnız /api/:path* eşleşir → sayfa isteklerinde x-org header'ı YOK.
// Bu yüzden host'tan doğrudan resolveOrg() ile kurum çözülür (middleware'e bağımlı değil).
const getBranding = cache(async () => {
  try {
    const host = headers().get('host');
    // Apex (okulin.com) → platform markası (kurum değil → tanıtım sayfası).
    if (isApexHost(host)) return PLATFORM_BRANDING;
    const org = resolveOrg(host);
    const rec = await tdb().org.findFirst({ where: { slug: org } });
    return normalizeBranding(rec);
  } catch {
    return normalizeBranding(null);
  }
});

// Apex (okulin.com) mı? Apex TANITIM sitesidir, kurulabilir PWA DEĞİL — böylece
// apex PWA'sından kurum subdomain'ine geçişte Chrome'un zorunlu Custom Tab barı DOĞMAZ.
// Kullanıcı yalnız kendi subdomain'ini (testkurs.okulin.com) PWA ekler → tek origin, bar yok.
const getIsApex = cache(() => {
  try { return isApexHost(headers().get('host')); } catch { return false; }
});

const APEX_DESC = 'okulin — dershane ve okullar için etüt takip, otomatik ders programı, yoklama, deneme analizi, ödeme ve veli iletişimi tek panelde.';
const BASE_URL = APP_DOMAIN ? `https://${APP_DOMAIN}` : 'https://okulin.com';

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  const apex = getIsApex();
  // Kuruma özel ikon: logo varsa onu kullan (iOS apple-touch + genel), yoksa varsayılan.
  const icon = b.logoUrl || '';
  const description = apex ? APEX_DESC : 'Etüt takip ve rezervasyon sistemi';
  return {
    title: apex ? { default: 'okulin — Eğitim Kurumu Yönetim Platformu', template: '%s' } : b.name,
    description,
    metadataBase: new URL(BASE_URL),
    // Apex'te manifest YOK → "ana ekrana ekle" tam PWA yaratmaz (bkz getIsApex).
    // Subdomain'lerde kuruma özel manifest verilir (tam PWA deneyimi korunur).
    ...(apex ? {} : { manifest: '/api/manifest' }),
    icons: {
      icon: icon || '/icon-192.png',
      apple: icon || '/apple-touch-icon.png',
    },
    // SEO: apex tanıtım sitesi indekslenir + zengin paylaşım kartları; kurum
    // subdomain'leri (özel panel) noindex — mahremiyet + duplicate-content önleme.
    ...(apex ? {
      keywords: [
        'dershane yönetim', 'etüt takip', 'ders programı oluşturucu', 'okul yönetim sistemi',
        'öğrenci takip', 'yoklama sistemi', 'deneme analizi', 'veli bilgilendirme', 'okulin',
      ],
      alternates: { canonical: BASE_URL },
      openGraph: {
        type: 'website', locale: 'tr_TR', siteName: 'okulin', url: BASE_URL,
        title: 'okulin — Eğitim Kurumu Yönetim Platformu', description,
        images: [{ url: '/icon-512.png', width: 512, height: 512, alt: 'okulin' }],
      },
      twitter: {
        card: 'summary', title: 'okulin — Eğitim Kurumu Yönetim Platformu', description,
        images: ['/icon-512.png'],
      },
    } : {
      robots: { index: false, follow: false },
    }),
    // iOS "web app capable" bayrakları da yalnız subdomain'de — apex tanıtım sitesi kalır.
    ...(apex ? {} : {
      appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: b.shortName,
      },
      other: {
        'mobile-web-app-capable': 'yes',
      },
    }),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getBranding();
  return {
    themeColor: b.themeColor,
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const apex = getIsApex();
  return (
    <html lang="tr">
      <head>
        {/* Tema FOUC önleyici — ilk boyamadan önce dark class'ı uygular */}
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`
        }} />
        {/* Service worker YALNIZ subdomain'de — apex tanıtım sitesi PWA olmasın (Custom Tab
            barını önlemek için). Apex'te SW + manifest olmayınca Chrome "yükle" önermez. */}
        {!apex && (
          <script dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js')); }`
          }} />
        )}
        {/* Zengin arama sonucu (structured data) — yalnız apex tanıtım sitesinde. */}
        {apex && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'okulin',
              applicationCategory: 'EducationalApplication',
              operatingSystem: 'Web',
              url: BASE_URL,
              description: APEX_DESC,
              inLanguage: 'tr-TR',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'TRY' },
            })
          }} />
        )}
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
