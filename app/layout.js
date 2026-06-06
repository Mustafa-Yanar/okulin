import './globals.css';
import { cache } from 'react';
import { headers } from 'next/headers';
import redis from '@/lib/redis';
import { DEFAULT_ORG, isApexHost, PLATFORM_BRANDING } from '@/lib/org';
import { normalizeBranding } from '@/lib/branding';

// İstek başına bir kez okunur (React cache dedupe) — metadata + viewport aynı çağrıyı paylaşır.
const getBranding = cache(async () => {
  try {
    // Apex (okulin.com) → platform markası (kurum değil → tanıtım sayfası).
    if (isApexHost(headers().get('host'))) return PLATFORM_BRANDING;
    const org = headers().get('x-org') || DEFAULT_ORG;
    const rec = await redis.get(`org:${org}`);
    return normalizeBranding(rec);
  } catch {
    return normalizeBranding(null);
  }
});

export async function generateMetadata() {
  const b = await getBranding();
  // Kuruma özel ikon: logo varsa onu kullan (iOS apple-touch + genel), yoksa varsayılan.
  const icon = b.logoUrl || '';
  return {
    title: b.name,
    description: 'Etüt takip ve rezervasyon sistemi',
    manifest: '/api/manifest',
    icons: {
      icon: icon || '/icon-192.png',
      apple: icon || '/apple-touch-icon.png',
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: b.shortName,
    },
    other: {
      'mobile-web-app-capable': 'yes',
    },
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
  return (
    <html lang="tr">
      <head>
        {/* Tema FOUC önleyici — ilk boyamadan önce dark class'ı uygular */}
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`
        }} />
        <script dangerouslySetInnerHTML={{
          __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js')); }`
        }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
