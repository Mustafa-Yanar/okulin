import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, Button, ErrorText, palette } from '../ui/kit';
import type { EtutScreenResponse, EtutSlotView } from '../api/types';

// Etüt rezervasyon (spec §5.1 — öğrenci). Bu hafta / gelecek hafta seçilebilir; slot durumuna
// göre rezerve/iptal. Rezervasyon PENCERESİ (Pazar 11:00 TSİ) sunucu-otoriter — istemci
// yalnız data.bookableWeeks.includes(data.weekKey) kıyaslar, kendi hesap yapmaz. İş kuralları
// sunucuda (bookEtut/cancelEtutV2 — lib/etut/booking.ts); ihlalde ApiError mesajı gösterilir.
export default function EtutEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [data, setData] = useState<EtutScreenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // işlemdeki etutId
  const [week, setWeek] = useState<'current' | 'next'>('current');

  // Yarış koruması: hafta seçici hızlı ardışık basılırsa yalnız SON isteğin sonucu uygulanır
  // (eski bir yanıt geç dönerse state'i geçersiz haftayla ezmesin).
  const reqIdRef = useRef(0);

  const load = useCallback(async (target?: string) => {
    if (!api) return;
    const reqId = ++reqIdRef.current;
    setError(null);
    try {
      const q = target ? `?week=${target}` : '';
      const res = await api.get<EtutScreenResponse>(`/api/mobile/v1/etut${q}`);
      if (reqIdRef.current === reqId) setData(res);
    } catch (e) {
      if (reqIdRef.current === reqId) {
        setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Etütler yüklenemedi. İnternetinizi kontrol edin.');
      }
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); setWeek('current'); }, [load]));

  const switchWeek = (w: 'current' | 'next') => {
    if (!data) return; // hafta anahtarları henüz bilinmiyor (ilk yükleme sürüyor)
    setWeek(w);
    void load(w === 'next' ? data.nextWeekKey : data.currentWeekKey);
  };

  // Eski sunucu (bookableWeeks alanı yok) karşısında çökmesin: dizi yoksa sunucunun kararına
  // güven (buton kapatılmaz) — bookEtut/cancelEtutV2 zaten pencereyi sunucu tarafında uygular.
  const canBook = !!data && (!Array.isArray(data.bookableWeeks) || data.bookableWeeks.includes(data.weekKey));

  const reserve = useCallback(async (slot: EtutSlotView, branch: string) => {
    if (!api || busy) return;
    setBusy(slot.etutId);
    setError(null);
    try {
      await api.post('/api/mobile/v1/etut/reserve', { teacherId: slot.teacherId, etutId: slot.etutId, branch, weekKey: data?.weekKey });
      await load(data?.weekKey);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Rezervasyon yapılamadı.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, load, data]);

  const cancel = useCallback(async (slot: EtutSlotView) => {
    if (!api || busy) return;
    setBusy(slot.etutId);
    setError(null);
    try {
      await api.del('/api/mobile/v1/etut/reserve', { teacherId: slot.teacherId, etutId: slot.etutId, weekKey: data?.weekKey });
      await load(data?.weekKey);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İptal edilemedi.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, load, data]);

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
        <Sub>Uygun etütleri gör; grubuna ve dersine uygun bir etüt seçebilirsin.</Sub>
        <View style={st.segment}>
          {(['current', 'next'] as const).map((w) => (
            <Button
              key={w}
              label={w === 'current' ? 'Bu hafta' : 'Gelecek hafta'}
              onPress={() => switchWeek(w)}
              disabled={!data}
              variant={week === w ? undefined : 'ghost'}
              color={brand}
            />
          ))}
        </View>
        {week === 'next' && data && !canBook ? (
          <Sub>Gelecek haftanın rezervasyonu Pazar 11:00'de açılır — şimdilik sadece görüntüleme.</Sub>
        ) : null}
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
                ) : !canBook ? (
                  <Text style={st.status}>Rezervasyon kapalı</Text>
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
  segment: { flexDirection: 'row', gap: 8, marginTop: 12 },
  day: { fontSize: 14, fontWeight: '700', color: palette.sub, marginTop: 20, textTransform: 'uppercase' },
  time: { fontSize: 15, fontWeight: '700', color: palette.text },
  status: { fontSize: 14, color: palette.sub, marginTop: 8 },
});
