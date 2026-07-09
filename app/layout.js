import './globals.css';
import { cache } from 'react';
import { headers } from 'next/headers';
import { resolveOrg, isApexHost, PLATFORM_BRANDING } from '@/lib/org';
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

export async function generateMetadata() {
  const b = await getBranding();
  const apex = getIsApex();
  // Kuruma özel ikon: logo varsa onu kullan (iOS apple-touch + genel), yoksa varsayılan.
  const icon = b.logoUrl || '';
  return {
    title: b.name,
    description: apex ? 'Eğitim kurumu yönetim platformu' : 'Etüt takip ve rezervasyon sistemi',
    // Apex'te manifest YOK → "ana ekrana ekle" tam PWA yaratmaz (bkz getIsApex).
    // Subdomain'lerde kuruma özel manifest verilir (tam PWA deneyimi korunur).
    ...(apex ? {} : { manifest: '/api/manifest' }),
    icons: {
      icon: icon || '/icon-192.png',
      apple: icon || '/apple-touch-icon.png',
    },
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

export async function generateViewport() {
  const b = await getBranding();
  return {
    themeColor: b.themeColor,
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  };
}

export default function RootLayout({ children }) {
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
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
