import { useEffect, useRef, useState } from 'react';
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '../config';
import { SessionProvider, useSession } from '../store/session';
import { UnreadBadgeProvider } from '../store/badge';
import { BootstrapGate } from '../ui/Gate';
import { eventIdFrom } from '../notification-routing';

// Crash raporlama (spec §17, 3/3 karar): EU/Frankfurt, PII kapalı, replay YOK,
// dev'de kapalı. Kullanıcı kimliği Sentry'ye GÖNDERİLMEZ.
Sentry.init({
  dsn: SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  enabled: !__DEV__,
});

// Ön planda da sistem bildirimi göster (banner) — varsayılan davranış sessizce yutar.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Push tap yönlendirmesi (spec §6/6): foreground/background tap listener + killed
// (soğuk açılış) son yanıt. Oturum hazır değilse BEKLEYEN ROTA — login/kurum akışı
// bitince uygulanır. Dedupe (İnceleme Codex #14): soğuk açılışta getLastNotification-
// ResponseAsync ile canlı listener AYNI yanıtı yarışabilir — identifier set'i tek
// işlenmeyi garantiler (clearLast... ayrıca sonraki açılışlara sızmayı keser).
function NotificationRouter() {
  const { status } = useSession();
  // Navigator mount olmadan router.push atılmaz (İnceleme Gemini #2: Gate 'checking'
  // iken status 'ready' olabilir — Stack henüz ekranda değilken push çökerdi).
  const rootNav = useRootNavigationState();
  const [pending, setPending] = useState<{ focus: string | null } | null>(null);
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    const accept = (resp: Notifications.NotificationResponse) => {
      const key = `${resp.notification.request.identifier}:${resp.actionIdentifier}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      setPending({ focus: eventIdFrom(resp.notification.request.content.data) });
    };
    let mounted = true;
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (!mounted || !resp) return;
      accept(resp);
      void Notifications.clearLastNotificationResponseAsync();
    });
    const sub = Notifications.addNotificationResponseReceivedListener(accept);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!pending || status !== 'ready') return; // login/kurum bekleniyor — rota bekler
    if (!rootNav?.key) return; // Stack henüz mount olmadı (Gate checking) — bekle
    router.push(pending.focus ? { pathname: '/bildirimler', params: { focus: pending.focus } } : '/bildirimler');
    setPending(null);
  }, [pending, status, rootNav?.key]);

  return null;
}

function RootLayout() {
  return (
    <SessionProvider>
      <UnreadBadgeProvider>
        <NotificationRouter />
        <BootstrapGate>
          <Stack screenOptions={{ headerShown: false }} />
        </BootstrapGate>
      </UnreadBadgeProvider>
    </SessionProvider>
  );
}

export default Sentry.wrap(RootLayout);
