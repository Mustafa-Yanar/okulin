import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../store/session';
import { Screen, Title, Sub, Card, palette } from '../ui/kit';

// "Bugün" placeholder'ı — gerçek içerik (günün programı, bekleyen işler, son
// bildirimler) Plan 4. Bu iskelet: kimlik doğrulanmış durumun kanıtı + push kartı.
const ROLE_LABEL: Record<string, string> = {
  student: 'Öğrenci',
  parent: 'Veli',
  teacher: 'Öğretmen',
  director: 'Müdür',
  accountant: 'Muhasebeci',
  counselor: 'Rehber',
  org_admin: 'Kurum Yöneticisi',
};

export default function BugunEkrani() {
  const { org, session } = useSession();
  return (
    <Screen>
      <View style={s.wrap}>
        <Sub>{org?.name}</Sub>
        <Title>Merhaba{session?.name ? `, ${session.name}` : ''}</Title>
        <Text style={s.role}>{ROLE_LABEL[session?.role ?? ''] ?? session?.role}</Text>
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
