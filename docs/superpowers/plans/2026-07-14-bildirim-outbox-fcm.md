# Bildirim Outbox + FCM v1 Altyapısı — Uygulama Planı (Mobil Plan 1/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bildirim gönderimini kayıpsız hale getiren PostgreSQL outbox + FCM v1 sağlayıcı altyapısını kurmak; mevcut web push dahil tüm kanallar bu hattan geçer.

**Architecture:** `sendPushToUser` imzası korunur ama içi outbox'a delege edilir: her bildirim önce `NotificationEvent` + cihaz başına `NotificationDelivery(pending)` satırı olarak yazılır (transaction), ardından anında gönderim denenir; başarısız teslimatlar 15 dakikalık cron'la exponential backoff ile yeniden denenir. Sağlayıcı adaptörleri (web-push VAPID mevcut, FCM v1 yeni — jose ile RS256 service-account JWT) tek arayüz arkasında. Hassas içerik (devamsızlık, taksit) kilit ekranına jenerik metinle gider; tam metin uygulama içi inbox kaydında (NotificationEvent) kalır.

**Tech Stack:** Next.js 14 route handlers, Prisma/PostgreSQL (Neon), `web-push` (mevcut), `jose` (mevcut — FCM OAuth JWT), vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-native-mobil-app-design.md` §8 (Push Mimarisi), §9/5, §17.
**ADR notu (spec'ten bilinçli sapma):** Spec'teki ayrı `NotificationOutbox` tablosu `NotificationEvent.dispatchStatus` alanına katlandı — event satırı domain olayıyla aynı transaction'da yazıldığı için outbox garantisi aynen sağlanır, bir tablo ve join eksilir (YAGNI).

## Global Constraints

- TypeScript strict; `tsconfig` `allowJs: false` — anahtarı SİLME (Next 14 geri yazar), `false` bırak.
- Yeni npm bağımlılığı YOK — `web-push` ve `jose` zaten kurulu.
- Hata formatı: route'larda `{ error: 'mesaj' }` + doğru HTTP status.
- Cron route'ları withAuth İSTİSNASI — dosya başına gerekçe yorumu + `Bearer ${CRON_SECRET}` doğrulaması (bkz. `app/api/cron/cleanup/route.ts` kalıbı).
- Prisma kullanan route'larda `export const runtime = 'nodejs';`.
- Commit mesajları Türkçe, `feat(bildirim):` / `fix:` önekli; her task sonunda commit; **`npm run build` geçmeden commit YOK**; `git add <dosya>` (asla `-A`).
- Kimlik üretimi `lib/id.ts` `newId()` — `Math.random` yasak.
- FCM env değişkenleri yoksa FCM adaptörü sessiz no-op (repo deseni: "kod no-op yapar yoksa").
- Tenant: satır düzeyi `orgSlug`+`branch` kolonları; istek bağlamında `tdb()`/`withScope`, global bakım işlerinde (cron dispatch/cleanup) base `prisma` — kasıtlı, yorumla belirt.

## Dosya Haritası

| Dosya | Sorumluluk |
|---|---|
| `prisma/schema.prisma` (değişir) | 3 yeni model: NotificationEvent, NotificationDelivery, DeviceInstallation |
| `lib/push/policy.ts` (yeni) | Saf kurallar: backoff, deneme sınırı, hassas içerik→jenerik push metni, sonuç→durum geçişi. **Prisma import ETMEZ** (vitest için temiz) |
| `lib/push/policy.test.ts` (yeni) | policy birim testleri |
| `lib/push/providers.ts` (yeni) | `deliver(target, notif)` — webpush + FCM v1 adaptörleri; FCM OAuth token (jose). **Prisma import ETMEZ** |
| `lib/push/providers.test.ts` (yeni) | FCM JWT iddiası + deliver testleri (fetch/web-push mock) |
| `lib/push/outbox.ts` (yeni) | DB bağlama: `enqueueNotification` (event+delivery transaction + anında gönderim), `dispatchDue` (cron retry) |
| `lib/push.ts` (değişir) | `sendPushToUser` outbox'a delege; `PushPayload.sensitive` alanı; abonelik CRUD aynen kalır |
| `lib/notify.ts` (değişir) | `notifyAbsentParents` → `sensitive: true` |
| `app/api/cron/payment-reminders/route.ts` (değişir) | taksit push'u → `sensitive: true` |
| `app/api/cron/notif-dispatch/route.ts` (yeni) | 15 dk'lık retry cron'u |
| `app/api/cron/cleanup/route.ts` (değişir) | Event 90g / bitmiş Delivery 30g retention |
| `vercel.json` (değişir) | 5. cron: `*/15 * * * *` |

**Operasyonel ön koşul (Mustafa — koddan bağımsız, Task 8'e kadar yetişmeli):** Firebase Console'da (`mustafayanar54@gmail.com`) proje aç (`okulin-mobil`), Project Settings → Service accounts → "Generate new private key" → JSON'dan üç değeri Vercel env'e ekle: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` (private key'i tek satır, `\n` kaçışlı yapıştır). Yoksa da altyapı çalışır (FCM no-op) — mobil app gelene kadar acele değil.

---

### Task 1: Prisma modelleri

**Files:**
- Modify: `prisma/schema.prisma` (PushSub modelinin hemen altına, ~satır 605 sonrası)

**Interfaces:**
- Produces: `prisma.notificationEvent`, `prisma.notificationDelivery`, `prisma.deviceInstallation` client tipleri (Task 5-7 kullanır)

- [ ] **Step 1: Modelleri ekle**

`prisma/schema.prisma` içinde `model PushSub { ... }` bloğunun altına ekle:

```prisma
// ── Bildirim outbox (kayıpsız teslimat) ─────────────────────────────────────
// NotificationEvent: kullanıcıya gösterilecek kalıcı bildirim kaydı (uygulama
// içi inbox bunu okuyacak) + outbox işlevi (dispatchStatus). Domain olayıyla
// aynı transaction'da yazılır → gönderim işi asla kaybolmaz.
// sensitive=true → push'ta jenerik metin (kilit ekranı mahremiyeti, Apple 4.5.4);
// tam title/body yalnız bu satırda (inbox'ta) durur.
model NotificationEvent {
  id             String    @id
  orgSlug        String
  branch         String    @default("main")
  role           String // student|teacher|parent|acc|cou|director
  userId         String // legacyId; parent için telefon (push.ts anahtarıyla birebir)
  title          String
  body           String
  url            String?
  tag            String?
  sensitive      Boolean   @default(false)
  data           Json?
  dispatchStatus String    @default("pending") // pending|done (delivery fan-out yazıldı)
  createdAt      DateTime  @default(now())
  readAt         DateTime?

  @@index([orgSlug, branch, role, userId, createdAt])
  @@index([dispatchStatus])
}

// Cihaz başına teslimat denemesi. target: webpush=endpoint / fcm=cihaz token'ı
// (denormalize — abonelik sonradan silinse de retry hedefini bilir).
model NotificationDelivery {
  id            String   @id
  eventId       String
  orgSlug       String
  branch        String   @default("main")
  provider      String // webpush|fcm
  target        String
  keys          Json? // yalnız webpush (p256dh/auth)
  status        String   @default("pending") // pending|sent|dead
  attempts      Int      @default(0)
  nextAttemptAt DateTime @default(now())
  providerId    String?
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([eventId, target])
  @@index([status, nextAttemptAt])
  @@index([orgSlug, branch])
}

// Native uygulama kurulumları (FCM/APNs token kaydı). Mobil app (Plan 3)
// doldurur; bu planda yalnız fan-out okur (bugün boş döner).
model DeviceInstallation {
  id         String   @id // istemci üretimi rastgele installationId
  orgSlug    String
  branch     String   @default("main")
  platform   String // android|ios
  provider   String   @default("fcm") // fcm|apns
  token      String
  role       String
  userId     String
  appVersion String?
  enabled    Boolean  @default(true)
  lastSeenAt DateTime @default(now())
  createdAt  DateTime @default(now())

  @@unique([provider, token])
  @@index([orgSlug, branch, role, userId])
}
```

- [ ] **Step 2: Şemayı veritabanına uygula**

Çalıştır: `npm run db:push`
Beklenen: `Your database is now in sync with your Prisma schema.` (+ `prisma generate` otomatik koşar)

- [ ] **Step 3: Build doğrula ve commit**

Çalıştır: `npm run build` → hatasız bitmeli.

```bash
git add prisma/schema.prisma
git commit -m "feat(bildirim): outbox şeması — NotificationEvent/Delivery + DeviceInstallation"
```

---

### Task 2: Saf politika modülü (backoff, hassas metin, durum geçişi)

**Files:**
- Create: `lib/push/policy.ts`
- Test: `lib/push/policy.test.ts`

**Interfaces:**
- Produces (Task 5-6 kullanır):
  - `MAX_ATTEMPTS = 5`
  - `backoffMinutes(attempt: number): number | null` — 1→5, 2→30, 3→120, 4→720, ≥5→null (dead)
  - `renderPush(p: { title: string; body: string; sensitive?: boolean }): { title: string; body: string }`
  - `applyResult(attempts: number, r: { ok: boolean; permanent: boolean }, now: Date): { status: 'sent' | 'pending' | 'dead'; nextAttemptAt?: Date }`

- [ ] **Step 1: Başarısız testi yaz**

`lib/push/policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { backoffMinutes, renderPush, applyResult, MAX_ATTEMPTS } from './policy';

describe('backoffMinutes', () => {
  it('artan gecikme verir, sınırda null (dead) döner', () => {
    expect(backoffMinutes(1)).toBe(5);
    expect(backoffMinutes(2)).toBe(30);
    expect(backoffMinutes(3)).toBe(120);
    expect(backoffMinutes(4)).toBe(720);
    expect(backoffMinutes(MAX_ATTEMPTS)).toBeNull();
    expect(backoffMinutes(99)).toBeNull();
  });
});

describe('renderPush', () => {
  it('hassas içerikte jenerik metin döner (kilit ekranı mahremiyeti)', () => {
    const out = renderPush({ title: 'Devamsızlık Bildirimi', body: 'Ali Yılmaz bugün derse katılmadı.', sensitive: true });
    expect(out.title).toBe('Yeni bildiriminiz var');
    expect(out.body).toBe('Detayları görmek için okulin uygulamasını açın.');
    expect(out.body).not.toContain('Ali');
  });
  it('normal içeriği aynen geçirir', () => {
    const out = renderPush({ title: 'Duyuru', body: 'Yarın etüt var.' });
    expect(out).toEqual({ title: 'Duyuru', body: 'Yarın etüt var.' });
  });
});

describe('applyResult', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  it('başarı → sent', () => {
    expect(applyResult(1, { ok: true, permanent: false }, now)).toEqual({ status: 'sent' });
  });
  it('kalıcı hata → dead (retry yok)', () => {
    expect(applyResult(1, { ok: false, permanent: true }, now)).toEqual({ status: 'dead' });
  });
  it('geçici hata → pending + backoff kadar ileri nextAttemptAt', () => {
    const r = applyResult(1, { ok: false, permanent: false }, now);
    expect(r.status).toBe('pending');
    expect(r.nextAttemptAt!.getTime()).toBe(now.getTime() + 5 * 60_000);
  });
  it('deneme sınırı aşılınca → dead', () => {
    expect(applyResult(MAX_ATTEMPTS, { ok: false, permanent: false }, now)).toEqual({ status: 'dead' });
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/push/policy.test.ts`
Beklenen: FAIL — `Cannot find module './policy'` (veya eşdeğeri).

- [ ] **Step 3: Modülü yaz**

`lib/push/policy.ts`:

```typescript
// Bildirim teslimat POLİTİKASI — saf fonksiyonlar, DB/IO yok (vitest dostu).
// Outbox durum makinesi: pending --deliver--> sent | pending(backoff) | dead.

export const MAX_ATTEMPTS = 5;

// attempt = kaçıncı denemenin SONUCU işleniyor (1-bazlı). Sınırda null → dead.
const BACKOFF_MIN = [5, 30, 120, 720] as const; // 5dk, 30dk, 2sa, 12sa

export function backoffMinutes(attempt: number): number | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  return BACKOFF_MIN[attempt - 1] ?? null;
}

// Kilit ekranı mahremiyeti (Apple 4.5.4 + KVKK): hassas bildirimlerde push'a
// jenerik metin gider; tam içerik yalnız NotificationEvent (uygulama içi inbox).
export const GENERIC_PUSH = {
  title: 'Yeni bildiriminiz var',
  body: 'Detayları görmek için okulin uygulamasını açın.',
} as const;

export function renderPush(p: { title: string; body: string; sensitive?: boolean }): { title: string; body: string } {
  if (p.sensitive) return { ...GENERIC_PUSH };
  return { title: p.title, body: p.body };
}

export interface DeliveryOutcome {
  status: 'sent' | 'pending' | 'dead';
  nextAttemptAt?: Date;
}

export function applyResult(attempts: number, r: { ok: boolean; permanent: boolean }, now: Date): DeliveryOutcome {
  if (r.ok) return { status: 'sent' };
  if (r.permanent) return { status: 'dead' };
  const mins = backoffMinutes(attempts);
  if (mins === null) return { status: 'dead' };
  return { status: 'pending', nextAttemptAt: new Date(now.getTime() + mins * 60_000) };
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Çalıştır: `npx vitest run lib/push/policy.test.ts`
Beklenen: 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/push/policy.ts lib/push/policy.test.ts
git commit -m "feat(bildirim): teslimat politikası — backoff + hassas-metin + durum geçişi (saf, testli)"
```

---

### Task 3: FCM v1 OAuth iddiası (jose)

**Files:**
- Create: `lib/push/providers.ts` (bu task'ta yalnız token kısmı)
- Test: `lib/push/providers.test.ts`

**Interfaces:**
- Produces: `_fcmAssertion(email: string, pkcs8Key: string, nowSec: number): Promise<string>` (test edilebilir çekirdek — tenant.ts `_scopedClient` deseni) ve `fcmAccessToken(): Promise<string | null>` (env yoksa null; modül içi 1 saatlik cache)

- [ ] **Step 1: Başarısız testi yaz**

`lib/push/providers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { _fcmAssertion } from './providers';

// Test için geçici RS256 anahtarı (gerçek service-account taklidi)
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

describe('_fcmAssertion', () => {
  it('Google token uçuna uygun RS256 JWT üretir', async () => {
    const jwt = await _fcmAssertion('svc@okulin-mobil.iam.gserviceaccount.com', pkcs8, 1_800_000_000);
    expect(decodeProtectedHeader(jwt).alg).toBe('RS256');
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe('svc@okulin-mobil.iam.gserviceaccount.com');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.iat).toBe(1_800_000_000);
    expect(claims.exp).toBe(1_800_000_000 + 3600);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/push/providers.test.ts`
Beklenen: FAIL — `Cannot find module './providers'`.

- [ ] **Step 3: Token modülünü yaz**

`lib/push/providers.ts` (dosyanın ilk hali — deliver Task 4'te eklenecek):

```typescript
import { SignJWT, importPKCS8 } from 'jose';

// Push sağlayıcı adaptörleri — DB/Prisma import ETMEZ (outbox.ts bağlar).
//
// FCM HTTP v1 kimlik doğrulaması: service-account ile OAuth2 jwt-bearer akışı.
// Google SDK'sı (firebase-admin) KASITLI kullanılmıyor — jose zaten bağımlılık,
// tek scope'luk token için 40 satır yeterli (yeni bağımlılık yok kuralı).
// Env: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (\n kaçışlı tek satır).
// Üçü de yoksa FCM adaptörü no-op (repo deseni).

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Test edilebilir çekirdek (bkz. lib/tenant.ts _scopedClient deseni).
export async function _fcmAssertion(email: string, pkcs8Key: string, nowSec: number): Promise<string> {
  const pk = await importPKCS8(pkcs8Key, 'RS256');
  return new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 3600)
    .sign(pk);
}

let _tokenCache: { token: string; expSec: number } | null = null;

export async function fcmAccessToken(): Promise<string | null> {
  const email = process.env.FCM_CLIENT_EMAIL;
  const key = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) return null; // FCM yapılandırılmamış → no-op

  const nowSec = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.expSec - 60 > nowSec) return _tokenCache.token;

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
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  _tokenCache = { token: data.access_token, expSec: nowSec + (data.expires_in || 3600) };
  return data.access_token;
}
```

- [ ] **Step 4: Testin geçtiğini doğrula**

Çalıştır: `npx vitest run lib/push/providers.test.ts`
Beklenen: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/push/providers.ts lib/push/providers.test.ts
git commit -m "feat(bildirim): FCM v1 OAuth token üreticisi (jose, yeni bağımlılık yok)"
```

---

### Task 4: Sağlayıcı adaptörleri — `deliver()`

**Files:**
- Modify: `lib/push/providers.ts` (Task 3 dosyasının sonuna eklenir)
- Modify: `lib/push/providers.test.ts` (testler eklenir)

**Interfaces:**
- Produces (Task 5 kullanır):
  - `interface ProviderResult { ok: boolean; permanent: boolean; providerId?: string; error?: string }`
  - `type PushTarget = { provider: 'webpush'; target: string; keys: { p256dh: string; auth: string } } | { provider: 'fcm'; target: string }`
  - `interface PushNotif { title: string; body: string; url?: string; tag?: string; requireInteraction?: boolean }`
  - `deliver(t: PushTarget, n: PushNotif): Promise<ProviderResult>`
- Consumes: Task 3 `fcmAccessToken()`

- [ ] **Step 1: Başarısız testleri ekle**

`lib/push/providers.test.ts` dosyasının sonuna ekle:

```typescript
import { vi, beforeEach, afterEach } from 'vitest';
import { deliver } from './providers';

// web-push modülünü mockla (gerçek push servisi çağrılmaz)
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));
import webpush from 'web-push';

describe('deliver — webpush', () => {
  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  const target = { provider: 'webpush' as const, target: 'https://fcm.googleapis.com/ep/abc', keys: { p256dh: 'k1', auth: 'k2' } };
  const notif = { title: 'T', body: 'B' };

  it('başarılı gönderim → ok', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201 } as never);
    const r = await deliver(target, notif);
    expect(r).toEqual({ ok: true, permanent: false });
  });
  it('410 Gone → kalıcı hata (abonelik ölü)', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 });
    const r = await deliver(target, notif);
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(true);
  });
  it('5xx → geçici hata (retry edilir)', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 503 });
    const r = await deliver(target, notif);
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(false);
  });
});

describe('deliver — fcm', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('env yoksa geçici hata döner (yapılandırma gelince retry başarır)', async () => {
    vi.stubEnv('FCM_CLIENT_EMAIL', '');
    vi.stubEnv('FCM_PRIVATE_KEY', '');
    const r = await deliver({ provider: 'fcm', target: 'tok1' }, { title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(false);
    expect(r.error).toContain('FCM yapılandırılmamış');
  });
  it('UNREGISTERED (404) → kalıcı hata', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'okulin-mobil');
    vi.stubEnv('FCM_CLIENT_EMAIL', 'svc@x.iam.gserviceaccount.com');
    vi.stubEnv('FCM_PRIVATE_KEY', pkcs8.replace(/\n/g, '\\n'));
    const fetchMock = vi.fn()
      // 1. çağrı: OAuth token
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }))
      // 2. çağrı: FCM send → 404 UNREGISTERED
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await deliver({ provider: 'fcm', target: 'dead-token' }, { title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('başarılı gönderim → ok + providerId', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'okulin-mobil');
    vi.stubEnv('FCM_CLIENT_EMAIL', 'svc@x.iam.gserviceaccount.com');
    vi.stubEnv('FCM_PRIVATE_KEY', pkcs8.replace(/\n/g, '\\n'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at2', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'projects/okulin-mobil/messages/m1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await deliver({ provider: 'fcm', target: 'tok2' }, { title: 'T', body: 'B', url: '/?sekme=odeme' });
    expect(r.ok).toBe(true);
    expect(r.providerId).toBe('projects/okulin-mobil/messages/m1');
    // FCM v1 gövdesi doğru mu?
    const fcmBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(fcmBody.message.token).toBe('tok2');
    expect(fcmBody.message.notification).toEqual({ title: 'T', body: 'B' });
    expect(fcmBody.message.data).toEqual({ url: '/?sekme=odeme' });
  });
});
```

**Not:** FCM token cache'i testler arasında sızmasın diye her FCM testinde farklı `access_token` beklenmez — cache modül içi olduğundan `expires_in` dolmadan ikinci test aynı token'ı kullanabilir; testlerdeki fetch mock'ları OAuth çağrısını `mockResolvedValueOnce` ile sıraya koyar. Cache nedeniyle OAuth çağrısı atlanırsa FCM-send mock'u ilk sıraya kayar — bu yüzden her test kendi `vi.stubGlobal('fetch', ...)` kurulumunu yapar ve **assert'ler çağrı sırasına değil içeriğe bakar** (yukarıda `mock.calls[1]` yalnız 2-çağrılı senaryoda kullanılır; cache isabetinde `mock.calls[0]` olur — testte `fetchMock.mock.calls.at(-1)` kullan):

Yukarıdaki son testte şu satırı kullan (sıra bağımsız):
```typescript
const fcmBody = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/push/providers.test.ts`
Beklenen: FAIL — `deliver is not a function` (Task 3 testi geçmeye devam eder).

- [ ] **Step 3: `deliver()` uygula**

`lib/push/providers.ts` sonuna ekle:

```typescript
import webpush from 'web-push';

export interface ProviderResult {
  ok: boolean;
  permanent: boolean; // true → hedef ölü, retry ETME (abonelik/token temizlenir)
  providerId?: string;
  error?: string;
}

export type PushTarget =
  | { provider: 'webpush'; target: string; keys: { p256dh: string; auth: string } }
  | { provider: 'fcm'; target: string };

export interface PushNotif {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

let _vapidConfigured = false;
function ensureVapid(): boolean {
  if (_vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);
  _vapidConfigured = true;
  return true;
}

async function deliverWebPush(t: Extract<PushTarget, { provider: 'webpush' }>, n: PushNotif): Promise<ProviderResult> {
  if (!ensureVapid()) return { ok: false, permanent: false, error: 'VAPID yapılandırılmamış' };
  try {
    await webpush.sendNotification({ endpoint: t.target, keys: t.keys }, JSON.stringify(n));
    return { ok: true, permanent: false };
  } catch (err) {
    const code = (err as { statusCode?: number } | null)?.statusCode;
    return {
      ok: false,
      permanent: code === 404 || code === 410, // abonelik ölü
      error: `webpush ${code ?? 'hata'}`,
    };
  }
}

async function deliverFcm(t: Extract<PushTarget, { provider: 'fcm' }>, n: PushNotif): Promise<ProviderResult> {
  const projectId = process.env.FCM_PROJECT_ID;
  const token = await fcmAccessToken();
  if (!projectId || !token) return { ok: false, permanent: false, error: 'FCM yapılandırılmamış' };
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: {
          token: t.target,
          notification: { title: n.title, body: n.body },
          // data alanları string olmak zorunda (FCM v1 kuralı)
          data: n.url ? { url: n.url } : undefined,
          android: { priority: 'HIGH', notification: n.tag ? { tag: n.tag } : undefined },
        },
      }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { name?: string };
      return { ok: true, permanent: false, providerId: data.name };
    }
    // 404 UNREGISTERED / 400 INVALID_ARGUMENT → token ölü/bozuk, retry anlamsız
    return {
      ok: false,
      permanent: res.status === 404 || res.status === 400,
      error: `fcm ${res.status}`,
    };
  } catch (err) {
    return { ok: false, permanent: false, error: `fcm ağ hatası: ${err instanceof Error ? err.message : 'bilinmiyor'}` };
  }
}

export async function deliver(t: PushTarget, n: PushNotif): Promise<ProviderResult> {
  return t.provider === 'webpush' ? deliverWebPush(t, n) : deliverFcm(t, n);
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Çalıştır: `npx vitest run lib/push/providers.test.ts`
Beklenen: 7 test PASS (1 token + 3 webpush + 3 fcm).

- [ ] **Step 5: Commit**

```bash
git add lib/push/providers.ts lib/push/providers.test.ts
git commit -m "feat(bildirim): deliver() sağlayıcı adaptörleri — webpush + FCM v1, kalıcı/geçici hata ayrımı"
```

---

### Task 5: Outbox DB bağlama — enqueue + dispatch

**Files:**
- Create: `lib/push/outbox.ts`

**Interfaces:**
- Consumes: Task 2 `renderPush/applyResult`, Task 4 `deliver/PushTarget`, `lib/id.ts newId`, `lib/sqldb.ts tdb/withScope`, `lib/prisma.ts prisma`
- Produces (Task 6-7 kullanır):
  - `enqueueNotification(role: string, userId: string, payload: PushPayload): Promise<PushSendResult>` — event+delivery transaction + anında gönderim; `PushPayload/PushSendResult` `lib/push.ts`'ten import edilir (Task 6'da `sensitive` alanı eklenecek — bu task'ta lokal tip kullan, Task 6 bağlar)
  - `dispatchDue(limit?: number): Promise<{ processed: number; sent: number; retried: number; dead: number }>`

- [ ] **Step 1: Modülü yaz**

`lib/push/outbox.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { tdb, withScope } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { newId } from '@/lib/id';
import { renderPush, applyResult } from './policy';
import { deliver, type PushTarget } from './providers';

// Outbox: bildirim = önce DB kaydı (event + cihaz başına delivery), sonra gönderim.
// Eski kusur: lib/push.ts doğrudan gönderir, hata yutulurdu → bildirim kaybolurdu.
// Yeni akış: enqueue (transaction) → anında dispatch denemesi (hızlı yol) →
// başarısızlar cron'la (notif-dispatch) backoff'lu retry. Kayıp yok.

export interface OutboxPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  requireInteraction?: boolean;
  sensitive?: boolean;
}

export interface OutboxSendResult {
  sent: number;
  failed: number;
  removed: number;
  error?: string;
}

interface DeliveryRow {
  id: string;
  provider: string;
  target: string;
  keys: unknown;
  attempts: number;
}

function toTarget(d: DeliveryRow): PushTarget {
  return d.provider === 'webpush'
    ? { provider: 'webpush', target: d.target, keys: d.keys as { p256dh: string; auth: string } }
    : { provider: 'fcm', target: d.target };
}

// Tek bir delivery satırını gönderir ve sonucunu DB'ye işler.
// Dönüş: 'sent' | 'pending' | 'dead'. Kalıcı ölümde kaynak aboneliği de temizler.
async function deliverOne(
  d: DeliveryRow,
  notif: { title: string; body: string; url?: string; tag?: string; requireInteraction?: boolean },
): Promise<'sent' | 'pending' | 'dead'> {
  const attempts = d.attempts + 1;
  const r = await deliver(toTarget(d), notif);
  const outcome = applyResult(attempts, r, new Date());
  await prisma.notificationDelivery.update({
    where: { id: d.id },
    data: {
      status: outcome.status,
      attempts,
      nextAttemptAt: outcome.nextAttemptAt ?? new Date(),
      providerId: r.providerId ?? undefined,
      lastError: r.ok ? null : (r.error ?? 'bilinmeyen hata'),
    },
  });
  if (outcome.status === 'dead' && r.permanent) {
    // Ölü hedefi kaynak tablodan da düşür (eski sendPushToUser 404/410 temizliği)
    if (d.provider === 'webpush') {
      await prisma.pushSub.deleteMany({ where: { endpoint: d.target } });
    } else {
      await prisma.deviceInstallation.updateMany({ where: { token: d.target }, data: { enabled: false } });
    }
  }
  return outcome.status;
}

// Kullanıcının cihazlarına bildirim kuyruklar + anında göndermeyi dener.
// İstek/tenant bağlamında çağrılır (tdb doğru kuruma yönlenir).
// Dönüş şekli eski sendPushToUser ile aynı: { sent, failed, removed }.
export async function enqueueNotification(role: string, userId: string, payload: OutboxPayload): Promise<OutboxSendResult> {
  // 1) Cihaz fan-out: web abonelikleri + native kurulumlar (bugün boş — Plan 3 doldurur)
  const webSubs = await tdb().pushSub.findMany({ where: { role, userId } });
  const devices = await tdb().deviceInstallation.findMany({ where: { role, userId, enabled: true } });

  // 2) Event + delivery satırları TEK transaction'da (outbox garantisi)
  const eventId = newId('ne_');
  const org = currentOrg();
  const branch = currentBranch();
  interface NewDelivery {
    id: string; eventId: string; orgSlug: string; branch: string;
    provider: string; target: string; keys?: object;
  }
  const deliveries: NewDelivery[] = [
    ...webSubs.map((s) => ({
      id: newId('nd_'), eventId, orgSlug: org, branch,
      provider: 'webpush', target: s.endpoint, keys: (s.keys ?? {}) as object,
    })),
    ...devices.map((di) => ({
      id: newId('nd_'), eventId, orgSlug: org, branch,
      provider: di.provider, target: di.token,
    })),
  ];
  // DİKKAT: transaction'da base `prisma` kullanılır — $extends'li tdb() client'ının
  // promise'i base $transaction'a karıştırılamaz (runtime "Transaction API error").
  // withScope aynı orgSlug/branch alanlarını data'ya enjekte eder → tenant garantisi aynı.
  await prisma.$transaction([
    prisma.notificationEvent.create({
      data: withScope({
        id: eventId,
        role, userId,
        title: payload.title, body: payload.body,
        url: payload.url, tag: payload.tag,
        sensitive: payload.sensitive ?? false,
        dispatchStatus: 'done', // fan-out bu transaction'da yazıldı
      }) as never, // withScope dönüşü geniş tip — create data'ya daraltma
    }),
    ...deliveries.map((data) => prisma.notificationDelivery.create({ data })),
  ]);

  if (deliveries.length === 0) return { sent: 0, failed: 0, removed: 0 }; // cihazsız kullanıcı — event inbox'ta durur

  // 3) Anında gönderim (hızlı yol) — başarısızlar pending kalır, cron toparlar
  const pushText = renderPush(payload);
  const notif = { ...pushText, url: payload.url, tag: payload.tag, requireInteraction: payload.requireInteraction };
  let sent = 0, failed = 0, removed = 0;
  for (const d of deliveries) {
    const status = await deliverOne({ ...d, keys: d.keys ?? {}, attempts: 0 }, notif);
    if (status === 'sent') sent++;
    else if (status === 'dead') { failed++; removed++; }
    else failed++;
  }
  return { sent, failed, removed };
}

// Cron retry: vadesi gelmiş pending teslimatları global tarar (tüm kurumlar —
// kasıtlı base prisma, bkz. cron/cleanup kalıbı; hedef token satırda gömülü,
// tenant bağlamı gerekmez). Event'in push metnini yeniden üretir.
export async function dispatchDue(limit = 200): Promise<{ processed: number; sent: number; retried: number; dead: number }> {
  const due = await prisma.notificationDelivery.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
  let sent = 0, retried = 0, dead = 0;
  for (const d of due) {
    const ev = await prisma.notificationEvent.findUnique({ where: { id: d.eventId } });
    if (!ev) { // event silinmiş (retention) → teslimatı kapat
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'dead', lastError: 'event yok' } });
      dead++;
      continue;
    }
    const pushText = renderPush({ title: ev.title, body: ev.body, sensitive: ev.sensitive });
    const status = await deliverOne(d, { ...pushText, url: ev.url ?? undefined, tag: ev.tag ?? undefined });
    if (status === 'sent') sent++;
    else if (status === 'dead') dead++;
    else retried++;
  }
  return { processed: due.length, sent, retried, dead };
}
```

- [ ] **Step 2: Tip kontrolü**

Çalıştır: `npx tsc --noEmit`
Beklenen: 0 hata. (Prisma client tipleri Task 1 `db:push` ile üretildi.)

- [ ] **Step 3: Commit**

```bash
git add lib/push/outbox.ts
git commit -m "feat(bildirim): outbox enqueue + dispatchDue — transaction'lı kayıt, anında gönderim, cron retry"
```

---

### Task 6: `sendPushToUser` outbox'a delege + hassas işaretler

**Files:**
- Modify: `lib/push.ts:33-40` (PushPayload'a `sensitive`), `lib/push.ts:78-104` (sendPushToUser gövdesi)
- Modify: `lib/notify.ts:46-51` (devamsızlık push'u `sensitive: true`)
- Modify: `app/api/cron/payment-reminders/route.ts:44-49` (taksit push'u `sensitive: true`)

**Interfaces:**
- Consumes: Task 5 `enqueueNotification`
- Produces: `sendPushToUser` imzası ve dönüş şekli DEĞİŞMEZ — 8 çağıran dosya (notify, payment-reminders, etkinlik, form, odev, push, announcements, davranis) dokunulmadan outbox'tan geçer.

- [ ] **Step 1: `lib/push.ts` düzenle**

`PushPayload` arayüzüne alan ekle (satır ~33):

```typescript
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  requireInteraction?: boolean;
  // true → push'ta jenerik metin (kilit ekranı mahremiyeti); tam metin yalnız
  // NotificationEvent'te (uygulama içi inbox). Devamsızlık/taksit için.
  sensitive?: boolean;
}
```

`sendPushToUser` fonksiyonunun TAMAMINI şu hale getir (eski gövde — findMany + webpush döngüsü + toRemove — silinir; dosya başındaki `webpush`/`ensureConfigured` kısımları ve abonelik CRUD fonksiyonları AYNEN kalır; artık kullanılmayan `ensureConfigured` ve `import webpush` satırını da kaldır — gönderim providers.ts'e taşındı):

```typescript
// Bir kullanıcının TÜM cihazlarına push gönderir — OUTBOX üzerinden.
// Bildirim önce NotificationEvent + NotificationDelivery olarak yazılır (kayıp
// olmaz), anında gönderim denenir, başarısızlar cron'la (notif-dispatch) retry
// edilir. İmza ve dönüş şekli eski davranışla birebir — çağıranlar değişmez.
export async function sendPushToUser(role: string, userId: string, payload: PushPayload): Promise<PushSendResult> {
  try {
    return await enqueueNotification(role, userId, payload);
  } catch (err) {
    // Outbox yazımı bile başarısızsa (DB kesintisi) eski best-effort sözleşmesi korunur
    console.warn('[push] enqueue başarısız:', err instanceof Error ? err.message : err);
    return { sent: 0, failed: 0, removed: 0, error: 'enqueue başarısız' };
  }
}
```

Dosya başına import ekle:

```typescript
import { enqueueNotification } from './push/outbox';
```

**Dikkat — döngüsel import yok:** `outbox.ts`, `lib/push.ts`'i import ETMEZ (kendi `OutboxPayload/OutboxSendResult` tiplerini tanımlar, yapısal olarak uyumlu).

- [ ] **Step 2: Devamsızlık push'unu hassas işaretle**

`lib/notify.ts` satır 46-51'deki çağrıya `sensitive: true` ekle:

```typescript
      await sendPushToUser('parent', phone, {
        title: 'Devamsızlık Bildirimi',
        body: `${names.join(', ')} bugün derse katılmadı.`,
        url: '/?sekme=program',
        tag: `devamsizlik-${date}`,
        sensitive: true, // kilit ekranında öğrenci adı görünmez (Apple 4.5.4/KVKK)
      });
```

- [ ] **Step 3: Taksit push'unu hassas işaretle**

`app/api/cron/payment-reminders/route.ts` satır 44-49'daki çağrıya `sensitive: true` ekle:

```typescript
      const r = await sendPushToUser('parent', phone, {
        title: 'Ödeme Hatırlatması',
        body,
        url: '/?sekme=odeme',
        tag: 'odeme-hatirlatma',
        sensitive: true, // kilit ekranında isim+tutar görünmez; detay panelde
      });
```

- [ ] **Step 4: Tip + build + tüm birim testleri**

Çalıştır: `npx tsc --noEmit && npm run test && npm run build`
Beklenen: tsc 0 hata; mevcut 112 + yeni 14 birim testi PASS; build başarılı.

- [ ] **Step 5: Commit**

```bash
git add lib/push.ts lib/push/outbox.ts lib/notify.ts app/api/cron/payment-reminders/route.ts
git commit -m "feat(bildirim): sendPushToUser outbox'a delege — kayıpsız teslimat; devamsızlık+taksit push'ları kilit ekranında jenerik"
```

---

### Task 7: Retry cron'u + retention

**Files:**
- Create: `app/api/cron/notif-dispatch/route.ts`
- Modify: `vercel.json` (crons dizisine 5. giriş)
- Modify: `app/api/cron/cleanup/route.ts:49-52` (retention ekleri)

**Interfaces:**
- Consumes: Task 5 `dispatchDue`

- [ ] **Step 1: Cron route'unu yaz**

`app/api/cron/notif-dispatch/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { dispatchDue } from '@/lib/push/outbox';

// Bildirim outbox retry cron'u — 15 dakikada bir vadesi gelmiş pending
// teslimatları backoff'la yeniden dener. Anında gönderim (enqueue içi hızlı
// yol) çoğu bildirimi halleder; bu cron güvenlik ağıdır (geçici sağlayıcı
// hatası, VAPID/FCM kesintisi).
//
// Bilinçli withAuth istisnası: cron ucu — oturum yok, CRON_SECRET Bearer doğrulanır.

export const runtime = 'nodejs'; // Prisma + web-push Node gerektirir

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await dispatchDue();
  return NextResponse.json({ ok: true, ...result });
}
```

- [ ] **Step 2: vercel.json'a cron ekle**

`vercel.json` crons dizisinin sonuna ekle (cleanup girişinden sonra, virgüle dikkat):

```json
    {
      "path": "/api/cron/notif-dispatch",
      "schedule": "*/15 * * * *"
    }
```

- [ ] **Step 3: Cleanup'a retention ekle**

`app/api/cron/cleanup/route.ts` — sabitlerin altına (satır ~22 sonrası) ekle:

```typescript
// Bildirim inbox kayıtları: 90 gün sonra kullanıcı için de bayat.
const NOTIF_EVENT_RETENTION_DAYS = 90;
// Sonuçlanmış (sent/dead) teslimat satırları: 30 gün hata ayıklama penceresi.
const NOTIF_DELIVERY_RETENTION_DAYS = 30;
```

`GET` içinde `notifDeleted` satırından sonra ekle:

```typescript
  const eventDeleted = await purge('notificationEvent',
    () => prisma.notificationEvent.deleteMany({ where: { createdAt: { lt: cutoff(NOTIF_EVENT_RETENTION_DAYS) } } }));
  const deliveryDeleted = await purge('notificationDelivery',
    () => prisma.notificationDelivery.deleteMany({
      where: { status: { not: 'pending' }, updatedAt: { lt: cutoff(NOTIF_DELIVERY_RETENTION_DAYS) } },
    }));
```

ve dönüş satırını güncelle:

```typescript
  return NextResponse.json({ ok: true, auditDeleted, errDeleted, notifDeleted, eventDeleted, deliveryDeleted });
```

- [ ] **Step 4: Build doğrula**

Çalıştır: `npm run build`
Beklenen: başarılı; `/api/cron/notif-dispatch` route listesinde görünür.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/notif-dispatch/route.ts vercel.json app/api/cron/cleanup/route.ts
git commit -m "feat(bildirim): notif-dispatch retry cron'u (15dk) + event/delivery retention"
```

---

### Task 8: Deploy + canlı doğrulama

**Files:** (kod değişikliği yok — doğrulama görevi)

- [ ] **Step 1: Push et, deploy'u bekle**

```bash
git push
```

Vercel otomatik deploy'unun bitmesini bekle (dashboard veya `vercel ls` — proje `prj_CQOWv8bchQWuirm6eeb71VCmK0dk`).

- [ ] **Step 2: Cron ucunu canlıda doğrula**

```bash
curl -s "https://testkurs.okulin.com/api/cron/notif-dispatch" -H "Authorization: Bearer $CRON_SECRET"
```

Beklenen: `{"ok":true,"processed":0,"sent":0,"retried":0,"dead":0}` (henüz pending teslimat yok). Yanlış secret ile 401 `{"error":"Unauthorized"}` döndüğünü de doğrula.
(`CRON_SECRET` Vercel env'de — `vercel env pull` ile alınabilir.)

- [ ] **Step 3: Uçtan uca canlı smoke — gerçek push**

testkurs müdürüyle giriş yapıp (CLAUDE.local.md creds) web'de push aboneliği olan bir kullanıcıya test bildirimi tetikle: panel **Bildirim ayarları → "Test bildirimi gönder"** (`POST /api/push` `action: 'test'` — `sendPushToUser` üzerinden artık outbox'tan geçer).

Doğrula (Neon SQL veya `prisma studio`):
- `NotificationEvent`'te yeni satır (title "Test", dispatchStatus 'done')
- `NotificationDelivery`'de cihaz başına satır, `status='sent'`, `attempts=1`
- Bildirim tarayıcıya düştü (görsel doğrulama — Mustafa'nın abone cihazı)

- [ ] **Step 4: Devamsızlık akışı jenerik-metin doğrulaması**

testkurs'ta bir öğrenciye "yok" yoklaması gir (öğretmen paneli) → veli cihazına düşen push'un başlığı **"Yeni bildiriminiz var"** olmalı (öğrenci adı KİLİT EKRANINDA GÖRÜNMEMELİ); `NotificationEvent.body`'de tam metin (öğrenci adıyla) durmalı. Test sonrası yoklamayı geri al.

- [ ] **Step 5: Bitiş — memory + roadmap güncelle**

`native-app-girisi.md` memory'sine "Plan 1 (outbox+FCM) canlıda ✅" notu düşülür; sıradaki plan (Plan 2 — `/api/mobile/v1` çekirdek) yazılmaya hazır.

---

## Self-Review Notları (plan yazarı doldurdu)

- **Spec kapsaması:** §8'in tüm kalemleri karşılandı — outbox garantisi (Task 1+5), backoff+idempotent unique (Task 1 `@@unique([eventId,target])` + Task 2), kalıcı token temizliği (Task 5 `deliverOne`), FCM v1 doğrudan (Task 3-4), jenerik kilit ekranı (Task 2+6), retention (Task 7). §8'deki "Vercel Queues hızlandırıcı" bilinçli DAHİL DEĞİL (YAGNI — 15dk cron yeter; ölçüm gerektirirse sonra).
- **APNs adaptörü** bu planda YOK — spec §12 F3 (iOS fazı) işi.
- **Uygulama içi bildirim merkezi UI/API** bu planda YOK — Plan 2 (`/api/mobile/v1`) ve Plan 4 (native ekran) işi; bu plan yalnız veriyi biriktirmeye başlar.
- **Tip tutarlılığı:** `OutboxPayload` ⊇ `PushPayload` (yapısal uyum, döngüsel import yok); `OutboxSendResult` = `PushSendResult` şekli.
