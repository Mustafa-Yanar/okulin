import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { Screen, Title, Sub, Button, Card, palette } from '../ui/kit';
import { rolEtiketi } from '../rol';
import type { DevicesResponse, DeviceView } from '../api/types';

// Ayarlar: profil özeti + cihaz oturumları (listele / tek tek iptal / tümünden
// çıkış — spec §7) + çıkış + kurumdan ayrıl.
// useFocusEffect: Stack'te ekran unmount olmaz — her öne gelişte liste tazelenir
// (İnceleme: Gemini 3.2). ScrollView: küçük ekranlarda alttaki butonlar taşmasın
// (İnceleme: Gemini 3.3); cihaz sayısı küçük olduğundan FlatList yerine map yeterli.
export default function AyarlarEkrani() {
  const { org, session, api, logout, leaveOrg } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [devices, setDevices] = useState<DeviceView[] | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const r = await api.get<DevicesResponse>('/api/mobile/v1/auth/devices');
      setDevices(r.devices);
    } catch {
      setDevices([]);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function revoke(d: DeviceView) {
    if (!api) return;
    await api.del('/api/mobile/v1/auth/devices', { sessionId: d.id }).catch(() => {});
    await load();
  }

  function confirmAllOut() {
    Alert.alert('Tüm cihazlardan çıkış', 'Bu hesabın tüm cihazlardaki oturumları kapatılacak.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Çıkış yap',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await api?.del('/api/mobile/v1/auth/devices', { all: true }).catch(() => {});
            // Sunucu oturumları + push bağları az önce topluca kapandı → yalnız yerel
            // temizlik (İnceleme Gemini 2.5: ölü oturumla logout 401 gürültüsü üretir).
            await logout(true);
            router.replace('/giris');
          })();
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView style={s.wrap} contentContainerStyle={s.content}>
        <Title>Ayarlar</Title>
        <Card>
          <Text style={s.name}>{session?.name}</Text>
          <Sub>
            {org?.name} · {rolEtiketi(session?.role)}
          </Sub>
        </Card>
        <Text style={s.section}>Cihazlar</Text>
        {devices === null ? <Sub>Yükleniyor…</Sub> : null}
        {devices?.length === 0 ? <Sub>Kayıtlı cihaz oturumu yok.</Sub> : null}
        {(devices ?? []).map((item) => (
          <Card key={item.id}>
            <Text style={s.name}>
              {item.deviceName || item.platform || 'Cihaz'}
              {item.current ? ' (bu cihaz)' : ''}
            </Text>
            <Sub>Son kullanım: {new Date(item.lastUsedAt).toLocaleString('tr-TR')}</Sub>
            {!item.current ? <Button label="Oturumu kapat" onPress={() => void revoke(item)} variant="danger" /> : null}
          </Card>
        ))}
        <Button label="Tüm cihazlardan çıkış" onPress={confirmAllOut} variant="danger" />
        <Button
          label="Çıkış yap"
          onPress={() => {
            void logout().then(() => router.replace('/giris'));
          }}
          color={brand}
        />
        <Button label="Kurumdan ayrıl" onPress={() => void leaveOrg().then(() => router.replace('/kurum'))} color={brand} variant="ghost" />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  name: { fontSize: 16, fontWeight: '600', color: palette.text },
  section: { fontSize: 14, fontWeight: '700', color: palette.sub, marginTop: 20, textTransform: 'uppercase' },
});
