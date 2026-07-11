'use client';

// PayTR ödeme sonrası iframe İÇİNE yüklenir. Üst pencereye (veli paneli) sonucu
// postMessage ile bildirir → modal kapanır + finans yeniden çekilir. Asıl
// kredilendirme sunucudaki callback'te olur; bu sayfa yalnız UX bildirimi.
import { useEffect, useState } from 'react';

export default function OdemeSonuc() {
  const [status, setStatus] = useState('');

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status') || 'ok';
    setStatus(s);
    try { window.parent?.postMessage({ type: 'paytr-result', status: s }, '*'); } catch {}
  }, []);

  const ok = status !== 'fail';
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: '40px 20px', color: '#374151' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{ok ? '✓' : '✕'}</div>
      <h1 style={{ fontSize: 18, fontWeight: 800, color: ok ? '#16a34a' : '#dc2626', margin: 0 }}>
        {ok ? 'Ödeme alındı' : 'Ödeme tamamlanamadı'}
      </h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
        {ok ? 'Bu pencere otomatik kapanacak.' : 'Tekrar deneyebilirsiniz.'}
      </p>
    </div>
  );
}
