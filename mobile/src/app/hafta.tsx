import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, ErrorText, palette } from '../ui/kit';
import { shiftWeekKey } from '../week-nav';
import type { WeekResponse, WeekDay, TeacherWeekDay, ParentChildView } from '../api/types';

// Haftalık program (spec §5.1 — 3 rol, salt-okunur). ?week= ile ◀ ▶ gezinme;
// veli çocuk seçici. Dersler + (öğrenci/veli) kendi etütleri; öğretmen grid.
export default function HaftaEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [week, setWeek] = useState<string | null>(null); // null = sunucu bu haftayı seçsin
  const [childId, setChildId] = useState<string | null>(null);
  const [data, setData] = useState<WeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const qs: string[] = [];
      if (week) qs.push(`week=${encodeURIComponent(week)}`);
      if (childId) qs.push(`child=${encodeURIComponent(childId)}`);
      const r = await api.get<WeekResponse>(`/api/mobile/v1/screens/week${qs.length ? `?${qs.join('&')}` : ''}`);
      setData(r);
      if (!week) setWeek(r.weekKey); // ilk yükte sunucunun haftasını sabitle (gezinme için)
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Program yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api, week, childId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shift = (delta: number) => setWeek((w) => (w ? shiftWeekKey(w, delta) : w));

  return (
    <Screen>
      <ScrollView style={st.wrap} contentContainerStyle={st.content}>
        <Title>Haftalık program</Title>
        <View style={st.nav}>
          <Pressable style={st.navBtn} onPress={() => shift(-1)}><Text style={[st.navLabel, { color: brand }]}>◀ Önceki</Text></Pressable>
          <Text style={st.weekLabel}>{data?.weekKey ?? ''}</Text>
          <Pressable style={st.navBtn} onPress={() => shift(1)}><Text style={[st.navLabel, { color: brand }]}>Sonraki ▶</Text></Pressable>
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!data && !error ? <Sub>Yükleniyor…</Sub> : null}

        {data?.role === 'parent' && data.children.length > 1 ? (
          <View style={st.chips}>
            {data.children.map((ch: ParentChildView) => {
              const active = (childId ?? data.child?.id) === ch.id;
              return (
                <Pressable key={ch.id} onPress={() => setChildId(ch.id)} style={[st.chip, active && { borderColor: brand }]}>
                  <Text style={[st.chipLabel, active && { color: brand, fontWeight: '700' }]}>{ch.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {data?.role === 'student' ? data.days.map((d) => <DayCard key={d.dayIndex} day={d} />) : null}
        {data?.role === 'parent' ? (data.child ? data.child.days.map((d) => <DayCard key={d.dayIndex} day={d} />) : <Card><Sub>Öğrenci kaydı bulunamadı.</Sub></Card>) : null}
        {data?.role === 'teacher' ? data.days.map((d) => <TeacherDayCard key={d.dayIndex} day={d} />) : null}
        {data?.role === 'management' ? <Card><Sub>Program görünümü öğrenci/veli/öğretmen içindir.</Sub></Card> : null}
      </ScrollView>
    </Screen>
  );
}

function DayCard({ day }: { day: WeekDay }) {
  const empty = day.lessons.length === 0 && (!day.etuts || day.etuts.length === 0);
  return (
    <Card>
      <Text style={st.dayTitle}>{day.dayLabel} · {day.date}</Text>
      {empty ? <Sub>Bu gün ders/etüt yok.</Sub> : null}
      {day.lessons.map((l, i) => (
        <View key={`${l.slotId}-${i}`} style={st.row}>
          <Text style={st.rowTime}>{l.slotLabel}</Text>
          <View style={st.rowMain}>
            <Text style={st.rowTitle}>{l.branch || 'Ders'}</Text>
            <Text style={st.rowSub}>{l.teacherName}</Text>
          </View>
        </View>
      ))}
      {(day.etuts ?? []).map((e) => (
        <View key={e.id} style={st.row}>
          <Text style={st.rowTime}>{`${e.start}–${e.end}`}</Text>
          <View style={st.rowMain}>
            <Text style={st.rowTitle}>{e.branch || 'Etüt'}</Text>
            <Text style={st.rowSub}>{e.teacherName} · etüt</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function TeacherDayCard({ day }: { day: TeacherWeekDay }) {
  return (
    <Card>
      <Text style={st.dayTitle}>{day.dayLabel} · {day.date}</Text>
      {day.slots.length === 0 ? <Sub>Bu gün ders/etüt yok.</Sub> : null}
      {day.slots.map((l, i) => (
        <View key={`${l.slotId}-${i}`} style={st.row}>
          <Text style={st.rowTime}>{l.slotLabel}</Text>
          <View style={st.rowMain}>
            <Text style={st.rowTitle}>{l.type === 'ders' ? `${l.cls || ''} ${l.branch}`.trim() : l.studentName || 'Etüt'}</Text>
            <Text style={st.rowSub}>{l.type === 'ders' ? 'Ders' : 'Etüt'}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  navBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  navLabel: { fontSize: 15, fontWeight: '600' },
  weekLabel: { fontSize: 15, fontWeight: '700', color: palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.line, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card },
  chipLabel: { fontSize: 14, color: palette.text },
  dayTitle: { fontSize: 15, fontWeight: '700', color: palette.text, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  rowTime: { fontSize: 13, fontWeight: '700', color: palette.sub, minWidth: 88 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: palette.text },
  rowSub: { fontSize: 13, color: palette.sub, marginTop: 1 },
});
