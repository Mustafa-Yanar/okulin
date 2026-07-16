import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '../config';
import { SessionProvider } from '../store/session';
import { BootstrapGate } from '../ui/Gate';

// Crash raporlama (spec §17, 3/3 karar): EU/Frankfurt, PII kapalı, replay YOK,
// dev'de kapalı. Kullanıcı kimliği Sentry'ye GÖNDERİLMEZ (takma adlı ID gerekirse
// Plan 4'te ayrıca değerlendirilir).
Sentry.init({
  dsn: SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  enabled: !__DEV__, // dev gürültüsü gitmez; kurulum 2026-07-17'de canlı olayla doğrulandı
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

function RootLayout() {
  return (
    <SessionProvider>
      <BootstrapGate>
        <Stack screenOptions={{ headerShown: false }} />
      </BootstrapGate>
    </SessionProvider>
  );
}

export default Sentry.wrap(RootLayout);
