import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, ErrorText, palette } from '../ui/kit';
import type { NotifPrefsResponse, NotifPrefUpdateResponse, NotifPrefItem } from '../api/types';

// Bildirim kategori tercihleri (spec §5.1). Kapalı kategori PUSH almaz; bildirim yine
// inbox'ta görünür. Güvenlik kategorisi listede yok (susturulamaz — sunucu zorlar).
export default function BildirimTercihleriEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [items, setItems] = useState<NotifPrefItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      setItems((await api.get<NotifPrefsResponse>('/api/mobile/v1/notification-prefs')).items);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Tercihler yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggle = useCallback(async (item: NotifPrefItem, enabled: boolean) => {
    if (!api || busy) return;
    setBusy(item.category);
    setItems((prev) => (prev ?? []).map((x) => (x.category === item.category ? { ...x, enabled } : x))); // iyimser
    try {
      const r = await api.post<NotifPrefUpdateResponse>('/api/mobile/v1/notification-prefs', { category: item.category, enabled });
      setItems(r.items);
    } catch (e) {
      setItems((prev) => (prev ?? []).map((x) => (x.category === item.category ? { ...x, enabled: !enabled } : x))); // geri al
      setError(e instanceof ApiError ? e.message : 'Tercih kaydedilemedi.');
    } finally {
      setBusy(null);
    }
  }, [api, busy]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content}>
        <Title>Bildirim tercihleri</Title>
        <Sub>Kapattığınız kategorilerde push bildirimi almazsınız; bildirimler yine uygulama içinde (Bildirimler sekmesi) görünür. Güvenlik bildirimleri her zaman açıktır.</Sub>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!items ? <Sub>Yükleniyor…</Sub> : null}
        {(items ?? []).map((item) => (
          <Card key={item.category}>
            <View style={st.row}>
              <Text style={st.label}>{item.label}</Text>
              <Switch value={item.enabled} onValueChange={(v) => void toggle(item, v)} disabled={busy === item.category} trackColor={{ true: brand, false: palette.line }} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '600', color: palette.text, flex: 1, marginRight: 12 },
});
