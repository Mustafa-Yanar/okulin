import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSession } from '../store/session';
import { extractOrgCode, resolveOrgByCode } from '../org';
import { Screen, Title, Sub, Button, ErrorText, LoadingScreen, palette } from '../ui/kit';

// Kurum QR taraması (spec §6/1): izin KULLANICI EYLEMİYLE (buton), QR içeriği
// extractOrgCode'dan geçer (yabancı host reddi), çözümleme resolveOrgByCode ortak
// yolunda. Çifte tarama busy kilidi + hata sonrası cooldown ile önlenir (İnceleme
// Gemini #3: geçersiz QR her karede yeniden tetiklenip API/UI'ı boğardı).
export default function KurumQrEkrani() {
  const { saveOrg, status } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const cooldownUntil = useRef(0);
  const [resolving, setResolving] = useState(false);

  // Rota guard'ı (İnceleme Codex #9): kurum kayıtlıyken QR ile kurum ÜZERİNE
  // YAZILAMAZ — değişim yalnız onaylı "Kurumdan ayrıl" akışından geçer.
  if (status !== 'needs-org') return <Redirect href="/" />;

  async function onScanned(raw: string) {
    if (busy.current || Date.now() < cooldownUntil.current) return; // tek işlem + hata sonrası bekleme
    const code = extractOrgCode(raw);
    if (!code) {
      cooldownUntil.current = Date.now() + 2500; // aynı geçersiz QR sürekli tetiklemesin (Gemini #3)
      setError('Bu QR bir kurum kodu içermiyor.');
      return;
    }
    busy.current = true;
    setResolving(true);
    setError(null);
    const r = await resolveOrgByCode(code);
    if (!r.ok) {
      setError(r.error);
      busy.current = false;
      setResolving(false);
      cooldownUntil.current = Date.now() + 2500; // başarısız çözümleme sonrası bekleme (Gemini #3)
      return;
    }
    await saveOrg(r.org);
    router.replace('/giris');
  }

  if (!permission) return <LoadingScreen />;

  if (!permission.granted) {
    return (
      <Screen>
        <View style={s.center}>
          <Title>QR ile kurum</Title>
          <Sub>Kurumunuzun QR kodunu taramak için kamera izni gerekir.</Sub>
          {permission.canAskAgain ? (
            <Button label="Kamera iznine izin ver" onPress={() => void requestPermission()} />
          ) : (
            <Sub>Kamera izni reddedilmiş. Telefon Ayarları → Uygulamalar → okulin → İzinler yolundan açabilirsiniz.</Sub>
          )}
          <Button label="Kodu elle gir" onPress={() => router.back()} variant="ghost" color={palette.brandFallback} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <CameraView
        style={s.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void onScanned(String(data))}
      />
      <View style={s.panel}>
        <Text style={s.hint}>{resolving ? 'Kurum aranıyor…' : 'Kurum QR kodunu kareye hizalayın.'}</Text>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button label="Kodu elle gir" onPress={() => router.back()} variant="ghost" color={palette.brandFallback} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  camera: { flex: 1 },
  panel: { padding: 24, backgroundColor: palette.bg },
  hint: { fontSize: 15, color: palette.text, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', padding: 24 },
});
