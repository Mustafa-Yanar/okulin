import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Input, Button, ErrorText, palette } from '../ui/kit';
import type { MobileRoleCategory } from '../api/types';

// Rol kartlı giriş (web login kartlarının mobil karşılığı, spec §5.1).
// correctRole yönlendirmesi: bilgiler doğru ama kart yanlışsa sunucu doğru
// kategoriyi söyler — kart otomatik değiştirilip kullanıcıya bildirilir.
const ROLES: { key: MobileRoleCategory; label: string }[] = [
  { key: 'student', label: 'Öğrenci' },
  { key: 'parent', label: 'Veli' },
  { key: 'teacher', label: 'Öğretmen' },
  { key: 'management', label: 'Yönetim' },
];

export default function GirisEkrani() {
  const { org, login, leaveOrg } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [role, setRole] = useState<MobileRoleCategory>('student');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await login({ username: username.trim(), password, role });
      router.replace('/bugun');
    } catch (e) {
      if (e instanceof ApiError && e.correctRole) setRole(e.correctRole);
      setError(e instanceof ApiError ? e.message : 'Giriş başarısız. Yeniden deneyin.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={s.wrap}>
        <Title>{org?.shortName || 'okulin'}</Title>
        <Sub>Hesabınızla giriş yapın.</Sub>
        <View style={s.roles}>
          {ROLES.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => setRole(r.key)}
              style={[s.roleCard, role === r.key && { borderColor: brand, backgroundColor: '#fff' }]}
            >
              <Text style={[s.roleLabel, role === r.key && { color: brand, fontWeight: '700' }]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        <Input
          value={username}
          onChangeText={setUsername}
          placeholder={role === 'parent' ? 'Telefon numarası' : 'Kullanıcı adı'}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Input value={password} onChangeText={setPassword} placeholder="Şifre" secureTextEntry onSubmitEditing={submit} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button
          label={busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
          onPress={submit}
          color={brand}
          disabled={busy || !username.trim() || !password}
        />
        <Button label="Kurum değiştir" onPress={() => void leaveOrg()} color={brand} variant="ghost" />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  roleCard: {
    minWidth: '47%',
    flexGrow: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.card,
  },
  roleLabel: { fontSize: 15, color: palette.text },
});
