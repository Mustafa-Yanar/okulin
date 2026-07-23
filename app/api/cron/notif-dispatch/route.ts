import { NextResponse } from 'next/server';
import { dispatchDue } from '@/lib/push/outbox';
import { isCronAuthorized } from '@/lib/cron-auth';

// Bildirim outbox retry cron'u — 15 dakikada bir vadesi gelmiş pending
// teslimatları backoff'la yeniden dener. Anında gönderim (enqueue içi hızlı
// yol) çoğu bildirimi halleder; bu cron güvenlik ağıdır (geçici sağlayıcı
// hatası, VAPID/FCM kesintisi).
//
// Bilinçli withAuth istisnası: cron ucu — oturum yok, CRON_SECRET Bearer doğrulanır.

export const runtime = 'nodejs'; // Prisma + web-push Node gerektirir

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await dispatchDue();
  return NextResponse.json({ ok: true, ...result });
}
