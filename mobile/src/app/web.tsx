import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useSession } from '../store/session';
import { roleCategoryOf } from '../rol';
import { LoadingScreen, Screen, StatusScreen } from '../ui/kit';
import type { SessionExchangeResponse } from '../api/types';

// Güvenli WebView (spec §5.2-5.4) — YALNIZ yönetim rolleri: yönetimsel uzun kuyruk
// (program oluşturucu, muhasebe, CRM, ayarlar) mevcut web panelinden.
// - Oturum: her açılışta TAZE session-exchange (kod tek kullanımlık, 60 sn, IP-bağlı)
//   → session-open 12 saatlik cookie kurar. Refresh token WebView'e HİÇ geçmez (spec §7).
// - Tek-retry (Plan 2 devri): ana belge 401/403 verirse (kod tüketildi / cookie
//   kayboldu / IP değişti) BİR KEZ yeniden exchange; ikinci hata → native hata ekranı.
// - Allowlist (İnceleme Codex #10): WebView içinde YALNIZ kullanıcının kendi
//   org.canonicalHost'u (https) — diğer *.okulin.com subdomainleri dahil her şey
//   dışarıda; dışa açılış yalnız güvenli şemalarla (intent:/javascript:/data: düşer).
// - Hata sınırı (İnceleme Codex #11): yükleme zaman sınırı + HTTP 5xx (session-open)
//   + render süreci ölümü → native hata ekranı.
// - Köprü YOK: postMessage/injectedJavaScript kurulmaz (spec §5.3 minimum köprünün
//   en güvenli hali) — token/şifre WebView'e geçmez.

const LOAD_TIMEOUT_MS = 20000;
// Dışa açılışta izinli şemalar (İnceleme Codex #10) — kalanı sistem tarafına da iletilmez.
const EXTERNAL_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:'];

export default function WebEkrani() {
  const { api, org, session, status, appVersion } = useSession();
  const params = useLocalSearchParams<{ path?: string }>();
  const target =
    typeof params.path === 'string' && params.path.startsWith('/') && !params.path.startsWith('//') && !params.path.includes('\\')
      ? params.path
      : '/';
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const webRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSession = useCallback(async () => {
    if (!api || !org) return;
    setFailed(false);
    setUrl(null);
    try {
      const r = await api.post<SessionExchangeResponse>('/api/mobile/v1/session-exchange');
      setUrl(
        `https://${org.canonicalHost}/api/mobile/v1/session-open?code=${encodeURIComponent(r.code)}&next=${encodeURIComponent(target)}`,
      );
    } catch {
      setFailed(true);
    }
  }, [api, org, target]);

  useEffect(() => {
    retried.current = false;
    void openSession();
    return () => {
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
  }, [openSession]);

  // Android geri tuşu — YALNIZ ekran odaktayken (İnceleme Gemini #4: global dinleyici
  // WebView arka planda dururken tüm uygulamanın geri davranışını bozardı).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (canGoBack.current) {
          webRef.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, []),
  );

  // Oturum durumu çözülmeden yönlendirme YOK (İnceleme Gemini #1: loading'de session
  // null → yönetici yanlışlıkla Bugün'e atılırdı).
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'ready') return <Redirect href="/" />;
  if (roleCategoryOf(session?.role) !== 'management') return <Redirect href="/bugun" />;
  if (failed) {
    return (
      <StatusScreen
        title="Panel açılamadı"
        message="Yönetim paneline bağlanılamadı. İnternetinizi kontrol edip yeniden deneyin."
        actionLabel="Yeniden dene"
        onAction={() => {
          retried.current = false;
          void openSession();
        }}
      />
    );
  }
  if (!url) return <LoadingScreen />;

  return (
    <Screen>
      <WebView
        ref={webRef}
        source={{ uri: url }}
        // UA sonuna "okulinapp/<sürüm>" ekler: sunucu logları/teşhis + web tarafı
        // ileride WebView'i UA'dan tespit edebilsin (spec §5.4 is-mobile-app hazırlığı).
        applicationNameForUserAgent={`okulinapp/${appVersion}`}
        startInLoadingState
        renderLoading={() => <LoadingScreen />}
        // Yükleme zaman sınırı (İnceleme Codex #11): startInLoadingState timeout DEĞİL —
        // ana belge süresinde bitmezse native hata ekranına düş.
        onLoadStart={() => {
          if (loadTimer.current) clearTimeout(loadTimer.current);
          loadTimer.current = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
        }}
        onLoadEnd={() => {
          if (loadTimer.current) clearTimeout(loadTimer.current);
        }}
        onNavigationStateChange={(nav) => {
          canGoBack.current = nav.canGoBack;
        }}
        onShouldStartLoadWithRequest={(req) => {
          let hostname = '';
          let protocol = '';
          try {
            const u = new URL(req.url);
            hostname = u.hostname;
            protocol = u.protocol;
          } catch {
            return false; // çözümlenemeyen URL yüklenmez
          }
          // Tenant sınırı (İnceleme Codex #10): yalnız KENDİ kurum host'u WebView
          // içinde — diğer *.okulin.com subdomainleri dahil her şey dışarıda.
          // hostname WHATWG'de küçük harf — canonicalHost da normalize edilir (fail-closed sertleştirme)
          if (protocol === 'https:' && org && hostname === org.canonicalHost.toLowerCase()) return true;
          // Dış bağlantı → sistem tarayıcısı, ama yalnız güvenli şemalar (spec §5.3);
          // intent:/javascript:/data: sessizce düşer (Codex #10).
          if (EXTERNAL_SCHEMES.includes(protocol)) {
            void Linking.openURL(req.url).catch(() => {});
          }
          return false;
        }}
        onHttpError={({ nativeEvent }) => {
          // Yalnız session-open zinciri işlenir — alt-kaynak 404'ları paneli düşürmesin.
          if (!nativeEvent.url || !nativeEvent.url.includes('/api/mobile/v1/session-open')) return;
          if (nativeEvent.statusCode === 401 || nativeEvent.statusCode === 403) {
            // Kod tüketilmiş / cookie kaybı / IP değişimi: bir kez taze exchange.
            if (!retried.current) {
              retried.current = true;
              void openSession();
            } else {
              setFailed(true);
            }
            return;
          }
          if (nativeEvent.statusCode >= 500) setFailed(true); // İnceleme Codex #11
        }}
        onError={() => setFailed(true)}
        onRenderProcessGone={() => setFailed(true)} // Android WebView süreci öldü (Codex #11)
      />
    </Screen>
  );
}
