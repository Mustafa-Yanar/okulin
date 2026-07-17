import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../store/session';
import { semverLt } from '../semver';
import { fetchWithTimeout, BOOT_TIMEOUT_MS } from '../api/http';
import { LoadingScreen, StatusScreen } from './kit';
import type { BootstrapResponse } from '../api/types';

// Kill-switch kapısı (spec §9/3): kurum host'undan bootstrap çekilir; bakım /
// minimum sürüm / kurum-pasif / ağ-yok durumları TÜM uygulamayı (login dahil) kapatır.
// Kurum seçilmemişken kapı atlanır (resolve-org apex'te, kill-switch'ten bağımsız).
// Plan 4 borç kapanışı: (a) fetch 10 sn timeout; (b) uygulama ön plana gelince
// SESSİZ yeniden kontrol (60 sn throttle) — bakım açıldıysa açık uygulama da yakalar.
// Sessiz mod YALNIZ daha önce 'ok' geçmiş host'ta geçerlidir (İnceleme Codex #7):
// kurum değişiminde ilk kontrol tam kontroldür, hatası fail-closed 'offline'a düşer.

type GateState = 'checking' | 'ok' | 'offline' | 'maintenance' | 'update' | 'inactive';
const RECHECK_MIN_MS = 60_000;

export function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { org, appVersion, retryBoot } = useSession();
  const [state, setState] = useState<GateState>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastCheckAt = useRef(0);
  const lastOkHost = useRef<string | null>(null); // son BAŞARIYLA geçen canonicalHost

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
    const silent = lastOkHost.current === org.canonicalHost;
    let cancelled = false;
    (async () => {
      // Sessiz yeniden kontrol: daha önce geçmiş host'ta 'ok' ekranı checking'e
      // DÜŞÜRÜLMEZ (çocuklar unmount olmasın); sorun bulunursa duruma geçilir.
      setState((s) => (silent && s === 'ok' ? s : 'checking'));
      try {
        const res = await fetchWithTimeout(fetch, `https://${org.canonicalHost}/api/mobile/v1/bootstrap`, {}, BOOT_TIMEOUT_MS);
        if (!res.ok) throw new Error(`bootstrap ${res.status}`); // 5xx/4xx → offline yolu (fail-closed)
        const j = (await res.json()) as BootstrapResponse;
        if (cancelled) return;
        lastCheckAt.current = Date.now();
        if (j.maintenance?.active) {
          setMessage(j.maintenance.message);
          setState('maintenance');
          return;
        }
        if (j.org && j.org.active === false) {
          setState('inactive'); // kurum pasif (spec §6/7 kenar durumu)
          return;
        }
        if (semverLt(appVersion, j.minSupportedVersion)) {
          setState('update');
          return;
        }
        lastOkHost.current = org.canonicalHost;
        setState('ok');
      } catch {
        // Sessiz kontrolde ağ hatası 'ok' ekranını DÜŞÜRMEZ (uygulama offline
        // durumunu istek düzeyinde zaten gösterir); ilk yükleme/kurum değişiminde
        // fail-closed offline.
        if (!cancelled) setState((s) => (silent && s === 'ok' ? s : 'offline'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, appVersion, tick]);

  // Ön plana dönüşte kill-switch'i tazele (60 sn throttle) — Plan 3 borcu.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !org) return;
      if (Date.now() - lastCheckAt.current < RECHECK_MIN_MS) return;
      setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, [org]);

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
  if (state === 'inactive') {
    return (
      <StatusScreen
        title="Kurum aktif değil"
        message="Bu kurumun okulin hizmeti şu anda aktif görünmüyor. Kurumunuzla iletişime geçin."
        actionLabel="Yeniden dene"
        onAction={retry}
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
