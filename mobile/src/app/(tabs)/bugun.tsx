import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSession } from '../../store/session';
import { useUnreadBadge } from '../../store/badge';
import { ApiError } from '../../api/client';
import {
  currentPermission, enablePush, refreshRegistration, watchTokenRotation,
  type EnableResult, type RegisterBase,
} from '../../push';
import { Screen, Title, Sub, Card, Button, ErrorText, palette } from '../../ui/kit';
import { StudentTodayView, ParentTodayView, TeacherTodayView, ManagementTodayView } from '../../ui/today';
import { rolEtiketi } from '../../rol';
import type { TodayResponse } from '../../api/types';

export default function BugunEkrani() {
  const { org, session, api, installationId, appVersion, rotateInstallationId } = useSession();
  const { setUnread } = useUnreadBadge();
  const brand = org?.themeColor || palette.brandFallback;
  const [perm, setPerm] = useState<EnableResult | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const base: RegisterBase | null = useMemo(
    () => (installationId ? { installationId, platform: 'android', appVersion } : null),
    [installationId, appVersion],
  );

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const q = childId ? `?child=${encodeURIComponent(childId)}` : '';
      const r = await api.get<TodayResponse>(`/api/mobile/v1/screens/today${q}`);
      setToday(r);
      setUnread(r.unreadNotifications);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Bugün yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api, childId, setUnread]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Soğuk açılış: izin varsa sessiz yeniden kayıt + rotasyon dinleyicisi (Plan 3 — aynen).
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

  // Ayarlar'dan izin değişimi: ön plana dönüşte tazele (Plan 3 — aynen).
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
      <ScrollView
        style={s.wrap}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[brand]} />}
      >
        <Sub>{org?.name}</Sub>
        <Title>Merhaba{session?.name ? `, ${session.name}` : ''}</Title>
        <Text style={s.role}>
          {rolEtiketi(session?.role)}
          {today ? ` · ${today.dayLabel}` : ''}
        </Text>

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

        {error ? <ErrorText>{error}</ErrorText> : null}
        {!today && !error ? <Sub>Yükleniyor…</Sub> : null}
        {today?.role === 'student' ? <StudentTodayView data={today} /> : null}
        {today?.role === 'parent' ? <ParentTodayView data={today} brand={brand} onSelectChild={setChildId} /> : null}
        {today?.role === 'teacher' ? <TeacherTodayView data={today} /> : null}
        {today?.role === 'management' ? <ManagementTodayView brand={brand} /> : null}

        {today && today.role !== 'management' ? (
          <Card>
            <Text style={s.cardTitle}>Hızlı erişim</Text>
            {/* PLAN5-QUICKLINKS: sonraki task'lar buraya buton ekler */}
            {today.role === 'student' || today.role === 'parent' || today.role === 'teacher' ? (
              <Button label="Haftalık program" onPress={() => router.push('/hafta')} color={brand} variant="ghost" />
            ) : null}
            {today.role === 'student' ? (
              <Button label="Etüt al / görüntüle" onPress={() => router.push('/etut')} color={brand} variant="ghost" />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  role: { fontSize: 14, color: palette.sub, marginTop: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: palette.text, marginBottom: 4 },
});
