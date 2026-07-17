import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Sub, palette } from './kit';
import type {
  ParentToday, StudentToday, TeacherToday, TodayEtut, TodayLesson, TodayOdevItem,
} from '../api/types';

// Bugün ekranı rol bileşenleri (spec §5.1). Veri sözleşmesi TodayResponse (Task 3):
// modül alanı null ise kart HİÇ render edilmez (kurum konfigürasyonuna saygı).
// Para: TR biçimi; ödeme başlatma YOK (spec §11 — PayTR mobilde gösterilmez).

const tl = (n: number) => `₺${n.toLocaleString('tr-TR')}`;

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.cardTitle}>{children}</Text>;
}

function LessonRows({ lessons, empty }: { lessons: TodayLesson[]; empty: string }) {
  if (lessons.length === 0) return <Sub>{empty}</Sub>;
  return (
    <View>
      {lessons.map((l, i) => (
        <View key={`${l.slotId}-${i}`} style={s.row}>
          <Text style={s.rowTime}>{l.slotLabel}</Text>
          <View style={s.rowMain}>
            <Text style={s.rowTitle}>{l.branch || 'Ders'}</Text>
            <Text style={s.rowSub}>{l.teacherName}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function EtutRows({ etuts, empty, showStudent }: { etuts: TodayEtut[]; empty: string; showStudent?: boolean }) {
  if (etuts.length === 0) return <Sub>{empty}</Sub>;
  return (
    <View>
      {etuts.map((e) => (
        <View key={e.id} style={s.row}>
          <Text style={s.rowTime}>{`${e.start}–${e.end}`}</Text>
          <View style={s.rowMain}>
            <Text style={s.rowTitle}>
              {showStudent ? (e.booked ? e.studentName || 'Dolu' : 'Boş') : e.branch || 'Etüt'}
            </Text>
            <Text style={s.rowSub}>{showStudent ? e.branch || '' : e.teacherName}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function OdevCard({ odev }: { odev: { pending: number; items: TodayOdevItem[] } }) {
  return (
    <Card>
      <CardTitle>Bekleyen ödevler ({odev.pending})</CardTitle>
      {odev.pending === 0 ? (
        <Sub>Bekleyen ödev yok.</Sub>
      ) : (
        <View>
          {odev.items.map((o) => (
            <View key={o.id} style={s.row}>
              <View style={s.rowMain}>
                <Text style={s.rowTitle}>{o.title}</Text>
                <Text style={[s.rowSub, o.overdue && { color: palette.danger, fontWeight: '700' }]}>
                  {o.branch}
                  {o.dueDate ? ` · son gün ${o.dueDate}` : ''}
                  {o.overdue ? ' · gecikti' : ''}
                </Text>
              </View>
            </View>
          ))}
          {odev.pending > odev.items.length ? <Sub>… ve {odev.pending - odev.items.length} ödev daha</Sub> : null}
        </View>
      )}
    </Card>
  );
}

export function StudentTodayView({ data }: { data: StudentToday }) {
  return (
    <View>
      <Card>
        <CardTitle>Bugünün dersleri</CardTitle>
        <LessonRows lessons={data.lessons} empty="Bugün dersin yok." />
      </Card>
      {data.etuts !== null ? (
        <Card>
          <CardTitle>Bugünkü etütlerim</CardTitle>
          <EtutRows etuts={data.etuts} empty="Bugün etüt rezervasyonun yok." />
        </Card>
      ) : null}
      {data.odev ? <OdevCard odev={data.odev} /> : null}
      {data.davranis || data.deneme ? (
        <Card>
          <CardTitle>Özet</CardTitle>
          {data.davranis ? <Text style={s.statLine}>Davranış puanı: {data.davranis.total}</Text> : null}
          {data.deneme ? (
            <Text style={s.statLine}>
              Son deneme: {data.deneme.name} — {data.deneme.toplamNet} net
              {data.deneme.rank ? ` (${data.deneme.rank}/${data.deneme.total})` : ''}
            </Text>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

export function ParentTodayView({
  data,
  brand,
  onSelectChild,
}: {
  data: ParentToday;
  brand: string;
  onSelectChild: (id: string) => void;
}) {
  const c = data.child;
  return (
    <View>
      {data.children.length > 1 ? (
        <View style={s.chips}>
          {data.children.map((ch) => {
            const active = c?.id === ch.id;
            return (
              <Pressable
                key={ch.id}
                onPress={() => onSelectChild(ch.id)}
                style={[s.chip, active && { borderColor: brand, backgroundColor: '#fff' }]}
              >
                <Text style={[s.chipLabel, active && { color: brand, fontWeight: '700' }]}>{ch.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {!c ? (
        <Card>
          <Sub>Öğrenci kaydı bulunamadı.</Sub>
        </Card>
      ) : (
        <View>
          <Card>
            <CardTitle>
              {c.name} — bugünün dersleri
            </CardTitle>
            <LessonRows lessons={c.lessons} empty="Bugün ders görünmüyor." />
          </Card>
          {c.etuts !== null ? (
            <Card>
              <CardTitle>Bugünkü etütleri</CardTitle>
              <EtutRows etuts={c.etuts} empty="Bugün etüt rezervasyonu yok." />
            </Card>
          ) : null}
          {c.odev ? <OdevCard odev={c.odev} /> : null}
          {c.finance ? (
            <Card>
              <CardTitle>Ödeme durumu</CardTitle>
              <Text style={s.statLine}>Kalan borç: {tl(c.finance.balance)}</Text>
              {c.finance.nextInstallment ? (
                <Text style={s.statLine}>
                  Sıradaki taksit: {tl(c.finance.nextInstallment.amount)}
                  {c.finance.nextInstallment.dueDate ? ` — ${c.finance.nextInstallment.dueDate}` : ''}
                </Text>
              ) : null}
              {c.finance.overdueCount > 0 ? (
                <Text style={[s.statLine, { color: palette.danger, fontWeight: '700' }]}>
                  Vadesi geçmiş {c.finance.overdueCount} taksit var.
                </Text>
              ) : null}
              <Sub>Ödeme işlemleri için kurumunuzla iletişime geçin.</Sub>
            </Card>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function TeacherTodayView({ data }: { data: TeacherToday }) {
  return (
    <View>
      <Card>
        <CardTitle>Bugünkü programım</CardTitle>
        {data.lessons.length === 0 ? (
          <Sub>Bugün programında ders görünmüyor.</Sub>
        ) : (
          <View>
            {data.lessons.map((l, i) => (
              <View key={`${l.slotId}-${i}`} style={s.row}>
                <Text style={s.rowTime}>{l.slotLabel}</Text>
                <View style={s.rowMain}>
                  <Text style={s.rowTitle}>
                    {l.type === 'ders' ? `${l.cls || ''} ${l.branch}`.trim() : l.studentName || 'Etüt'}
                  </Text>
                  <Text style={s.rowSub}>{l.type === 'ders' ? 'Ders' : 'Etüt'}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
      {data.etuts !== null ? (
        <Card>
          <CardTitle>Bugünkü etüt blokları</CardTitle>
          <EtutRows etuts={data.etuts} empty="Bugün etüt bloğun yok." showStudent />
        </Card>
      ) : null}
    </View>
  );
}

export function ManagementTodayView({ brand }: { brand: string }) {
  return (
    <Card>
      <CardTitle>Yönetim paneli</CardTitle>
      <Sub>Program oluşturucu, muhasebe, CRM ve kurum ayarları web panelinde.</Sub>
      <Button label="Paneli aç" onPress={() => (router.push as any)('/web')} color={brand} />
    </Card>
  );
}

const s = StyleSheet.create({
  cardTitle: { fontSize: 16, fontWeight: '600', color: palette.text, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  rowTime: { fontSize: 13, fontWeight: '700', color: palette.sub, minWidth: 88 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: palette.text },
  rowSub: { fontSize: 13, color: palette.sub, marginTop: 1 },
  statLine: { fontSize: 15, color: palette.text, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.card,
  },
  chipLabel: { fontSize: 14, color: palette.text },
});
