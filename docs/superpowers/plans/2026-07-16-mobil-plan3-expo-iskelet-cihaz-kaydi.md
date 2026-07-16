# Mobil Plan 3/5 — Expo İskelet + Cihaz Kaydı (FCM go-live) Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expo Router + RN (TS) mobil iskeleti kurmak (kurum kodu → giriş → "Bugün" → ayarlar/cihazlar) ve push cihaz kaydını uçtan uca canlıya almak (DeviceInstallation doldurma + FCM go-live + gerçek cihazda bildirim), yanında F1 launch-blocker'ı (hesap silme → mobil oturum iptali) kapatmak.

**Architecture:** Backend tarafında Plan 2'nin `/api/mobile/v1` çekirdeğine iki uç eklenir (`push/register` POST/DELETE) + logout/cihaz-iptali push bağını koparır + silme akışları `purgeMobileAccess` ile mobil erişimi kapatır. Plan 1 outbox'ının FCM adaptörü sertleştirilir (OAuth de-dup, json guard, `channel_id`, `data.eventId`, icon/requireInteraction kalıcılığı). Mobil tarafta `mobile/` bağımsız Expo (SDK 57) uygulaması: SecureStore token deposu, tek-uçuş refresh mutex'li tipli API istemcisi, bootstrap kill-switch kapısı, kullanıcı-eylemiyle push izni → native FCM token → register. Tipler `lib/mobile/api-types.ts` tek kaynağından mobile'a script'le kopyalanır (drift testi korur).

**Tech Stack:** Backend: Next.js 14 + Prisma/Neon + Upstash (mevcut). Mobil: Expo SDK 57 (RN 0.86, React 19.2), expo-router, expo-secure-store, expo-notifications (native FCM token), expo-crypto, expo-constants, expo-device, expo-dev-client, @sentry/react-native (~7.11), vitest (saf modül testleri). Build: **yerel** `npx expo run:android` (Temurin JDK 17 + Android cmdline-tools) + fiziksel Android telefon (USB).

**Spec:** `docs/superpowers/specs/2026-07-14-native-mobil-app-design.md` §4 (repo düzeni), §5 (uygulama yapısı), §6 (kurum keşfi), §7 (auth istemci tarafı), §8 (push/izin/logout), §12 (F0 çıkış kapısı: "push uçtan uca gerçek cihazda").

**Plan 2'den devralınanlar:** istemci refresh mutex (Gemini #5) → Task 7 · response sözleşme tipleri (Codex #9) → Task 2/7 · cihaz-katmanlı rate limit ilk katmanı (Codex #10/#11) → Task 2 · F1 silme→iptal → Task 3 · FCM go-live sertleştirmeleri (Plan 1 takip notu) → Task 1. **Plan 4'e devredilenler:** session-exchange istemci tek-retry + WebView, bildirim merkezi (inbox UI + API), deep-link routing, QR ile kurum, gerçek "Bugün" içeriği.

## Karar Notları (ADR — bilinçli tercihler)

- **Yerel build yolu (Mustafa, 2026-07-16):** `npx expo run:android` + fiziksel Android telefon (USB). Disk 38 GB boş olduğundan tam Android Studio KURULMAZ — Temurin JDK 17 + Android command-line tools yeterli (~5-6 GB); emülatör/Studio istenirse sonradan eklenir. EAS cloud build Plan 5'te (mağaza hattı) devreye girer.
- **Sentry Plan 3'te (Mustafa, 2026-07-16):** `@sentry/react-native` + `@sentry/react-native/expo` plugin'i (sentry-expo DEPRECATED). Org **EU (Frankfurt) data residency** ile açılır (spec §17): `sendDefaultPii: false`, session replay YOK, `enabled: !__DEV__`. Source-map upload (SENTRY_AUTH_TOKEN) Plan 5 release hattına.
- **Expo Push Service KULLANILMAZ** (spec §8, 3/3 karar): `Notifications.getDevicePushTokenAsync()` NATIVE FCM token'ı verir; mevcut FCM v1 adaptörü (okulin-mobil service account) bunu doğrudan hedefler. Expo Go'da SDK 53+ remote push yok → development build zorunlu (zaten yerel build).
- **assetlinks.json Plan 5'e ERTELENDİ** (memory Plan 3 diyordu — bilinçli sapma): dev build'ler RN'in HERKESE AÇIK paylaşılan debug keystore'uyla imzalanır; o fingerprint'i prod domain'de yayınlamak hijyen sorunu (com.okulin.app adlı herhangi bir debug imzalı uygulama App Link doğrulaması kazanır). Deep-link routing zaten Plan 4-5 işi; assetlinks + `android.intentFilters(autoVerify)` release keystore fingerprint'iyle birlikte gelir.
- **google-services.json COMMIT EDİLMEZ** (repo PUBLIC): gitignore'a girer; Firebase client config'i sır değil ama public repoda durmasına gerek yok. Kayıp halinde Firebase Console → okulin-mobil → Android app → yeniden indirilir; not CLAUDE.local.md'ye.
- **Oturum snapshot'ı cihazda SAKLANMAZ:** soğuk açılışta `/me` çekilir. Gerekçe: SecureStore ~2 KB değer sınırı (veli `children` payload'ı aşabilir) + her açılışta taze payload. `/me` ağ hatasında 3 kısa deneme, sonra login ekranı (token'lar korunur — şifre yeniden girilirse de zarar yok). Offline-okuma v1 iskelet kapsamı dışı (spec §16 kararı Plan 4+ inbox cache ile).
- **Tek aktif hesap** (spec §16): logout → push unregister + oturum iptali; aynı cihazda başka hesapla login aynı `installationId`'yi yeni hesaba bağlar (register upsert).
- **installationId** = `expo-crypto` randomUUID, SecureStore'da kalıcı; reklam kimliği DEĞİL (spec §6/4). Kurumdan ayrılırken push bağı unregister ile kopar (spec §6/7 temizliği).
- **(provider,token) devri:** aynı FCM token'ı başka bir installationId satırında kaldıysa (silip yeniden kurma gerçeği) eski satır SİLİNİR, kayıt yeni installationId'ye yazılır. `DeviceInstallation.id = installationId` upsert anahtarıdır; kurum/hesap değişiminde satır yeni sahibe geçer (`savePushSubscription` çapraz-tenant deseni: base prisma + orgSlug/branch ELLE).
- **F1 purge silmeden ÖNCE ve fail-loud** (şifre-sıfırlamadaki try/catch best-effort deseninden bilinçli sapma): purge düşerse silme de durur (500) — aktif mobil oturumu kalmış "silinmiş" kullanıcı oluşmaz; retry ikisini de tekrar dener. Ters sırada purge hatası sessiz kalıcı açık bırakırdı.
- **Veli oturumu öğrenci silmede İPTAL EDİLMEZ:** veli hesabı telefon-bazlı ve başka çocukları olabilir; `children` snapshot bayatlığı web 7g cookie ile aynı sınıf (Plan 2 payload-tazeliği ADR'si). Kabul.
- **Rate limit iki katman (İnceleme Codex #6):** register/unregister IP + oturum(sid) kovaları; refresh IP + token-hash kovası — kimlikli istemci IP değiştirerek kovadan kaçamaz, okul NAT'ı tek kovada boğulmaz. Değerler kova başına: register 20/10dk, refresh 120/10dk. Tenant katmanı gerekirse ölçümle (spec §9/8'in kalanı).
- **Refresh yanıt-kaybı kalıntısı (İnceleme Codex #9, ADR):** rotation yanıtı istemciye ulaşamazsa istemci eski token'la kalır; grace (30 sn) İÇİNDE tekrar meşru yoldan kurtulur — istemci ağ hatasında 2 sn arayla bir kez daha dener (Task 7). 30 sn'i aşan kesintide sunucu REUSE sayıp oturumu kapatır → kullanıcı yeniden giriş yapar. Bu güvenlik/kullanılabilirlik dengesi BİLİNÇLİ; tam çözüm (idempotency-key'li refresh) sunucu sözleşmesi değişikliğidir, gerekirse Plan 4+.
- **Offline çıkışta push bağı kalıntısı (İnceleme Gemini B2-6, ADR):** çevrimdışı logout'ta unregister isteği gidemez → DeviceInstallation bağı sunucuda kalır (oturum da revoke edilmemiştir; cihazda token silindiği için refresh hiç yapılmaz, 60 günde düşer). Pencere: aynı cihazda başka hesap login olana dek eski hesabın YENİ bildirimleri cihaza gelebilir. Kabul — web'in offline çıkışı da PushSub'ı bırakır (parite); bekleyen kuyruk zaten sahiplik kontrolüyle korunur. Plan 4'te "bekleyen unregister bayrağı" değerlendirilir.
- **inbox görsel meta kalıcılığı** (`icon`/`requireInteraction`) `NotificationEvent.data` JSON alanında — ŞEMA DEĞİŞİKLİĞİ YOK (alan Plan 1'den beri mevcut, boş duruyordu).
- **FCM `data.eventId` + `channel_id: 'default'`** şimdiden gönderilir: istemci kanalı Task 9'da oluşturur; eventId Plan 4 bildirim merkezi eşleşmesi/dedupe'un ön hazırlığı. Kilit ekranı jenerik metin SUNUCUDA çözülür (`renderPush` sensitive yolu — istemcide ek iş yok).
- **Node 20.20.2 korunur:** SDK 57/RN 0.86 engines `^20.19.4` sağlanıyor (doğrulandı); Node 22 göçü ayrı iş (Remotion `node@20` pini bozulmaz). Expo araçları yine de node sürümüne takılırsa (İnceleme Codex #1 uyarısı): `mise` ile YALNIZ mobile/ dizinine node 22 pinlenir (`cd mobile && mise use node@22`) — global sürüme dokunulmaz.
- **`x-okulin-app: android/<version>`** başlığı her mobil istekte gönderilir (sunucu şimdilik okumaz; log/teşhis + ileride sürüm-bazlı davranış).
- **Ekran tasarımı iskelet seviyesinde:** temiz, marka renkli (resolve-org `themeColor`), TR metinli; "enerjik görsel yön" cilası Plan 4'te native ekranlarla birlikte.

## Operasyon Ön Koşulları (Mustafa — ilgili task'a kadar)

1. **Firebase Android app kaydı** (Task 6'ya kadar): console.firebase.google.com → `okulin-mobil` → Add app → Android → package `com.okulin.app` → `google-services.json` indir. Adım adım Task 6 Step 4'te.
2. **Sentry hesabı** (Task 10'a kadar): sentry.io → yeni org **Data Storage Location: EU (Frankfurt)** → React Native projesi → DSN. Adım adım Task 10 Step 1'de.
3. **Telefon**: Geliştirici seçenekleri + USB hata ayıklama (Task 5 Step 3'te adımlar) + USB kablosu.

## Global Constraints

- Web tarafı: TypeScript strict; `tsconfig` `allowJs:false` anahtarı SİLİNMEZ; **yeni npm bağımlılığı YOK**; hata formatı `{ error }` + doğru status; Prisma route'larında `export const runtime = 'nodejs';`; kimlik `lib/id.ts` `newId()` / `crypto.randomBytes` (`Math.random` yasak); loglara/yanıtlara token-hash-PII yazılmaz.
- Mobil tarafı: bağımlılıklar YALNIZ `npx expo install <paket>` ile (SDK-pinli sürüm) + `vitest` (devDependency); TS strict (template default'u korunur); push/refresh token'ları asla console'a yazılmaz; UI metinleri Türkçe, emoji yok.
- Şema değişikliği YOK (bu planda `prisma/schema.prisma`'ya dokunulmaz).
- Commit: Türkçe, `feat(mobil):` / `fix:` / `test(mobil):` önekli; her task sonunda; web değişikliğinde `npm run build` geçmeden commit YOK; mobil değişikliğinde `cd mobile && npx tsc --noEmit && npx vitest run` geçmeden commit YOK; `git add <dosya>` (asla `-A`).
- Deploy: backend Task 4'te tek push (Task 1-3 yalnız local commit); mobil dosyalar deploy'u etkilemez (Vercel `mobile/`'ı build etmez) ama yine de Task 4 sonrası push'lar serbest.
- Canlı testler `.env.local`'deki `OKULIN_*` creds + testkurs'a karşı (`e2e/helpers` deseni).

## Dosya Haritası

| Dosya | Sorumluluk |
|---|---|
| `lib/push/providers.ts` (değişir) | OAuth in-flight de-dup + json guard; `PushNotif.icon/data`; FCM `channel_id` + `data.eventId` |
| `lib/push/providers.test.ts` (değişir) | Yeni describe: eşzamanlılık, bozuk gövde, FCM gövde alanları |
| `lib/push/outbox.ts` (değişir) | event.data'ya icon/requireInteraction; anında+retry yollarında meta ve eventId geçişi |
| `lib/mobile/contracts.ts` (değişir) | `PushRegisterSchema`, `PushUnregisterSchema` |
| `lib/mobile/api-types.ts` (yeni) | /mobile/v1 istek+yanıt TS tipleri — mobile'a kopyalanan TEK KAYNAK (import'suz saf tipler) |
| `lib/mobile/devices.ts` (yeni) | `registerDevice`, `unbindInstallation`, `unbindAllInstallations` (DeviceInstallation katmanı) |
| `lib/mobile/sessions.ts` (değişir) | `installationIdOf(sid)` (logout/cihaz-iptali push bağı koparma için) |
| `lib/mobile/purge.ts` (yeni) | `purgeMobileAccess(role, userIds[], reason)` — oturum revoke + installation silme (F1) |
| `lib/ratelimit.ts` (değişir) | `mobileRegisterRatelimit` (20/10dk), `mobileRefreshRatelimit` (120/10dk) |
| `app/api/mobile/v1/push/register/route.ts` (yeni) | POST kayıt/yeniden bağlama · DELETE unregister (Bearer) |
| `app/api/mobile/v1/auth/logout/route.ts` (değişir) | logout → installation bağı koparma (spec §8) |
| `app/api/mobile/v1/auth/devices/route.ts` (değişir) | tek/tüm cihaz iptalinde installation bağı koparma |
| `app/api/mobile/v1/auth/refresh/route.ts` (değişir) | IP rate limit |
| `lib/students.ts`, `lib/teachers.ts` (değişir) | delete akışlarına `purgeMobileAccess` (F1) |
| `app/api/counselors/route.ts`, `app/api/accountants/route.ts`, `app/api/assistant-directors/route.ts` (değişir) | DELETE'lere `purgeMobileAccess` (F1; asistan → mobil rol 'director') |
| `lib/parents.ts` (değişir) | `syncParents` veli silmede purge; `resetParent` mobil oturum iptali (Codex #5) |
| `app/api/superadmin/route.ts` (değişir) | TENANT_MODELS'e mobil+bildirim tabloları — kurum silme temizliği (Codex #5) |
| `e2e/int-mobile-push.spec.js` (yeni) | Canlı: register/rotation/devir/unregister + F1 (rehber sil → access anında ölür) |
| `vitest.config.js`, `tsconfig.json`, `.gitignore`, `package.json` (değişir) | `mobile/**` dışlamaları + `mobile:types` script |
| `scripts/sync-mobile-api-types.mjs` (yeni) | api-types.ts → mobile/src/api/types.ts kopyası |
| `lib/mobile/api-types.sync.test.ts` (yeni) | Kopya drift denetimi (birebir eşitlik) |
| `mobile/` (yeni — Expo SDK 57) | Bağımsız uygulama; aşağıdakiler mobile/ altı |
| `mobile/app.json` (değişir) | name/slug okulin, package com.okulin.app, googleServicesFile, plugin'ler |
| `mobile/src/config.ts` | APEX adresi + SENTRY_DSN sabitleri |
| `mobile/src/store/storage.ts` | SecureStore `KeyValueStore` sarmalayıcı (test-enjekte edilebilir) |
| `mobile/src/api/types.ts` | `lib/mobile/api-types.ts`'in script kopyası (elle DÜZENLENMEZ) |
| `mobile/src/api/tokens.ts` | TokenStore (access/refresh SecureStore; epoch + refresh-önce yazım) — client.test kapsar |
| `mobile/src/api/client.ts` (+test) | Tipli istemci: Bearer, TEK-UÇUŞ refresh mutex, 401 tek tekrar, hata çevirisi |
| `mobile/src/semver.ts` (+test) | `semverLt` (min sürüm kapısı) |
| `mobile/src/store/session.tsx` | SessionProvider: org/oturum durumu, login/logout/leaveOrg |
| `mobile/src/ui/kit.tsx` | Screen/Button/Input/LoadingScreen — ortak mini kit |
| `mobile/src/ui/Gate.tsx` | Bootstrap kapısı: bakım / min sürüm / offline ekranları |
| `mobile/src/push.ts` | kanal + izin + native FCM token + register + rotation listener |
| `mobile/app/_layout.tsx`, `app/index.tsx`, `app/kurum.tsx`, `app/giris.tsx`, `app/bugun.tsx`, `app/ayarlar.tsx` | Ekran akışı |
| `mobile/vitest.config.ts` | mobil birim test koşusu (src/**/*.test.ts) |

---

### Task 1: FCM adaptörü sertleştirme (Plan 1 devri)

Plan 1 takip notundaki go-live ön koşulları: OAuth `res.json()` guard + eşzamanlı OAuth de-dup; ek olarak FCM gövdesine `channel_id` (istemci kanalı Task 9'da açar) ve `data.eventId` (Plan 4 inbox eşleşmesi), `icon/requireInteraction`'ın cron retry'da kaybolmaması (`NotificationEvent.data`).

**Files:**
- Modify: `lib/push/providers.ts` (fcmAccessToken ~29-54, PushNotif ~67-73, deliverFcm ~101-132)
- Modify: `lib/push/outbox.ts` (deliverOne ~47-50, enqueueNotification ~106-126, dispatchDue ~154-155)
- Test: `lib/push/providers.test.ts` (dosya sonuna yeni describe)

**Interfaces:**
- Produces: `PushNotif` artık `icon?: string; data?: Record<string, string>` taşır (outbox geçirir); dışa dönük imzalar değişmez.

- [ ] **Step 1: Başarısız testleri yaz**

`lib/push/providers.test.ts` dosyasının SONUNA ekle (mevcut `pkcs8` sabitini yeniden kullanır; modül-içi `_tokenCache/_inflight` durumu için taze modül gerekir → `vi.resetModules` + dinamik import):

```typescript
describe('fcmAccessToken sertleştirme (taze modül)', () => {
  beforeEach(() => {
    vi.stubEnv('FCM_PROJECT_ID', 'okulin-mobil');
    vi.stubEnv('FCM_CLIENT_EMAIL', 'svc@x.iam.gserviceaccount.com');
    vi.stubEnv('FCM_PRIVATE_KEY', pkcs8.replace(/\n/g, '\\n'));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('eşzamanlı iki çağrı TEK OAuth isteği yapar (in-flight de-dup)', async () => {
    vi.resetModules();
    const { fcmAccessToken } = await import('./providers');
    let oauthCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        oauthCalls++;
        await new Promise((r) => setTimeout(r, 20)); // yarışı garantile
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      throw new Error('beklenmeyen fetch');
    }));
    const [a, b] = await Promise.all([fcmAccessToken(), fcmAccessToken()]);
    expect(a).toBe('tok');
    expect(b).toBe('tok');
    expect(oauthCalls).toBe(1);
  });

  it('bozuk OAuth gövdesi fırlatmaz, null döner', async () => {
    vi.resetModules();
    const { fcmAccessToken } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('html hata sayfası', { status: 200 })));
    expect(await fcmAccessToken()).toBeNull();
  });

  it('OAuth ağ hatası fırlatmaz, null döner', async () => {
    vi.resetModules();
    const { fcmAccessToken } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await fcmAccessToken()).toBeNull();
  });

  it('FCM 400 (payload hatası) KALICI SAYILMAZ — cihaz yanlışlıkla disable edilmez', async () => {
    vi.resetModules();
    const { deliver } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [] } }), { status: 400 });
    }));
    const r = await deliver({ provider: 'fcm', target: 'tok-x' }, { title: 't', body: 'b' });
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(false);
  });

  it('400 + details errorCode=UNREGISTERED → kalıcı (token gerçekten ölü)', async () => {
    vi.resetModules();
    const { deliver } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] } }),
        { status: 400 },
      );
    }));
    const r = await deliver({ provider: 'fcm', target: 'tok-olu' }, { title: 't', body: 'b' });
    expect(r.permanent).toBe(true);
  });

  it('deliver FCM gövdesine channel_id + data.eventId koyar', async () => {
    vi.resetModules();
    const { deliver } = await import('./providers');
    const bodies: Array<Record<string, never>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ name: 'projects/x/messages/1' }), { status: 200 });
    }));
    const r = await deliver(
      { provider: 'fcm', target: 'cihaz-token' },
      { title: 't', body: 'b', tag: 'etiket', url: '/x', data: { eventId: 'ne_1' } },
    );
    expect(r.ok).toBe(true);
    const msg = (bodies[0] as { message: { android: { notification: Record<string, string> }; data: Record<string, string> } }).message;
    expect(msg.android.notification.channel_id).toBe('default');
    expect(msg.android.notification.tag).toBe('etiket');
    expect(msg.data).toEqual({ url: '/x', eventId: 'ne_1' });
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/push/providers.test.ts`
Beklenen: FAIL — de-dup testi `oauthCalls=2`, channel_id testi `undefined`, 400-payload testi `permanent=true` (mevcut kod tüm 400'leri kalıcı sayıyor), OAuth ağ hatası testi fırlatıyor.

- [ ] **Step 3: providers.ts'i düzenle**

(a) `PushNotif`'e iki alan ekle:

```typescript
export interface PushNotif {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  icon?: string; // web-push payload'ına girer (sw.js okur); FCM'de kullanılmaz
  data?: Record<string, string>; // FCM data alanları (string zorunlu) — eventId vb.
}
```

(b) `fcmAccessToken`'ı in-flight de-dup + json guard ile değiştir (`let _tokenCache ...` satırının altına `_inflight` ekle):

```typescript
let _tokenCache: { token: string; expSec: number } | null = null;
let _inflight: Promise<string | null> | null = null;

export async function fcmAccessToken(): Promise<string | null> {
  const email = process.env.FCM_CLIENT_EMAIL;
  const key = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) return null; // FCM yapılandırılmamış → no-op

  const nowSec = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expSec - 60 > nowSec) return _tokenCache.token;

  // Eşzamanlı fan-out (N cihaz = N deliverFcm) tek OAuth çağrısını paylaşsın —
  // de-dup'sız Google'a N istek giderdi (Plan 1 takip notu).
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const assertion = await _fcmAssertion(email, key, nowSec);
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      if (!res.ok) {
        console.warn('[push:fcm] OAuth token alınamadı:', res.status, await res.text().catch(() => ''));
        return null;
      }
      // Bozuk gövde (proxy/ağ arızası) fırlatmasın (Plan 1 takip notu: json guard).
      const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
      if (!data?.access_token) return null;
      _tokenCache = { token: data.access_token, expSec: nowSec + (data.expires_in || 3600) };
      return data.access_token;
    } catch (err) {
      // Ağ/imza hatası fan-out veya cron döngüsünü FIRLATMASIN (İnceleme Codex #12) —
      // teslimat 'FCM yapılandırılmamış/erişilemedi' geçici hatasıyla retry'a düşer.
      console.warn('[push:fcm] OAuth ağ hatası:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}
```

(c) `deliverFcm` fonksiyonunun TAMAMINI değiştir (gövde alanları + 400 sınıflandırması + token çağrısı try içinde — İnceleme Codex #12):

```typescript
async function deliverFcm(t: Extract<PushTarget, { provider: 'fcm' }>, n: PushNotif): Promise<ProviderResult> {
  const projectId = process.env.FCM_PROJECT_ID;
  try {
    const token = await fcmAccessToken();
    if (!projectId || !token) return { ok: false, permanent: false, error: 'FCM yapılandırılmamış' };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: {
          token: t.target,
          notification: { title: n.title, body: n.body },
          // data alanları string olmak zorunda (FCM v1 kuralı). eventId: bildirim
          // merkezi eşleşmesi + dedupe hazırlığı (Plan 4 native routing okur).
          data: { ...(n.url ? { url: n.url } : {}), ...(n.data ?? {}) },
          android: {
            priority: 'HIGH',
            // İstemci 'default' kanalını oluşturur (mobile/src/push.ts) — Android 8+
            // kanal belirtilmezse bildirim "Miscellaneous"a düşer.
            notification: { channel_id: 'default', ...(n.tag ? { tag: n.tag } : {}) },
          },
        },
      }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { name?: string };
      return { ok: true, permanent: false, providerId: data.name };
    }
    // Kalıcılık kararı (İnceleme Codex #12): 404 = UNREGISTERED (token ölü). 400 tek
    // başına kalıcı DEĞİL — bozuk payload (bizim kod hatamız) da 400 döndürür ve tüm
    // cihazları yanlışlıkla disable ederdi. 400'de yalnız FCM error.details içinde
    // errorCode='UNREGISTERED' varsa kalıcı say.
    let permanent = res.status === 404;
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { error?: { details?: { errorCode?: string }[] } } | null;
      permanent = !!body?.error?.details?.some((d) => d.errorCode === 'UNREGISTERED');
    }
    return { ok: false, permanent, error: `fcm ${res.status}` };
  } catch (err) {
    return { ok: false, permanent: false, error: `fcm ağ hatası: ${err instanceof Error ? err.message : 'bilinmiyor'}` };
  }
}
```

Not: mevcut testlerden "UNREGISTERED (404) → kalıcı" aynen geçmeye devam eder (404 yolu değişmedi).

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Çalıştır: `npx vitest run lib/push/providers.test.ts`
Beklenen: eski 7 + yeni 3 = 10 test PASS. (Mevcut "başarılı gönderim" testi `data.url` eşitliğini `toEqual({ url: '/?sekme=odeme' })` ile kontrol ediyor — data merge aynı sonucu üretir, kırılmaz.)

- [ ] **Step 5: outbox.ts'e meta kalıcılığı + eventId geçişini ekle**

(a) `deliverOne` imzasındaki inline notif tipini `PushNotif` ile değiştir (import'a ekle):

```typescript
import { deliver, type PushTarget, type PushNotif } from './providers';
```

```typescript
async function deliverOne(
  d: DeliveryRow,
  notif: PushNotif,
): Promise<{ status: 'sent' | 'pending' | 'dead'; resourceRemoved: boolean }> {
```

(b) `enqueueNotification` içinde event create'ine `data` alanı ekle (`dispatchStatus: 'done',` satırının ÜSTÜNE):

```typescript
        sensitive: payload.sensitive ?? false,
        // Görsel meta cron retry'da kaybolmasın (Plan 1 takip notu) — şema değişikliği
        // yok, mevcut Json `data` alanı kullanılır.
        data: payload.icon || payload.requireInteraction
          ? { icon: payload.icon, requireInteraction: payload.requireInteraction }
          : undefined,
        dispatchStatus: 'done', // fan-out bu transaction'da yazıldı
```

(c) Anında gönderim yolunda notif'i zenginleştir (mevcut `const notif = ...` satırını değiştir):

```typescript
  const pushText = renderPush(payload);
  const notif: PushNotif = {
    ...pushText,
    url: payload.url,
    tag: payload.tag,
    icon: payload.icon,
    requireInteraction: payload.requireInteraction,
    data: { eventId },
  };
```

(d) `dispatchDue` retry yolu: SAHİPLİK KONTROLÜ + meta'yı event'ten geri oku. `if (!ev) { ... }` bloğunun ALTINDAN döngü sonuna kadar olan kısmı şu şekilde değiştir:

```typescript
    // Sahiplik kontrolü (İnceleme Codex #2 — KVKK): teslimat kuyruğa girdikten sonra
    // hedef cihaz logout / hesap silme / token devri ile el değiştirmiş olabilir.
    // NotificationDelivery.target denormalize — körlemesine gönderilirse ESKİ
    // kullanıcının bildirimi cihazın YENİ sahibine gider. Gönderimden hemen önce
    // hedefin hâlâ event'in kullanıcısına bağlı olduğunu doğrula; değilse teslimatı
    // kapat (anında gönderim yolu bu kontrolden muaf — fan-out aynı istekte taze).
    const stillOwned = d.provider === 'webpush'
      ? await prisma.pushSub.findFirst({
          where: { endpoint: d.target, orgSlug: ev.orgSlug, role: ev.role, userId: ev.userId },
          select: { id: true },
        })
      : await prisma.deviceInstallation.findFirst({
          where: { provider: d.provider, token: d.target, enabled: true, orgSlug: ev.orgSlug, role: ev.role, userId: ev.userId },
          select: { id: true },
        });
    if (!stillOwned) {
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: 'dead', lastError: 'hedef sahiplik değişti/kaldırıldı' },
      });
      dead++;
      continue;
    }

    const meta = (ev.data ?? {}) as { icon?: string; requireInteraction?: boolean };
    const pushText = renderPush({ title: ev.title, body: ev.body, sensitive: ev.sensitive });
    const { status } = await deliverOne(d, {
      ...pushText,
      url: ev.url ?? undefined,
      tag: ev.tag ?? undefined,
      icon: meta.icon,
      requireInteraction: meta.requireInteraction,
      data: { eventId: ev.id },
    });
```

- [ ] **Step 6: Tüm testler + build**

Çalıştır: `npx vitest run && npm run build`
Beklenen: tüm birim testler PASS, build başarılı.

- [ ] **Step 7: Commit**

```bash
git add lib/push/providers.ts lib/push/providers.test.ts lib/push/outbox.ts
git commit -m "feat(mobil): FCM go-live sertleştirme — OAuth de-dup + json guard + channel_id + data.eventId + inbox görsel meta kalıcılığı"
```

---

### Task 2: Cihaz kayıt servisi + push/register uçları + rate limit

`DeviceInstallation` doldurma (spec §8/§9-1): Bearer korumalı POST/DELETE `push/register`; refresh ucuna IP rate limit (Plan 2 devri Codex #10/#11); `/mobile/v1` yanıt tipleri tek kaynağa iner (`api-types.ts`, Plan 2 devri Codex #9 — mobile kopyası Task 7'de).

**Files:**
- Modify: `lib/mobile/contracts.ts` (dosya sonuna 2 şema)
- Create: `lib/mobile/api-types.ts`
- Create: `lib/mobile/devices.ts`
- Modify: `lib/mobile/sessions.ts` (`installationIdOf` — `loadActiveSession`'ın altına)
- Modify: `lib/ratelimit.ts` (dosyadaki son limiter'ın altına 2 limiter)
- Create: `app/api/mobile/v1/push/register/route.ts`
- Modify: `app/api/mobile/v1/auth/refresh/route.ts` (rate limit)

**Interfaces:**
- Consumes: `withMobileAuth` (Plan 2), `safeLimit/getClientIp/formatResetWait` (mevcut), `prisma.deviceInstallation` (Plan 1 modeli).
- Produces (Task 3/4/7/9 kullanır): `registerDevice(role, userId, input: RegisterDeviceInput): Promise<'ok' | 'conflict'>` · `unbindInstallation(installationId: string | null | undefined, role: string, userId: string): Promise<void>` (org-kapsamlı) · `unbindAllInstallations(role: string, userId: string): Promise<void>` · `installationIdOf(sid: string): Promise<string | null>` · `PushRegisterSchema/PushUnregisterSchema` · `api-types.ts`'teki tüm tipler.

**Not (TDD istisnası):** `devices.ts` saf mantık içermeyen DB katmanıdır (Plan 2 `sessions.ts` paritesi) — birim test yerine Task 4'teki canlı sözleşme testleri doğrular.

- [ ] **Step 1: contracts.ts'e şemaları ekle**

`lib/mobile/contracts.ts` sonuna:

```typescript
export const PushRegisterSchema = z.object({
  installationId: z.string().min(8).max(100),
  platform: z.enum(['android', 'ios']),
  token: z.string().min(10).max(4096),
  appVersion: z.string().max(20).optional(),
});

export const PushUnregisterSchema = z.object({
  installationId: z.string().min(8).max(100),
});
```

- [ ] **Step 2: api-types.ts'i yaz**

`lib/mobile/api-types.ts` (yeni — TAMAMI):

```typescript
// /api/mobile/v1 İSTEK + YANIT tipleri — mobil istemciyle paylaşılan TEK KAYNAK.
// KURAL: Bu dosya import İÇERMEZ (saf tipler). mobile/src/api/types.ts'e
// scripts/sync-mobile-api-types.mjs birebir kopyalar; drift'i
// lib/mobile/api-types.sync.test.ts denetler. Değiştirince `npm run mobile:types` koş.
// Route yanıt gövdeleri bu tiplere UYMALI (mevcutlar Plan 2'den birebir çıkarıldı).

export type MobileRoleCategory = 'student' | 'parent' | 'teacher' | 'management';
export type MobilePlatform = 'android' | 'ios';

// Hata zarfı: her uçta { error } + doğru HTTP status (repo standardı).
export interface ApiErrorBody {
  error: string;
  correctRole?: MobileRoleCategory; // login rol-kapısı yönlendirmesi
}

export interface ResolveOrgRequest {
  code: string;
}
export interface ResolveOrgResponse {
  ok: true;
  orgSlug: string;
  branch: string;
  name: string;
  shortName: string;
  logoUrl: string; // boş string olabilir
  themeColor: string; // #rrggbb
  canonicalHost: string; // istemci YALNIZ buna bağlanır (spec §6/3)
  active: true;
}

export interface BootstrapResponse {
  minSupportedVersion: string;
  recommendedVersion: string;
  maintenance: { active: boolean; message: string | null };
  flags: Record<string, boolean>;
  serverTime: string;
  org: {
    slug: string;
    branch: string;
    name: string;
    shortName: string;
    logoUrl: string;
    themeColor: string;
    active: boolean;
    modules: Record<string, boolean>;
  } | null; // apex'te null (kurum sızdırılmaz)
}

// Oturum payload'ı (web Session paritesi — rol-özel alanlar var).
export interface MobileSessionInfo {
  role: string;
  id: string;
  name?: string;
  org: string;
  branch: string;
  mustChangePassword?: boolean;
  [k: string]: unknown; // rol-özel: cls, group, branches, children, asst...
}

export interface LoginRequest {
  username: string;
  password: string;
  role?: MobileRoleCategory;
  installationId?: string;
  deviceName?: string;
  platform?: MobilePlatform;
}
export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token saniyesi
  sessionId: string;
  session: MobileSessionInfo;
}
export interface RefreshRequest {
  refreshToken: string;
}

export interface MeResponse {
  session: MobileSessionInfo;
}

export interface DeviceView {
  id: string;
  deviceName: string | null;
  platform: string | null;
  createdAt: string; // ISO
  lastUsedAt: string; // ISO
  current: boolean;
}
export interface DevicesResponse {
  devices: DeviceView[];
}
export interface DeviceRevokeRequest {
  sessionId?: string;
  all?: boolean;
}
export interface DeviceRevokeResponse {
  ok: true;
  revoked: number;
}

export interface PushRegisterRequest {
  installationId: string;
  platform: MobilePlatform;
  token: string;
  appVersion?: string;
}
export interface PushUnregisterRequest {
  installationId: string;
}

export interface OkResponse {
  ok: true;
}
```

- [ ] **Step 3: devices.ts'i yaz**

`lib/mobile/devices.ts` (yeni — TAMAMI):

```typescript
import { prisma } from '@/lib/prisma';
import { currentOrg, currentBranch } from '@/lib/tenant';

// DeviceInstallation katmanı (spec §8): push fan-out'unun (lib/push/outbox.ts
// enqueueNotification) native ayağını doldurur. id = istemci üretimi installationId
// (reklam kimliği değil), (provider,token) global-unique.
//
// Cihaz kurum/hesap DEĞİŞTİREBİLİR (kurumdan ayrıl + başka kurum kodu; aynı cihazda
// başka hesapla login) → satır yeni sahibe/kuruma GEÇER. Bu yüzden erişim base prisma
// ile, orgSlug/branch ELLE yazılır (savePushSubscription çapraz-tenant deseni; tdb()
// olsaydı başka kurumda kalan satır bulunamaz → P2002 patlardı).

export interface RegisterDeviceInput {
  installationId: string;
  platform: 'android' | 'ios';
  token: string;
  appVersion?: string;
}

export type RegisterOutcome = 'ok' | 'conflict';

export async function registerDevice(role: string, userId: string, input: RegisterDeviceInput): Promise<RegisterOutcome> {
  const provider = 'fcm'; // v1 Android; APNs F3'te ayrı provider değeriyle gelir
  const org = currentOrg();

  // Sahiplik sınırı (İnceleme Codex #3): installationId istemci BEYANIDIR — başka
  // kullanıcıya ait bir kaydı yalnız aynı FCM token'ını sunabilen devralabilir
  // (token cihaz-yerel sırdır; aynı cihazda hesap değişiminin doğal kanıtı).
  // Token da farklıysa 'conflict' → route 409 döner, istemci YENİ installationId
  // üretip bir kez tekrar dener (mobile/src/push.ts). Böylece sızmış/tahmin edilmiş
  // bir installationId ile başka hesabın push bağı düşürülemez.
  const existing = await prisma.deviceInstallation.findUnique({ where: { id: input.installationId } });
  const sameOwner = existing != null && existing.role === role && existing.userId === userId && existing.orgSlug === org;
  if (existing && !sameOwner && existing.token !== input.token) return 'conflict';

  // Token devri: aynı (provider,token) BAŞKA installationId'de kaldıysa (sil-kur,
  // cihaz sıfırlama) eski satır ölüdür → sil, yoksa upsert P2002'ye çarpar.
  const clearStaleToken = () =>
    prisma.deviceInstallation.deleteMany({
      where: { provider, token: input.token, id: { not: input.installationId } },
    });
  const data = {
    orgSlug: org,
    branch: currentBranch(),
    role,
    userId,
    platform: input.platform,
    provider,
    token: input.token,
    appVersion: input.appVersion,
  };
  const doUpsert = () =>
    prisma.deviceInstallation.upsert({
      where: { id: input.installationId },
      // enabled: ölü-token disable'ı yeni token'la kayıtta geri açılır
      update: { ...data, enabled: true, lastSeenAt: new Date() },
      create: { id: input.installationId, ...data },
    });

  await clearStaleToken();
  try {
    await doUpsert();
  } catch (e) {
    // Eşzamanlı iki kayıt aynı token'ı yarıştırabilir (deleteMany→upsert aralığı) —
    // (provider,token) unique P2002 üretir; bir kez daha temizle + dene (Codex #14).
    if ((e as { code?: string } | null)?.code !== 'P2002') throw e;
    await clearStaleToken();
    await doUpsert();
  }
  return 'ok';
}

// Bildirimi durdur (spec §8: logout → installation-hesap bağı kalkar). orgSlug+role+
// userId koşulu: kullanıcı YALNIZ kendi kurumundaki kendi bağını koparabilir (IDOR;
// 'director' userId'si her kurumda aynı olduğundan org koşulu ŞART — Codex #4).
// Satır SİLİNİR — sonraki login/register yeniden oluşturur.
export async function unbindInstallation(
  installationId: string | null | undefined,
  role: string,
  userId: string,
): Promise<void> {
  if (!installationId) return;
  await prisma.deviceInstallation.deleteMany({
    where: { id: installationId, orgSlug: currentOrg(), role, userId },
  });
}

// "Tüm cihazlardan çıkış" + hesap silme (purge) için: kullanıcının org'daki tüm bağları.
export async function unbindAllInstallations(role: string, userId: string): Promise<void> {
  await prisma.deviceInstallation.deleteMany({ where: { orgSlug: currentOrg(), role, userId } });
}
```

- [ ] **Step 4: sessions.ts'e installationIdOf ekle**

`lib/mobile/sessions.ts` içinde `loadActiveSession` fonksiyonunun ALTINA:

```typescript
// Oturumun bağlı olduğu installationId — logout/cihaz-iptali push bağını koparırken
// kullanılır. orgSlug=currentOrg(): başka kurumun sid'i bu host'ta bulunamaz.
export async function installationIdOf(sid: string): Promise<string | null> {
  const s = await tdb().mobileSession.findFirst({
    where: { id: sid, orgSlug: currentOrg() },
    select: { installationId: true },
  });
  return s?.installationId ?? null;
}
```

- [ ] **Step 5: ratelimit.ts'e iki limiter ekle**

`lib/ratelimit.ts` içinde son limiter tanımının (errorLogRatelimit) ALTINA:

```typescript
// Mobil push cihaz kaydı: 20 kayıt / 10 dakika (IP başına).
// Meşru istemci login/açılış/rotasyon başına 1 kayıt yapar; token-flood'u keser.
export const mobileRegisterRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '10 m'),
  analytics: false,
  prefix: 'rl:mreg',
});

// Mobil refresh: 120 istek / 10 dakika (IP başına — NAT arkasında çok cihaz olabilir;
// meşru cihaz ~15 dk'da 1 refresh yapar). Refresh-token taramasını yavaşlatır
// (Plan 2 devri Codex #10/#11'in IP katmanı).
export const mobileRefreshRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, '10 m'),
  analytics: false,
  prefix: 'rl:mref',
});
```

- [ ] **Step 6: push/register route'unu yaz**

`app/api/mobile/v1/push/register/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { registerDevice, unbindInstallation } from '@/lib/mobile/devices';
import { parseBody } from '@/lib/validate';
import { PushRegisterSchema, PushUnregisterSchema } from '@/lib/mobile/contracts';
import { mobileRegisterRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';

// Push cihaz kaydı (spec §8/§9-1): native FCM cihaz token'ı → DeviceInstallation.
// POST: kayıt/yeniden bağlama (izin sonrası + soğuk açılış + token rotasyonu).
// DELETE: bildirimi kapat / logout öncesi bağ koparma (MobileSession'a DOKUNMAZ).
// Bearer korumalı (withMobileAuth) → CSRF middleware Bearer istisnasından geçer.
export const runtime = 'nodejs';

// Rate limit iki katman (İnceleme Codex #6): IP kovası (NAT dışı flood) + oturum
// (sid) kovası — kimliği doğrulanmış istemci IP değiştirerek kovadan kaçamaz.
async function registerLimited(req: NextRequest, sid: string): Promise<NextResponse | null> {
  const ipHit = await safeLimit(mobileRegisterRatelimit, getClientIp(req));
  const sidHit = ipHit.success ? await safeLimit(mobileRegisterRatelimit, `sid:${sid}`) : ipHit;
  const hit = !ipHit.success ? ipHit : sidHit;
  if (hit.success) return null;
  return NextResponse.json(
    { error: `Çok fazla kayıt isteği. Lütfen ${formatResetWait(hit.reset)} tekrar deneyin.` },
    { status: 429 }
  );
}

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await registerLimited(req, session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, PushRegisterSchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await registerDevice(session.role, String(session.id ?? ''), parsed.data);
  if (outcome === 'conflict') {
    // installationId başka hesaba bağlı ve token kanıtı yok — istemci yeni
    // installationId üretip tek sefer tekrar dener (mobile/src/push.ts).
    return NextResponse.json({ error: 'Kurulum kimliği başka bir hesaba bağlı.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await registerLimited(req, session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, PushUnregisterSchema);
  if (!parsed.ok) return parsed.response;
  await unbindInstallation(parsed.data.installationId, session.role, String(session.id ?? ''));
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 7: refresh route'una rate limit ekle**

`app/api/mobile/v1/auth/refresh/route.ts` — import'lara ekle:

```typescript
import { mobileRefreshRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';
```

```typescript
import { createHash } from 'crypto';
```

`POST` gövdesinde `orgFromHost` kontrolünün HEMEN ALTINA (IP katmanı) ve `parseBody` başarısının HEMEN ALTINA (token katmanı — İnceleme Codex #6: kimlikli istemci IP değiştirerek kaçamasın; düz token loglanmaz, yalnız hash'in ilk 32 karakteri kova anahtarı olur):

```typescript
  const ip = getClientIp(req);
  const rl = await safeLimit(mobileRefreshRatelimit, ip);
  if (!rl.success) {
    return NextResponse.json(
      { error: `Çok fazla istek. Lütfen ${formatResetWait(rl.reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }
```

```typescript
  // Token-bazlı ikinci kova: meşru cihaz ~15 dk'da 1 refresh yapar; aynı token'ın
  // saniyelik denemesi (replay/tarama) IP'den bağımsız kesilir.
  const tokenKey = 'tok:' + createHash('sha256').update(parsed.data.refreshToken).digest('hex').slice(0, 32);
  const rlToken = await safeLimit(mobileRefreshRatelimit, tokenKey);
  if (!rlToken.success) {
    return NextResponse.json(
      { error: `Çok fazla istek. Lütfen ${formatResetWait(rlToken.reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }
```

- [ ] **Step 8: Build + commit**

Çalıştır: `npx vitest run && npm run build`
Beklenen: PASS + build başarılı.

```bash
git add lib/mobile/contracts.ts lib/mobile/api-types.ts lib/mobile/devices.ts lib/mobile/sessions.ts lib/ratelimit.ts app/api/mobile/v1/push/register/route.ts app/api/mobile/v1/auth/refresh/route.ts
git commit -m "feat(mobil): push cihaz kaydı — DeviceInstallation register/unregister + api-types tek kaynak + refresh/register IP rate limit"
```

---

### Task 3: Logout/cihaz-iptali push bağı + F1 hesap silme temizliği

İki tamamlayıcı iş: (a) spec §8 "logout → aktif installation-hesap bağı kaldırılır (bildirim durur)" — logout ve cihaz-iptali uçları installation'ı da koparır; (b) **F1 launch-blocker** (Plan 2 devri): hesap SİLME akışları mobil oturumu iptal etmiyor + cihaz kaydını bırakıyordu → `purgeMobileAccess` ile ikisi birden kapatılır.

**Files:**
- Create: `lib/mobile/purge.ts`
- Modify: `app/api/mobile/v1/auth/logout/route.ts`
- Modify: `app/api/mobile/v1/auth/devices/route.ts` (DELETE)
- Modify: `lib/students.ts` (`deleteStudent` ~164, `bulkDeleteStudents` ~171)
- Modify: `lib/teachers.ts` (`deleteTeacher` ~147)
- Modify: `app/api/counselors/route.ts`, `app/api/accountants/route.ts`, `app/api/assistant-directors/route.ts` (DELETE blokları)
- Modify: `lib/parents.ts` (`syncParents` ~50: veli silme; `resetParent` ~72: şifre sıfırlama — İnceleme Codex #5)
- Modify: `app/api/superadmin/route.ts:14-19` (TENANT_MODELS — kurum silmede mobil tablolar da temizlensin)

**Interfaces:**
- Consumes: `revokeMobileSessionsFor`, `revokeMobileSession`, `installationIdOf` (sessions.ts), `unbindInstallation/unbindAllInstallations` (devices.ts, Task 2).
- Produces: `purgeMobileAccess(role: string, userIds: string[], reason: string): Promise<void>`.

**Not (TDD istisnası):** DB katmanı — canlı doğrulama Task 4'ün F1 senaryosunda (rehber sil → access anında 401).

- [ ] **Step 1: purge.ts'i yaz**

`lib/mobile/purge.ts` (yeni — TAMAMI):

```typescript
import { tdb } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';
import { currentOrg } from '@/lib/tenant';

// Hesap SİLİNİRKEN mobil erişimin tamamı kapanır (F1 launch-blocker, Plan 2 devri):
// 1) aktif MobileSession'lar revoke → access token withMobileAuth iptal kontrolüyle
//    ANINDA ölür, refresh de çalışmaz;
// 2) DeviceInstallation bağları silinir → push fan-out cihazı artık bulamaz.
//
// BİLİNÇLİ FAIL-LOUD (şifre-sıfırlamadaki try/catch best-effort'tan sapma): silme
// akışında purge SİLMEDEN ÖNCE çağrılır; purge düşerse silme de durur (500) — aktif
// mobil oturumu kalmış "silinmiş" kullanıcı oluşmaz, retry ikisini de tekrar dener.
//
// Toplu silme (bulkDeleteStudents 2000 id'ye kadar) tek sorguda: userId IN (...).
// Rol eşlemesi çağıranın sorumluluğu: assistant_director hesabı mobil oturumda
// role='director' taşır (userId = kendi legacyId'si — gerçek müdürün userId'si
// 'director' string'i olduğundan çakışmaz). Veli hesabı öğrenci silmede İPTAL
// EDİLMEZ (telefon-bazlı, başka çocukları olabilir — plan ADR'si).
export async function purgeMobileAccess(role: string, userIds: string[], reason: string): Promise<void> {
  if (userIds.length === 0) return;
  // MobileSession sqldb SKIP'te → orgSlug ELLE (Plan 2 deseni).
  await tdb().mobileSession.updateMany({
    where: { orgSlug: currentOrg(), role, userId: { in: userIds }, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  // DeviceInstallation çapraz-tenant deseni gereği base prisma + orgSlug ELLE
  // (bkz lib/mobile/devices.ts başlık yorumu).
  await prisma.deviceInstallation.deleteMany({
    where: { orgSlug: currentOrg(), role, userId: { in: userIds } },
  });
}
```

- [ ] **Step 2: logout route'unu güncelle**

`app/api/mobile/v1/auth/logout/route.ts` (TAMAMI — mevcut dosyayı değiştir):

```typescript
import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { revokeMobileSession, installationIdOf } from '@/lib/mobile/sessions';
import { unbindInstallation } from '@/lib/mobile/devices';

// Mobil çıkış: token'daki sid'in oturumunu iptal eder — refresh artık çalışmaz;
// access token da iptal kontrolü nedeniyle ANINDA geçersiz (withMobileAuth).
// Ayrıca installation-hesap bağı koparılır → bildirim durur (spec §8).
export const runtime = 'nodejs';

export const POST = withMobileAuth(async (_req, _ctx, session) => {
  const userId = String(session.id ?? '');
  const instId = await installationIdOf(session.sid);
  await unbindInstallation(instId, session.role, userId);
  await revokeMobileSession(session.sid, session.role, userId, 'çıkış');
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 3: devices route DELETE'ini güncelle**

`app/api/mobile/v1/auth/devices/route.ts` — import'ları güncelle:

```typescript
import { listMobileDevices, revokeMobileSession, revokeMobileSessionsFor, installationIdOf } from '@/lib/mobile/sessions';
import { unbindInstallation, unbindAllInstallations } from '@/lib/mobile/devices';
```

`DELETE` gövdesini değiştir (GET aynı kalır):

```typescript
export const DELETE = withMobileAuth(async (req, _ctx, session) => {
  const parsed = await parseBody(req, MobileDeviceRevokeSchema);
  if (!parsed.ok) return parsed.response;
  const userId = String(session.id ?? '');
  if (parsed.data.all) {
    const revoked = await revokeMobileSessionsFor(session.role, userId, 'tüm cihazlardan çıkış');
    await unbindAllInstallations(session.role, userId); // bildirim de durur (spec §8)
    return NextResponse.json({ ok: true, revoked });
  }
  // Bağı ÖNCE kopar (İnceleme Codex #4 — sıra): revoke sonrası unbind hata verse
  // oturum kapanmış ama push bağlı kalırdı ve retry İMKANSIZ olurdu (revoke artık
  // 404 döner). Bu sırada hata retry edilebilir; unbind çağıranın org+role+userId
  // koşuluyla sınırlı (yabancı oturum kimliğinde no-op).
  // Not: aynı installation'da ikinci bir aktif oturum varsa (logout'suz çifte login)
  // push kısa süre kesilir; istemci soğuk açılışta sessizce yeniden kaydolur (Task 9).
  const instId = await installationIdOf(parsed.data.sessionId!);
  await unbindInstallation(instId, session.role, userId);
  const ok = await revokeMobileSession(parsed.data.sessionId!, session.role, userId, 'cihaz iptali');
  if (!ok) return NextResponse.json({ error: 'Oturum bulunamadı' }, { status: 404 });
  return NextResponse.json({ ok: true, revoked: 1 });
});
```

- [ ] **Step 4: Silme akışlarına purge ekle (F1)**

(a) `lib/students.ts` — import ekle:

```typescript
import { purgeMobileAccess } from './mobile/purge';
```

`deleteStudent` ve `bulkDeleteStudents`'ı değiştir:

```typescript
export async function deleteStudent(id: string): Promise<{ name: string; cls: string }> {
  const s = await tdb().student.findFirst({ where: { legacyId: id }, include: { class: true } });
  if (s) {
    // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1) — bkz lib/mobile/purge.ts.
    await purgeMobileAccess('student', [id], 'hesap silindi');
    await tdb().student.delete({ where: { id: s.id } }); // cascade: finance/behavior
  }
  return { name: s?.name || id, cls: s?.class?.legacyId || '' };
}

export async function bulkDeleteStudents(ids: string[]): Promise<number> {
  await purgeMobileAccess('student', ids, 'hesap silindi'); // F1 — silmeden önce
  await tdb().student.deleteMany({ where: { legacyId: { in: ids } } }); // cascade: finance/behavior
  return ids.length;
}
```

(b) `lib/teachers.ts` — import ekle:

```typescript
import { purgeMobileAccess } from './mobile/purge';
```

`deleteTeacher`'ı değiştir:

```typescript
export async function deleteTeacher(id: string): Promise<{ name: string }> {
  const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
  if (t) {
    // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1) — bkz lib/mobile/purge.ts.
    await purgeMobileAccess('teacher', [id], 'hesap silindi');
    await tdb().teacher.delete({ where: { id: t.id } });
  }
  return { name: t?.name || id };
}
```

(c) `app/api/counselors/route.ts` — import ekle:

```typescript
import { purgeMobileAccess } from '@/lib/mobile/purge';
```

DELETE içindeki `if (a) await tdb().counselor.delete({ where: { id: a.id } });` satırını değiştir:

```typescript
  if (a) {
    // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1) — bkz lib/mobile/purge.ts.
    await purgeMobileAccess('counselor', [id], 'hesap silindi');
    await tdb().counselor.delete({ where: { id: a.id } });
  }
```

(d) `app/api/accountants/route.ts` — aynı import; DELETE içindeki `if (a) await tdb().accountant.delete({ where: { id: a.id } });` satırını değiştir:

```typescript
  if (a) {
    // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1) — bkz lib/mobile/purge.ts.
    await purgeMobileAccess('accountant', [id], 'hesap silindi');
    await tdb().accountant.delete({ where: { id: a.id } });
  }
```

(e) `app/api/assistant-directors/route.ts` — aynı import; DELETE içindeki `if (a) await tdb().assistantDirector.delete({ where: { id: a.id } });` satırını değiştir:

```typescript
  if (a) {
    // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1). Müdür yardımcısı mobil
    // oturumda role='director' + userId=legacyId taşır (şifre-sıfırlama paritesi).
    await purgeMobileAccess('director', [id], 'hesap silindi');
    await tdb().assistantDirector.delete({ where: { id: a.id } });
  }
```

(f) `lib/parents.ts` — veli hesabı da GERÇEK bir silme yoludur (İnceleme Codex #5: `syncParents` çocuğu kalmayan veliyi siler). Import ekle:

```typescript
import { purgeMobileAccess } from './mobile/purge';
import { revokeMobileSessionsFor } from './mobile/sessions';
```

`syncParents` içindeki silme döngüsünü değiştir:

```typescript
  for (const p of existing) {
    if (!map.has(p.phone)) {
      // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1) — veli userId'si telefon.
      await purgeMobileAccess('parent', [p.phone], 'hesap silindi');
      await tdb().parent.delete({ where: { id: p.id } });
      removed++;
    }
  }
```

`resetParent`'ta şifre güncellemesinin ALTINA (diğer rollerin şifre-sıfırlama paritesi — orada best-effort deseni kullanılıyor, burada da öyle):

```typescript
  // Şifre sıfırlanınca mobil oturumlar da kapanır (auth route reset paritesi).
  // Best-effort: iptal hatası şifre sıfırlamayı geri döndürmez.
  try {
    await revokeMobileSessionsFor('parent', phone, 'şifre sıfırlandı');
  } catch (e) {
    console.warn('[mobil] veli şifre sıfırlamada oturum iptali başarısız:', e instanceof Error ? e.message : e);
  }
```

(g) `app/api/superadmin/route.ts` — kurum silme (`DELETE`) `TENANT_MODELS` üzerinden `orgSlug` ile temizlik yapar; mobil tablolar ve bildirim tabloları listede YOK (İnceleme Codex #5: silinmiş kurumun MobileSession'ı yaşamaya devam ederdi). Listeyi güncelle:

```typescript
const TENANT_MODELS = [
  'director', 'counselor', 'accountant', 'parent', 'teacher', 'student', 'class', 'course',
  'slotBooking', 'tenantConfig', 'finance', 'expense', 'attendance', 'behavior', 'exam',
  'odev', 'hedef', 'etkinlik', 'form', 'lead', 'announcement', 'resource', 'topic',
  'guidance', 'auditLog', 'errLog', 'pushSub', 'payOrder',
  // Mobil + bildirim tabloları (Plan 3, İnceleme Codex #5): kurum silinince cihaz
  // oturumları/kayıtları ve bildirim kuyruğu da gitmeli — kalan MobileSession,
  // silinmiş kurumun host'unda çalışmaya devam ederdi.
  'assistantDirector', 'notifLog', 'notificationEvent', 'notificationDelivery',
  'mobileSession', 'deviceInstallation',
];
```

(Not: `assistantDirector` ve `notifLog` da listede eksikti — aynı sızıntı sınıfı, tek satırla birlikte kapatılır.)

- [ ] **Step 5: Build + commit**

Çalıştır: `npx vitest run && npm run build`
Beklenen: PASS + build başarılı.

```bash
git add lib/mobile/purge.ts app/api/mobile/v1/auth/logout/route.ts app/api/mobile/v1/auth/devices/route.ts lib/students.ts lib/teachers.ts lib/parents.ts app/api/counselors/route.ts app/api/accountants/route.ts app/api/assistant-directors/route.ts app/api/superadmin/route.ts
git commit -m "feat(mobil): F1 — hesap/veli/kurum silme + logout/cihaz iptali mobil oturumu ve push bağını kapatır (purgeMobileAccess)"
```

---

### Task 4: Deploy + canlı sözleşme testleri (int-mobile-push)

Task 1-3 canlıya çıkar; register/rotation/devir/unregister ve F1 zinciri canlı testkurs'a karşı doğrulanır.

**Files:**
- Create: `e2e/int-mobile-push.spec.js`

**Interfaces:**
- Consumes: canlı `/api/mobile/v1/*` uçları; `e2e/helpers` (`BASE`, `DIR_STATE`); `.env.local` creds (`OKULIN_STU_USER/PASS`).

- [ ] **Step 1: Push + deploy doğrulama**

Önce (Codex operasyon notu): `npm i -g vercel@latest` (yerel CLI 56.2.0 → 56.2.1+).

```bash
git push
```

Vercel otomatik deploy'u bekle, sonra DOĞRU COMMIT'in canlıda olduğunu doğrula (`serverTime` eski deploy'da da güncel olur — kanıt değil; İnceleme Codex #14):

```bash
git rev-parse --short HEAD
vercel inspect okulin.com 2>&1 | grep -iE 'commit|status|ready'
```

Beklenen: inspect çıktısındaki commit SHA'sı yerel HEAD ile aynı, durum READY.

- [ ] **Step 2: Canlı sözleşme testini yaz**

`e2e/int-mobile-push.spec.js` (yeni — TAMAMI):

```javascript
/**
 * ENTEGRASYON — mobil push cihaz kaydı + F1 hesap-silme temizliği (canlı testkurs)
 * register (yeni / token rotasyonu / reinstall devri / yetkisiz) → unregister →
 * F1: geçici REHBER hesabı silinince access token ANINDA ölür (purgeMobileAccess).
 *
 * Rate-limit bütçesi: login kovası ip:username (5/15dk) — STU 1 + geçici rehber 1
 * (farklı username → ayrı kova). register kovası rl:mreg 20/10dk (IP ve sid ayrı
 * kovalar) — testte ~9 kayıt isteği, limite uzak.
 * Temizlik: geçici rehber afterAll'da her koşulda silinir.
 */
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { BASE, DIR_STATE } = require('./helpers');

const STU_USER = process.env.OKULIN_STU_USER;
const STU_PASS = process.env.OKULIN_STU_PASS;

test.describe('Mobil push kaydı + F1 hesap silme (canlı)', () => {
  test.describe.configure({ mode: 'serial' });

  let api; // native taklidi (Origin başlığı YOK, cookie yok)
  let web; // director web oturumu (geçici rehber CRUD)
  let access;
  let couId = null; // geçici rehber — afterAll temizliği
  const instA = 'e2e-inst-' + crypto.randomUUID();
  const instB = 'e2e-inst-' + crypto.randomUUID();
  const tokA = 'e2e-fcm-' + crypto.randomUUID();
  const tokB = 'e2e-fcm-' + crypto.randomUUID();

  test.beforeAll(async ({ playwright }) => {
    expect(STU_PASS, "OKULIN_STU_USER/PASS .env.local'de tanımlı olmalı").toBeTruthy();
    api = await playwright.request.newContext();
    web = await playwright.request.newContext({
      storageState: DIR_STATE,
      extraHTTPHeaders: { Origin: BASE }, // cookie-auth mutasyonlar CSRF için Origin ister
    });
    const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, {
      data: { username: STU_USER, password: STU_PASS, role: 'student', installationId: instA, platform: 'android' },
    });
    expect(r.status(), await r.text()).toBe(200);
    access = (await r.json()).accessToken;
  });

  test.afterAll(async () => {
    if (couId) await web.delete(`${BASE}/api/counselors`, { data: { id: couId } }).catch(() => {});
    await api?.dispose();
    await web?.dispose();
  });

  const H = (t) => ({ Authorization: `Bearer ${t || access}` });

  test('register: yeni cihaz 200', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instA, platform: 'android', token: tokA, appVersion: '0.1.0' },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test('register: aynı installation yeni token (rotasyon) 200', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instA, platform: 'android', token: tokB },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test('register: aynı token BAŞKA installation (reinstall devri) 200', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instB, platform: 'android', token: tokB },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test("register: Bearer'sız 401", async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      data: { installationId: instA, platform: 'android', token: tokA },
    });
    expect(r.status()).toBe(401);
  });

  test('register: geçersiz gövde 400', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instA, platform: 'windows', token: tokA },
    });
    expect(r.status()).toBe(400);
  });

  test('unregister: 200', async () => {
    const r = await api.delete(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instB },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test("eşzamanlı iki kayıt aynı token ile yarışırsa ikisi de 200 (P2002 retry)", async () => {
    const tokC = 'e2e-fcm-' + crypto.randomUUID();
    const [r1, r2] = await Promise.all([
      api.post(`${BASE}/api/mobile/v1/push/register`, {
        headers: H(),
        data: { installationId: 'e2e-inst-' + crypto.randomUUID(), platform: 'android', token: tokC },
      }),
      api.post(`${BASE}/api/mobile/v1/push/register`, {
        headers: H(),
        data: { installationId: 'e2e-inst-' + crypto.randomUUID(), platform: 'android', token: tokC },
      }),
    ]);
    expect(r1.status(), await r1.text()).toBe(200);
    expect(r2.status(), await r2.text()).toBe(200);
  });

  test('F1: rehber silinince mobil erişim ANINDA ölür (+ sahiplik 409)', async () => {
    // 1) Geçici rehber (director web API; username = name, counselors route kuralı)
    const name = 'E2E F1 Rehber ' + Date.now();
    const pass = 'e2e-F1-' + crypto.randomUUID().slice(0, 8);
    const instF = 'e2e-inst-' + crypto.randomUUID();
    const c = await web.post(`${BASE}/api/counselors`, { data: { name, password: pass } });
    expect(c.status(), await c.text()).toBe(200);
    couId = (await c.json()).id;

    // 2) Mobil login (management kategorisi) + cihaz kaydı + me yeşil
    const l = await api.post(`${BASE}/api/mobile/v1/auth/login`, {
      data: { username: name, password: pass, role: 'management', installationId: instF, platform: 'android' },
    });
    expect(l.status(), await l.text()).toBe(200);
    const { accessToken: couAccess, refreshToken: couRefresh } = await l.json();
    const reg = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(couAccess),
      data: { installationId: instF, platform: 'android', token: 'e2e-fcm-' + crypto.randomUUID() },
    });
    expect(reg.status(), await reg.text()).toBe(200);
    const me1 = await api.get(`${BASE}/api/mobile/v1/me`, { headers: H(couAccess) });
    expect(me1.status()).toBe(200);

    // 3) Sahiplik sınırı: BAŞKA kullanıcı (öğrenci) rehberin installationId'sini
    //    FARKLI token'la devralamaz → 409 (İnceleme Codex #3)
    const hijack = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(), // öğrenci access'i
      data: { installationId: instF, platform: 'android', token: 'e2e-fcm-' + crypto.randomUUID() },
    });
    expect(hijack.status(), await hijack.text()).toBe(409);

    // 4) Hesabı sil (director) → purgeMobileAccess silmeden önce koşar
    const d = await web.delete(`${BASE}/api/counselors`, { data: { id: couId } });
    expect(d.status(), await d.text()).toBe(200);
    couId = null;

    // 5) Access ANINDA geçersiz (15 dk exp BEKLENMEZ) + refresh de ölü (İnceleme Codex #14)
    const me2 = await api.get(`${BASE}/api/mobile/v1/me`, { headers: H(couAccess) });
    expect(me2.status()).toBe(401);
    const ref = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: couRefresh } });
    expect(ref.status()).toBe(401);
  });
});
```

- [ ] **Step 3: Testleri koş**

```bash
npx playwright test e2e/int-mobile-push.spec.js --project=int
npx playwright test e2e/int-mobile-auth.spec.js --project=int
```

Beklenen: yeni spec tümü PASS + mevcut mobil auth regresyonsuz (reuse testi ~35 sn bekler). Kırılan olursa düzelt, `fix:` commit'iyle işle, push'la, yeniden koş.

- [ ] **Step 4: Commit + push**

```bash
git add e2e/int-mobile-push.spec.js
git commit -m "test(mobil): push cihaz kaydı + F1 hesap-silme canlı sözleşme testleri"
git push
```

---

### Task 5: Yerel Android build zinciri (JDK 17 + SDK cmdline-tools + telefon)

Operasyonel kurulum — commit yok. Tam Android Studio KURULMAZ (disk kararı, ADR): Temurin JDK 17 + Android command-line tools + platform-tools yeterli; gradle eksik SDK bileşenlerini (lisanslar kabul edilince) ilk build'de kendisi indirir.

**Files:** yok (sistem kurulumu + `~/.zshrc`).

- [ ] **Step 1: JDK 17 + Android command-line tools kur**

```bash
brew install --cask temurin@17
brew install --cask android-commandlinetools
```

Doğrula: `/usr/libexec/java_home -v 17` bir yol basmalı.

- [ ] **Step 2: Ortam değişkenleri**

`~/.zshrc` sonuna ekle, sonra `exec zsh`:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

- [ ] **Step 3: SDK bileşenleri + lisanslar**

```bash
sdkmanager --sdk_root="$ANDROID_HOME" --install "platform-tools" "cmdline-tools;latest"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
```

(`cmdline-tools;latest` SDK köküne de kurulur — brew, araçları kendi dizinine koyar;
gradle/AGP bazı akışlarda bunları `$ANDROID_HOME/cmdline-tools` altında arar.
İnceleme: Gemini B1-1.)

Beklenen: "All SDK package licenses accepted". Doğrula: `adb --version` çalışır ve `ls "$ANDROID_HOME/licenses"` dolu.

- [ ] **Step 4: Telefonu hazırla (Mustafa)**

1. Ayarlar → Telefon hakkında → **Yapı numarası**'na 7 kez dokun (geliştirici modu açılır)
2. Ayarlar → Geliştirici seçenekleri → **USB hata ayıklama** AÇ
3. Telefonu USB ile Mac'e bağla → telefonda çıkan "USB hata ayıklamaya izin verilsin mi?" penceresinde **bu bilgisayara her zaman izin ver** + İzin ver

Doğrula:

```bash
adb devices
```

Beklenen: cihaz seri numarası + `device` (eğer `unauthorized` görünürse telefondaki izin penceresini onayla).

---

### Task 6: Expo iskeleti + Firebase Android kaydı + telefonda ilk boot

`mobile/` bağımsız Expo (SDK 57) uygulaması olarak kurulur (spec §4: aynı repo, bağımsız package.json, Turborepo YOK); kimlik `com.okulin.app`; google-services.json bağlanır; telefonda ilk debug build açılır. Web kök yapılandırmaları mobile'ı dışlar.

**Files:**
- Create: `mobile/` (create-expo-app çıktısı; app.json düzenlenir)
- Modify: `.gitignore` (kök), `tsconfig.json` (exclude), `vitest.config.js` (exclude)

- [ ] **Step 1: Uygulamayı oluştur**

```bash
cd /Users/mustafa/Workspace/active/okulin
npx create-expo-app@latest mobile --template default@sdk-57
```

(`--template default@sdk-57` pini şart — İnceleme Codex #1: bayraksız komut geçiş
dönemlerinde bir önceki SDK'yı üretebilir.)

Beklenen: SDK 57 template (Expo Router + TypeScript default). Doğrula: `grep '"expo"' mobile/package.json` → `"expo": "~57.x"`. Kurulum node sürümüne takılırsa plan ADR'sindeki "Node 20 korunur" notuna bak (mise ile yalnız mobile/ için node 22 kur).

- [ ] **Step 2: Örnek ekranları temizle**

```bash
cd mobile && npm run reset-project
```

Sorulara: örnek dosyaları **taşıma, SİL** (delete). Beklenen: `mobile/app/` içinde yalnız `index.tsx` + `_layout.tsx` kalır.

- [ ] **Step 3: SDK paketlerini ekle**

```bash
npx expo install expo-secure-store expo-notifications expo-crypto expo-constants expo-device expo-dev-client
```

(`npx expo install` SDK 57 ile uyumlu sürümleri pinler — elle sürüm yazma.)

- [ ] **Step 4: Firebase Android app kaydı (Mustafa — operasyonel)**

1. console.firebase.google.com → **okulin-mobil** projesi → Project Overview → **Add app** → Android simgesi
2. Android package name: `com.okulin.app` · App nickname: `okulin-android` · SHA-1: **boş bırak** (FCM için gerekmez)
3. **Register app** → **google-services.json'u indir**
4. Dosyayı `mobile/google-services.json` konumuna taşı (repo köküne DEĞİL)
5. Konsolun sonraki "SDK ekleme" adımlarını ATLA (Expo plugin halleder) → Continue to console

Doğrula: `ls mobile/google-services.json` var. CLAUDE.local.md'ye not düş: "google-services.json gitignore'da; kayıpta Firebase Console → okulin-mobil → Android app → yeniden indir".

- [ ] **Step 5: app.json'u düzenle**

`mobile/app.json` içinde şu alanları GÜNCELLE/EKLE (template'in splash/icon/experiments alanlarına dokunma):

```json
{
  "expo": {
    "name": "okulin",
    "slug": "okulin",
    "version": "0.1.0",
    "scheme": "okulin",
    "userInterfaceStyle": "automatic",
    "android": {
      "package": "com.okulin.app",
      "googleServicesFile": "./google-services.json"
    },
    "ios": {
      "bundleIdentifier": "com.okulin.app"
    },
    "plugins": ["expo-router", "expo-secure-store", "expo-notifications"]
  }
}
```

(Template `plugins` içinde `expo-router` ve `expo-splash-screen` zaten varsa listeyi koru, `expo-secure-store` + `expo-notifications`'ı EKLE. `android.intentFilters` + assetlinks BİLEREK YOK — Plan 5, ADR.)

- [ ] **Step 6: Kök dışlamaları**

(a) Kök `.gitignore` sonuna ekle:

```
# Mobil (Expo) — yerel/native üretilen dosyalar + Firebase client config (public repo)
mobile/android/
mobile/ios/
mobile/.expo/
mobile/google-services.json
```

(b) Kök `tsconfig.json` `exclude` dizisine `"mobile"` ekle:

```json
  "exclude": [
    "node_modules",
    "scripts",
    "scratch",
    "tmp",
    "solver-service",
    "e2e",
    "testsprite_tests",
    "mobile"
  ]
```

(c) `vitest.config.js` `exclude` dizisine `'mobile/**'` ekle (mobil kendi vitest'iyle koşar):

```javascript
    exclude: ['e2e/**', 'node_modules/**', '.next/**', 'out-render/**', 'scripts/**', 'mobile/**'],
```

- [ ] **Step 7: Telefonda ilk build**

Telefon USB'de bağlıyken:

```bash
cd mobile && npx expo run:android
```

Beklenen: prebuild `mobile/android/` üretir, gradle ilk seferde bileşen indirir (~10-20 dk), APK telefona kurulur, Metro bağlanır, telefonda Expo Router boş index ekranı açılır. (Cihaz sorulursa fiziksel cihazı seç.)

- [ ] **Step 8: Web etkilenmedi kanıtı + commit**

```bash
cd /Users/mustafa/Workspace/active/okulin
npx vitest run && npm run build
git add mobile .gitignore tsconfig.json vitest.config.js
git commit -m "feat(mobil): Expo SDK 57 iskeleti — com.okulin.app kimliği, SecureStore/Notifications paketleri, kök dışlamalar"
```

(Not: `git add mobile` gitignore sayesinde `android/`, `.expo/`, `google-services.json`, `node_modules/` almaz — `git status --short mobile | head` ile doğrula.)

---

### Task 7: Mobil çekirdek katman — depo, token, API istemcisi (refresh mutex), tip senkronu

Saf (RN import'suz) çekirdek modüller + vitest: SecureStore sarmalayıcı, TokenStore, tipli API istemcisi (TEK-UÇUŞ refresh mutex — Plan 2 devri Gemini #5), semver kapısı; `api-types.ts` kopya script'i + web tarafında drift testi.

**Files:**
- Create: `mobile/src/config.ts`, `mobile/src/store/storage.ts`, `mobile/src/api/tokens.ts`, `mobile/src/api/client.ts`, `mobile/src/semver.ts`
- Create: `mobile/src/api/client.test.ts`, `mobile/src/semver.test.ts`
- Create: `mobile/vitest.config.ts`
- Create: `scripts/sync-mobile-api-types.mjs` (web kökü)
- Create: `lib/mobile/api-types.sync.test.ts` (web kökü)
- Modify: `package.json` (web kökü — `mobile:types` script), `mobile/package.json` (test script + vitest)

**Interfaces:**
- Consumes: `lib/mobile/api-types.ts` (Task 2).
- Produces (Task 8-9 kullanır): `KeyValueStore` + `secureStorage` · `createTokenStore(kv): TokenStore` · `createApiClient(opts): ApiClient` (`get/post/del/login/logout`) · `ApiError { status, correctRole? }` · `semverLt(a, b): boolean`.

- [ ] **Step 1: Tip senkron script'i + web drift testi**

(a) `scripts/sync-mobile-api-types.mjs` (yeni — TAMAMI):

```javascript
// lib/mobile/api-types.ts → mobile/src/api/types.ts birebir kopya.
// Tek kaynak web tarafıdır; mobil kopya ELLE DÜZENLENMEZ.
// Drift denetimi: lib/mobile/api-types.sync.test.ts (npm test).
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('mobile/src/api', { recursive: true });
copyFileSync('lib/mobile/api-types.ts', 'mobile/src/api/types.ts');
console.log('mobile/src/api/types.ts güncellendi (lib/mobile/api-types.ts kopyası)');
```

(b) Web `package.json` scripts'e ekle:

```json
    "mobile:types": "node scripts/sync-mobile-api-types.mjs",
```

(c) İlk kopyayı üret: `npm run mobile:types` → `mobile/src/api/types.ts` oluşur.

(d) `lib/mobile/api-types.sync.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('mobil api tipleri senkron', () => {
  it('mobile/src/api/types.ts, lib/mobile/api-types.ts ile birebir aynı (npm run mobile:types)', () => {
    const src = readFileSync('lib/mobile/api-types.ts', 'utf8');
    const copy = readFileSync('mobile/src/api/types.ts', 'utf8');
    expect(copy).toBe(src);
  });
});
```

- [ ] **Step 2: Mobil vitest kurulumu**

```bash
cd mobile && npm install --save-dev vitest
```

`mobile/vitest.config.ts` (yeni — TAMAMI):

```typescript
import { defineConfig } from 'vitest/config';

// Yalnız saf (RN import'suz) src modülleri test edilir — ekran/native testleri
// Maestro/Detox ile Plan 4+ (spec §13).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

`mobile/package.json` scripts'e ekle:

```json
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
```

- [ ] **Step 3: config + storage + tokens + semver modülleri**

(a) `mobile/src/config.ts` (yeni — TAMAMI):

```typescript
// Uygulama sabitleri.
// APEX_BASE: resolve-org'un TEK adresi — kurum host'ları buradan çözülür, elle
// girilen host'a ASLA bağlanılmaz (spec §6/3).
// SENTRY_DSN Task 10'da doldurulur (DSN sır değildir, istemciye gömülür).
export const APEX_BASE = 'https://okulin.com';
export const SENTRY_DSN = '';

// Host allowlist'i (spec §6/3 + İnceleme Codex #11): resolve-org YANITINDAKİ
// canonicalHost bile doğrulanmadan kullanılmaz — istemci yalnız *.okulin.com
// desenine bağlanır (yanıt kurcalanır/bozulursa şifreler yabancı host'a gitmez).
export function isAllowedHost(host: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*\.okulin\.com$/.test(host);
}
```

(b) `mobile/src/store/storage.ts` (yeni — TAMAMI):

```typescript
import * as SecureStore from 'expo-secure-store';

// SecureStore (iOS Keychain / Android Keystore) sarmalayıcı — spec §7 saklama kararı.
// Arayüz enjekte edilebilir: testler bellek-içi fake kullanır (RN import'u test
// dosyalarına sızmaz).

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export const secureStorage: KeyValueStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};
```

(c) `mobile/src/api/tokens.ts` (yeni — TAMAMI):

```typescript
import type { KeyValueStore } from '../store/storage';

// Access/refresh token deposu. SecureStore değerleri küçük tutulur (~2KB sınır) —
// oturum payload'ı SAKLANMAZ (boot'ta /me çekilir, plan ADR'si).
//
// epoch (İnceleme Codex #8): logout/kurum değişimi sayacı. Geç gelen bir refresh
// yanıtı, arada logout/yeni login olduysa eski oturumu DİRİLTMESİN ve yenisini
// EZMESİN diye setPair beklenen epoch ile çağrılır; clear() epoch'u artırır,
// eşleşmeyen yazım reddedilir (false döner).

export interface TokenStore {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  epoch(): number;
  setPair(p: { accessToken: string; refreshToken: string }, expectedEpoch?: number): Promise<boolean>;
  clear(): Promise<void>;
}

const ACCESS_KEY = 'okulin.access';
const REFRESH_KEY = 'okulin.refresh';

export function createTokenStore(kv: KeyValueStore): TokenStore {
  let epoch = 0;
  return {
    getAccess: () => kv.get(ACCESS_KEY),
    getRefresh: () => kv.get(REFRESH_KEY),
    epoch: () => epoch,
    async setPair(p, expectedEpoch) {
      if (expectedEpoch !== undefined && expectedEpoch !== epoch) return false; // bayat yazım
      // Yazım sırası REFRESH-ÖNCE (İnceleme Codex #8): uygulama iki yazım arasında
      // ölürse "yeni refresh + eski access" kalır — eski access 401 yer, refresh
      // çalışır. Ters sıra "yeni access + eski refresh" bırakırdı; eski refresh
      // sonraki kullanımda grace-dışı REUSE sayılıp oturumu kapatırdı.
      await kv.set(REFRESH_KEY, p.refreshToken);
      await kv.set(ACCESS_KEY, p.accessToken);
      return true;
    },
    async clear() {
      epoch++;
      await kv.del(ACCESS_KEY);
      await kv.del(REFRESH_KEY);
    },
  };
}
```

(d) `mobile/src/semver.ts` (yeni — TAMAMI):

```typescript
// "1.2.3" biçimli sürüm karşılaştırma — bootstrap minSupportedVersion kapısı için.
// Eksik/bozuk parça 0 sayılır (fail-open değil: "0.0.0" min her sürümü geçirir,
// superadmin min'i yükselttiğinde eski sürüm kapıya takılır).
export function semverLt(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}
```

(e) `mobile/src/semver.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { semverLt } from './semver';

describe('semverLt', () => {
  it('küçük < büyük', () => {
    expect(semverLt('0.1.0', '0.2.0')).toBe(true);
    expect(semverLt('1.9.9', '2.0.0')).toBe(true);
    expect(semverLt('1.0.9', '1.1.0')).toBe(true);
  });
  it('eşit ve büyük → false', () => {
    expect(semverLt('1.2.3', '1.2.3')).toBe(false);
    expect(semverLt('2.0.0', '1.9.9')).toBe(false);
  });
  it('bozuk/eksik parça 0 sayılır', () => {
    expect(semverLt('1.2', '1.2.1')).toBe(true);
    expect(semverLt('abc', '0.0.1')).toBe(true);
    expect(semverLt('1.0.0', '')).toBe(false);
  });
});
```

- [ ] **Step 4: Başarısız istemci testini yaz**

`mobile/src/api/client.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createApiClient, ApiError } from './client';
import { createTokenStore } from './tokens';
import type { KeyValueStore } from '../store/storage';

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
  };
}

const PAIR = {
  accessToken: 'acc-2',
  refreshToken: 'ref-2',
  expiresIn: 900,
  sessionId: 'ms_1',
  session: { role: 'student', id: 's1', org: 'testkurs', branch: 'main' },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeClient(fetchFn: typeof fetch, onSessionExpired?: () => void) {
  const tokens = createTokenStore(memoryStore());
  const client = createApiClient({
    baseUrl: 'https://testkurs.okulin.com',
    tokens,
    appVersion: '0.1.0',
    fetchFn,
    onSessionExpired,
    refreshRetryDelayMs: 1, // testte 2 sn bekleme olmasın
  });
  return { client, tokens };
}

describe('createApiClient', () => {
  it('Bearer + x-okulin-app başlıklarını ekler', async () => {
    let seen: Record<string, string> = {};
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
      return json(200, { ok: true });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'acc-1', refreshToken: 'ref-1' });
    await client.get('/api/mobile/v1/me');
    expect(seen.authorization).toBe('Bearer acc-1');
    expect(seen['x-okulin-app']).toBe('android/0.1.0');
  });

  it('401 → refresh → TEK tekrar; eşzamanlı iki 401 TEK refresh çağrısı yapar (mutex)', async () => {
    let refreshCalls = 0;
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20)); // yarışı garantile
        return json(200, PAIR);
      }
      const auth = ((init?.headers ?? {}) as Record<string, string>).authorization;
      if (auth === 'Bearer acc-2') return json(200, { session: PAIR.session });
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'acc-eski', refreshToken: 'ref-1' });
    const [a, b] = await Promise.all([
      client.get<{ session: { id: string } }>('/api/mobile/v1/me'),
      client.get<{ session: { id: string } }>('/api/mobile/v1/me'),
    ]);
    expect(a.session.id).toBe('s1');
    expect(b.session.id).toBe('s1');
    expect(refreshCalls).toBe(1);
    expect(await tokens.getRefresh()).toBe('ref-2'); // yeni çift kaydedildi
  });

  it('refresh 401 → token temizle + onSessionExpired', async () => {
    const expired = vi.fn();
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) return json(401, { error: 'Oturum geçersiz' });
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f, expired);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    await expect(client.get('/api/mobile/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    expect(await tokens.getRefresh()).toBeNull();
  });

  it('refresh AĞ hatası → token KORUNUR (offline oturum düşürmez)', async () => {
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) throw new TypeError('network');
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    await expect(client.get('/api/mobile/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(await tokens.getRefresh()).toBe('r');
  });

  it('refresh 503 (geçici sunucu hatası) → token KORUNUR, onSessionExpired ÇAĞRILMAZ', async () => {
    const expired = vi.fn();
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) return json(503, { error: 'bakım' });
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f, expired);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    await expect(client.get('/api/mobile/v1/me')).rejects.toMatchObject({ status: 0 });
    expect(expired).not.toHaveBeenCalled();
    expect(await tokens.getRefresh()).toBe('r');
  });

  it('refresh sürerken clear (logout yarışı) → geç gelen çift YAZILMAZ (epoch)', async () => {
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 30));
        return json(200, PAIR);
      }
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    const inflight = client.get('/api/mobile/v1/me').catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    await tokens.clear(); // kullanıcı tam bu anda çıkış yaptı
    await inflight;
    expect(await tokens.getRefresh()).toBeNull(); // oturum diriltilmedi
  });

  it('login: hata gövdesindeki error + correctRole ApiError\'a taşınır', async () => {
    const f = vi.fn(async () =>
      json(403, { error: 'Bu bilgiler Veli hesabına ait.', correctRole: 'parent' }),
    ) as unknown as typeof fetch;
    const { client } = makeClient(f);
    await expect(client.login({ username: 'x', password: 'y', role: 'student' })).rejects.toMatchObject({
      status: 403,
      correctRole: 'parent',
    });
  });

  it('login başarılı → çift kaydedilir', async () => {
    const f = vi.fn(async () => json(200, PAIR)) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    const r = await client.login({ username: 'x', password: 'y' });
    expect(r.session.role).toBe('student');
    expect(await tokens.getAccess()).toBe('acc-2');
  });
});
```

- [ ] **Step 5: Testin başarısız olduğunu doğrula**

```bash
cd mobile && npx vitest run src/api/client.test.ts
```

Beklenen: FAIL — `Cannot find module './client'`.

- [ ] **Step 6: İstemciyi yaz**

`mobile/src/api/client.ts` (yeni — TAMAMI):

```typescript
import type {
  LoginRequest,
  MobileRoleCategory,
  TokenPairResponse,
} from './types';
import type { TokenStore } from './tokens';

// Tipli /api/mobile/v1 istemcisi.
// - Her istekte Bearer + x-okulin-app başlığı.
// - 401 → TEK-UÇUŞ refresh mutex (Plan 2 devri Gemini #5: eşzamanlı 401'ler tek
//   refresh paylaşır — rotation'da ikinci istek eski token'la reuse tetiklemesin) →
//   başarılıysa isteği BİR KEZ tekrarlar.
// - Refresh 401/4xx → oturum bitti: token'lar silinir + onSessionExpired.
// - Refresh AĞ hatası → token'lar KORUNUR (offline oturum düşürmez), istek ApiError(0) atar.
// - Token'lar asla loglanmaz.

export class ApiError extends Error {
  status: number;
  correctRole?: MobileRoleCategory;
  constructor(status: number, message: string, correctRole?: MobileRoleCategory) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.correctRole = correctRole;
  }
}

export interface ApiClientOpts {
  baseUrl: string; // https://<canonicalHost>
  tokens: TokenStore;
  appVersion?: string;
  fetchFn?: typeof fetch; // test enjeksiyonu
  onSessionExpired?: () => void;
  refreshRetryDelayMs?: number; // test enjeksiyonu (default 2000)
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string, body?: unknown): Promise<T>;
  login(body: LoginRequest): Promise<TokenPairResponse>;
  logout(): Promise<void>;
}

type RefreshOutcome = 'ok' | 'invalid' | 'network';

export function createApiClient(opts: ApiClientOpts): ApiClient {
  const f = opts.fetchFn ?? fetch;
  let refreshing: Promise<RefreshOutcome> | null = null;

  const baseHeaders = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-okulin-app': `android/${opts.appVersion ?? '0.0.0'}`,
  });

  async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  }

  function toError(res: Response, body: Record<string, unknown> | null): ApiError {
    return new ApiError(
      res.status,
      String(body?.error ?? `Sunucu hatası (${res.status})`),
      body?.correctRole as MobileRoleCategory | undefined,
    );
  }

  async function doRefresh(): Promise<RefreshOutcome> {
    const refreshToken = await opts.tokens.getRefresh();
    if (!refreshToken) return 'invalid';
    const epoch = opts.tokens.epoch(); // bayat-yanıt kilidi (İnceleme Codex #8)
    const attempt = () =>
      f(`${opts.baseUrl}/api/mobile/v1/auth/refresh`, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({ refreshToken }),
      });
    let res: Response;
    try {
      res = await attempt();
    } catch {
      // Kısa ağ hıçkırığında rotation grace penceresi (30 sn) içinde bir kez daha
      // dene (İnceleme Codex #9): yanıt kaybolduysa sunucu çoktan rotate etmiştir —
      // grace içindeki tekrar meşru yoldan yeni çift verir; geç kalınırsa sunucu
      // REUSE sayıp oturumu kapatır (bilinçli güvenlik sınırı, plan ADR'si).
      await new Promise((r) => setTimeout(r, opts.refreshRetryDelayMs ?? 2000));
      try {
        res = await attempt();
      } catch {
        return 'network';
      }
    }
    if (!res.ok) {
      // Yalnız KESİN kimlik hataları oturumu düşürür (İnceleme Codex #7): 429/5xx
      // (limit, bakım, geçici arıza) token'ları KORUR — okul NAT'ında IP limitinin
      // dolması kitlesel logout üretmesin.
      if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
      return 'network';
    }
    const pair = (await parseJson(res)) as unknown as TokenPairResponse | null;
    if (!pair?.accessToken) return 'network'; // bozuk 2xx gövdesi — oturumu düşürme
    const written = await opts.tokens.setPair(pair, epoch);
    if (!written) return 'invalid'; // arada logout/kurum değişimi oldu — bayat yanıtı at
    return 'ok';
  }

  async function request<T>(path: string, method: string, body?: unknown, allowRetry = true): Promise<T> {
    const access = await opts.tokens.getAccess();
    let res: Response;
    try {
      res = await f(opts.baseUrl + path, {
        method,
        headers: { ...baseHeaders(), ...(access ? { authorization: `Bearer ${access}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Bağlantı kurulamadı. İnternetinizi kontrol edin.');
    }
    if (res.status === 401 && allowRetry) {
      refreshing ??= doRefresh().finally(() => {
        refreshing = null;
      });
      const outcome = await refreshing;
      if (outcome === 'ok') return request<T>(path, method, body, false);
      if (outcome === 'invalid') {
        await opts.tokens.clear();
        opts.onSessionExpired?.();
        throw new ApiError(401, 'Oturum süresi doldu. Yeniden giriş yapın.');
      }
      throw new ApiError(0, 'Bağlantı kurulamadı. İnternetinizi kontrol edin.');
    }
    const json = await parseJson(res);
    if (!res.ok) throw toError(res, json);
    return json as T;
  }

  return {
    get: (path) => request(path, 'GET'),
    post: (path, body) => request(path, 'POST', body ?? {}),
    del: (path, body) => request(path, 'DELETE', body),

    // Login 401-refresh yoluna GİRMEZ (yanlış şifre refresh tetiklememeli).
    async login(body: LoginRequest): Promise<TokenPairResponse> {
      let res: Response;
      try {
        res = await f(`${opts.baseUrl}/api/mobile/v1/auth/login`, {
          method: 'POST',
          headers: baseHeaders(),
          body: JSON.stringify(body),
        });
      } catch {
        throw new ApiError(0, 'Bağlantı kurulamadı. İnternetinizi kontrol edin.');
      }
      const json = await parseJson(res);
      if (!res.ok) throw toError(res, json);
      const pair = json as unknown as TokenPairResponse;
      await opts.tokens.setPair(pair);
      return pair;
    },

    // Sunucu iptali best-effort (offline çıkışta da yerel oturum kapanır);
    // token'lar HER DURUMDA silinir.
    async logout(): Promise<void> {
      try {
        await request('/api/mobile/v1/auth/logout', 'POST', {}, false);
      } catch {
        /* offline/iptal edilmiş oturum — yerel temizlik yeter */
      }
      await opts.tokens.clear();
    },
  };
}
```

- [ ] **Step 7: Testler + typecheck**

```bash
cd mobile && npx vitest run && npx tsc --noEmit
cd /Users/mustafa/Workspace/active/okulin && npx vitest run && npm run build
```

Beklenen: mobil 2 test dosyası (client 8 + semver 3) PASS + typecheck temiz; web tarafında drift testi dahil tümü PASS + build başarılı.

- [ ] **Step 8: Commit**

```bash
git add mobile/src mobile/vitest.config.ts mobile/package.json mobile/package-lock.json scripts/sync-mobile-api-types.mjs lib/mobile/api-types.sync.test.ts package.json
git commit -m "feat(mobil): istemci çekirdeği — SecureStore token deposu, tek-uçuş refresh mutex'li tipli API istemcisi, tip senkron script + drift testi"
```

---

### Task 8: Ekran akışı — oturum sağlayıcı, bootstrap kapısı, kurum/giriş/Bugün/ayarlar

İskelet ekranları (spec §5.1'in v1-iskelet alt kümesi): kurum kodu → rol kartlı giriş → "Bugün" placeholder → ayarlar (profil/cihazlar/çıkış/kurumdan ayrıl). Kill-switch kapısı (bakım / min sürüm / offline) kök layout'ta.

**Files:**
- Create: `mobile/src/store/session.tsx`, `mobile/src/ui/kit.tsx`, `mobile/src/ui/Gate.tsx`
- Create: `mobile/app/kurum.tsx`, `mobile/app/giris.tsx`, `mobile/app/bugun.tsx`, `mobile/app/ayarlar.tsx`
- Modify: `mobile/app/_layout.tsx`, `mobile/app/index.tsx`

**Interfaces:**
- Consumes: Task 7 çekirdeği (`createApiClient`, `createTokenStore`, `secureStorage`, `semverLt`, tipler) + `mobile/src/config.ts`.
- Produces (Task 9-10 kullanır): `useSession(): { status, org, session, api, installationId, appVersion, saveOrg, leaveOrg, login, logout(localOnly?), retryBoot, rotateInstallationId }`.

- [ ] **Step 1: UI mini kiti yaz**

`mobile/src/ui/kit.tsx` (yeni — TAMAMI):

```tsx
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// İskelet UI kiti — tek dosyada tutarlı temel bileşenler. Marka rengi ekran
// bazında prop'la gelir (resolve-org themeColor). Görsel cila Plan 4'te
// (enerjik görsel yön) — burada temiz/okunur/44pt dokunma hedefi yeter.

export const palette = {
  bg: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  sub: '#64748b',
  line: '#e2e8f0',
  danger: '#dc2626',
  brandFallback: '#7c3aed',
};

export function Screen({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={s.screen}>{children}</SafeAreaView>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Sub({ children }: { children: React.ReactNode }) {
  return <Text style={s.sub}>{children}</Text>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return <Text style={s.error}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={palette.sub} {...props} style={[s.input, props.style]} />;
}

export function Button({
  label,
  onPress,
  color = palette.brandFallback,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const bg = variant === 'primary' ? color : 'transparent';
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? palette.danger : color;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant !== 'primary' && { borderWidth: 1, borderColor: variant === 'danger' ? palette.danger : color },
      ]}
    >
      <Text style={[s.btnLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export function LoadingScreen() {
  return (
    <SafeAreaView style={[s.screen, s.center]}>
      <ActivityIndicator size="large" color={palette.brandFallback} />
    </SafeAreaView>
  );
}

// Tam ekran durum mesajı (bakım / güncelleme / offline).
export function StatusScreen({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <SafeAreaView style={[s.screen, s.center, { padding: 24 }]}>
      <Title>{title}</Title>
      <Text style={[s.sub, { textAlign: 'center', marginVertical: 12 }]}>{message}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: palette.text },
  sub: { fontSize: 15, color: palette.sub },
  error: { fontSize: 14, color: palette.danger, marginTop: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: palette.text,
    backgroundColor: palette.card,
    marginTop: 10,
  },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 12 },
  btnLabel: { fontSize: 16, fontWeight: '600' },
  card: {
    backgroundColor: palette.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    marginTop: 12,
  },
});
```

- [ ] **Step 2: Oturum sağlayıcıyı yaz**

`mobile/src/store/session.tsx` (yeni — TAMAMI):

```tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { isAllowedHost } from '../config';
import { secureStorage } from './storage';
import { createTokenStore } from '../api/tokens';
import { ApiError, createApiClient, type ApiClient } from '../api/client';
import type { LoginRequest, MeResponse, MobileSessionInfo } from '../api/types';

// Oturum durumu — TEK aktif hesap (spec §16). Oturum snapshot'ı cihazda SAKLANMAZ:
// boot'ta /me çekilir (SecureStore ~2KB değer sınırı + taze payload — plan ADR'si).
// /me ağ hatasında 3 kısa deneme, sonra login ekranı (token'lar KORUNUR).

export interface OrgInfo {
  orgSlug: string;
  canonicalHost: string;
  name: string;
  shortName: string;
  logoUrl: string;
  themeColor: string;
}

export type SessionStatus = 'loading' | 'needs-org' | 'needs-login' | 'ready';

interface SessionContextValue {
  status: SessionStatus;
  org: OrgInfo | null;
  session: MobileSessionInfo | null;
  api: ApiClient | null;
  installationId: string | null;
  appVersion: string;
  saveOrg(o: OrgInfo): Promise<void>;
  leaveOrg(): Promise<void>;
  login(body: Pick<LoginRequest, 'username' | 'password' | 'role'>): Promise<void>;
  // localOnly: sunucu oturumu zaten kapatıldıysa (tüm cihazlardan çıkış) yalnız
  // yerel temizlik — ölü oturumla logout/unregister 401 gürültüsü üretmesin
  // (İnceleme Gemini 2.5).
  logout(localOnly?: boolean): Promise<void>;
  retryBoot(): void; // Gate "Yeniden dene" — /me açılış denemesini tekrarlar (offline kurtarma)
  rotateInstallationId(): Promise<string>; // push register 409'unda yeni kimlik (Codex #3)
}

const SessionContext = createContext<SessionContextValue | null>(null);
const ORG_KEY = 'okulin.org';
const INSTALLATION_KEY = 'okulin.installationId';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [session, setSession] = useState<MobileSessionInfo | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [bootTick, setBootTick] = useState(0); // retryBoot sayacı (offline kurtarma)
  const appVersion = Constants.expoConfig?.version ?? '0.0.0';
  const tokens = useMemo(() => createTokenStore(secureStorage), []);

  const api = useMemo(() => {
    if (!org) return null;
    return createApiClient({
      baseUrl: `https://${org.canonicalHost}`,
      tokens,
      appVersion,
      onSessionExpired: () => {
        setSession(null);
        setStatus('needs-login');
      },
    });
  }, [org, tokens, appVersion]);

  // Açılış: installationId (yoksa üret, spec §6/4) + kayıtlı kurum.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let inst = await secureStorage.get(INSTALLATION_KEY);
      if (!inst) {
        inst = Crypto.randomUUID();
        await secureStorage.set(INSTALLATION_KEY, inst);
      }
      if (cancelled) return;
      setInstallationId(inst);
      const rawOrg = await secureStorage.get(ORG_KEY);
      if (cancelled) return;
      if (!rawOrg) {
        setStatus('needs-org');
        return;
      }
      // Bozuk/allowlist-dışı kayıt → güvenli düşüş: kurum seçimine dön
      // (İnceleme Codex #11 — doğrulamasız JSON.parse + host'a körü körüne bağlanma).
      try {
        const parsedOrg = JSON.parse(rawOrg) as OrgInfo;
        if (!parsedOrg?.canonicalHost || !isAllowedHost(parsedOrg.canonicalHost)) throw new Error('geçersiz kurum kaydı');
        setOrg(parsedOrg);
      } catch {
        await secureStorage.del(ORG_KEY);
        if (!cancelled) setStatus('needs-org');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Kurum yüklendi → refresh token varsa /me ile oturumu doğrula.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      const refresh = await tokens.getRefresh();
      if (!refresh) {
        if (!cancelled) setStatus('needs-login');
        return;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const me = await api.get<MeResponse>('/api/mobile/v1/me');
          if (!cancelled) {
            setSession(me.session);
            setStatus('ready');
          }
          return;
        } catch (e) {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 401) return; // onSessionExpired zaten çekti
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000)); // ağ — kısa dene
        }
      }
      // Ağ 3 denemede gelmedi: login ekranına düş (token'lar DURUR). Gate zaten
      // offline ekranını gösterir; "Yeniden dene" retryBoot() ile bu effect'i
      // tekrarlar — ağ gelince token'lı kullanıcı şifre yazmadan 'ready' olur.
      if (!cancelled) setStatus('needs-login');
    })();
    return () => {
      cancelled = true;
    };
  }, [api, tokens, bootTick]);

  const retryBoot = useCallback(() => setBootTick((t) => t + 1), []);

  // Push register 409'unda (installationId başka hesaba bağlı — Codex #3) yeni
  // kurulum kimliği üret; push.ts tek-retry ile kullanır.
  const rotateInstallationId = useCallback(async () => {
    const fresh = Crypto.randomUUID();
    await secureStorage.set(INSTALLATION_KEY, fresh);
    setInstallationId(fresh);
    return fresh;
  }, []);

  const saveOrg = useCallback(async (o: OrgInfo) => {
    await secureStorage.set(ORG_KEY, JSON.stringify(o));
    setOrg(o);
    setStatus('needs-login');
  }, []);

  const logout = useCallback(async (localOnly = false) => {
    if (api && !localOnly) {
      // Push bağını kopar (spec §8) — kayıt hiç yapılmadıysa sunucuda no-op.
      if (installationId) {
        await api.del('/api/mobile/v1/push/register', { installationId }).catch(() => {});
      }
      await api.logout();
    } else {
      await tokens.clear(); // localOnly / api yok: yalnız yerel temizlik
    }
    setSession(null);
    setStatus('needs-login');
  }, [api, installationId, tokens]);

  // Kurum değişimi (spec §6/7): oturum + push bağı + kayıtlı kurum temizlenir.
  const leaveOrg = useCallback(async () => {
    await logout();
    await secureStorage.del(ORG_KEY);
    setOrg(null);
    setStatus('needs-org');
  }, [logout]);

  const login = useCallback(
    async (body: Pick<LoginRequest, 'username' | 'password' | 'role'>) => {
      if (!api) throw new ApiError(0, 'Önce kurum seçilmeli.');
      const r = await api.login({
        ...body,
        installationId: installationId ?? undefined,
        deviceName: Device.modelName ?? undefined,
        platform: 'android',
      });
      setSession(r.session);
      setStatus('ready');
    },
    [api, installationId],
  );

  // Context value memo'lu: her render'da yeni referans üretip TÜM tüketici
  // ekranları gereksiz re-render etmesin (İnceleme: Gemini 3.1).
  const value = useMemo<SessionContextValue>(
    () => ({ status, org, session, api, installationId, appVersion, saveOrg, leaveOrg, login, logout, retryBoot, rotateInstallationId }),
    [status, org, session, api, installationId, appVersion, saveOrg, leaveOrg, login, logout, retryBoot, rotateInstallationId],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession, SessionProvider içinde kullanılmalı');
  return ctx;
}
```

- [ ] **Step 3: Bootstrap kapısını yaz**

`mobile/src/ui/Gate.tsx` (yeni — TAMAMI):

```tsx
import React, { useEffect, useState } from 'react';
import { useSession } from '../store/session';
import { semverLt } from '../semver';
import { LoadingScreen, StatusScreen } from './kit';
import type { BootstrapResponse } from '../api/types';

// Kill-switch kapısı (spec §9/3): kurum host'undan bootstrap çekilir; bakım /
// minimum sürüm / ağ-yok durumları TÜM uygulamayı (login dahil) kapatır.
// Kurum seçilmemişken kapı atlanır (resolve-org apex'te, kill-switch'ten bağımsız).

type GateState = 'checking' | 'ok' | 'offline' | 'maintenance' | 'update';

export function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { org, appVersion, retryBoot } = useSession();
  const [state, setState] = useState<GateState>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // "Yeniden dene": hem bootstrap'i hem oturum /me denemesini tekrarla — offline'da
  // token'lı kullanıcı ağ gelince şifre yazmadan içeri girsin (İnceleme: Gemini 2.1).
  const retry = () => {
    retryBoot();
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (!org) {
      setState('ok');
      return;
    }
    let cancelled = false;
    (async () => {
      setState('checking');
      try {
        const res = await fetch(`https://${org.canonicalHost}/api/mobile/v1/bootstrap`);
        const j = (await res.json()) as BootstrapResponse;
        if (cancelled) return;
        if (j.maintenance?.active) {
          setMessage(j.maintenance.message);
          setState('maintenance');
          return;
        }
        if (semverLt(appVersion, j.minSupportedVersion)) {
          setState('update');
          return;
        }
        setState('ok');
      } catch {
        if (!cancelled) setState('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, appVersion, tick]);

  if (state === 'checking') return <LoadingScreen />;
  if (state === 'maintenance') {
    return (
      <StatusScreen
        title="Bakımdayız"
        message={message || 'okulin kısa bir bakım çalışmasında. Az sonra yeniden deneyin.'}
        actionLabel="Yeniden dene"
        onAction={retry}
      />
    );
  }
  if (state === 'update') {
    return (
      <StatusScreen
        title="Güncelleme gerekli"
        message="Uygulamanın bu sürümü artık desteklenmiyor. Lütfen yeni sürümü yükleyin."
      />
    );
  }
  if (state === 'offline') {
    return (
      <StatusScreen
        title="Bağlantı yok"
        message="Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin."
        actionLabel="Yeniden dene"
        onAction={retry}
      />
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Kök layout + yönlendirici index**

(a) `mobile/app/_layout.tsx` (TAMAMI — mevcut dosyayı değiştir):

```tsx
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { SessionProvider } from '../src/store/session';
import { BootstrapGate } from '../src/ui/Gate';

// Ön planda da sistem bildirimi göster (banner) — varsayılan davranış sessizce yutar.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  return (
    <SessionProvider>
      <BootstrapGate>
        <Stack screenOptions={{ headerShown: false }} />
      </BootstrapGate>
    </SessionProvider>
  );
}
```

(b) `mobile/app/index.tsx` (TAMAMI — mevcut dosyayı değiştir):

```tsx
import { Redirect } from 'expo-router';
import { useSession } from '../src/store/session';
import { LoadingScreen } from '../src/ui/kit';

// Duruma göre yönlendirici — ekranlar arası akışın tek karar noktası.
export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'needs-org') return <Redirect href="/kurum" />;
  if (status === 'needs-login') return <Redirect href="/giris" />;
  return <Redirect href="/bugun" />;
}
```

- [ ] **Step 5: Kurum kodu ekranı**

`mobile/app/kurum.tsx` (yeni — TAMAMI):

```tsx
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { APEX_BASE, isAllowedHost } from '../src/config';
import { useSession } from '../src/store/session';
import { Screen, Title, Sub, Input, Button, ErrorText } from '../src/ui/kit';
import type { ResolveOrgResponse } from '../src/api/types';

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
```

- [ ] **Step 6: Giriş ekranı**

`mobile/app/giris.tsx` (yeni — TAMAMI):

```tsx
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../src/store/session';
import { ApiError } from '../src/api/client';
import { Screen, Title, Sub, Input, Button, ErrorText, palette } from '../src/ui/kit';
import type { MobileRoleCategory } from '../src/api/types';

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
```

- [ ] **Step 7: Bugün + Ayarlar ekranları**

(a) `mobile/app/bugun.tsx` (yeni — TAMAMI; push kartının işlevi Task 9'da bağlanır — şimdilik buton görünür ama `enablePush` import'u Task 9 dosyasını bekler, o yüzden BU task'ta kart yalnız yer tutucu metin gösterir):

```tsx
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/store/session';
import { Screen, Title, Sub, Card, palette } from '../src/ui/kit';

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
```

(b) `mobile/app/ayarlar.tsx` (yeni — TAMAMI):

```tsx
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSession } from '../src/store/session';
import { Screen, Title, Sub, Button, Card, palette } from '../src/ui/kit';
import type { DevicesResponse, DeviceView } from '../src/api/types';

// Ayarlar: profil özeti + cihaz oturumları (listele / tek tek iptal / tümünden
// çıkış — spec §7) + çıkış + kurumdan ayrıl.
// useFocusEffect: Stack'te ekran unmount olmaz — her öne gelişte liste tazelenir
// (İnceleme: Gemini 3.2). ScrollView: küçük ekranlarda alttaki butonlar taşmasın
// (İnceleme: Gemini 3.3); cihaz sayısı küçük olduğundan FlatList yerine map yeterli.
export default function AyarlarEkrani() {
  const { org, session, api, logout, leaveOrg } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [devices, setDevices] = useState<DeviceView[] | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const r = await api.get<DevicesResponse>('/api/mobile/v1/auth/devices');
      setDevices(r.devices);
    } catch {
      setDevices([]);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function revoke(d: DeviceView) {
    if (!api) return;
    await api.del('/api/mobile/v1/auth/devices', { sessionId: d.id }).catch(() => {});
    await load();
  }

  function confirmAllOut() {
    Alert.alert('Tüm cihazlardan çıkış', 'Bu hesabın tüm cihazlardaki oturumları kapatılacak.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Çıkış yap',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await api?.del('/api/mobile/v1/auth/devices', { all: true }).catch(() => {});
            // Sunucu oturumları + push bağları az önce topluca kapandı → yalnız yerel
            // temizlik (İnceleme Gemini 2.5: ölü oturumla logout 401 gürültüsü üretir).
            await logout(true);
            router.replace('/giris');
          })();
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView style={s.wrap} contentContainerStyle={s.content}>
        <Title>Ayarlar</Title>
        <Card>
          <Text style={s.name}>{session?.name}</Text>
          <Sub>
            {org?.name} · {session?.role}
          </Sub>
        </Card>
        <Text style={s.section}>Cihazlar</Text>
        {devices === null ? <Sub>Yükleniyor…</Sub> : null}
        {devices?.length === 0 ? <Sub>Kayıtlı cihaz oturumu yok.</Sub> : null}
        {(devices ?? []).map((item) => (
          <Card key={item.id}>
            <Text style={s.name}>
              {item.deviceName || item.platform || 'Cihaz'}
              {item.current ? ' (bu cihaz)' : ''}
            </Text>
            <Sub>Son kullanım: {new Date(item.lastUsedAt).toLocaleString('tr-TR')}</Sub>
            {!item.current ? <Button label="Oturumu kapat" onPress={() => void revoke(item)} variant="danger" /> : null}
          </Card>
        ))}
        <Button label="Tüm cihazlardan çıkış" onPress={confirmAllOut} variant="danger" />
        <Button
          label="Çıkış yap"
          onPress={() => {
            void logout().then(() => router.replace('/giris'));
          }}
          color={brand}
        />
        <Button label="Kurumdan ayrıl" onPress={() => void leaveOrg().then(() => router.replace('/kurum'))} color={brand} variant="ghost" />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  name: { fontSize: 16, fontWeight: '600', color: palette.text },
  section: { fontSize: 14, fontWeight: '700', color: palette.sub, marginTop: 20, textTransform: 'uppercase' },
});
```

- [ ] **Step 8: Telefonda akış doğrulaması + commit**

```bash
cd mobile && npx tsc --noEmit && npx vitest run
npx expo run:android
```

Telefonda sırayla doğrula (testkurs kurum kodu CLAUDE.local.md "Kurum kodu" notunda; öğrenci creds `.env.local` `OKULIN_STU_*`):
1. Kurum kodu ekranı → kod gir → giriş ekranı testkurs markasıyla açılır
2. Yanlış şifre → hata mesajı; doğru giriş → "Bugün" ekranı ad + rolle
3. Ayarlar → cihaz listesinde "bu cihaz" görünür
4. Çıkış → giriş ekranına döner; yeniden giriş çalışır
5. Uygulamayı kapat/aç → doğrudan "Bugün" (kalıcı oturum, /me ile)
6. Superadmin kill-switch smoke (Mac'ten, CLAUDE.local.md superadmin creds):

```bash
# bakımı aç → telefonda uygulamayı yeniden aç → "Bakımdayız" ekranı görünmeli
curl -s -X PUT "https://okulin.com/api/superadmin/mobile-config" -b sa-cookies.txt \
  -H "Content-Type: application/json" -H "Origin: https://okulin.com" \
  -d '{"maintenance":true,"maintenanceMessage":"Kısa bakım"}'
# GERİ KAPAT (unutma!) → telefonda "Yeniden dene" → normal akış
curl -s -X PUT "https://okulin.com/api/superadmin/mobile-config" -b sa-cookies.txt \
  -H "Content-Type: application/json" -H "Origin: https://okulin.com" \
  -d '{"maintenance":false,"maintenanceMessage":null}'
```

(sa-cookies.txt için superadmin login akışı Plan 2 Task 11'deki gibi — gizli URL'den `POST /api/auth` + cookie sakla.)

```bash
git add mobile/src mobile/app
git commit -m "feat(mobil): ekran akışı — kurum kodu, rol kartlı giriş, Bugün placeholder, ayarlar/cihazlar, bootstrap kill-switch kapısı"
```

---

### Task 9: Push istemcisi — kanal + izin kartı + native FCM token kaydı + rotasyon

Push izni KULLANICI EYLEMİYLE istenir (spec §8 — ilk açılışta otomatik prompt YOK): "Bugün" ekranındaki kart. Kanal `default` token'dan ÖNCE oluşturulur (Android 13+ zorunluluğu). Token = `getDevicePushTokenAsync` NATIVE FCM token'ı.

**Files:**
- Create: `mobile/src/push.ts`
- Modify: `mobile/app/bugun.tsx` (push kartı işlevselleşir)

**Interfaces:**
- Consumes: `ApiClient` (Task 7), `PushRegisterRequest` (types), `useSession` (Task 8).
- Produces: `currentPermission()`, `enablePush(api, base)`, `refreshRegistration(api, base)`, `watchTokenRotation(api, base)`.

- [ ] **Step 1: push.ts'i yaz**

`mobile/src/push.ts` (yeni — TAMAMI):

```typescript
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
```

- [ ] **Step 2: Bugün ekranına push kartını bağla**

`mobile/app/bugun.tsx` (TAMAMI — Task 8'deki dosyayı değiştir):

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/store/session';
import { currentPermission, enablePush, refreshRegistration, watchTokenRotation, type EnableResult, type RegisterBase } from '../src/push';
import { Screen, Title, Sub, Card, Button, palette } from '../src/ui/kit';

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
  const { org, session, api, installationId, appVersion, rotateInstallationId } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [perm, setPerm] = useState<EnableResult | null>(null);

  const base: RegisterBase | null = useMemo(
    () => (installationId ? { installationId, platform: 'android', appVersion } : null),
    [installationId, appVersion],
  );

  // Soğuk açılış: izin varsa sessiz yeniden kayıt + rotasyon dinleyicisi.
  // cancelled bayrağı: async kurulum bitmeden unmount olursa dinleyici sızmasın
  // (İnceleme: Gemini 4.2).
  useEffect(() => {
    if (!api || !base) return;
    let cancelled = false;
    let sub: { remove(): void } | null = null;
    void (async () => {
      setPerm(await currentPermission());
      await refreshRegistration(api, base, rotateInstallationId);
      if (cancelled) return;
      sub = watchTokenRotation(api, base, rotateInstallationId);
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [api, base]);

  // Kullanıcı telefon Ayarları'ndan bildirim iznini değiştirip dönebilir — uygulama
  // ön plana gelince izin durumunu tazele, yeni verilmişse kaydı tamamla
  // (İnceleme: Gemini 4.1).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !api || !base) return;
      void (async () => {
        const p = await currentPermission();
        setPerm(p);
        if (p === 'granted') await refreshRegistration(api, base, rotateInstallationId);
      })();
    });
    return () => sub.remove();
  }, [api, base]);

  async function onEnable() {
    if (!api || !base) return;
    setPerm(await enablePush(api, base, rotateInstallationId));
  }

  return (
    <Screen>
      <View style={s.wrap}>
        <Sub>{org?.name}</Sub>
        <Title>Merhaba{session?.name ? `, ${session.name}` : ''}</Title>
        <Text style={s.role}>{ROLE_LABEL[session?.role ?? ''] ?? session?.role}</Text>

        {perm !== 'granted' ? (
          <Card>
            <Text style={s.cardTitle}>{perm === 'error' ? 'Bildirim kaydı tamamlanamadı' : 'Bildirimler kapalı'}</Text>
            <Sub>
              {perm === 'denied'
                ? 'Bildirim izni reddedilmiş. Telefon Ayarları → Uygulamalar → okulin → Bildirimler yolundan açabilirsiniz.'
                : perm === 'error'
                  ? 'İzin verildi ama sunucu kaydı yapılamadı. İnternetinizi kontrol edip tekrar deneyin.'
                  : 'Duyuru, yoklama ve ödeme bildirimlerini kaçırmamak için bildirimleri açın.'}
            </Sub>
            {perm !== 'denied' ? (
              <Button label={perm === 'error' ? 'Tekrar dene' : 'Bildirimleri Aç'} onPress={() => void onEnable()} color={brand} />
            ) : null}
          </Card>
        ) : null}

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
```

- [ ] **Step 3: Telefonda doğrula + commit**

```bash
cd mobile && npx tsc --noEmit && npx vitest run
npx expo run:android
```

Telefonda: giriş → Bugün → "Bildirimleri Aç" → sistem izin penceresi → izin ver → kart kaybolur; Metro log'unda register isteği hatasız (401/400 YOK). İzin reddi senaryosu: (ayarlardan izni geri alıp) kart "reddedilmiş" metnini gösterir.

```bash
git add mobile/src/push.ts mobile/app/bugun.tsx
git commit -m "feat(mobil): push istemcisi — default kanal, kullanıcı-eylemli izin kartı, native FCM token kaydı + rotasyon dinleyicisi"
```

---

### Task 10: Sentry (EU/Frankfurt) entegrasyonu

Crash raporlama (spec §17 kararı): `@sentry/react-native` + Expo config plugin. `sendDefaultPii: false`, replay YOK, dev'de kapalı. Source-map upload Plan 5 (release hattı — SENTRY_AUTH_TOKEN o zaman).

**Files:**
- Modify: `mobile/app.json` (plugin), `mobile/src/config.ts` (DSN), `mobile/app/_layout.tsx` (init + wrap), `mobile/package.json` (bağımlılık)

- [ ] **Step 1: Sentry hesabı (Mustafa — operasyonel)**

1. sentry.io → Sign up (mustafayanar54@gmail.com) → org adı `okulin` → **Data Storage Location: European Union (EU)** SEÇ (org oluştururken sorulur; sonradan değiştirilemez)
2. Create Project → Platform: **React Native** → proje adı `okulin-mobil`
3. Kurulum sihirbazını ATLA (elle kuruyoruz) → Settings → Projects → okulin-mobil → Client Keys (DSN) → **DSN'i kopyala** (`https://...@oXXXX.ingest.de.sentry.io/...` — `.de.` EU kanıtı)

- [ ] **Step 2: Paketi ekle + plugin + DSN**

```bash
cd mobile && npx expo install @sentry/react-native
```

(a) `mobile/app.json` plugins listesine ekle (mevcutları koru):

```json
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-notifications",
      "@sentry/react-native/expo"
    ]
```

(b) `mobile/src/config.ts` içindeki `SENTRY_DSN` sabitini kopyalanan DSN ile doldur:

```typescript
export const SENTRY_DSN = 'https://<kopyalanan-anahtar>@<org>.ingest.de.sentry.io/<proje>';
```

- [ ] **Step 3: Init + wrap**

`mobile/app/_layout.tsx` (TAMAMI — mevcut dosyayı değiştir):

```tsx
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '../src/config';
import { SessionProvider } from '../src/store/session';
import { BootstrapGate } from '../src/ui/Gate';

// Crash raporlama (spec §17, 3/3 karar): EU/Frankfurt, PII kapalı, replay YOK,
// dev'de kapalı. Kullanıcı kimliği Sentry'ye GÖNDERİLMEZ (takma adlı ID gerekirse
// Plan 4'te ayrıca değerlendirilir).
Sentry.init({
  dsn: SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  enabled: !__DEV__,
});

// Ön planda da sistem bildirimi göster (banner) — varsayılan davranış sessizce yutar.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function RootLayout() {
  return (
    <SessionProvider>
      <BootstrapGate>
        <Stack screenOptions={{ headerShown: false }} />
      </BootstrapGate>
    </SessionProvider>
  );
}

export default Sentry.wrap(RootLayout);
```

- [ ] **Step 4: Canlı doğrula + commit**

Geçici test: `Sentry.init` içinde `enabled: true` yap (yalnız bu doğrulama için) ve `Sentry.init(...)` satırının ALTINA geçici olarak ekle:

```tsx
setTimeout(() => Sentry.captureMessage('okulin mobil Sentry kurulum testi'), 5000);
```

```bash
npx expo run:android
```

Sentry → okulin-mobil → Issues'da "kurulum testi" mesajı ~1 dk içinde görünmeli. Sonra GERİ AL (`enabled: !__DEV__` + setTimeout satırını sil), typecheck + commit:

```bash
npx tsc --noEmit && npx vitest run
git add mobile/app.json mobile/src/config.ts mobile/app/_layout.tsx mobile/package.json mobile/package-lock.json
git commit -m "feat(mobil): Sentry crash raporlama — EU/Frankfurt, sendDefaultPii kapalı, replay yok, dev'de devre dışı"
```

---

### Task 11: Uçtan uca canlı doğrulama (gerçek cihazda push) + kapanış

F0 çıkış kapısı (spec §12): "push uçtan uca gerçek cihazda". Gerçek FCM token'la kayıt + gerçek push tetikleme + logout'ta bildirimin durduğu kanıtı; memory güncellemesi.

**Files:**
- Modify: memory `native-app-girisi.md` (oturum sonunda)

- [ ] **Step 1: Uygulamayı son haliyle kur + push kaydı**

```bash
cd mobile && npx expo run:android
```

Telefonda: kurum kodu → **öğrenci** girişi (`OKULIN_STU_*`) → "Bildirimleri Aç" → izin ver. Metro log'unda register 200.

- [ ] **Step 2: Gerçek push — duyuru (uygulama arka planda)**

Mac'te tarayıcıdan testkurs müdür paneline gir (CLAUDE.local.md creds) → Duyurular → yeni duyuru: hedef **öğrenciler**, başlık **BENZERSİZ** olsun — "Mobil test 14:32" gibi (saat:dakika ekle; eski/gecikmiş bildirimle karışmasın — İnceleme Codex #15), içerik kısa metin → yayınla.

Beklenen: telefon (uygulama ARKA PLANDA — force-stop DEĞİL; Android force-stop'ta FCM teslimini uygulama yeniden açılana dek durdurur, o ayrı bir davranıştır) **60 saniye içinde** sistem bildirimi alır — başlık/metin duyuruyla aynı, 'default' kanalından. Uygulama ÖN PLANDAYKEN ikinci bir benzersiz duyuru → banner görünür (`setNotificationHandler`). Her kontrol öncesi bildirim tepsisini temizle.

- [ ] **Step 3: Kilit ekranı mahremiyeti (sensitive yol) — geçici öğrenci+veli ile**

Devamsızlık push'u `NotifLog(date, studentId)` ile GÜNDE BİR KEZ dedupe edilir — mevcut öğrenci daha önce işaretlendiyse push üretmez (İnceleme Codex #15). Bu yüzden TEMİZ bir geçici kayıt kullan:

1. Müdür panelinden geçici öğrenci oluştur ("Mobil Test Öğrenci", veli telefonu = Mustafa'nın erişebildiği numara; testkurs'ta gerçek kayıt yok — çakışma riski yok)
2. Telefonda çıkış → **veli** girişi (kullanıcı adı = veli telefonu, ilk şifre = telefon) → Bildirimleri Aç
3. Müdür panelinden bugünün yoklamasında geçici öğrenciyi "yok" işaretle

Beklenen: 60 saniye içinde push düşer, kilit ekranı/tepsi metni **JENERİK** ("Yeni bildiriminiz var / Detay için okulin'i açın" — öğrenci adı/durum YOK; sunucu `renderPush` sensitive yolu).

- [ ] **Step 4: Logout → bildirim durur (unbind kanıtı) + geçici kayıt temizliği**

Telefonda Ayarlar → Çıkış. Müdür panelinden veli hedefli BENZERSİZ bir duyuru yayınla.

Beklenen: 60 saniye içinde bildirim GELMEZ (installation bağı logout'ta koptu; tepsi boş). Yeniden giriş + Bildirimleri Aç → üçüncü benzersiz duyuru → bildirim yine GELİR.

Temizlik: geçici öğrenciyi müdür panelinden SİL — bu aynı zamanda F1 purge'ünün canlıda (veli dahil `syncParents` yolu) bir kez daha tetiklenmesidir; silme sonrası telefonda veli oturumu açıksa bir sonraki istek 401 → giriş ekranına düşmeli (F1 gözle doğrulama).

- [ ] **Step 5: Regresyon — canlı sözleşme testleri**

```bash
cd /Users/mustafa/Workspace/active/okulin
npx playwright test e2e/int-mobile-push.spec.js e2e/int-mobile-auth.spec.js --project=int
npx playwright test --project=setup --project=smoke
```

Beklenen: tümü yeşil (web regresyonu yok — bu planda web görünür davranışı değişmedi, yalnız FCM/outbox iç yolu).

- [ ] **Step 6: Kapanış — memory + push**

- `native-app-girisi.md` memory'sine "Plan 3 (Expo iskelet + cihaz kaydı + FCM go-live + F1) ✅" bölümü: öğrenilen dersler, ADR'ler (assetlinks ertelemesi dahil), sıradaki plan (Plan 4 — native ekranlar + WebView + bildirim merkezi + deep link).
- CLAUDE.local.md'ye google-services.json + Sentry DSN kurtarma notları (Task 6/10'da düşülmediyse).
- Test duyurularını müdür panelinden sil.

```bash
git push
```

---

## Self-Review Notları (plan yazarı doldurdu)

- **Spec kapsaması:** §4 repo düzeni → Task 6 (`mobile/` bağımsız package.json, Turborepo yok; sözleşme paylaşımı route-import'suz → api-types kopya deseni Task 2/7). §5.1 iskelet alt kümesi → Task 8 (kurum kodu, giriş, "Bugün" placeholder, profil/cihazlar/çıkış, bakım/min-sürüm/ağ-yok ekranları); kalan native ekranlar Plan 4 (plan başında devir listesi). §6 → Task 8 kurum ekranı (yalnız canonicalHost'a bağlanma, installationId SecureStore); QR + deep link Plan 4/5 (ADR). §7 istemci tarafı → Task 7 (SecureStore, refresh mutex, tek tekrar) + Task 8 (cihazlar ekranı). §8 → Task 1 (FCM sertleştirme + channel_id + eventId), Task 2 (register), Task 3 (logout unbind), Task 9 (kanal→izin→native token, kullanıcı-eylemli izin), Task 11 (gerçek cihaz + sensitive jenerik metin + logout'ta durma). §12 F0 kapısı → Task 4 (sözleşme testleri) + Task 11 (uçtan uca gerçek cihaz).
- **Tip tutarlılığı:** `RegisterDeviceInput` (Task 2) ⊂ `PushRegisterRequest` (api-types) — route `parsed.data`'yı doğrudan geçirir. `installationIdOf` Task 2'de üretilir, Task 3 logout/devices kullanır. `purgeMobileAccess(role, userIds[], reason)` imzası Task 3'ün 5 çağrı noktasında aynı. Mobil `ApiClient.get/post/del/login/logout` Task 7'de tanımlı, Task 8/9 aynı imzalarla çağırır. `RegisterBase = Omit<PushRegisterRequest,'token'>` Task 9'da tanımlı ve bugun.tsx aynı adla import eder.
- **Placeholder taraması:** tüm kod blokları tam; "benzer şekilde" yalnız (d)/(e) accountant/assistant-director adımlarında değil — her birinin tam bloğu verildi. Operasyonel adımlar (Firebase/Sentry/telefon) tıklama düzeyinde.
- **Riskli noktalar (bilinçli):** (1) create-expo-app template alan adları SDK 57'de küçük farklılık gösterebilir (reset-project prompt metni, app.json plugin listesi) — Task 6 adımları "alanları GÜNCELLE, kalanına dokunma" diye yazıldı; (2) `sdkmanager` brew cask yolu değişirse `--sdk_root` bayrağı kurtarır; (3) Task 11 Step 3 geçici öğrenci+veli ile deterministikleştirildi (dedupe temiz, ilk şifre = telefon).
- **İnceleme (Codex 16 + Gemini 11 bulgu, 2026-07-16 — hepsi triage edildi):**
  - *İşlenen Critical'lar:* bekleyen teslimat SAHİPLİK kontrolü (Codex #2 → Task 1 dispatchDue; KVKK) · register devir sınırı + 409 + istemci kimlik rotasyonu (Codex #3 → Task 2/9) · veli-silme/`resetParent` + kurum-silme purge kapsamı (Codex #5 → Task 3 f/g) · refresh hata sınıflandırması — 429/5xx logout üretmez (Codex #7 → Task 7) · token epoch + refresh-önce yazım — logout/kurum-değişimi yarışı (Codex #8 → Task 7) · offline açılış kurtarması retryBoot (Codex #10 + Gemini 2.1 → Task 8) · SDK template pini (Codex #1) · ANDROID_HOME/cmdline-tools (Gemini B1-1).
  - *İşlenen Important'lar:* unbind org kapsamı + iptal sırası (Codex #4) · sid/token-hash rate limit katmanları (Codex #6) · FCM 400 sınıflandırması + OAuth try (Codex #12) · push kayıt-hatası UI + listener yaşam döngüsü (Codex #13 + Gemini 4.2) · canlı test davranış kanıtları (refresh-401, 409, eşzamanlı P2002) + deploy SHA eşleşmesi (Codex #14) · cihaz testi determinizmi — benzersiz başlık, 60 sn pencere, geçici öğrenci, force-stop ayrımı (Codex #15) · context memo + useFocusEffect + ScrollView + AppState izin tazeleme (Gemini 3.1-3.3, 4.1) · tüm-cihazlardan-çıkışta localOnly logout (Gemini 2.5) · canonicalHost istemci allowlist'i + kayıt doğrulama (Codex #11).
  - *Reddedilenler (gerekçeli):* Gemini "shouldShowAlert kullanın" — SDK 53+ resmî API `shouldShowBanner/shouldShowList` (Expo docs/context7 doğrulandı; Gemini SDK 52 bilgisi) · Gemini "index Redirect nav-state guard" — `<Redirect>` render-yolu bileşeni resmi desendir, imperatif root `router.replace` değil · Codex "Node ≥22.13 zorunlu" — RN 0.86 engines `^20.19.4`, 20.20.2 geçer; takılma halinde mise fallback ADR'de.
  - *ADR ile kabul:* refresh yanıt-kaybı >30 sn → reuse-revoke (grace-içi tek retry ile daraltıldı) · offline çıkışta push bağı kalıntısı · registerDevice'ta transaction'sız deleteMany+upsert (P2002 tek-retry ile).

