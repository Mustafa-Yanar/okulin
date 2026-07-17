import { useEffect, useRef, useState } from 'react';
import { Stack, router, usePathname, useRootNavigationState } from 'expo-router';
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
  const pathname = usePathname();
  const [pending, setPending] = useState<{ focus: string | null } | null>(null);
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    const accept = (resp: Notifications.NotificationResponse) => {
      const key = `${resp.notification.request.identifier}:${resp.actionIdentifier}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      // Killed-durum FCM tap'inde veri content.data yerine trigger.remoteMessage.data'da
      // gelir (expo-notifications tepsi-teslim farkı — Task 11 cihaz turunda yakalandı;
      // foreground/background'da content.data dolu). İki kaynaktan ilki kazanır.
      const trig = resp.notification.request.trigger as
        | { remoteMessage?: { data?: Record<string, string> | null } }
        | null
        | undefined;
      setPending({
        focus: eventIdFrom(resp.notification.request.content.data) ?? eventIdFrom(trig?.remoteMessage?.data),
      });
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

  // Bekleyen rota, başarı DOĞRULANMADAN silinmez (İnceleme: rootNav?.key dış
  // navigator'ı ölçer — nested Stack Gate 'ok' olana dek mount değildir; erken
  // push expo-router'da sessizce düşer ve pending silinirse tap kaybolurdu).
  // Desen: hedefteysek temizle; değilsek push dene; push düştüyse Stack'in
  // mount/kayıt olması nav-state'i değiştirir → effect yeniden koşar → tekrar dener.
  useEffect(() => {
    if (!pending || status !== 'ready' || !rootNav?.key) return;
    if (pathname === '/bildirimler') {
      setPending(null); // hedefe varıldı (push'umuz ya da kullanıcı zaten oradaydı)
      return;
    }
    router.push(pending.focus ? { pathname: '/bildirimler', params: { focus: pending.focus } } : '/bildirimler');
  }, [pending, status, rootNav, pathname]);

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
