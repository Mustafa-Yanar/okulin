import { NextResponse } from 'next/server';
import { getSession, withAuth } from '@/lib/auth';
import {
  savePushSubscription,
  removePushSubscription,
  sendPushToUser,
  getSubscriptionCount,
} from '@/lib/push';

// web-push Node crypto kullanır → Node runtime şart (edge değil)
export const runtime = 'nodejs';

// GET /api/push → VAPID public key + bu kullanıcının kayıtlı cihaz sayısı
// Bilinçli withAuth istisnası: public key oturumsuz da okunabilir (subscribe akışı öncesi).
export async function GET() {
  const session = await getSession();
  const publicKey = process.env.VAPID_PUBLIC_KEY || null;
  let deviceCount = 0;
  if (session) {
    deviceCount = await getSubscriptionCount(session.role, session.id || '');
  }
  return NextResponse.json({ publicKey, deviceCount });
}

// POST /api/push
//   { action:'subscribe', subscription }   → bu cihazı kaydet
//   { action:'unsubscribe', endpoint }     → bu cihazı kaldır
//   { action:'test' }                      → kendine test bildirimi gönder
export const POST = withAuth(async (req, _ctx, session) => {
  const body: { action?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; endpoint?: string } = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === 'subscribe') {
    if (!body.subscription?.endpoint) {
      return NextResponse.json({ error: 'Geçersiz abonelik' }, { status: 400 });
    }
    await savePushSubscription(session.role, session.id || '', body.subscription);
    return NextResponse.json({ ok: true });
  }

  if (action === 'unsubscribe') {
    if (!body.endpoint) {
      return NextResponse.json({ error: 'endpoint gerekli' }, { status: 400 });
    }
    await removePushSubscription(session.role, session.id || '', body.endpoint);
    return NextResponse.json({ ok: true });
  }

  if (action === 'test') {
    const result = await sendPushToUser(session.role, session.id || '', {
      title: 'Test bildirimi',
      body: 'Bildirimler çalışıyor. Bu bir test mesajıdır.',
      url: '/',
      tag: 'test',
    });
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
});
