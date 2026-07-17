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

// Kayıt + 409-rotate tek deseni (Plan 3 Minor #9): installationId çakışmasında
// (başka hesaba bağlı) taze kimlik üretilip BİR KEZ tekrar denenir.
async function postRegister(api: ApiClient, base: RegisterBase, token: string, rotate?: RotateInstallationId): Promise<void> {
  try {
    await api.post('/api/mobile/v1/push/register', { ...base, token });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409 || !rotate) throw e;
    const installationId = await rotate();
    await api.post('/api/mobile/v1/push/register', { ...base, installationId, token });
  }
}

async function registerToken(api: ApiClient, base: RegisterBase, rotate?: RotateInstallationId): Promise<void> {
  const t = await Notifications.getDevicePushTokenAsync();
  await postRegister(api, base, String(t.data), rotate);
  console.log('[push] cihaz kaydı sunucuda tamam'); // token LOGLANMAZ
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
    void postRegister(api, base, String(t.data), rotate).catch(() => {
      /* sessiz — bir sonraki açılış dener (rotate() hatası dahil, Plan 3 fix'i korunur) */
    });
  });
}
