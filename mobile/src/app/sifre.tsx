import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Input, Button, ErrorText } from '../ui/kit';
import type { ChangePasswordResponse } from '../api/types';

// Şifre değiştirme (spec §7). Zorunlu (mustChangePassword) → Vazgeç yok; isteğe bağlı
// (ayarlardan) → Vazgeç var. Başarıda taze token çifti yazılır, session güncellenir (kapı açılır).
export default function SifreEkrani() {
  const { api, session, applyPasswordChanged } = useSession();
  const forced = Boolean(session?.mustChangePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (next.length < 6) { setError('Yeni şifre en az 6 karakter olmalı.'); return; }
    if (next !== again) { setError('Yeni şifreler eşleşmiyor.'); return; }
    if (next === current) { setError('Yeni şifre mevcut şifreyle aynı olamaz.'); return; }
    if (!api) return;
    setBusy(true);
    try {
      const r = await api.post<ChangePasswordResponse>('/api/mobile/v1/auth/change-password', { currentPassword: current, newPassword: next });
      await applyPasswordChanged({ accessToken: r.accessToken, refreshToken: r.refreshToken }, r.session);
      router.replace('/bugun');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Şifre değiştirilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content}>
        <Title>Şifre değiştir</Title>
        <Sub>{forced ? 'Devam etmek için şifrenizi değiştirmeniz gerekiyor.' : 'Hesap şifrenizi güncelleyin.'}</Sub>
        <Input placeholder="Mevcut şifre" secureTextEntry value={current} onChangeText={setCurrent} autoCapitalize="none" />
        <Input placeholder="Yeni şifre (en az 6)" secureTextEntry value={next} onChangeText={setNext} autoCapitalize="none" />
        <Input placeholder="Yeni şifre (tekrar)" secureTextEntry value={again} onChangeText={setAgain} autoCapitalize="none" />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button label={busy ? 'Kaydediliyor…' : 'Şifreyi değiştir'} onPress={() => void submit()} disabled={busy} />
        {!forced ? <Button label="Vazgeç" onPress={() => router.back()} variant="ghost" /> : null}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({ content: { padding: 24, paddingTop: 32, paddingBottom: 48 } });
