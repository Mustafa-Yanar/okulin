// Tarayıcı tarafı Web Push yardımcıları. Yalnız client'ta çağrılmalı.

// VAPID public key (base64url) → Uint8Array (applicationServerKey için)
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface PushState {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}

// Push destekleniyor mu?
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Mevcut durum: { supported, permission, subscribed }
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: !!sub,
  };
}

// Bildirim izni iste + abone ol + sunucuya kaydet. Dönüş: true/false
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) throw new Error('Tarayıcınız bildirimleri desteklemiyor');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Bildirim izni verilmedi');
  }

  // VAPID public key'i sunucudan al
  const res = await fetch('/api/push', { credentials: 'same-origin' });
  const { publicKey } = await res.json();
  if (!publicKey) throw new Error('Sunucu bildirim anahtarı tanımlı değil');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const save = await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON() }),
  });
  if (!save.ok) throw new Error('Abonelik kaydedilemedi');
  return true;
}

// Aboneliği iptal et (hem tarayıcıdan hem sunucudan).
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'unsubscribe', endpoint }),
  });
  return true;
}
