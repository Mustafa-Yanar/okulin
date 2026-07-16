import React, { useEffect, useState } from 'react';
import { useSession } from '../store/session';
import { semverLt } from '../semver';
import { LoadingScreen, StatusScreen } from './kit';
import type { BootstrapResponse } from '../api/types';

// Kill-switch kapısı (spec §9/3): kurum host'undan bootstrap çekilir; bakım /
// minimum sürüm / ağ-yok durumları TÜM uygulamayı (login dahil) kapatır.
// Kurum seçilmemişken kapı atlanır (resolve-org apex'te, kill-switch'ten bağımsız).

type GateState = 'checking' | 'ok' | 'offline' | 'maintenance' | 'update';

export function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { org, appVersion, retryBoot } = useSession();
  const [state, setState] = useState<GateState>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // "Yeniden dene": hem bootstrap'i hem oturum /me denemesini tekrarla — offline'da
  // token'lı kullanıcı ağ gelince şifre yazmadan içeri girsin (İnceleme: Gemini 2.1).
  const retry = () => {
    retryBoot();
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (!org) {
      setState('ok');
      return;
    }
    let cancelled = false;
    (async () => {
      setState('checking');
      try {
        const res = await fetch(`https://${org.canonicalHost}/api/mobile/v1/bootstrap`);
        const j = (await res.json()) as BootstrapResponse;
        if (cancelled) return;
        if (j.maintenance?.active) {
          setMessage(j.maintenance.message);
          setState('maintenance');
          return;
        }
        if (semverLt(appVersion, j.minSupportedVersion)) {
          setState('update');
          return;
        }
        setState('ok');
      } catch {
        if (!cancelled) setState('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, appVersion, tick]);

  if (state === 'checking') return <LoadingScreen />;
  if (state === 'maintenance') {
    return (
      <StatusScreen
        title="Bakımdayız"
        message={message || 'okulin kısa bir bakım çalışmasında. Az sonra yeniden deneyin.'}
        actionLabel="Yeniden dene"
        onAction={retry}
      />
    );
  }
  if (state === 'update') {
    return (
      <StatusScreen
        title="Güncelleme gerekli"
        message="Uygulamanın bu sürümü artık desteklenmiyor. Lütfen yeni sürümü yükleyin."
      />
    );
  }
  if (state === 'offline') {
    return (
      <StatusScreen
        title="Bağlantı yok"
        message="Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin."
        actionLabel="Yeniden dene"
        onAction={retry}
      />
    );
  }
  return <>{children}</>;
}
