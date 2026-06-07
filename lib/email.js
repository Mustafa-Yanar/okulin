import { Resend } from 'resend';

// Resend ile e-posta gönderimi (transactional, HTTP API — kendi mail sunucusu YOK).
// RESEND_API_KEY tanımlı değilse sessizce no-op döner → build/deploy ve mevcut
// akışlar kırılmaz (anahtar Vercel env'inde tanımlanınca otomatik aktifleşir).
//
// Env:
//   RESEND_API_KEY  — Resend panelinden alınan API anahtarı (zorunlu, yoksa atlanır)
//   EMAIL_FROM      — gönderen (varsayılan: Resend test adresi onboarding@resend.dev)

let _client;
function client() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

// Tek bir e-posta gönder. Hata fırlatmaz — { id } | { skipped } | { error } döner.
export async function sendEmail({ to, subject, html, text, replyTo }) {
  const c = client();
  if (!c) {
    console.warn('[email] RESEND_API_KEY tanımlı değil — e-posta atlandı.');
    return { skipped: true };
  }
  const from = process.env.EMAIL_FROM || 'okulin <onboarding@resend.dev>';
  try {
    const { data, error } = await c.emails.send({
      from, to, subject, html, text,
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) {
      console.error('[email] gönderim hatası:', error);
      return { error };
    }
    return { id: data?.id };
  } catch (e) {
    console.error('[email] beklenmeyen hata:', e);
    return { error: e };
  }
}
