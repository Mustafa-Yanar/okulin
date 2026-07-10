'use client';

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { isPushSupported, getPushState, subscribeToPush, unsubscribeFromPush } from '@/lib/push-client';

interface NotificationButtonProps {
  showToast: (msg: string, type?: string) => void;
}

// Header'da bildirim aç/kapat butonu. Tüm roller kullanabilir.
// Kapalı: BellOff (gri). Açık: Bell (indigo). İşlem sırasında: pulse.
export default function NotificationButton({ showToast }: NotificationButtonProps) {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isPushSupported()) { setSupported(false); return; }
      try {
        const state = await getPushState();
        setSubscribed(state.subscribed);
      } catch {}
    })();
  }, []);

  if (!supported) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
        showToast('Bildirimler kapatıldı');
      } else {
        await subscribeToPush();
        setSubscribed(true);
        showToast('Bildirimler açıldı');
      }
    } catch (err) {
      showToast((err instanceof Error && err.message) || 'Bildirim işlemi başarısız', 'error');
    } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? BellRing : subscribed ? Bell : BellOff;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={subscribed ? 'Bildirimler açık — kapatmak için tıkla' : 'Bildirimleri aç'}
      className={`btn-ghost !px-3 !py-2 ${busy ? 'animate-pulse' : ''}`}
    >
      <Icon size={14} className={subscribed ? 'text-indigo-500' : 'text-gray-400'} />
    </button>
  );
}
