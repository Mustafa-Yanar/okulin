import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, Button, ErrorText, palette } from '../ui/kit';
import type { EtutScreenResponse, EtutSlotView } from '../api/types';

// Etüt rezervasyon (spec §5.1 — öğrenci). Bu haftanın uygun etütleri; slot durumuna
// göre rezerve/iptal. İş kuralları sunucuda (reserveEtut); ihlalde ApiError mesajı gösterilir.
export default function EtutEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [data, setData] = useState<EtutScreenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // işlemdeki etutId

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      setData(await api.get<EtutScreenResponse>('/api/mobile/v1/etut'));
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Etütler yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const reserve = useCallback(async (slot: EtutSlotView, branch: string) => {
    if (!api || busy) return;
    setBusy(slot.etutId);
    setError(null);
    try {
      await api.post('/api/mobile/v1/etut/reserve', { teacherId: slot.teacherId, etutId: slot.etutId, branch, weekKey: data?.weekKey });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Rezervasyon yapılamadı.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, load]);

  const cancel = useCallback(async (slot: EtutSlotView) => {
    if (!api || busy) return;
    setBusy(slot.etutId);
    setError(null);
    try {
      await api.del('/api/mobile/v1/etut/reserve', { teacherId: slot.teacherId, etutId: slot.etutId });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İptal edilemedi.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, load]);

  // Güne göre grupla (slots zaten gün+saat sıralı geliyor).
  const byDay: { dayLabel: string; slots: EtutSlotView[] }[] = [];
  for (const s of data?.slots ?? []) {
    const last = byDay[byDay.length - 1];
    if (last && last.dayLabel === s.dayLabel) last.slots.push(s);
    else byDay.push({ dayLabel: s.dayLabel, slots: [s] });
  }

  return (
    <Screen>
      <ScrollView style={st.wrap} contentContainerStyle={st.content}>
        <Title>Etüt rezervasyonu</Title>
        <Sub>Bu haftanın uygun etütleri. Grubuna ve dersine uygun bir etüt seçebilirsin.</Sub>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!data && !error ? <Sub>Yükleniyor…</Sub> : null}
        {data && byDay.length === 0 ? <Sub>Bu hafta rezerve edilebilir etüt yok.</Sub> : null}
        {byDay.map((day) => (
          <View key={day.dayLabel}>
            <Text style={st.day}>{day.dayLabel}</Text>
            {day.slots.map((slot) => (
              <Card key={`${slot.teacherId}-${slot.etutId}`}>
                <Text style={st.time}>{`${slot.start}–${slot.end}`}</Text>
                <Sub>{slot.teacherName}</Sub>
                {slot.mine ? (
                  <View>
                    <Text style={[st.status, { color: brand, fontWeight: '700' }]}>
                      Rezerve edildi{slot.branch ? ` — ${slot.branch}` : ''}
                    </Text>
                    <Button label={busy === slot.etutId ? 'İşleniyor…' : 'İptal et'} onPress={() => void cancel(slot)} disabled={busy === slot.etutId} variant="danger" />
                  </View>
                ) : slot.booked ? (
                  <Text style={st.status}>Dolu</Text>
                ) : slot.branches.length === 0 ? (
                  <Text style={st.status}>Bu etüt için uygun dersin yok.</Text>
                ) : slot.branches.length === 1 ? (
                  <Button label={busy === slot.etutId ? 'İşleniyor…' : `Rezerve et — ${slot.branches[0]}`} onPress={() => void reserve(slot, slot.branches[0])} disabled={busy === slot.etutId} color={brand} />
                ) : (
                  <View>
                    <Sub>Ders seç:</Sub>
                    {slot.branches.map((b) => (
                      <Button key={b} label={busy === slot.etutId ? 'İşleniyor…' : b} onPress={() => void reserve(slot, b)} disabled={busy === slot.etutId} color={brand} variant="ghost" />
                    ))}
                  </View>
                )}
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  day: { fontSize: 14, fontWeight: '700', color: palette.sub, marginTop: 20, textTransform: 'uppercase' },
  time: { fontSize: 15, fontWeight: '700', color: palette.text },
  status: { fontSize: 14, color: palette.sub, marginTop: 8 },
});
