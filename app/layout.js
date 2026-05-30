import './globals.css';
import { cache } from 'react';
import { headers } from 'next/headers';
import redis from '@/lib/redis';
import { DEFAULT_ORG } from '@/lib/org';
import { normalizeBranding } from '@/lib/branding';

// İstek başına bir kez okunur (React cache dedupe) — metadata + viewport aynı çağrıyı paylaşır.
const getBranding = cache(async () => {
  try {
    const org = headers().get('x-org') || DEFAULT_ORG;
    const rec = await redis.get(`org:${org}`);
    return normalizeBranding(rec);
  } catch {
    return normalizeBranding(null);
  }
});

export async function generateMetadata() {
  const b = await getBranding();
  return {
    title: b.name,
    description: 'Etüt takip ve rezervasyon sistemi',
    manifest: '/manifest.json',
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
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <script dangerouslySetInnerHTML={{
          __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js')); }`
        }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
