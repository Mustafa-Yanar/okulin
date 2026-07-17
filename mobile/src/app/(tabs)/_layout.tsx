import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../../store/session';
import { useUnreadBadge } from '../../store/badge';
import { LoadingScreen, palette } from '../../ui/kit';

// Ana sekmeler (spec §5.1): Bugün · Bildirimler · Ayarlar. Giriş/kurum/WebView/QR
// ekranları kök Stack'te kalır. Rozet: okunmamış bildirim (badge store).
// Rota guard'ı (İnceleme Codex #9): sekmelere deep link ile oturumsuz gelinirse
// index yönlendirmesine döner — ekranlar api'siz boş durumda takılı kalmaz.
export default function TabsLayout() {
  const { org, status } = useSession();
  const { unread } = useUnreadBadge();
  const brand = org?.themeColor || palette.brandFallback;
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'ready') return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: brand }}>
      <Tabs.Screen
        name="bugun"
        options={{
          title: 'Bugün',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bildirimler"
        options={{
          title: 'Bildirimler',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="ayarlar"
        options={{
          title: 'Ayarlar',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
