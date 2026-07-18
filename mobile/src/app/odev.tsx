import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, Button, Input, ErrorText, palette } from '../ui/kit';
import type { OdevListResponse, OdevListItem, OdevListItemParent, OdevSubmitResponse } from '../api/types';

const STATUS_LABEL: Record<string, string> = { '': 'Teslim edilmedi', teslim: 'Teslim edildi', kontrol: 'Kontrol edildi' };

// Ödev (spec §5.1): öğrenci liste + teslim/geri-al; veli salt-okunur çocuk durumları.
export default function OdevEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [data, setData] = useState<OdevListResponse | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      setData(await api.get<OdevListResponse>('/api/mobile/v1/odev'));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'Ödev modülü kurumunuzda kapalı.' : e instanceof ApiError && e.status !== 0 ? e.message : 'Ödevler yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const submit = useCallback(async (id: string, done: boolean) => {
    if (!api || busy) return;
    setBusy(id);
    setError(null);
    try {
      await api.post<OdevSubmitResponse>('/api/mobile/v1/odev', { id, note: notes[id] ?? undefined, done });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İşlem başarısız.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, notes, load]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content}>
        <Title>Ödevler</Title>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!data ? <Sub>Yükleniyor…</Sub> : null}
        {data && data.items.length === 0 ? <Sub>Ödev bulunmuyor.</Sub> : null}

        {data?.role === 'student' ? data.items.map((o: OdevListItem) => (
          <Card key={o.id}>
            <Text style={st.title}>{o.title}</Text>
            <Sub>{o.branch}{o.dueDate ? ` · son gün ${o.dueDate}` : ''}{o.createdByName ? ` · ${o.createdByName}` : ''}</Sub>
            {o.desc ? <Text style={st.desc}>{o.desc}</Text> : null}
            <Text style={[st.status, o.overdue && { color: palette.danger, fontWeight: '700' }]}>
              {STATUS_LABEL[o.status] ?? o.status}{o.overdue ? ' · gecikti' : ''}
            </Text>
            {o.status === 'kontrol' ? (
              <View>
                {o.score ? <Text style={st.fb}>Puan: {o.score}</Text> : null}
                {o.feedback ? <Text style={st.fb}>Geri bildirim: {o.feedback}</Text> : null}
              </View>
            ) : o.status === 'teslim' ? (
              <Button label={busy === o.id ? 'İşleniyor…' : 'Teslimi geri al'} onPress={() => void submit(o.id, false)} disabled={busy === o.id} variant="danger" />
            ) : (
              <View>
                <Input placeholder="Not (isteğe bağlı)" value={notes[o.id] ?? ''} onChangeText={(t) => setNotes((p) => ({ ...p, [o.id]: t }))} multiline />
                <Button label={busy === o.id ? 'İşleniyor…' : 'Teslim et'} onPress={() => void submit(o.id, true)} disabled={busy === o.id} color={brand} />
              </View>
            )}
          </Card>
        )) : null}

        {data?.role === 'parent' ? data.items.map((o: OdevListItemParent) => (
          <Card key={o.id}>
            <Text style={st.title}>{o.title}</Text>
            <Sub>{o.branch}{o.dueDate ? ` · son gün ${o.dueDate}` : ''}{o.createdByName ? ` · ${o.createdByName}` : ''}</Sub>
            {o.desc ? <Text style={st.desc}>{o.desc}</Text> : null}
            {o.children.map((ch) => (
              <Text key={ch.childId} style={st.status}>{ch.childName}: {STATUS_LABEL[ch.status] ?? ch.status}</Text>
            ))}
          </Card>
        )) : null}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  title: { fontSize: 16, fontWeight: '700', color: palette.text },
  desc: { fontSize: 14, color: palette.text, marginTop: 6 },
  status: { fontSize: 14, color: palette.sub, marginTop: 8 },
  fb: { fontSize: 14, color: palette.text, marginTop: 4 },
});
