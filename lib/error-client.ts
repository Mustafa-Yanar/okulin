'use client';

// İstemci tarafı hata raporlayıcı — /api/log'a fire-and-forget POST.
// Asla throw etmez (raporlama hatası uygulamayı bozmamalı).
// Spam koruması: aynı mesaj kısa sürede tekrar gönderilmez + oturum başına üst sınır.

const seen = new Map<string, number>(); // message -> son gönderim zamanı (ms)
const DEDUPE_MS = 30_000;      // aynı hatayı 30 sn içinde tekrar gönderme
let sentCount = 0;
const MAX_PER_SESSION = 50;    // sekme ömrü boyunca en fazla 50 rapor

export interface ErrorReport {
  message?: unknown;
  stack?: unknown;
  source?: string;
  componentStack?: unknown;
}

export function reportError({ message, stack, source = 'manual', componentStack }: ErrorReport = {}): void {
  try {
    if (!message || typeof message !== 'string') return;
    if (sentCount >= MAX_PER_SESSION) return;

    const now = Date.now();
    const last = seen.get(message);
    if (last && now - last < DEDUPE_MS) return;
    seen.set(message, now);
    sentCount++;

    const body = JSON.stringify({
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : undefined,
      source,
      url: typeof window !== 'undefined' ? window.location.pathname : undefined,
      componentStack: componentStack ? String(componentStack).slice(0, 8000) : undefined,
    });

    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body,
      keepalive: true, // sayfa kapanırken bile gönderilebilsin
    }).catch(() => {});
  } catch {
    // sessizce yut
  }
}
