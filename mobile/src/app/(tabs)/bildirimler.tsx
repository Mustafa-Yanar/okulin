import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../store/session';
import { useUnreadBadge } from '../../store/badge';
import { Screen, Title, Sub, Button, ErrorText, palette } from '../../ui/kit';
import { roleCategoryOf } from '../../rol';
import { targetForUrl } from '../../notification-routing';
import type { InboxItem, InboxListResponse, InboxReadResponse } from '../../api/types';

// Bildirim merkezi (spec §8): NotificationEvent inbox'u. Kilit ekranı metni
// jenerikleşse bile TAM içerik burada görünür (jenerikleştirme yalnız push'a
// uygulanır — sunucu renderPush). Tap → okundu; focus paramı (push tap
// yönlendirmesi) ilgili bildirimi okundu işaretleyip vurgular.
export default function BildirimlerEkrani() {
  const { api, org, session } = useSession();
  const { setUnread } = useUnreadBadge();
  const brand = org?.themeColor || palette.brandFallback;
  const params = useLocalSearchParams<{ focus?: string }>();
  const focus = typeof params.focus === 'string' ? params.focus : null;
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Push tap'i eski sayfada kalmış bir event'i işaret edebilir — tek-kayıt modundan
  // çekilip üstte gösterilir (İnceleme Codex #8).
  const [focusItem, setFocusItem] = useState<InboxItem | null>(null);
  const processedFocus = useRef<string | null>(null);

  const applyCounts = useCallback(
    (n: number) => {
      setUnreadCount(n);
      setUnread(n);
    },
    [setUnread],
  );

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const r = await api.get<InboxListResponse>('/api/mobile/v1/notifications?limit=20');
      setItems(r.items);
      setNextBefore(r.nextBefore);
      applyCounts(r.unreadCount);
    } catch {
      setError('Bildirimler yüklenemedi. İnternetinizi kontrol edin.');
      setItems((prev) => prev ?? []);
    }
  }, [api, applyCounts]);

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

  async function loadMore() {
    if (!api || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.get<InboxListResponse>(
        `/api/mobile/v1/notifications?limit=20&before=${encodeURIComponent(nextBefore)}`,
      );
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setNextBefore(r.nextBefore);
      applyCounts(r.unreadCount);
    } catch {
      /* sayfa sonu denemesi — sessiz; kullanıcı yenileyebilir */
    } finally {
      setLoadingMore(false);
    }
  }

  const markRead = useCallback(
    async (eventId: string) => {
      if (!api) return;
      // İyimser: satırı hemen okundu göster; HATADA GERİ AL (İnceleme Gemini #5).
      const flip = (read: boolean) => {
        setItems((prev) => (prev ?? []).map((x) => (x.id === eventId ? { ...x, read } : x)));
        setFocusItem((prev) => (prev && prev.id === eventId ? { ...prev, read } : prev));
      };
      flip(true);
      try {
        const r = await api.post<InboxReadResponse>('/api/mobile/v1/notifications', { eventId });
        applyCounts(r.unreadCount);
      } catch {
        flip(false); // sunucu onaylamadı — iyimser işareti geri çek
      }
    },
    [api, applyCounts],
  );

  // focus (push tap, Task 9 yönlendirir): her focus değeri BİR KEZ işlenir. Listede
  // yoksa (eski sayfada) tek-kayıt modundan çekilip üstte gösterilir (Codex #8) —
  // kullanıcı dokunduğu bildirimin tam halini her durumda görür; sonra okundu.
  useEffect(() => {
    if (!focus || processedFocus.current === focus || items === null || !api) return;
    processedFocus.current = focus;
    const inList = items.find((x) => x.id === focus);
    void (async () => {
      if (!inList) {
        try {
          const r = await api.get<InboxListResponse>(`/api/mobile/v1/notifications?id=${encodeURIComponent(focus)}`);
          if (r.items[0]) setFocusItem(r.items[0]);
          applyCounts(r.unreadCount);
        } catch {
          /* bulunamadı/ağ hatası — liste yine görünür */
        }
      }
      if (!inList || !inList.read) await markRead(focus);
    })();
  }, [focus, items, api, markRead, applyCounts]);

  async function markAll() {
    if (!api || items === null) return;
    const snapshot = items;
    setItems(items.map((x) => ({ ...x, read: true })));
    try {
      const r = await api.post<InboxReadResponse>('/api/mobile/v1/notifications', { all: true });
      applyCounts(r.unreadCount);
    } catch {
      setItems(snapshot); // sunucu onaylamadı — geri al (İnceleme Gemini #5)
    }
  }

  return (
    <Screen>
      <FlatList
        style={s.wrap}
        contentContainerStyle={s.content}
        data={items ?? []}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[brand]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListHeaderComponent={
          <View>
            <Title>Bildirimler</Title>
            {error ? <ErrorText>{error}</ErrorText> : null}
            {unreadCount > 0 ? (
              <Button label={`Tümünü okundu say (${unreadCount})`} onPress={() => void markAll()} color={brand} variant="ghost" />
            ) : null}
            {focusItem && !(items ?? []).some((x) => x.id === focusItem.id) ? (
              <View style={[s.item, { borderColor: brand, borderWidth: 2 }]}>
                <Text style={s.itemTitle}>{focusItem.title}</Text>
                <Text style={s.itemBody}>{focusItem.body}</Text>
                <Text style={s.itemDate}>{new Date(focusItem.createdAt).toLocaleString('tr-TR')}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={items === null ? <Sub>Yükleniyor…</Sub> : <Sub>Henüz bildiriminiz yok.</Sub>}
        ListFooterComponent={loadingMore ? <Sub>Yükleniyor…</Sub> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => (item.read ? undefined : void markRead(item.id))}>
            <View style={[s.item, !item.read && s.unreadItem, focus === item.id && { borderColor: brand, borderWidth: 2 }]}>
              <View style={s.itemHead}>
                {!item.read ? <View style={[s.dot, { backgroundColor: brand }]} /> : null}
                <Text style={s.itemTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
              <Text style={s.itemBody}>{item.body}</Text>
              <Text style={s.itemDate}>{new Date(item.createdAt).toLocaleString('tr-TR')}</Text>
              {(() => {
                const t = targetForUrl(item.url, roleCategoryOf(session?.role));
                if (!t) return null;
                return (
                  <Button
                    label="İlgili ekranı aç"
                    variant="ghost"
                    color={brand}
                    onPress={() => {
                      if (!item.read) void markRead(item.id);
                      if (t.type === 'today') router.push('/bugun');
                      else router.push({ pathname: '/web', params: { path: t.path } });
                    }}
                  />
                );
              })()}
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  item: {
    backgroundColor: palette.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    marginTop: 12,
  },
  unreadItem: { backgroundColor: '#f5f3ff' },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: palette.text, flexShrink: 1 },
  itemBody: { fontSize: 14, color: palette.text, marginTop: 6 },
  itemDate: { fontSize: 12, color: palette.sub, marginTop: 8 },
});
