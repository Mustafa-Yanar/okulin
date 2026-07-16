import * as Notifications from 'expo-notifications';
import { ApiError, type ApiClient } from './api/client';
import type { PushRegisterRequest } from './api/types';

// Push kaydı (spec §8):
// - Kanal ÖNCE: Android 13+ izin promptu kanal olmadan çıkmaz; sunucu FCM
//   gövdesinde channel_id: 'default' gönderir (lib/push/providers.ts).
// - İzin KULLANICI EYLEMİYLE (Bugün ekranı kartı) — ilk açılışta otomatik prompt YOK.
// - Token: getDevicePushTokenAsync → NATIVE FCM cihaz token'ı (Expo Push Service
//   KULLANILMAZ — 3/3 karar). Token asla loglanmaz.
// - 409 (installationId başka hesaba bağlı — İnceleme Codex #3): yeni kimlik üret
//   (rotate) + TEK tekrar.
// - 'error' durumu (İnceleme Codex #13): izin verildi ama sunucu kaydı başarısız —
//   UI "tekrar dene" gösterir; izin durumuyla karışmaz.

export type PushPermission = 'granted' | 'denied' | 'undetermined';
export type EnableResult = PushPermission | 'error';
export type RegisterBase = Omit<PushRegisterRequest, 'token'>;
export type RotateInstallationId = () => Promise<string>;

async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Genel',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export async function currentPermission(): Promise<PushPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

async function registerToken(api: ApiClient, base: RegisterBase, rotate?: RotateInstallationId): Promise<void> {
  const t = await Notifications.getDevicePushTokenAsync();
  const token = String(t.data);
  try {
    await api.post('/api/mobile/v1/push/register', { ...base, token });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409 || !rotate) throw e;
    const installationId = await rotate(); // kimlik çakışması → taze kimlikle tek tekrar
    await api.post('/api/mobile/v1/push/register', { ...base, installationId, token });
  }
  console.log('[push] cihaz kaydı sunucuda tamam'); // Task 11 gözlemi — token LOGLANMAZ
}

// Kullanıcı "Bildirimleri Aç"a bastı: kanal → izin → token → kayıt.
export async function enablePush(api: ApiClient, base: RegisterBase, rotate?: RotateInstallationId): Promise<EnableResult> {
  await ensureChannel();
  const p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return p.canAskAgain ? 'undetermined' : 'denied';
  try {
    await registerToken(api, base, rotate);
    return 'granted';
  } catch {
    return 'error';
  }
}

// Soğuk açılışta izin zaten verilmişse SESSİZCE yeniden kaydol: FCM token rotasyonu +
// cihaz-iptali/logout'ta kopmuş bağın onarımı. Hata yutulur — açılışı bozmaz.
export async function refreshRegistration(api: ApiClient, base: RegisterBase, rotate?: RotateInstallationId): Promise<void> {
  try {
    if ((await currentPermission()) !== 'granted') return;
    await ensureChannel();
    await registerToken(api, base, rotate);
  } catch {
    /* sessiz — bir sonraki açılış dener */
  }
}

// Uygulama AÇIKKEN token rotasyonunu yakala (FCM token'ı nadiren döner).
export function watchTokenRotation(api: ApiClient, base: RegisterBase, rotate?: RotateInstallationId): { remove(): void } {
  return Notifications.addPushTokenListener((t) => {
    void (async () => {
      try {
        await api.post('/api/mobile/v1/push/register', { ...base, token: String(t.data) });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && rotate) {
          const installationId = await rotate();
          await api.post('/api/mobile/v1/push/register', { ...base, installationId, token: String(t.data) }).catch(() => {});
        }
      }
    })();
  });
}
