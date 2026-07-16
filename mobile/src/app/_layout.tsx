import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { SessionProvider } from '../store/session';
import { BootstrapGate } from '../ui/Gate';

// Ön planda da sistem bildirimi göster (banner) — varsayılan davranış sessizce yutar.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  return (
    <SessionProvider>
      <BootstrapGate>
        <Stack screenOptions={{ headerShown: false }} />
      </BootstrapGate>
    </SessionProvider>
  );
}
