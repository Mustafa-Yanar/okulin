import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { APEX_BASE, isAllowedHost } from '../config';
import { useSession } from '../store/session';
import { Screen, Title, Sub, Input, Button, ErrorText } from '../ui/kit';
import type { ResolveOrgResponse } from '../api/types';

// Kurum keşfi (spec §6): kod apex'e gider, istemci YALNIZ dönen canonicalHost'a
// bağlanır. QR okuma Plan 4 (ADR).
export default function KurumEkrani() {
  const { saveOrg } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${APEX_BASE}/api/mobile/v1/resolve-org`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const j = (await res.json().catch(() => null)) as (Partial<ResolveOrgResponse> & { error?: string }) | null;
      if (!res.ok || !j?.ok || !j.canonicalHost) {
        setError(j?.error ?? 'Kurum bulunamadı. Kodu kontrol edin.');
        return;
      }
      if (!isAllowedHost(j.canonicalHost)) {
        // Allowlist dışı host'a ASLA bağlanma (spec §6/3 + İnceleme Codex #11).
        setError('Kurum adresi doğrulanamadı.');
        return;
      }
      await saveOrg({
        orgSlug: j.orgSlug!,
        canonicalHost: j.canonicalHost,
        name: j.name!,
        shortName: j.shortName!,
        logoUrl: j.logoUrl ?? '',
        themeColor: j.themeColor!,
      });
      router.replace('/giris');
    } catch {
      setError('Bağlantı kurulamadı. İnternetinizi kontrol edin.');
    } finally {
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
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 24 },
});
