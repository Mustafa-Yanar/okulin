import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  savePushSubscription,
  removePushSubscription,
  sendPushToUser,
  getSubscriptionCount,
} from '@/lib/push';

// web-push Node crypto kullanır → Node runtime şart (edge değil)
export const runtime = 'nodejs';

// GET /api/push → VAPID public key + bu kullanıcının kayıtlı cihaz sayısı
export async function GET() {
  const session = await getSession();
  const publicKey = process.env.VAPID_PUBLIC_KEY || null;
  let deviceCount = 0;
  if (session) {
    deviceCount = await getSubscriptionCount(session.role, session.id);
  }
  return NextResponse.json({ publicKey, deviceCount });
}

// POST /api/push
//   { action:'subscribe', subscription }   → bu cihazı kaydet
//   { action:'unsubscribe', endpoint }     → bu cihazı kaldır
//   { action:'test' }                      → kendine test bildirimi gönder
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === 'subscribe') {
    if (!body.subscription?.endpoint) {
      return NextResponse.json({ error: 'Geçersiz abonelik' }, { status: 400 });
    }
    await savePushSubscription(session.role, session.id, body.subscription);
    return NextResponse.json({ ok: true });
  }

  if (action === 'unsubscribe') {
    if (!body.endpoint) {
      return NextResponse.json({ error: 'endpoint gerekli' }, { status: 400 });
    }
    await removePushSubscription(session.role, session.id, body.endpoint);
    return NextResponse.json({ ok: true });
  }

  if (action === 'test') {
    const result = await sendPushToUser(session.role, session.id, {
      title: 'Test bildirimi',
      body: 'Bildirimler çalışıyor. Bu bir test mesajıdır.',
      url: '/',
      tag: 'test',
    });
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}
