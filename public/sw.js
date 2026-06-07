// okulin Service Worker — Web Push + temel offline fallback.
// v2 (2026-05): push + notificationclick handler'ları eklendi.

const SW_VERSION = 'v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Push bildirimi geldiğinde ──
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // düz metin geldiyse
    data = { title: 'Akyazı Çözüm', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Akyazı Çözüm Özel Öğretim Kursu';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,        // aynı tag → bildirim üst üste yığılmaz
    data: { url: data.url || '/' },    // tıklanınca açılacak adres
    requireInteraction: !!data.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Bildirime tıklanınca ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Açık bir sekme varsa ona odaklan
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      // Yoksa yeni sekme aç
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Temel offline fallback (yalnız GET; ağ önce, hata olursa cache) ──
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
