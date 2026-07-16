import { useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../store/session';
import { currentPermission, enablePush, refreshRegistration, watchTokenRotation, type EnableResult, type RegisterBase } from '../push';
import { Screen, Title, Sub, Card, Button, palette } from '../ui/kit';
import { rolEtiketi } from '../rol';

export default function BugunEkrani() {
  const { org, session, api, installationId, appVersion, rotateInstallationId } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [perm, setPerm] = useState<EnableResult | null>(null);

  const base: RegisterBase | null = useMemo(
    () => (installationId ? { installationId, platform: 'android', appVersion } : null),
    [installationId, appVersion],
  );

  // Soğuk açılış: izin varsa sessiz yeniden kayıt + rotasyon dinleyicisi.
  // cancelled bayrağı: async kurulum bitmeden unmount olursa dinleyici sızmasın
  // (İnceleme: Gemini 4.2).
  useEffect(() => {
    if (!api || !base) return;
    let cancelled = false;
    let sub: { remove(): void } | null = null;
    void (async () => {
      setPerm(await currentPermission());
      await refreshRegistration(api, base, rotateInstallationId);
      if (cancelled) return;
      sub = watchTokenRotation(api, base, rotateInstallationId);
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [api, base]);

  // Kullanıcı telefon Ayarları'ndan bildirim iznini değiştirip dönebilir — uygulama
  // ön plana gelince izin durumunu tazele, yeni verilmişse kaydı tamamla
  // (İnceleme: Gemini 4.1).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !api || !base) return;
      void (async () => {
        const p = await currentPermission();
        setPerm(p);
        if (p === 'granted') await refreshRegistration(api, base, rotateInstallationId);
      })();
    });
    return () => sub.remove();
  }, [api, base]);

  async function onEnable() {
    if (!api || !base) return;
    setPerm(await enablePush(api, base, rotateInstallationId));
  }

  return (
    <Screen>
      <View style={s.wrap}>
        <Sub>{org?.name}</Sub>
        <Title>Merhaba{session?.name ? `, ${session.name}` : ''}</Title>
        <Text style={s.role}>{rolEtiketi(session?.role)}</Text>

        {perm !== 'granted' ? (
          <Card>
            <Text style={s.cardTitle}>{perm === 'error' ? 'Bildirim kaydı tamamlanamadı' : 'Bildirimler kapalı'}</Text>
            <Sub>
              {perm === 'denied'
                ? 'Bildirim izni reddedilmiş. Telefon Ayarları → Uygulamalar → okulin → Bildirimler yolundan açabilirsiniz.'
                : perm === 'error'
                  ? 'İzin verildi ama sunucu kaydı yapılamadı. İnternetinizi kontrol edip tekrar deneyin.'
                  : 'Duyuru, yoklama ve ödeme bildirimlerini kaçırmamak için bildirimleri açın.'}
            </Sub>
            {perm !== 'denied' ? (
              <Button label={perm === 'error' ? 'Tekrar dene' : 'Bildirimleri Aç'} onPress={() => void onEnable()} color={brand} />
            ) : null}
          </Card>
        ) : null}

        <Card>
          <Text style={s.cardTitle}>Bugün</Text>
          <Sub>Günün programı ve bekleyen işler yakında burada görünecek.</Sub>
        </Card>
        <Link href="/ayarlar" style={s.link}>
          Ayarlar ve cihazlar →
        </Link>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 24, paddingTop: 32 },
  role: { fontSize: 14, color: palette.sub, marginTop: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: palette.text, marginBottom: 4 },
  link: { marginTop: 16, fontSize: 16, color: palette.brandFallback, fontWeight: '600' },
});
