import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '../store/session';
import { resolveOrgByCode } from '../org';
import { Screen, Title, Sub, Input, Button, ErrorText, palette } from '../ui/kit';

// Kurum keşfi (spec §6): kod apex'e gider, istemci YALNIZ dönen canonicalHost'a
// bağlanır (resolveOrgByCode — ortak yol). QR girişi /kurum-qr.
export default function KurumEkrani() {
  const { saveOrg, status } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rota guard'ı (İnceleme Codex #9): kurum zaten kayıtlıyken deep link ile gelinirse
  // kurum ÜZERİNE YAZILAMAZ — değişim yalnız onaylı "Kurumdan ayrıl" (leaveOrg:
  // oturum + push bağı + kayıt temizliği) akışından geçer. saveOrg sonrası status
  // 'needs-login' olur; bu guard'ın o anki Redirect'i de /giris'e düşer (çakışmaz).
  if (status !== 'needs-org') return <Redirect href="/" />;

  async function submit() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const r = await resolveOrgByCode(code.trim().toUpperCase());
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    try {
      await saveOrg(r.org);
      setBusy(false);
      router.replace('/giris');
    } catch {
      // SecureStore yazımı düşebilir (Keystore hatası) — buton kilitli kalmasın (inceleme bulgusu).
      setError('Kurum kaydedilemedi. Yeniden deneyin.');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={s.wrap}>
        <Title>okulin</Title>
        <Sub>Kurumunuzun size verdiği kurum kodunu girin.</Sub>
        <Input
          value={code}
          onChangeText={setCode}
          placeholder="Kurum kodu (örn. ABC-123)"
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={submit}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button label={busy ? 'Aranıyor…' : 'Devam et'} onPress={submit} disabled={busy || !code.trim()} />
        <Button label="QR kod ile tara" onPress={() => router.push('/kurum-qr')} color={palette.brandFallback} variant="ghost" />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24 },
});
