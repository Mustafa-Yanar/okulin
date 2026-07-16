# /api/mobile/v1 Çekirdeği — Uygulama Planı (Mobil Plan 2/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native mobil uygulamanın backend çekirdeğini kurmak: kurum çözümleme (resolve-org), access/refresh token auth + cihaz oturumları (rotation + reuse detection + iptal), bootstrap (sürüm/bakım/kill-switch) ve native→WebView session-exchange.

**Architecture:** Mevcut web cookie sistemi AYNEN kalır; yanına Bearer token katmanı eklenir. Web login'inin çekirdeği (kimlik doğrulama + payload üretimi) `lib/login.ts` servisine çıkarılır — web `/api/auth` ve mobil `/api/mobile/v1/auth/login` aynı çekirdeği kullanır. Mobil access token = 15 dk'lık HS256 JWT, **ayrı `MOBILE_JWT_SECRET`** ile imzalanır (web cookie'sinden kriptografik olarak ayrık) + `aud='okulin-mobile'`. Refresh token = opak rastgele değer, DB'de sha256 hash'li `MobileSession` satırı (cihaz oturumu: tek tek iptal, "tüm cihazlardan çıkış", şifre değişiminde toplu iptal; **her korumalı istekte iptal kontrolü**). WebView oturumu tek kullanımlık koda dayalı session-exchange ile kurulur — WebView refresh token'ı HİÇ görmez, kod istek IP'sine bağlanır.

**Tech Stack:** Next.js 14 route handlers, Prisma/PostgreSQL (Neon), `jose` (mevcut), `bcryptjs` (mevcut), Upstash Redis (session-exchange kodu — kısa ömürlü), vitest, Playwright `int` (canlı testkurs).

**Spec:** `docs/superpowers/specs/2026-07-14-native-mobil-app-design.md` §6 (Kurum Keşfi), §7 (Auth ve Oturum), §9 (Backend).

**Üçlü-AI incelemesi (İKİ TUR):** Tur 1 — Codex (14) + Gemini (6); Tur 2 (güncel plana karşı) — Codex (8) + Gemini (6). Her iki turun Critical/Important bulguları işlendi (aşağıda "İnceleme kaynaklı kararlar" + ADR). Tur 2'de iki gerçek Critical yakalandı: refresh rotation'da eski token'ın sonsuz yaşaması (Codex) ve org_admin `tdb()` branch enjeksiyonu kırılması (Gemini+Codex).

**Operasyon ön koşulu:** Uygulamaya başlamadan `npm i -g vercel@latest` (Codex notu: yerel CLI 56.2.0 eski; deploy/env için 56.2.1+).

## Karar Notları (spec parametreleri + bilinçli sapmalar)

- **DOĞRULAMA ASKIYA ALINDI (Mustafa, 2026-07-16):** giriş cihaz doğrulaması (OTP/SMS) hem web hem mobilde devre dışı — **şifre doğruysa giriş yeter**. Kod SİLİNMEZ, çağrı yolundan çıkarılır (geri getirilebilir). İleride SMS yerine **kayıt kodu (enrollment code)** veya yerel-TR-SMS gelebilir — auth çekirdeği kanaldan bağımsız kuruluyor, doğrulama sonra takılır. Bkz. memory `bildirim-dogrulama-maliyet-karari`.
- **superadmin login DAVRANIŞI DEĞİŞTİRİLMEZ** (Mustafa 2026-07-16; İnceleme Codex #2): Plan 2 mobil auth çekirdeğidir, superadmin web login'i kapsam DIŞI. superadmin bloğu (maybeOtp dahil) `app/api/auth/route.ts`'e AYNEN taşınır — mevcut davranış (telefon yoksa/SMS gidemezse fail-OPEN) korunur. **Not:** bu fail-open bir zayıflıktır (en kritik hesap, SMS kesintisinde 2FA kalkar) ama Plan 2'de düzeltilmez; superadmin fail-closed sertleştirmesi ayrı güvenlik işidir (memory `superadmin-guvenlik` "AÇIK İŞ"). Normal roller OTP'den çıkarıldı → yeni cihaz bildirimi de onlar için tetiklenmez (aşağı ADR).
- **ADR — kabul edilen sınırlar (İnceleme, düzeltilmeyip belgelenenler):**
  - *WebView cookie iptal bağı (Codex #3/Gemini #5):* session-open kod tüketimi anında iptal yineler (Task 10), ama kurulan 12 saatlik web cookie'si sonrasında mobil iptalden bağımsız yaşar (JWT exp de 12 saat — çalınan cookie 12 saatte söner, 7 gün değil). Tam bağlama (WebView her istekte MobileSession kontrolü) Plan 3/WebView auth katmanı işi.
  - *IP-binding kırılganlığı (Codex #7):* session-exchange IP eşleşmesi defense-in-depth; dual-stack (IPv4/IPv6), VPN, hücresel geçişte meşru istek reddolabilir → native taraf yeni exchange üretir (Plan 3 istemci tek-retry). Aynı NAT'taki iki cihaz aynı IP'yi paylaşabilir → tek başına faktör değil.
  - *Her istekte iptal DB turu (Gemini #6):* withMobileAuth her korumalı istekte `loadActiveSession` (2 kolon, PK index) çeker. İptal ANINDA etki etmeli → cache güvenliği zayıflatır. Ölçülüp gerekirse Plan 3'te kısa-TTL Redis cache.
  - *Reuse detection prevHash-sınırı (Codex #1, düzeltme SONRASI kabul):* 2+ rotasyon eskimiş token "unknown" → reddedilir (revoke değil); zaten geçersiz. Full token-family YAGNI.
- **Access TTL 15 dk** (spec §7: 10-15 dk üst sınır), **refresh TTL 60 gün kayan pencere** (her rotation uzatır — aktif cihaz düşmez), **rotation grace 30 sn** (ağ hatasında yanıtı kaybolan meşru istemci eski token'la kısa süre yeniden deneyebilir; grace DIŞI eski token = reuse → oturum tamamen kapatılır).
- **Ayrı `MOBILE_JWT_SECRET`** (İnceleme: Codex #12 + Gemini #6, Mustafa onayı): mobil access token web `JWT_SECRET`'ından AYRI anahtarla imzalanır. Yüzey ayrımı kriptografik — web `verifyToken` mobil token'ı imza hatasıyla reddeder, `verifyMobileAccessToken` web token'ını hem farklı secret hem `aud` zorunluluğuyla reddeder. Bu sayede web `verifyToken`'a DOKUNULMAZ (aud-reddi hile'sine gerek yok). Env yoksa dev fallback (`JWT_SECRET` → sabit); prod'da zorunlu.
- **Token claim'leri:** oturum payload'ı (role, id, name, org, branch, rol-özel alanlar) + `sid` (MobileSession id) + `aud`. Spec'teki "token version" alanı YOK — iptal, her korumalı istekte `MobileSession.revokedAt` kontrolüyle çözülür (İnceleme: Codex #2/#4; versiyon sayacı gereksiz).
- **Payload tazeliği:** access token 15 dk'da bir refresh'te DB payload snapshot'ından yeniden imzalanır. Rol/çocuk değişikliği en geç 15 dk'da yansımaz DEĞİL — kritik değişimler (şifre sıfırlama) zaten tüm oturumları iptal eder (yeni login gerekir); rol/çocuk değişiminde ürün "yeniden login" bekler (web 7g cookie ile aynı sınıf). Not: ADR — daha sıkı tazelik gerekirse refresh'te DB'den taze payload üretimi eklenir (YAGNI şimdilik).
- **İptal (revocation) her korumalı istekte kontrol edilir** (İnceleme: Codex #2 — asıl Critical): `withMobileAuth` yalnız JWT imzasına GÜVENMEZ; `sid`'in `MobileSession` satırını okur, `revokedAt` doluysa veya `expiresAt` geçmişse 401. Böylece logout/şifre değişimi/cihaz iptali sonrası çalınmış access token 15 dk boyunca çalışmaz ve onunla WebView cookie üretilemez.
- **Tüm roller login olur, superadmin HARİÇ** (Mustafa onayı; İnceleme: Codex #8). superadmin mobilde HİÇ token üretmez (verifyLogin zincirinde yok). **org_admin dahil** — native ekranı yok ama session-exchange ile WebView yönetime girer; `__hq__` branch tenant kilidinde özel ele alınır (org eşleşir, branch muaf — web getSession paritesi).
- **resolve-org yalnız main şube host'u döner** (`/api/gate` paritesi); şube host'larına geçiş deep-link işi (Plan 3+).
- **Fail-closed tenant** (İnceleme: Codex #7): mobil auth uçları (login/refresh/Bearer korumalı) yalnız kurum host'unda çalışır — `orgFromHost(host)` null ise (apex/bilinmeyen host → `DEFAULT_ORG`'a düşme) reddedilir. resolve-org bu kuraldan MUAF (apex'ten çağrılır, kodla çözer).
- **CSRF: dar exact-path allowlist** (İnceleme: Codex #6 — tüm prefix yerine): yalnız oturumsuz JSON POST uçları (`resolve-org`, `auth/login`, `auth/refresh`) muaf; Bearer uçları zaten mevcut Bearer istisnasından geçer; `session-open` GET (CSRF sadece mutasyonda). Sözleşme testi: bu prefix'te cookie-auth mutasyon YOK.
- **MobileAppConfig** (min sürüm / bakım / feature flag) global tek satır, superadmin API'siyle yönetilir; panel UI'ı bu planda YOK (curl/panel sonrası iş).
- **Zod → üretilmiş TS istemci:** istek şemaları `lib/mobile/contracts.ts`'te tek kaynak. Response/error zarfları Plan 3'te (mobil istemci üretimiyle birlikte) versiyonlanır — İnceleme (Codex #9) not: request-only sözleşme bilinçli, ADR.
- **İsim sapmaları (ADR, İnceleme Codex #9):** spec `minimumSupportedVersion`/`recommendedVersion` → planda `minSupportedVersion`/`recommendedVersion` (kısa, tutarlı). Spec resolve-org `logo`/`colors` → planda `logoUrl`/`themeColor` (mevcut `lib/branding.ts` alan adlarıyla birebir). Bilinçli.

## Global Constraints

- TypeScript strict; `tsconfig` `allowJs: false` — anahtarı SİLME (Next 14 geri yazar), `false` bırak.
- Yeni npm bağımlılığı YOK — `jose`, `bcryptjs`, `zod`, `@upstash/*` zaten kurulu.
- **Yeni env: `MOBILE_JWT_SECRET`** (Vercel production, sensitive). Operasyonel ön koşul (Mustafa, Task 3'e kadar): `openssl rand -hex 32` ile üret, Vercel production env'e ekle. Yoksa da altyapı çalışır (dev fallback), ama canlı doğrulama (Task 11) için gerekir.
- Hata formatı: route'larda `{ error: 'mesaj' }` + doğru HTTP status.
- withAuth İSTİSNALARI dosya başına gerekçe yorumu ister (login/bootstrap/resolve-org/refresh/session-open kalıbı).
- Prisma kullanan route'larda `export const runtime = 'nodejs';`.
- Commit mesajları Türkçe, `feat(mobil):` / `refactor:` / `fix:` önekli; her task sonunda commit; **`npm run build` geçmeden commit YOK**; `git add <dosya>` (asla `-A`).
- Kimlik üretimi `lib/id.ts` `newId()` veya `crypto.randomBytes` — `Math.random` yasak.
- Tenant: `MobileSession` satır düzeyi `orgSlug`+`branch`; istek bağlamında `tdb()`. DİKKAT (Plan 1 dersi): `withScope` runtime'da alan EKLEMEZ (salt tip cast'i; gerçek enjeksiyon `tdb()` $extends'inde) — base `prisma` ile yazacaksan tenant alanlarını ELLE yaz. Bu planda base `prisma` yalnız GLOBAL tablolarda (MobileAppConfig, Org) ve cleanup cron'unda kullanılır.
- Loglara/yanıtlara token, refresh hash veya PII yazılmaz.
- Deploy Task 11'de (tek push); ara task'lar yalnız local commit.

## Dosya Haritası

| Dosya | Sorumluluk |
|---|---|
| `prisma/schema.prisma` (değişir) | 2 yeni model: MobileSession (cihaz oturumu + refresh hash), MobileAppConfig (global kill-switch) |
| `lib/sqldb.ts` (değişir) | SKIP setine `MobileAppConfig` (global tablo) |
| `lib/tenant.ts` (değişir) | `ScopedRedis`'e `getdel` (atomik tek-kullanımlık tüketim) |
| `lib/auth.ts` (değişir) | `setSession` opsiyonel maxAge (session-exchange kısa ömürlü cookie) |
| `lib/login.ts` (yeni) | Web+mobil ORTAK login çekirdeği: `verifyLogin`, `roleCategory`, `maskPhone`, `getOtpIdentity`. **tdb ile okur, cookie/token yazmaz, OTP tetiklemez** |
| `app/api/auth/route.ts` (değişir) | login `verifyLogin`'e delege; normal rollerde OTP askıya (superadmin 2FA korunur); şifre değişimlerinde mobil oturum iptali |
| `app/api/otp/verify/route.ts` (değişir) | `getOtpIdentity` lib/login'den import (yerel kopya silinir) — superadmin 2FA yolunda kullanılmaya devam |
| `lib/mobile/token.ts` (yeni) | Access JWT imza/doğrulama (MOBILE_JWT_SECRET + aud + issuer/alg kilidi), refresh üretim + sha256 hash. **DB import ETMEZ** |
| `lib/mobile/token.test.ts` (yeni) | token birim testleri |
| `lib/mobile/policy.ts` (yeni) | Saf refresh durum makinesi: rotate / reject / revoke(reuse) + TTL sabitleri. **Import'suz saf modül** |
| `lib/mobile/policy.test.ts` (yeni) | policy birim testleri |
| `lib/mobile/contracts.ts` (yeni) | Tüm /mobile/v1 isteklerinin Zod şemaları (ileride istemci üretiminin tek kaynağı) |
| `lib/mobile/sessions.ts` (yeni) | DB bağlama: issueMobileSession, refreshMobileSession, loadActiveSession, revoke*, listMobileDevices |
| `lib/mobile/auth.ts` (yeni) | `withMobileAuth` — Bearer + tenant kilidi + iptal kontrolü + HttpError çevirisi |
| `middleware.js` (değişir) | mobile/v1 oturumsuz POST uçları için dar CSRF allowlist |
| `app/api/mobile/v1/resolve-org/route.ts` (yeni) | kurum kodu → canonical host + marka (gate paritesi) |
| `app/api/mobile/v1/bootstrap/route.ts` (yeni) | sürüm kapısı + bakım + flags + kurum markası/modüller |
| `app/api/mobile/v1/me/route.ts` (yeni) | Bearer whoami |
| `app/api/mobile/v1/auth/login/route.ts` (yeni) | login (şifre doğru → token çifti; org_admin dahil) |
| `app/api/mobile/v1/auth/refresh/route.ts` (yeni) | rotation + reuse detection |
| `app/api/mobile/v1/auth/logout/route.ts` (yeni) | kendi oturumunu iptal |
| `app/api/mobile/v1/auth/devices/route.ts` (yeni) | cihaz oturumu listele / iptal / tümünden çıkış |
| `app/api/mobile/v1/session-exchange/route.ts` (yeni) | Bearer → tek kullanımlık kod (60 sn, IP'ye bağlı) |
| `app/api/mobile/v1/session-open/route.ts` (yeni) | kod → kısa ömürlü web cookie + redirect (IP eşleşme + atomik tüketim) |
| `app/api/superadmin/mobile-config/route.ts` (yeni) | MobileAppConfig GET/PUT (superadmin) |
| `app/api/cron/cleanup/route.ts` (değişir) | MobileSession retention (iptal/expired 30 gün) |
| `e2e/int-mobile-auth.spec.js` (yeni) | canlı testkurs'a karşı uçtan uca sözleşme testi |

---

### Task 1: Prisma modelleri + ScopedRedis.getdel + sqldb SKIP

**Files:**
- Modify: `prisma/schema.prisma` (`model DeviceInstallation { ... }` bloğunun altına, ~satır 674 sonrası)
- Modify: `lib/sqldb.ts:14-17` (SKIP setine `MobileAppConfig`)
- Modify: `lib/tenant.ts:93-108` (ScopedRedis interface) + `lib/tenant.ts:131-152` (_scopedClient impl)

**Interfaces:**
- Produces: `prisma.mobileSession`, `prisma.mobileAppConfig` client tipleri (Task 6-9 kullanır); `ScopedRedis.getdel<T>(key): Promise<T | null>` (Task 10 kullanır)

- [ ] **Step 1: Modelleri ekle**

`prisma/schema.prisma` içinde `model DeviceInstallation { ... }` bloğunun altına ekle:

```prisma
// ── Mobil cihaz oturumları (/api/mobile/v1 token auth) ──────────────────────
// Refresh token DB'de yalnız sha256 hash olarak durur (düz token asla yazılmaz).
// Rotation: her refresh'te yeni token, eskisi prevRefreshHash'e kayar; grace (30sn)
// dışı prev kullanımı = REUSE → oturum revoke (lib/mobile/policy.ts durum makinesi).
// payload: access token claim'lerinin snapshot'ı — refresh'te yeniden imzalanır.
// revokedAt: logout/şifre değişimi/cihaz iptali → withMobileAuth her istekte kontrol eder.
model MobileSession {
  id              String    @id // ms_ önekli newId
  orgSlug         String
  branch          String    @default("main")
  role            String // oturum rolü (assistant_director → 'director', payload ile aynı)
  userId          String // legacyId; parent için telefon (web session.id ile birebir)
  payload         Json
  installationId  String? // istemci üretimi rastgele kurulum kimliği (reklam kimliği değil)
  deviceName      String?
  platform        String? // android|ios
  refreshHash     String    @unique
  prevRefreshHash String?
  rotatedAt       DateTime?
  createdAt       DateTime  @default(now())
  lastUsedAt      DateTime  @default(now())
  expiresAt       DateTime // kayan pencere: her rotation +60 gün
  revokedAt       DateTime?
  revokedReason   String? // reuse|çıkış|cihaz iptali|tüm cihazlardan çıkış|şifre değişti|şifre sıfırlandı
  createdIp       String?

  @@index([orgSlug, branch, role, userId])
  @@index([prevRefreshHash])
}

// Mobil uygulama GLOBAL konfigürasyonu — remote kill-switch (spec §9/3).
// Tek satır (id='default'); superadmin API'siyle güncellenir; bootstrap okur.
// GLOBAL tablo (kurum-bağımsız) → sqldb SKIP listesinde, base prisma ile erişilir.
model MobileAppConfig {
  id                  String   @id @default("default")
  minSupportedVersion String   @default("0.0.0")
  recommendedVersion  String   @default("0.0.0")
  maintenance         Boolean  @default(false)
  maintenanceMessage  String?
  flags               Json?
  updatedAt           DateTime @updatedAt
}
```

- [ ] **Step 2: sqldb SKIP setine iki modeli de ekle**

`lib/sqldb.ts` içinde SKIP setini güncelle. `MobileAppConfig` GLOBAL tablo. **`MobileSession` de SKIP'e girer** (İnceleme: Gemini #1 + Codex #4 — Critical): mobil cihaz oturumu ORG düzeyi bir kavramdır, şube-bazlı DEĞİL. `tdb()` branch enjeksiyonu, org_admin (`__hq__`) veya şube-değiştiren kullanıcı oturumunu istek şubesine kısıtlayıp her isteği 401'letirdi. SKIP → enjeksiyon yok; `orgSlug` `sessions.ts`'te ELLE yazılır (Plan 1 "withScope runtime'da alan eklemez" dersi):

```typescript
const SKIP = new Set([
  'Org', 'SuperAdmin', 'Branch', 'OrgAdmin', 'DemoRequest',
  'TeacherPreset', 'Installment', 'BehaviorEntry', 'ExamRow', 'FormResponse',
  'MobileAppConfig', 'MobileSession',
]);
```

- [ ] **Step 3: ScopedRedis'e getdel ekle**

`lib/tenant.ts` `ScopedRedis` interface'ine (satır ~94, `get` satırının altına) ekle:

```typescript
  getdel<T = unknown>(key: string): Promise<T | null>;
```

`_scopedClient` dönüş objesine (satır ~132, `get:` satırının altına) ekle:

```typescript
    getdel: (key) => client.getdel(k(key)),
```

- [ ] **Step 4: Şemayı veritabanına uygula**

Çalıştır: `npm run db:push`
Beklenen: `Your database is now in sync with your Prisma schema.` (+ `prisma generate` otomatik koşar)

- [ ] **Step 5: Build doğrula ve commit**

Çalıştır: `npm run build` → hatasız bitmeli.

```bash
git add prisma/schema.prisma lib/sqldb.ts lib/tenant.ts
git commit -m "feat(mobil): MobileSession + MobileAppConfig şeması + ScopedRedis.getdel (atomik tüketim)"
```

---

### Task 2: signToken opsiyonel exp + verifyToken aud reddi + setSession maxAge

session-exchange kısa cookie için üç dokunuş: (a) `signToken` opsiyonel `expSec` alır — cookie `maxAge` kısaltılırken JWT `exp`'i 7 günde bırakmak, çalınan cookie değerini 7 gün geçerli kılardı (İnceleme: Codex #3b); (b) `verifyToken` `aud` taşıyan token'ı reddeder — dev'de `MOBILE_JWT_SECRET` yoksa mobil token web secret'ıyla imzalanabilir, bu defense-in-depth katmanı web yüzeyini korur (İnceleme: Codex #6 + Gemini #4); (c) `setSession` opsiyonel `maxAgeSec` — cookie ömrü + JWT exp birlikte kısalır.

**Files:**
- Modify: `lib/auth.ts:222-227` (signToken), `lib/auth.ts:229-236` (verifyToken), `lib/auth.ts:264-276` (setSession)
- Test: `lib/auth.token.test.ts` (yeni)

**Interfaces:**
- Produces (Task 10 kullanır): `signToken(payload, expSec?: number)` (default 7 gün, geriye uyumlu); `setSession(res, payload, opts?: { maxAgeSec?: number })` — maxAgeSec verilince cookie maxAge VE JWT exp ikisi de o kadar; `verifyToken` `aud`'lu token'a `null` döner.

- [ ] **Step 1: Başarısız testi yaz**

`lib/auth.token.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';

process.env.JWT_SECRET = 'test-web-secret';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => ({ get: () => null }),
}));

const { signToken, verifyToken } = await import('./auth');

describe('verifyToken aud reddi (defense-in-depth)', () => {
  it('kendi imzaladığı (aud’suz) web token’ını doğrular', async () => {
    const t = await signToken({ role: 'director', id: 'director' });
    expect((await verifyToken(t))?.role).toBe('director');
  });

  it('aud taşıyan token’ı REDDEDER (mobil token web cookie’sine geçemez)', async () => {
    const t = await new SignJWT({ role: 'director', sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('okulin-mobile')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('test-web-secret'));
    expect(await verifyToken(t)).toBeNull();
  });
});

describe('signToken expSec', () => {
  it('expSec verilince exp o kadar (kısa cookie için)', async () => {
    const t = await signToken({ role: 'director', id: 'director' }, 3600);
    const s = await verifyToken(t);
    expect(s!.exp! - s!.iat!).toBe(3600);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/auth.token.test.ts`
Beklenen: FAIL (aud reddi henüz yok / signToken expSec kabul etmiyor).

- [ ] **Step 3: lib/auth.ts'i düzenle**

(a) `signToken`'a opsiyonel exp ekle:

```typescript
export async function signToken(payload: Session, expSec?: number): Promise<string> {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: 'HS256' });
  if (expSec != null) {
    const nowSec = Math.floor(Date.now() / 1000);
    jwt.setIssuedAt(nowSec).setExpirationTime(nowSec + expSec);
  } else {
    jwt.setExpirationTime('7d');
  }
  return jwt.sign(getSecret());
}
```

(b) `verifyToken`'a aud reddi ekle:

```typescript
export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    // Defense-in-depth: audience taşıyan token (mobil access token, aud='okulin-mobile')
    // web cookie oturumu olarak KABUL EDİLMEZ. Ayrı MOBILE_JWT_SECRET zaten çapraz
    // doğrulamayı imza hatasıyla engeller; bu, dev fallback aynı secret'a düşse bile
    // (veya iki secret yanlışlıkla eşitlenirse) yüzeyleri ayrık tutar. Web token'ları
    // aud'suz imzalanır → eski oturumlar etkilenmez.
    if (payload.aud) return null;
    return payload as Session;
  } catch {
    return null;
  }
}
```

(c) `setSession`'a opsiyonel maxAge ekle (JWT exp'i de kısaltır):

```typescript
export async function setSession(
  res: ResponseWithCookies,
  payload: Session,
  opts?: { maxAgeSec?: number },
): Promise<void> {
  // Superadmin: '__super__'. Org_admin: '__hq__' branch. Diğerleri: currentOrg() + istek şubesi.
  const org = payload.role === 'superadmin' ? '__super__' : currentOrg();
  const branch = payload.role === 'org_admin' ? '__hq__' : (payload.branch || currentBranch());
  const maxAge = opts?.maxAgeSec ?? 60 * 60 * 24 * 7;
  // JWT exp = cookie maxAge (çalınan cookie DEĞERİ maxAge'den uzun yaşamasın).
  const token = await signToken({ ...payload, org, branch }, maxAge);
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}
```

- [ ] **Step 4: Testler + build**

Çalıştır: `npx vitest run lib/auth.token.test.ts && npx vitest run lib/auth.withauth.test.ts && npm run build`
Beklenen: yeni 3 test + mevcut withAuth testleri PASS; build başarılı. (setSession artık signToken'a exp geçiriyor — mevcut 7 gün davranışı korunur çünkü default maxAge 7 gün.)

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth.token.test.ts
git commit -m "feat(mobil): signToken exp + verifyToken aud reddi + setSession maxAge — session-exchange kısa cookie güvenliği"
```

---

### Task 3: Mobil token yardımcıları (lib/mobile/token.ts)

**Files:**
- Create: `lib/mobile/token.ts`
- Test: `lib/mobile/token.test.ts`

**Interfaces:**
- Consumes: `lib/auth Session` (yalnız tip)
- Produces (Task 6+ kullanır):
  - `MOBILE_AUDIENCE = 'okulin-mobile'`, `MOBILE_ISSUER = 'okulin'`, `ACCESS_TTL_SEC = 900`
  - `interface MobileClaims extends Session { sid: string }`
  - `signMobileAccessToken(payload: Session, sid: string): Promise<string>`
  - `verifyMobileAccessToken(token: string): Promise<MobileClaims | null>`
  - `newRefreshToken(): string` — `mrt_` + 32 bayt base64url
  - `hashRefreshToken(t: string): string` — sha256 hex

- [ ] **Step 1: Başarısız testi yaz**

`lib/mobile/token.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';

process.env.MOBILE_JWT_SECRET = 'test-mobile-secret';
process.env.JWT_SECRET = 'test-web-secret-different';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => ({ get: () => null }),
}));

const { signToken } = await import('../auth');
const { signMobileAccessToken, verifyMobileAccessToken, newRefreshToken, hashRefreshToken, ACCESS_TTL_SEC } =
  await import('./token');

describe('mobil access token', () => {
  const payload = { role: 'student', id: 'stu1', name: 'Ali', org: 'testkurs', branch: 'main' };

  it('imzala→doğrula gidiş-dönüşü claim’leri korur (sid dahil)', async () => {
    const t = await signMobileAccessToken(payload, 'ms_abc');
    const c = await verifyMobileAccessToken(t);
    expect(c?.role).toBe('student');
    expect(c?.sid).toBe('ms_abc');
    expect(c?.org).toBe('testkurs');
    expect(c?.exp! - c?.iat!).toBe(ACCESS_TTL_SEC);
  });

  it('web cookie token’ını REDDEDER (farklı secret + aud yok)', async () => {
    const webToken = await signToken({ role: 'director', id: 'director' });
    expect(await verifyMobileAccessToken(webToken)).toBeNull();
  });

  it('doğru secret ama aud’suz token’ı REDDEDER', async () => {
    const t = await new SignJWT({ role: 'director', sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('test-mobile-secret'));
    expect(await verifyMobileAccessToken(t)).toBeNull();
  });

  it('sid claim’i olmayan token’ı REDDEDER', async () => {
    const t = await new SignJWT({ role: 'director' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('okulin-mobile')
      .setIssuer('okulin')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('test-mobile-secret'));
    expect(await verifyMobileAccessToken(t)).toBeNull();
  });

  it('bozuk token’a null döner', async () => {
    expect(await verifyMobileAccessToken('sacma')).toBeNull();
  });
});

describe('refresh token', () => {
  it('mrt_ önekli, yeterli entropili, her seferinde farklı', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a).toMatch(/^mrt_[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
  });

  it('hash deterministik 64 karakter hex', () => {
    const t = newRefreshToken();
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
    expect(hashRefreshToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/mobile/token.test.ts`
Beklenen: FAIL — `Cannot find module './token'`.

- [ ] **Step 3: Modülü yaz**

`lib/mobile/token.ts`:

```typescript
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'crypto';
import type { Session } from '@/lib/auth';

// Mobil token yardımcıları — DB/Prisma import ETMEZ (sessions.ts bağlar).
//
// Access token: web'den AYRI MOBILE_JWT_SECRET ile imzalanır → yüzey ayrımı
// kriptografik (web verifyToken mobil token'ı imza hatasıyla reddeder). Ayrıca
// aud='okulin-mobile' + iss='okulin' + alg='HS256' zorunlu (defense-in-depth:
// bir verifier gelecekte aud'u unutsa bile secret ayrımı korur).
// Refresh token: opak rastgele değer; DB'de yalnız sha256 hash'i durur.

export const MOBILE_AUDIENCE = 'okulin-mobile';
export const MOBILE_ISSUER = 'okulin';
export const ACCESS_TTL_SEC = 15 * 60; // spec §7: 10-15 dk

// Lazy secret çözümleme (auth.ts getSecret deseni). Prod'da MOBILE_JWT_SECRET
// zorunlu ve web JWT_SECRET'tan FARKLI olmalı (İnceleme: Codex #6 — iki secret
// eşitse kriptografik ayrım kalmaz → fail-closed). Dev'de secret yoksa fallback web
// secret'ından TÜRETİLİR ('-mobile-dev' eki) — asla düz JWT_SECRET değil ki dev'de
// bile mobil token web verifyToken'dan (aud reddine ek) imza olarak da geçemesin.
let _mobileSecret: Uint8Array | undefined;
function getMobileSecret(): Uint8Array {
  if (_mobileSecret) return _mobileSecret;
  const s = process.env.MOBILE_JWT_SECRET;
  const web = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!s) throw new Error('MOBILE_JWT_SECRET tanımlı değil — production ortamında zorunludur.');
    if (s === web) throw new Error('MOBILE_JWT_SECRET, JWT_SECRET ile aynı olamaz — token yüzey ayrımı için farklı olmalı.');
  }
  if (!s) console.warn('[mobile] UYARI: MOBILE_JWT_SECRET yok — türetilmiş dev secret kullanılıyor.');
  _mobileSecret = new TextEncoder().encode(s || (web ? `${web}-mobile-dev` : 'dev-only-mobile-secret-change-me'));
  return _mobileSecret;
}

// sid = MobileSession id — logout/devices/iptal kontrolü oturum satırını bundan bulur.
export interface MobileClaims extends Session {
  sid: string;
}

export async function signMobileAccessToken(payload: Session, sid: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(MOBILE_AUDIENCE)
    .setIssuer(MOBILE_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ACCESS_TTL_SEC)
    .sign(getMobileSecret());
}

export async function verifyMobileAccessToken(token: string): Promise<MobileClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getMobileSecret(), {
      audience: MOBILE_AUDIENCE,
      issuer: MOBILE_ISSUER,
      algorithms: ['HS256'],
    });
    if (typeof (payload as { sid?: unknown }).sid !== 'string') return null;
    return payload as MobileClaims;
  } catch {
    return null;
  }
}

// 32 bayt (256 bit) kriptografik rastgelelik — tahmin edilemez, brute force pratik imkansız.
export function newRefreshToken(): string {
  return 'mrt_' + randomBytes(32).toString('base64url');
}

// DB'de düz token durmaz: sızan DB dump'ı oturum çalmaya yetmez.
export function hashRefreshToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Çalıştır: `npx vitest run lib/mobile/token.test.ts`
Beklenen: 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mobile/token.ts lib/mobile/token.test.ts
git commit -m "feat(mobil): access/refresh token yardımcıları — ayrı MOBILE_JWT_SECRET + aud/iss/alg kilidi + sha256 refresh hash"
```

---

### Task 4: Refresh durum makinesi (lib/mobile/policy.ts)

**Files:**
- Create: `lib/mobile/policy.ts`
- Test: `lib/mobile/policy.test.ts`

**Interfaces:**
- Produces (Task 6 kullanır):
  - `REFRESH_TTL_DAYS = 60`, `ROTATE_GRACE_SEC = 30`
  - `interface RefreshSessionState { refreshHash; prevRefreshHash; rotatedAt; expiresAt; revokedAt }`
  - `decideRefresh(s, presentedHash, now): { action: 'rotate' } | { action: 'reject'; reason } | { action: 'revoke'; reason: 'reuse' }`
  - `nextExpiry(now: Date): Date`

**ADR notu (İnceleme: Codex #1, kabul edilen sınır):** reuse detection yalnız `prevRefreshHash` (son bir rotasyon) ile sınırlıdır. 2+ rotasyon eskimiş bir token "unknown" olur ve **reddedilir** (revoke değil) — çünkü o token zaten geçersizdir ve meşru istemci ondan çoktan ilerlemiştir (access TTL 15 dk → token sık rotate olur). Full token-family tablosu YAGNI; grace + prevHash pratikte çalıntı-token'ı meşru istemci hâlâ aktifken yakalamaya yeter.

- [ ] **Step 1: Başarısız testi yaz**

`lib/mobile/policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { decideRefresh, nextExpiry, REFRESH_TTL_DAYS, ROTATE_GRACE_SEC } from './policy';

const now = new Date('2026-07-16T12:00:00Z');
const base = {
  refreshHash: 'guncel',
  prevRefreshHash: 'eski' as string | null,
  rotatedAt: new Date(now.getTime() - 120_000) as Date | null, // 2 dk önce rotate edildi
  expiresAt: new Date(now.getTime() + 86400_000),
  revokedAt: null as Date | null,
};

describe('decideRefresh', () => {
  it('güncel hash → rotate', () => {
    expect(decideRefresh(base, 'guncel', now)).toEqual({ action: 'rotate' });
  });

  it('revoke edilmiş oturum → reject (güncel hash bile olsa)', () => {
    expect(decideRefresh({ ...base, revokedAt: new Date() }, 'guncel', now))
      .toEqual({ action: 'reject', reason: 'revoked' });
  });

  it('süresi dolmuş oturum → reject', () => {
    expect(decideRefresh({ ...base, expiresAt: new Date(now.getTime() - 1000) }, 'guncel', now))
      .toEqual({ action: 'reject', reason: 'expired' });
  });

  it('grace İÇİNDE eski hash → rotate (kaybolan yanıtın meşru tekrarı)', () => {
    const s = { ...base, rotatedAt: new Date(now.getTime() - (ROTATE_GRACE_SEC - 5) * 1000) };
    expect(decideRefresh(s, 'eski', now)).toEqual({ action: 'rotate' });
  });

  it('grace DIŞI eski hash → revoke (REUSE — çalıntı şüphesi)', () => {
    expect(decideRefresh(base, 'eski', now)).toEqual({ action: 'revoke', reason: 'reuse' });
  });

  it('tanınmayan hash → reject', () => {
    expect(decideRefresh(base, 'yabanci', now)).toEqual({ action: 'reject', reason: 'unknown' });
  });

  it('prev yokken eski hash sunulursa → reject (ilk oturumda reuse yolu yok)', () => {
    expect(decideRefresh({ ...base, prevRefreshHash: null }, 'eski', now))
      .toEqual({ action: 'reject', reason: 'unknown' });
  });
});

describe('nextExpiry', () => {
  it('now + 60 gün', () => {
    expect(nextExpiry(now).getTime()).toBe(now.getTime() + REFRESH_TTL_DAYS * 86400_000);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/mobile/policy.test.ts`
Beklenen: FAIL — `Cannot find module './policy'`.

- [ ] **Step 3: Modülü yaz**

`lib/mobile/policy.ts`:

```typescript
// Refresh token rotation POLİTİKASI — saf fonksiyonlar, DB/IO yok (vitest dostu).
//
// Durum makinesi (spec §7: rotation + reuse detection):
//   güncel hash            → rotate  (yeni çift üret, eskiyi prev'e kaydır)
//   prev hash, grace içi   → rotate  (rotation yanıtı istemciye ulaşamamış olabilir —
//                                     ağ hatasında meşru istemci eski token'la döner)
//   prev hash, grace dışı  → revoke  (REUSE: token çalınmış olabilir → oturum kapanır,
//                                     kullanıcı yeniden login olur)
//   tanınmayan / revoked / expired → reject

export const REFRESH_TTL_DAYS = 60; // kayan pencere: her rotation uzatır (aktif cihaz düşmez)
export const ROTATE_GRACE_SEC = 30;

export interface RefreshSessionState {
  refreshHash: string;
  prevRefreshHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type RefreshDecision =
  | { action: 'rotate' }
  | { action: 'reject'; reason: 'revoked' | 'expired' | 'unknown' }
  | { action: 'revoke'; reason: 'reuse' };

export function decideRefresh(s: RefreshSessionState, presentedHash: string, now: Date): RefreshDecision {
  if (s.revokedAt) return { action: 'reject', reason: 'revoked' };
  if (s.expiresAt.getTime() <= now.getTime()) return { action: 'reject', reason: 'expired' };
  if (presentedHash === s.refreshHash) return { action: 'rotate' };
  if (s.prevRefreshHash && presentedHash === s.prevRefreshHash) {
    const rotatedMs = s.rotatedAt?.getTime() ?? 0;
    if (now.getTime() - rotatedMs <= ROTATE_GRACE_SEC * 1000) return { action: 'rotate' };
    return { action: 'revoke', reason: 'reuse' };
  }
  return { action: 'reject', reason: 'unknown' };
}

export function nextExpiry(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TTL_DAYS * 86400_000);
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Çalıştır: `npx vitest run lib/mobile/policy.test.ts`
Beklenen: 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mobile/policy.ts lib/mobile/policy.test.ts
git commit -m "feat(mobil): refresh rotation durum makinesi — grace'li reuse detection (saf, testli)"
```

---

### Task 5: Login servisi çıkarımı (lib/login.ts) + OTP askıya alma

Web `/api/auth` login action'ının çekirdeği (kimlik doğrulama + rol kapısı + payload üretimi) `lib/login.ts`'e taşınır; web route aynı çekirdeği çağırır. Aynı task'ta **normal rollerin OTP/cihaz doğrulaması askıya alınır** (Mustafa 2026-07-16) — superadmin 2FA korunur. `getOtpIdentity` de (otp/verify route'undaki yerel kopya) lib/login'e taşınır (superadmin 2FA + change_password yolları kullanmaya devam eder).

**Davranış farkları (bilinçli, belgeli):**
1. Normal roller (öğrenci/veli/öğretmen/müdür/muhasebeci/rehber/org_admin) artık `needsOtp` ASLA almaz — şifre doğru → direkt cookie.
2. Superadmin login akışı DEĞİŞMEZ (maybeOtp korunur).
3. director/org_admin login yanıt gövdesine `id` alanı eklenir (payload zaten içeriyordu; client yalnız role/name/mustChangePassword okur, zararsız).

**Files:**
- Create: `lib/login.ts`
- Modify: `app/api/auth/route.ts` (login action + importlar; satır 21-67 tip/yardımcılar silinir, 100-297 login bloğu yeniden yazılır)
- Modify: `app/api/otp/verify/route.ts:19-53` (yerel getOtpIdentity silinir, import edilir)

**Interfaces:**
- Produces (Task 8 kullanır):
  - `verifyLogin(username: string, password: string, selectedRole?: RoleCategory): Promise<LoginResult>`
  - `type LoginResult = { ok: true; role: string; payload: Session; phone: string | null } | { ok: false; status: number; error: string; correctRole?: RoleCategory }`
  - `roleCategory(role: string): RoleCategory` ('student'|'parent'|'teacher'|'management')
  - `maskPhone(phone): string`
  - `getOtpIdentity(username: string, roleCategory: string): Promise<{ phone: string | null; pushRole: string; pushId: string } | null>`

- [ ] **Step 1: lib/login.ts'i yaz**

```typescript
import bcrypt from 'bcryptjs';
import { tdb } from './sqldb';
import { currentOrg } from './tenant';
import { normalizeTurkishMobile } from './phone';
import type { Session } from './auth';
import type { ParentChild } from './parents';

// Giriş kimlik doğrulama SERVİSİ — web (/api/auth, cookie) ve mobil
// (/api/mobile/v1/auth/login, token) uçlarının ORTAK çekirdeği.
//
// Kapsam: rol kapısı (yanlış giriş kartı yönlendirmesi) + şifre doğrulama +
// oturum payload üretimi + veli modül geçidi.
// KAPSAM DIŞI (çağıran halleder): rate limit, OTP/cihaz tanıma, superadmin
// (yalnız web gizli sayfası — mobilde HİÇ üretilmez), cookie/token yazımı.

export type RoleCategory = 'student' | 'parent' | 'teacher' | 'management';

export const CATEGORY_LABEL: Record<RoleCategory, string> = {
  student: 'Öğrenci', parent: 'Veli', teacher: 'Öğretmen', management: 'Yönetim',
};

export function roleCategory(role: string): RoleCategory {
  if (role === 'student') return 'student';
  if (role === 'parent') return 'parent';
  if (role === 'teacher') return 'teacher';
  return 'management'; // director, assistant_director, accountant, counselor, org_admin
}

// Telefon numarasının ortasını maskele: "0532***67" (superadmin OTP ekranı için).
export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 7) return '***';
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

export type LoginOk = { ok: true; role: string; payload: Session; phone: string | null };
export type LoginFail = { ok: false; status: number; error: string; correctRole?: RoleCategory };
export type LoginResult = LoginOk | LoginFail;

// Rol tablolarından dönen kayıtların ortak görünümü (model başına alan farkları opsiyonel).
interface RoleRow {
  legacyId?: string;
  name?: string | null;
  phone?: string | null;
  passwordHash: string;
  mustChangePassword?: boolean;
  branches?: string[];
  allowedGroups?: string[];
  class?: { legacyId: string } | null;
  group?: string;
  children?: unknown;
}

// Eski (Redis) kayıt şekli — payload üretimi bu ara şekle dayanır.
interface LegacyRec {
  id: string;
  name: string;
  phone: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
  branches?: string[];
  allowedGroups?: string[];
  cls?: string;
  group?: string;
  children?: ParentChild[];
  // eski kayıt fallback alanları (teacher)
  branch?: string;
  extraBranches?: string[];
}

// SQL rol satırını LegacyRec'e çevirir. id = legacyId (parent: phone);
// student.cls = class.legacyId (cuid DEĞİL).
function sqlRecToLegacy(role: string, r: (RoleRow & { phone?: string | null }) | null): LegacyRec | null {
  if (!r) return null;
  const base = { name: r.name || '', phone: r.phone || null, passwordHash: r.passwordHash, mustChangePassword: !!r.mustChangePassword };
  if (role === 'teacher') return { ...base, id: r.legacyId || '', branches: r.branches || [], allowedGroups: r.allowedGroups || [] };
  if (role === 'student') return { ...base, id: r.legacyId || '', cls: r.class?.legacyId || '', group: r.group };
  if (role === 'parent') return { ...base, id: r.phone || '', name: r.name || '', children: ((r.children as ParentChild[] | null) || []) };
  return { ...base, id: r.legacyId || '' }; // accountant | counselor | assistant_director
}

export async function verifyLogin(username: string, password: string, selectedRole?: RoleCategory): Promise<LoginResult> {
  // Katı rol seçimi + akıllı yönlendirme: bilgiler doğru ama seçilen kart hesabın
  // gerçek rol kategorisiyle uyuşmuyorsa doğru girişe yönlendir.
  const gateMismatch = (actualRole: string): LoginFail | null => {
    if (!selectedRole) return null; // eski client — kapı devre dışı (geri uyumlu)
    const actualCat = roleCategory(actualRole);
    if (actualCat === selectedRole) return null;
    return {
      ok: false, status: 403,
      error: `Bu bilgiler ${CATEGORY_LABEL[actualCat]} hesabına ait. Lütfen "${CATEGORY_LABEL[actualCat]}" girişini kullanın.`,
      correctRole: actualCat,
    };
  };

  // Kayıttan oturum payload'ı üret (rol bazlı alanlar).
  const finish = async (role: string, rec: LegacyRec): Promise<LoginResult> => {
    const gate = gateMismatch(role);
    if (gate) return gate;

    // Modül geçidi (veli): veli paneli çok sayıda paylaşılan uca yayılır →
    // kaldıraç login'de: kurum veli modülünü kapattıysa veli hiç giriş yapamaz.
    if (role === 'parent') {
      const { getOrgConfig } = await import('./config');
      const mods = await getOrgConfig('modules');
      if (mods.veli === false) return { ok: false, status: 403, error: 'Veli girişi bu kurumda kapalı' };
    }

    let payload: Session;
    if (role === 'teacher') {
      const branches = Array.isArray(rec.branches) ? rec.branches
        : [rec.branch, ...(rec.extraBranches || [])].filter((b): b is string => Boolean(b)); // eski kayıt fallback
      payload = { role: 'teacher', id: rec.id, name: rec.name, branches, allowedGroups: rec.allowedGroups || [], mustChangePassword: !!rec.mustChangePassword };
    } else if (role === 'student') {
      payload = { role: 'student', id: rec.id, name: rec.name, cls: rec.cls, group: rec.group, mustChangePassword: !!rec.mustChangePassword };
    } else if (role === 'parent') {
      const children = Array.isArray(rec.children) ? rec.children : [];
      // Veli adı: kayıttaki gerçek ad. Header her zaman dolu → ad yoksa türetme;
      // parentName SADECE gerçek ad (boşsa panel karşılaması gösterilmez).
      const realName = rec.name || '';
      const headerName = realName || (children.length === 1 ? `${children[0].name} (Veli)` : 'Veli');
      payload = { role: 'parent', id: rec.id, name: headerName, parentName: realName, children, mustChangePassword: !!rec.mustChangePassword };
    } else if (role === 'assistant_director') {
      // Müdür yardımcısı: oturumda MÜDÜRLE BİREBİR aynı → role='director'. asst:true
      // yalnız UI etiketi + audit ayrımı; id = kendi legacyId'si.
      payload = { role: 'director', asst: true, id: rec.id, name: rec.name, mustChangePassword: !!rec.mustChangePassword };
    } else { // accountant | counselor
      payload = { role, id: rec.id, name: rec.name, mustChangePassword: !!rec.mustChangePassword };
    }
    return { ok: true, role, payload, phone: rec.phone || null };
  };

  // Org_admin (kurum-geneli, şube-bağımsız).
  const orgAdmin = await tdb().orgAdmin.findFirst({ where: { orgSlug: currentOrg(), username } });
  if (orgAdmin && orgAdmin.username === username) {
    const ok = await bcrypt.compare(password, orgAdmin.passwordHash);
    if (ok) {
      const gate = gateMismatch('org_admin');
      if (gate) return gate;
      return { ok: true, role: 'org_admin', payload: { role: 'org_admin', id: 'org_admin', name: orgAdmin.name || undefined }, phone: null };
    }
  }

  // Director.
  const director = await tdb().director.findFirst({ where: { username } });
  if (director && director.username === username) {
    const ok = await bcrypt.compare(password, director.passwordHash);
    if (ok) {
      const gate = gateMismatch('director');
      if (gate) return gate;
      return {
        ok: true, role: 'director',
        payload: { role: 'director', id: 'director', name: director.name },
        phone: (director as { phone?: string | null }).phone || null,
      };
    }
  }

  // Rol tabloları: assistant_director→accountant→counselor→teacher→student, sonra veli.
  const tryRole = async (role: string, sqlRec: RoleRow | null): Promise<LoginResult | null> => {
    const rec = sqlRecToLegacy(role, sqlRec);
    if (!rec) return null;
    const ok = await bcrypt.compare(password, rec.passwordHash);
    if (!ok) return null;
    return finish(role, rec);
  };
  let r: LoginResult | null;
  r = await tryRole('assistant_director', await tdb().assistantDirector.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('accountant', await tdb().accountant.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('counselor', await tdb().counselor.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('teacher', await tdb().teacher.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('student', await tdb().student.findFirst({ where: { username }, include: { class: { select: { legacyId: true } } } })); if (r) return r;
  // Veli: kullanıcı adı = telefon (ham veya kanonik); kayıtlı phone kanonik.
  const normP = normalizeTurkishMobile(username);
  const phones = [username, normP].filter((p): p is string => Boolean(p));
  const parent = phones.length ? await tdb().parent.findFirst({ where: { phone: { in: phones } } }) : null;
  r = await tryRole('parent', parent); if (r) return r;

  return { ok: false, status: 401, error: 'Kullanıcı adı veya şifre hatalı' };
}

// ── OTP kimliği (yalnız superadmin 2FA + change_password yollarında kullanılır) ──
// Kullanıcı adı + rol kategorisinden hesabın telefonu + push kimliğini bul.
// pushRole/pushId, push aboneliğinin anahtarladığı (session.role, session.id) ile
// BİREBİR eşleşmeli: teacher/student/accountant/counselor → legacyId,
// parent → telefon, director/assistant_director → 'director'.
// (Eski konumu: app/api/otp/verify/route.ts. İnceleme Codex #5: assistant_director
//  telefonluysa 'management' dalında bulunamıyordu → burada açıkça eklendi.)
export interface OtpIdentity { phone: string | null; pushRole: string; pushId: string }

export async function getOtpIdentity(username: string, roleCategory: string): Promise<OtpIdentity | null> {
  if (roleCategory === 'superadmin') {
    const sa = await tdb().superAdmin.findFirst({ where: { username } });
    if (!sa) return null;
    return { phone: sa.phone || null, pushRole: 'superadmin', pushId: 'superadmin' };
  }
  if (roleCategory === 'management') {
    const dir = await tdb().director.findFirst({ where: { username } });
    // NOT: Director modelinde phone kolonu yok → telefonsuz → OTP'ye hiç girmez (push moot).
    if (dir) return { phone: (dir as typeof dir & { phone?: string | null }).phone || null, pushRole: 'director', pushId: 'director' };
    const asst = await tdb().assistantDirector.findFirst({ where: { username } });
    // Müdür yardımcısı push kimliği 'director' pushId'siyle DEĞİL kendi legacyId'siyle
    // eşleşmez — oturumda role='director' ama push aboneliği kendi id'sine (auth payload id=legacyId).
    if (asst) return { phone: asst.phone || null, pushRole: 'director', pushId: asst.legacyId };
    const acc = await tdb().accountant.findFirst({ where: { username } });
    if (acc) return { phone: acc.phone || null, pushRole: 'accountant', pushId: acc.legacyId };
    const cou = await tdb().counselor.findFirst({ where: { username } });
    if (cou) return { phone: cou.phone || null, pushRole: 'counselor', pushId: cou.legacyId };
    return null;
  }
  if (roleCategory === 'parent') {
    const normPhone = normalizeTurkishMobile(username);
    const p = await tdb().parent.findFirst({ where: { phone: normPhone || username } });
    if (!p) return null;
    const ph = normPhone || username;
    return { phone: ph, pushRole: 'parent', pushId: ph };
  }
  const rec = roleCategory === 'teacher'
    ? await tdb().teacher.findFirst({ where: { username } })
    : await tdb().student.findFirst({ where: { username } });
  if (!rec) return null;
  return { phone: rec.phone || null, pushRole: roleCategory, pushId: rec.legacyId };
}
```

- [ ] **Step 2: app/api/auth/route.ts'i çekirdeğe bağla + OTP askıya al**

(a) Import satırlarını güncelle: `normalizeTurkishMobile` ve `ParentChild` importlarını SİL (artık lib/login'de), şunu EKLE:

```typescript
import { verifyLogin, roleCategory, maskPhone, type RoleCategory } from '@/lib/login';
```

(b) Dosyadan SİL: `RoleRow` interface, `LegacyRec` interface, `sqlRecToLegacy`, `maskPhone` (satır 21-67 arası — üstteki withAuth istisna yorumu KALIR).

(c) `if (action === 'login') { ... }` bloğunun TAMAMINI şu hale getir. **Normal rollerde OTP askıya alındı** (Mustafa 2026-07-16); superadmin bloğu maybeOtp'yi KORUR:

```typescript
  if (action === 'login') {
    const { username, password } = data;
    // Rate limit kontrolü — IP + username birleşik key
    const ip = getClientIp(req);
    const rlKey = `${ip}:${(username || 'anon').toLowerCase()}`;
    const { success, reset } = await safeLimit(loginRatelimit, rlKey);
    if (!success) {
      return NextResponse.json(
        { error: `Çok fazla başarısız deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
        { status: 429 }
      );
    }

    const selectedRole = data.role;

    // ── superadmin 2FA cihaz tanıma (KORUNUR — yalnız superadmin bloğu kullanır) ──
    // NOT (2026-07-16): normal rollerin OTP/cihaz doğrulaması ASKIYA ALINDI (Mustafa).
    // Aşağıdaki maybeOtp/isKnownDevice yalnız superadmin login'inde çağrılır; normal
    // roller verifyLogin sonrası doğrudan cookie alır. Kod korunur (geri getirilebilir).
    const deviceToken = req.cookies.get('device_token')?.value;
    async function isKnownDevice(cat: string): Promise<boolean> {
      if (!deviceToken) return false;
      const found = await redis.get(`device:${cat}:${username}:${deviceToken}`);
      return !!found;
    }
    async function maybeOtp(cat: string, phone: string | null): Promise<NextResponse | null> {
      const known = await isKnownDevice(cat);
      if (known) return null;
      if (!phone) return null;
      try {
        await sendOtp(phone);
      } catch {
        return null;
      }
      return NextResponse.json({ needsOtp: true, phone: maskPhone(phone) }, { status: 200 });
    }

    // Superadmin (global, kurum-bağımsız) — WEB'E ÖZGÜ, mobilde HİÇ üretilmez.
    // GÜVENLİK: yalnız gizli süper-admin sayfasından (role:'superadmin') denenebilir.
    if (selectedRole === 'superadmin') {
      // GÜVENLİK: süper-admin YALNIZ apex domain'den (okulin.com) girilebilir.
      const host = headers().get('host');
      if (orgFromHost(host)) {
        return NextResponse.json({ error: 'Süper yönetici girişi bu adresten yapılamaz.' }, { status: 403 });
      }
      // IP kısıtı — SUPERADMIN_ALLOWED_IPS tanımlıysa yalnız listedeki IP'ler girebilir.
      if (!isSuperadminIpAllowed(getClientIp(req))) {
        return NextResponse.json({ error: 'Süper yönetici girişi bu ağdan yapılamaz.' }, { status: 403 });
      }
      const superadmin = await tdb().superAdmin.findFirst({ where: { username } });
      if (superadmin && superadmin.username === username) {
        const ok = await bcrypt.compare(password, superadmin.passwordHash);
        if (ok) {
          const saName = (superadmin as { name?: string }).name || 'Süper Admin';
          // 2FA: telefon kayıtlıysa + cihaz tanınmıyorsa OTP iste (KORUNUR).
          const otpRes = await maybeOtp('superadmin', superadmin.phone || null);
          if (otpRes) return otpRes;
          const res = NextResponse.json({ role: 'superadmin', name: saName });
          await setSession(res, { role: 'superadmin', id: 'superadmin', name: saName });
          return res;
        }
      }
      return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı.' }, { status: 401 });
    }

    // Ortak çekirdek: org_admin/director/rol tabloları/veli zinciri + rol kapısı +
    // veli modül geçidi (lib/login.ts — mobil login de aynı çekirdeği kullanır).
    // superadmin bloğu yukarıda return etti; kalan selectedRole RoleCategory'dir (cast).
    const result = await verifyLogin(username, password, selectedRole as RoleCategory | undefined);
    if (!result.ok) {
      return NextResponse.json(
        result.correctRole ? { error: result.error, correctRole: result.correctRole } : { error: result.error },
        { status: result.status }
      );
    }

    // OTP ASKIYA ALINDI — normal roller şifre doğruysa doğrudan giriş yapar.
    const res = NextResponse.json(result.payload);
    await setSession(res, result.payload);
    return res;
  }
```

(d) SİLİNENLERİ doğrula: login bloğu içindeki eski `CATEGORY_LABEL`, `roleCategory`, `gateMismatch`, `makeLoginResponse`, `tryRole`, org_admin/director inline blokları ve rol tablosu zinciri artık YOK. `bcrypt`, `headers`, `orgFromHost`, `isSuperadminIpAllowed`, `sendOtp`, `redis` importları superadmin bloğu için KALIR (`redis` = `tenantRedis()` üst satırdan).

- [ ] **Step 3: app/api/otp/verify/route.ts'i bağla**

Yerel `OtpIdentity` interface + `getOtpIdentity` fonksiyonunu (satır 19-53) SİL; import ekle:

```typescript
import { getOtpIdentity } from '@/lib/login';
```

Artık kullanılmayan importları temizle (`normalizeTurkishMobile` — `npx tsc --noEmit` söyler; `tdb` hâlâ kullanılıyorsa kalır).

- [ ] **Step 4: Tip + test + build**

Çalıştır: `npx tsc --noEmit && npm run test && npm run build`
Beklenen: 0 tip hatası; tüm birim testler PASS; build başarılı.

- [ ] **Step 5: Commit**

```bash
git add lib/login.ts app/api/auth/route.ts app/api/otp/verify/route.ts
git commit -m "refactor(auth): login çekirdeği lib/login.ts'e + normal rollerde OTP askıya (superadmin 2FA korunur)"
```

---

### Task 6: Sözleşmeler + oturum DB katmanı + withMobileAuth

**Files:**
- Create: `lib/mobile/contracts.ts`
- Create: `lib/mobile/sessions.ts`
- Create: `lib/mobile/auth.ts`

**Interfaces:**
- Consumes: Task 3 token yardımcıları, Task 4 policy, `lib/sqldb tdb/withScope`, `lib/id newId`, `lib/tenant currentOrg/currentBranch`, `lib/errors errorResponse`
- Produces (Task 7-10 kullanır):
  - `issueMobileSession(payload: Session, device: DeviceInfo): Promise<MobileTokenPair>` — `{ accessToken, refreshToken, expiresIn, sessionId }`
  - `refreshMobileSession(presentedToken: string): Promise<RefreshOutcome>`
  - `loadActiveSession(sid: string): Promise<{ revokedAt: Date | null; expiresAt: Date } | null>` — iptal kontrolü için
  - `revokeMobileSession(id, role, userId, reason): Promise<boolean>` / `revokeMobileSessionsFor(role, userId, reason): Promise<number>`
  - `listMobileDevices(role, userId, currentSid): Promise<DeviceView[]>`
  - `withMobileAuth(handler)` — Bearer + tenant kilidi + iptal kontrolü
  - Zod şemaları: `ResolveOrgSchema`, `MobileLoginSchema`, `MobileRefreshSchema`, `MobileDeviceRevokeSchema`, `MobileConfigUpdateSchema`

- [ ] **Step 1: contracts.ts'i yaz**

`lib/mobile/contracts.ts`:

```typescript
import { z, zName, zPassword } from '@/lib/validate';

// /api/mobile/v1 İSTEK sözleşmeleri — tek kaynak. Mobil istemcinin tipli API
// katmanı (Plan 3) bu şemalardan üretilecek; route'lar parseBody ile doğrular.
// superadmin BİLEREK yok (mobilde üretilmez).

export const MobileRoleEnum = z.enum(['student', 'parent', 'teacher', 'management']);

export const ResolveOrgSchema = z.object({ code: z.string().min(1).max(20) });

export const MobileLoginSchema = z.object({
  username: zName,
  password: zPassword,
  role: MobileRoleEnum.optional(),
  installationId: z.string().max(100).optional(),
  deviceName: z.string().max(120).optional(),
  platform: z.enum(['android', 'ios']).optional(),
});

export const MobileRefreshSchema = z.object({ refreshToken: z.string().min(20).max(300) });

export const MobileDeviceRevokeSchema = z
  .object({ sessionId: z.string().max(100).optional(), all: z.boolean().optional() })
  .refine((d) => d.sessionId || d.all, 'sessionId veya all gerekli');

export const MobileConfigUpdateSchema = z.object({
  minSupportedVersion: z.string().max(20).optional(),
  recommendedVersion: z.string().max(20).optional(),
  maintenance: z.boolean().optional(),
  maintenanceMessage: z.string().max(500).nullable().optional(),
  flags: z.record(z.boolean()).optional(),
});
```

- [ ] **Step 2: sessions.ts'i yaz**

`lib/mobile/sessions.ts`:

```typescript
import { tdb } from '@/lib/sqldb';
import { currentOrg } from '@/lib/tenant';
import { newId } from '@/lib/id';
import type { Session } from '@/lib/auth';
import { signMobileAccessToken, newRefreshToken, hashRefreshToken, ACCESS_TTL_SEC } from './token';
import { decideRefresh, nextExpiry } from './policy';

// Cihaz oturumu DB katmanı. MobileSession sqldb SKIP'te (org düzeyi kavram, şube-bazlı
// DEĞİL — org_admin '__hq__' ve şube-değiştiren kullanıcı otomatik branch enjeksiyonuyla
// düşerdi). Bu yüzden orgSlug HER sorgu/create'te ELLE yazılır (Plan 1 dersi); branch
// sorgularda FİLTRELENMEZ (org düzeyi). Şube kilidi withMobileAuth'ta claims ile yapılır.
// Çapraz-kurum: orgSlug=currentOrg() koşulu → başka kurum host'una sunulan token bulunamaz.

export interface DeviceInfo {
  installationId?: string;
  deviceName?: string;
  platform?: string;
  ip?: string;
}

export interface MobileTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token saniyesi
  sessionId: string;
}

// Yeni cihaz oturumu aç + ilk token çiftini üret (login sonrası).
// payload org/branch İÇERMELİ (çağıran currentOrg/currentBranch ile doldurur; org_admin
// için branch='__hq__') — access token tenant kilidi + DB satırı bu claim'lere dayanır.
export async function issueMobileSession(payload: Session, device: DeviceInfo): Promise<MobileTokenPair> {
  const sid = newId('ms_');
  const refreshToken = newRefreshToken();
  // SKIP tablosu → orgSlug/branch ELLE (tdb $extends enjekte ETMEZ).
  await tdb().mobileSession.create({
    data: {
      id: sid,
      orgSlug: String(payload.org ?? currentOrg()),
      branch: String(payload.branch ?? 'main'),
      role: payload.role,
      userId: String(payload.id ?? ''),
      payload: payload as object,
      installationId: device.installationId,
      deviceName: device.deviceName,
      platform: device.platform,
      createdIp: device.ip,
      refreshHash: hashRefreshToken(refreshToken),
      expiresAt: nextExpiry(new Date()),
    },
  });
  const accessToken = await signMobileAccessToken(payload, sid);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC, sessionId: sid };
}

// withMobileAuth iptal kontrolü + session-open aktiflik yineleme: sid aktif mi?
// orgSlug=currentOrg() → farklı kurumun sid'i bu host'ta BULUNAMAZ (null → reddet).
export async function loadActiveSession(sid: string): Promise<{ revokedAt: Date | null; expiresAt: Date } | null> {
  return tdb().mobileSession.findFirst({
    where: { id: sid, orgSlug: currentOrg() },
    select: { revokedAt: true, expiresAt: true },
  });
}

export type RefreshOutcome =
  | { ok: true; pair: MobileTokenPair; payload: Session }
  | { ok: false; status: number; error: string };

// Rotation + reuse detection (karar: lib/mobile/policy.ts).
export async function refreshMobileSession(presentedToken: string): Promise<RefreshOutcome> {
  const org = currentOrg();
  const h = hashRefreshToken(presentedToken);
  const s = await tdb().mobileSession.findFirst({
    where: { orgSlug: org, OR: [{ refreshHash: h }, { prevRefreshHash: h }] },
  });
  if (!s) return { ok: false, status: 401, error: 'Oturum bulunamadı. Yeniden giriş yapın.' };

  const decision = decideRefresh(s, h, new Date());
  if (decision.action === 'revoke') {
    await tdb().mobileSession.updateMany({
      where: { id: s.id, orgSlug: org },
      data: { revokedAt: new Date(), revokedReason: decision.reason },
    });
    return { ok: false, status: 401, error: 'Oturum güvenlik nedeniyle kapatıldı. Yeniden giriş yapın.' };
  }
  if (decision.action === 'reject') {
    return { ok: false, status: 401, error: 'Oturum geçersiz. Yeniden giriş yapın.' };
  }

  // rotate — CAS (optimistic kilit) + doğru prev yazımı (İnceleme Codex #1):
  // Rotasyon DAİMA "mevcut güncel (s.refreshHash) → yeni". CAS koşulu her iki yolda
  // AYNI: refreshHash HÂLÂ s.refreshHash mi (kimse önce rotate etmemiş mi). prev = önceki
  // güncel = s.refreshHash — sunulan h DEĞİL (h yazılsaydı grace yolunda eski token her
  // kullanımda grace'i yeniden açıp süresiz yaşardı + iki eşzamanlı grace ikisi de geçerdi).
  // Bu CAS eşzamanlı/art-arda grace'te tek kazanan bırakır (kaybeden count=0 → 401).
  const now = new Date();
  const refreshToken = newRefreshToken();
  const r = await tdb().mobileSession.updateMany({
    where: { id: s.id, orgSlug: org, refreshHash: s.refreshHash },
    data: {
      refreshHash: hashRefreshToken(refreshToken),
      prevRefreshHash: s.refreshHash, // önceki güncel — sunulan h değil
      rotatedAt: now,
      lastUsedAt: now,
      expiresAt: nextExpiry(now), // kayan pencere: aktif cihaz düşmez
    },
  });
  if (r.count === 0) return { ok: false, status: 401, error: 'Oturum geçersiz. Yeniden giriş yapın.' };

  const payload = s.payload as unknown as Session;
  const accessToken = await signMobileAccessToken(payload, s.id);
  return { ok: true, pair: { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC, sessionId: s.id }, payload };
}

// Tek oturumu iptal (kendi cihazın: logout / cihaz listesinden iptal).
// role+userId koşulu: kullanıcı YALNIZ kendi oturumunu kapatabilir (IDOR koruması).
export async function revokeMobileSession(id: string, role: string, userId: string, reason: string): Promise<boolean> {
  const r = await tdb().mobileSession.updateMany({
    where: { id, orgSlug: currentOrg(), role, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count > 0;
}

// Kullanıcının TÜM oturumlarını iptal (tüm cihazlardan çıkış / şifre değişimi).
export async function revokeMobileSessionsFor(role: string, userId: string, reason: string): Promise<number> {
  const r = await tdb().mobileSession.updateMany({
    where: { orgSlug: currentOrg(), role, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}

export interface DeviceView {
  id: string;
  deviceName: string | null;
  platform: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}

export async function listMobileDevices(role: string, userId: string, currentSid: string): Promise<DeviceView[]> {
  const rows = await tdb().mobileSession.findMany({
    where: { orgSlug: currentOrg(), role, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    deviceName: r.deviceName,
    platform: r.platform,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    current: r.id === currentSid,
  }));
}
```

- [ ] **Step 3: auth.ts (withMobileAuth) yaz**

`lib/mobile/auth.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { orgFromHost } from '@/lib/org';
import { errorResponse } from '@/lib/errors';
import type { RouteContext } from '@/lib/auth';
import { verifyMobileAccessToken, type MobileClaims } from './token';
import { loadActiveSession } from './sessions';

// withAuth'un MOBİL karşılığı — cookie yerine Authorization: Bearer <access token>.
// Guard geçerse token claim'leri (Session + sid) 3. argüman olarak enjekte edilir.
//
// Üç katman:
//   1) İmza + aud/iss/alg (verifyMobileAccessToken) — geçersiz token 401.
//   2) Fail-closed tenant (İnceleme Codex #7): host kurum host'u OLMALI (orgFromHost
//      null → apex/bilinmeyen host → DEFAULT_ORG'a düşme → RET). Token org/branch,
//      isteğin tenant'ıyla eşleşmeli — org_admin '__hq__' branch'i muaf (web paritesi).
//   3) İptal (İnceleme Codex #2): sid'in MobileSession'ı hâlâ aktif mi (revokedAt null,
//      expiresAt gelecekte). Logout/şifre değişimi/cihaz iptali access token'ı ANINDA
//      geçersizler — imza geçerli olsa bile.
const unauth = () => NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

export type MobileHandler = (req: NextRequest, ctx: RouteContext, session: MobileClaims) => Promise<Response> | Response;

export function withMobileAuth(handler: MobileHandler): (req: NextRequest, ctx: RouteContext) => Promise<Response> {
  return async (req: NextRequest, ctx: RouteContext) => {
    const auth = req.headers.get('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return unauth();
    const claims = await verifyMobileAccessToken(token);
    if (!claims) return unauth();

    // Fail-closed tenant: yalnız gerçek kurum host'unda (apex/bilinmeyen host RET).
    if (!orgFromHost(headers().get('host'))) return unauth();
    if (claims.org !== currentOrg()) return unauth();
    // org_admin şube-bağımsız (__hq__) — branch kontrolü muaf; diğerleri eşleşmeli.
    if (claims.role !== 'org_admin' && (claims.branch || 'main') !== currentBranch()) return unauth();

    // İptal kontrolü — imza geçerli olsa bile oturum kapatılmışsa reddet.
    const active = await loadActiveSession(claims.sid);
    if (!active || active.revokedAt || active.expiresAt.getTime() <= Date.now()) return unauth();

    // Servis katmanı HttpError'ları tek noktada { error }+status'a çevrilir (withAuth kalıbı).
    try {
      return await handler(req, ctx, claims);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
```

- [ ] **Step 4: Tip kontrolü + commit**

Çalıştır: `npx tsc --noEmit`
Beklenen: 0 hata. (`s.payload as unknown as Session` ve `payload as object` cast'leri Json kolonu için bilinçli.)

```bash
git add lib/mobile/contracts.ts lib/mobile/sessions.ts lib/mobile/auth.ts
git commit -m "feat(mobil): cihaz oturumu katmanı — issue/refresh/revoke + withMobileAuth (tenant+iptal kilidi) + Zod sözleşmeleri"
```

---

### Task 7: resolve-org + bootstrap + me + middleware allowlist + superadmin mobile-config

**Files:**
- Create: `app/api/mobile/v1/resolve-org/route.ts`
- Create: `app/api/mobile/v1/bootstrap/route.ts`
- Create: `app/api/mobile/v1/me/route.ts`
- Create: `app/api/superadmin/mobile-config/route.ts`
- Modify: `middleware.js:31-48` (CSRF exact-path allowlist)

**Interfaces:**
- Consumes: Task 6 `withMobileAuth`, `ResolveOrgSchema`, `MobileConfigUpdateSchema`; mevcut `gateRatelimit`, `normalizeCode/hostForOrg`, `normalizeBranding`, `getOrgConfig`, `orgFromHost/branchFromHost`
- Produces: `POST /resolve-org` → `{ ok, orgSlug, branch, name, shortName, logoUrl, themeColor, canonicalHost, active }`; `GET /bootstrap` → `{ minSupportedVersion, recommendedVersion, maintenance, flags, serverTime, org }`; `GET /me` → `{ session }`

- [ ] **Step 1: middleware.js'e dar CSRF allowlist ekle**

`middleware.js` içinde önce (dosya başına, `MUTATING_METHODS` satırının altına) allowlist sabiti ekle:

```javascript
// /api/mobile/v1 oturumsuz JSON POST uçları — tarayıcı cookie'si TAŞIMAZ (native
// istemci Origin göndermez) → CSRF vektörü yok. YALNIZ bu tam yollar muaf; Bearer
// korumalı uçlar zaten aşağıdaki Bearer istisnasından geçer, session-open GET'tir.
// SÖZLEŞME: bu listeye cookie-auth ile yetkilenen bir uç EKLENEMEZ (Task 11 testi denetler).
const MOBILE_CSRF_EXEMPT = new Set([
  '/api/mobile/v1/resolve-org',
  '/api/mobile/v1/auth/login',
  '/api/mobile/v1/auth/refresh',
]);
```

Sonra CSRF bloğundaki `isPaymentCallback` satırının altına ekle ve koşulu güncelle:

```javascript
    const isMobileExempt = MOBILE_CSRF_EXEMPT.has(req.nextUrl.pathname);
    if (!isBearer && !isPaymentCallback && !isMobileExempt) {
```

- [ ] **Step 2: resolve-org route'unu yaz**

`app/api/mobile/v1/resolve-org/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { gateRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';
import { normalizeCode, hostForOrg } from '@/lib/orgcode';
import { normalizeBranding } from '@/lib/branding';
import { parseBody } from '@/lib/validate';
import { ResolveOrgSchema } from '@/lib/mobile/contracts';
import { tdb } from '@/lib/sqldb';

// Mobil kurum keşfi (spec §6): kurum kodu → canonical host + marka.
// /api/gate'in mobil karşılığı — apex'ten çağrılır, istemci YALNIZ dönen
// canonicalHost'a bağlanır (serbest girilmiş host'a asla).
// Bilinçli withAuth istisnası: ilk açılış akışı — oturum kavramı henüz yok.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success, reset } = await safeLimit(gateRatelimit, ip);
  if (!success) {
    return NextResponse.json(
      { error: `Çok fazla deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }

  const parsed = await parseBody(req, ResolveOrgSchema);
  if (!parsed.ok) return parsed.response;
  const code = normalizeCode(parsed.data.code);
  if (!code || code.length < 4) {
    return NextResponse.json({ error: 'Geçersiz kurum kodu.' }, { status: 400 });
  }

  const org = await tdb().org.findFirst({ where: { code } }); // Org global tablo (SKIP)
  if (!org) return NextResponse.json({ error: 'Bu koda ait kurum bulunamadı.' }, { status: 404 });
  if (org.active === false) return NextResponse.json({ error: 'Bu kurum şu anda aktif değil.' }, { status: 403 });

  const branding = normalizeBranding(org);
  return NextResponse.json({
    ok: true,
    orgSlug: org.slug,
    branch: 'main', // kurum kodu main şubeye çözer (gate paritesi); şube geçişi deep-link işi
    name: branding.name,
    shortName: branding.shortName,
    logoUrl: branding.logoUrl,
    themeColor: branding.themeColor,
    canonicalHost: hostForOrg(org.slug, 'main'),
    active: true,
  });
}
```

- [ ] **Step 3: bootstrap route'unu yaz**

`app/api/mobile/v1/bootstrap/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { orgFromHost, branchFromHost } from '@/lib/org';
import { normalizeBranding } from '@/lib/branding';
import { getOrgConfig } from '@/lib/config';

// Mobil bootstrap (spec §9/3): sürüm kapısı + bakım + feature flag (remote
// kill-switch) + kurum host'unda marka/modüller. MobileAppConfig GLOBAL tek satır
// (superadmin yönetir) → base prisma.
// Bilinçli withAuth istisnası: login ÖNCESİ de çağrılır — kill-switch her durumda çalışmalı.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // bakım anahtarı asla cache'lenmesin

export async function GET() {
  const cfg = await prisma.mobileAppConfig.findUnique({ where: { id: 'default' } });

  // Kurum bölümü yalnız kurum host'unda (apex'te org sızdırılmaz — orgFromHost apex'te null).
  const host = headers().get('host');
  const orgSlug = orgFromHost(host);
  let org: Record<string, unknown> | null = null;
  if (orgSlug) {
    const rec = await prisma.org.findUnique({ where: { slug: orgSlug } });
    if (rec) {
      const modules = await getOrgConfig('modules'); // istek tenant bağlamı (x-org) bu org
      org = {
        slug: rec.slug,
        branch: branchFromHost(host) || 'main',
        ...normalizeBranding(rec),
        active: rec.active !== false,
        modules,
      };
    }
  }

  return NextResponse.json({
    minSupportedVersion: cfg?.minSupportedVersion || '0.0.0',
    recommendedVersion: cfg?.recommendedVersion || '0.0.0',
    maintenance: { active: cfg?.maintenance ?? false, message: cfg?.maintenanceMessage || null },
    flags: (cfg?.flags as Record<string, boolean> | null) || {},
    serverTime: new Date().toISOString(),
    org,
  });
}
```

- [ ] **Step 4: me route'unu yaz**

`app/api/mobile/v1/me/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';

// Mobil "whoami" — istemci açılışta token geçerliliğini ve rol payload'ını doğrular.
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (_req, _ctx, session) => {
  // JWT meta claim'leri (iat/exp/aud/iss) yanıt gövdesine sızdırılmaz.
  const { iat, exp, aud, iss, ...rest } = session;
  return NextResponse.json({ session: rest });
});
```

- [ ] **Step 5: superadmin mobile-config route'unu yaz**

`app/api/superadmin/mobile-config/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody } from '@/lib/validate';
import { MobileConfigUpdateSchema } from '@/lib/mobile/contracts';

// Mobil uygulama global konfigürasyonu — remote kill-switch (min sürüm / bakım /
// feature flag). GLOBAL tablo (kurum-bağımsız) → base prisma; yalnız superadmin.
export const runtime = 'nodejs';

export const GET = withAuth(['superadmin'], async () => {
  const cfg = await prisma.mobileAppConfig.findUnique({ where: { id: 'default' } });
  return NextResponse.json({ config: cfg });
});

export const PUT = withAuth(['superadmin'], async (req) => {
  const parsed = await parseBody(req, MobileConfigUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const cfg = await prisma.mobileAppConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...parsed.data, maintenanceMessage: parsed.data.maintenanceMessage ?? null },
    update: parsed.data,
  });
  return NextResponse.json({ ok: true, config: cfg });
});
```

- [ ] **Step 6: Build doğrula + commit**

Çalıştır: `npm run build`
Beklenen: başarılı; route listesinde 4 yeni uç görünür.

```bash
git add app/api/mobile/v1/resolve-org/route.ts app/api/mobile/v1/bootstrap/route.ts app/api/mobile/v1/me/route.ts app/api/superadmin/mobile-config/route.ts middleware.js
git commit -m "feat(mobil): resolve-org + bootstrap + me uçları; mobile/v1 dar CSRF allowlist; superadmin kill-switch API"
```

---

### Task 8: Mobil login ucu

**Files:**
- Create: `app/api/mobile/v1/auth/login/route.ts`

**Interfaces:**
- Consumes: Task 5 `verifyLogin`, Task 6 `issueMobileSession/MobileLoginSchema`, mevcut `loginRatelimit`, `orgFromHost`, `currentOrg/currentBranch`, `getClientIp`
- Produces: `POST /auth/login` → `{ accessToken, refreshToken, expiresIn, sessionId, session }` | hata

- [ ] **Step 1: login route'unu yaz**

`app/api/mobile/v1/auth/login/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { loginRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';
import { orgFromHost } from '@/lib/org';
import { verifyLogin } from '@/lib/login';
import { issueMobileSession } from '@/lib/mobile/sessions';
import { MobileLoginSchema } from '@/lib/mobile/contracts';
import { parseBody } from '@/lib/validate';
import { currentOrg, currentBranch } from '@/lib/tenant';

// Mobil login (spec §7): şifre doğru → access+refresh çifti (cihaz doğrulama şimdilik
// ASKIDA — Mustafa 2026-07-16). Web /api/auth login'iyle AYNI çekirdek (verifyLogin);
// fark: cookie yerine token + MobileSession cihaz oturumu.
// superadmin çekirdekte HİÇ yok. org_admin İZİNLİ (WebView yönetim için session-exchange).
// Fail-closed tenant: yalnız kurum host'unda (apex/bilinmeyen host RET).
// Bilinçli withAuth istisnası: login ucu — oturum burada kurulur.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Fail-closed tenant (İnceleme Codex #7): login yalnız gerçek kurum subdomain'inde.
  if (!orgFromHost(headers().get('host'))) {
    return NextResponse.json({ error: 'Geçersiz kurum adresi.' }, { status: 400 });
  }

  const parsed = await parseBody(req, MobileLoginSchema);
  if (!parsed.ok) return parsed.response;
  const { username, password, role: selectedRole, installationId, deviceName, platform } = parsed.data;

  // Rate limit — web login ile AYNI kova (ip:username): mobil uç web kovasını bypass edemez.
  const ip = getClientIp(req);
  const rlKey = `${ip}:${username.toLowerCase()}`;
  const { success, reset } = await safeLimit(loginRatelimit, rlKey);
  if (!success) {
    return NextResponse.json(
      { error: `Çok fazla başarısız deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }

  const result = await verifyLogin(username, password, selectedRole);
  if (!result.ok) {
    return NextResponse.json(
      result.correctRole ? { error: result.error, correctRole: result.correctRole } : { error: result.error },
      { status: result.status }
    );
  }

  // Token payload'ına tenant kimliği yazılır (withMobileAuth kilidi + web setSession paritesi).
  // org_admin şube-bağımsız → branch '__hq__' (withMobileAuth branch kontrolünü muaf tutar).
  const branch = result.role === 'org_admin' ? '__hq__' : currentBranch();
  const payload = { ...result.payload, org: currentOrg(), branch };
  const pair = await issueMobileSession(payload, { installationId, deviceName, platform, ip });
  return NextResponse.json({ ...pair, session: payload });
}
```

- [ ] **Step 2: Build doğrula + commit**

Çalıştır: `npx tsc --noEmit && npm run build`
Beklenen: 0 tip hatası; build başarılı, yeni route listede.

```bash
git add app/api/mobile/v1/auth/login/route.ts
git commit -m "feat(mobil): login ucu — şifre doğru → token çifti (org_admin dahil, fail-closed tenant)"
```

---

### Task 9: refresh + logout + devices + şifre değişiminde iptal + retention

**Files:**
- Create: `app/api/mobile/v1/auth/refresh/route.ts`
- Create: `app/api/mobile/v1/auth/logout/route.ts`
- Create: `app/api/mobile/v1/auth/devices/route.ts`
- Modify: `app/api/auth/route.ts` (change_password + reset_password'a iptal kancası)
- Modify: `app/api/cron/cleanup/route.ts` (MobileSession retention)

**Interfaces:**
- Consumes: Task 6 `refreshMobileSession/revokeMobileSession/revokeMobileSessionsFor/listMobileDevices`, `withMobileAuth`, `MobileRefreshSchema/MobileDeviceRevokeSchema`
- Produces:
  - `POST /auth/refresh` → `{ accessToken, refreshToken, expiresIn, sessionId, session }` | 401
  - `POST /auth/logout` → `{ ok: true }`
  - `GET /auth/devices` → `{ devices: DeviceView[] }`; `DELETE /auth/devices` → `{ ok, revoked }`

- [ ] **Step 1: refresh route'unu yaz**

`app/api/mobile/v1/auth/refresh/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { orgFromHost } from '@/lib/org';
import { parseBody } from '@/lib/validate';
import { MobileRefreshSchema } from '@/lib/mobile/contracts';
import { refreshMobileSession } from '@/lib/mobile/sessions';

// Refresh token rotation (spec §7): her kullanım yeni çift üretir, eskisi geçersizleşir;
// grace (30sn) dışı eski token kullanımı oturumu KAPATIR (reuse detection —
// lib/mobile/policy.ts). Tenant kilidi: arama tdb() üzerinden → başka kurumun
// host'una sunulan token bulunamaz. Fail-closed: yalnız kurum host'unda.
// Bilinçli withAuth istisnası: access token süresi dolmuşken çağrılır — Bearer yok.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!orgFromHost(headers().get('host'))) {
    return NextResponse.json({ error: 'Geçersiz kurum adresi.' }, { status: 400 });
  }
  const parsed = await parseBody(req, MobileRefreshSchema);
  if (!parsed.ok) return parsed.response;
  const r = await refreshMobileSession(parsed.data.refreshToken);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ...r.pair, session: r.payload });
}
```

- [ ] **Step 2: logout route'unu yaz**

`app/api/mobile/v1/auth/logout/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { revokeMobileSession } from '@/lib/mobile/sessions';

// Mobil çıkış: token'daki sid'in oturumunu iptal eder — refresh artık çalışmaz;
// access token da iptal kontrolü nedeniyle ANINDA geçersiz (withMobileAuth).
export const runtime = 'nodejs';

export const POST = withMobileAuth(async (_req, _ctx, session) => {
  await revokeMobileSession(session.sid, session.role, String(session.id ?? ''), 'çıkış');
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 3: devices route'unu yaz**

`app/api/mobile/v1/auth/devices/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { listMobileDevices, revokeMobileSession, revokeMobileSessionsFor } from '@/lib/mobile/sessions';
import { parseBody } from '@/lib/validate';
import { MobileDeviceRevokeSchema } from '@/lib/mobile/contracts';

// Cihaz oturumu yönetimi (spec §7): listele, tek tek iptal, "tüm cihazlardan çıkış".
// role+userId koşulu sessions katmanında — kullanıcı YALNIZ kendi oturumlarını görür/kapatır.
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (_req, _ctx, session) => {
  const devices = await listMobileDevices(session.role, String(session.id ?? ''), session.sid);
  return NextResponse.json({ devices });
});

export const DELETE = withMobileAuth(async (req, _ctx, session) => {
  const parsed = await parseBody(req, MobileDeviceRevokeSchema);
  if (!parsed.ok) return parsed.response;
  const userId = String(session.id ?? '');
  if (parsed.data.all) {
    const revoked = await revokeMobileSessionsFor(session.role, userId, 'tüm cihazlardan çıkış');
    return NextResponse.json({ ok: true, revoked });
  }
  const ok = await revokeMobileSession(parsed.data.sessionId!, session.role, userId, 'cihaz iptali');
  if (!ok) return NextResponse.json({ error: 'Oturum bulunamadı' }, { status: 404 });
  return NextResponse.json({ ok: true, revoked: 1 });
});
```

- [ ] **Step 4: Şifre değişiminde mobil oturum iptali**

`app/api/auth/route.ts` — import ekle:

```typescript
import { revokeMobileSessionsFor } from '@/lib/mobile/sessions';
```

(a) `updatePasswordFor` içinde, `await db[roleKey].update(...)` satırından SONRA (setSession'dan önce) ekle:

```typescript
      // Spec §7: şifre değişiminde tüm mobil refresh oturumları iptal (web oturumu sürer).
      await revokeMobileSessionsFor(session!.role, String(session!.id ?? ''), 'şifre değişti');
```

(b) `reset_password` action'ında `await db[model].update(...)` satırından SONRA (logAudit'ten önce) ekle:

```typescript
    // Mobil oturum iptali — müdür yardımcısı mobil oturumunda role='director' taşır.
    const mobileRole = targetRole === 'assistant_director' ? 'director' : targetRole;
    await revokeMobileSessionsFor(mobileRole, targetId, 'şifre sıfırlandı');
```

- [ ] **Step 5: cleanup cron'una retention ekle**

`app/api/cron/cleanup/route.ts` — sabitlerin altına ekle:

```typescript
// Kapanmış (revoke/expired) mobil oturum kayıtları: 30 gün denetim penceresi, sonra sil.
const MOBILE_SESSION_RETENTION_DAYS = 30;
```

`GET` içinde `deliveryDeleted` bloğundan sonra ekle:

```typescript
  const mobileSessionDeleted = await purge('mobileSession',
    () => prisma.mobileSession.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: cutoff(MOBILE_SESSION_RETENTION_DAYS) } },
          { expiresAt: { lt: cutoff(MOBILE_SESSION_RETENTION_DAYS) } },
        ],
      },
    }));
```

ve dönüş satırını güncelle:

```typescript
  return NextResponse.json({ ok: true, auditDeleted, errDeleted, notifDeleted, eventDeleted, deliveryDeleted, mobileSessionDeleted });
```

- [ ] **Step 6: Tip + test + build + commit**

Çalıştır: `npx tsc --noEmit && npm run test && npm run build`
Beklenen: hepsi yeşil.

```bash
git add app/api/mobile/v1/auth/refresh/route.ts app/api/mobile/v1/auth/logout/route.ts app/api/mobile/v1/auth/devices/route.ts app/api/auth/route.ts app/api/cron/cleanup/route.ts
git commit -m "feat(mobil): refresh rotation + logout + cihaz yönetimi; şifre değişiminde mobil oturum iptali + retention"
```

---

### Task 10: session-exchange + session-open (native → WebView)

**Files:**
- Create: `app/api/mobile/v1/session-exchange/route.ts`
- Create: `app/api/mobile/v1/session-open/route.ts`

**Interfaces:**
- Consumes: Task 6 `withMobileAuth`, Task 2 `setSession` (maxAge'li), `tenantRedis` (`getdel` — Task 1), `getClientIp`
- Produces: `POST /session-exchange` (Bearer) → `{ code, expiresIn: 60 }`; `GET /session-open?code=..&next=/..` → 302 + kısa ömürlü `etut_session` cookie

- [ ] **Step 1: session-exchange route'unu yaz**

`app/api/mobile/v1/session-exchange/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { withMobileAuth } from '@/lib/mobile/auth';
import { tenantRedis } from '@/lib/tenant';
import { getClientIp } from '@/lib/ratelimit';

// Native → WebView oturum aktarımı, adım 1 (spec §5.3/§7): Bearer ile tek
// kullanımlık kod üret. Kod 60 sn yaşar, tenant-scoped Redis'te durur — yalnız
// aynı kurum host'unda açılabilir. WebView refresh token'ı HİÇ görmez; kod yalnız
// oturum payload'ını taşır.
// İnceleme (Gemini #4): login-CSRF / session-donation koruması — kodu ÜRETEN cihazın
// IP'si payload'a gömülür; session-open aynı IP'yi ister (saldırganın kodu kurbanın
// tarayıcısında açılamaz).
export const runtime = 'nodejs';

const EXCHANGE_TTL_SEC = 60;

export const POST = withMobileAuth(async (req, _ctx, session) => {
  const code = randomBytes(32).toString('base64url');
  // JWT meta dışarıda — cookie payload'ı web Session şekliyle birebir. sid AYRICA
  // saklanır: session-open kodu cookie'ye çevirirken oturum HÂLÂ aktif mi diye
  // yineler (kod üretildikten sonra 60 sn içinde logout olursa cookie kurulmaz —
  // İnceleme Codex #3a).
  const { iat, exp, aud, iss, sid, ...payload } = session;
  await tenantRedis().set(
    `mexch:${code}`,
    { payload, ip: getClientIp(req), sid },
    { ex: EXCHANGE_TTL_SEC },
  );
  const res = NextResponse.json({ code, expiresIn: EXCHANGE_TTL_SEC });
  res.headers.set('Cache-Control', 'no-store'); // kod proxy/CDN'de cache'lenmesin
  return res;
});
```

- [ ] **Step 2: session-open route'unu yaz**

`app/api/mobile/v1/session-open/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { tenantRedis, currentOrg } from '@/lib/tenant';
import { orgFromHost } from '@/lib/org';
import { getClientIp } from '@/lib/ratelimit';
import { setSession, type Session } from '@/lib/auth';
import { loadActiveSession } from '@/lib/mobile/sessions';

// Adım 2: WebView bu URL'i yükler → kod tek kullanımlık doğrulanır → KISA ömürlü
// web cookie oturumu (12 saat, JWT exp de 12 saat) kurulur → next'e redirect. iOS cookie
// temizliğine dayanıklılık: WebView cookie kaybederse native taraf yeni exchange yapar (spec §7).
// Bilinçli withAuth istisnası: cookie oturumu BURADA kurulur; tek kullanımlık kod doğrular.
export const runtime = 'nodejs';

const COOKIE_TTL_SEC = 60 * 60 * 12;

interface ExchangeRec { payload: Session; ip: string; sid: string }

export async function GET(req: NextRequest) {
  // Fail-closed tenant (İnceleme Codex #5): auth kuran uç yalnız gerçek kurum host'unda.
  // Apex/bilinmeyen host DEFAULT_ORG'a düşer → varsayılan kurum kodu orada tüketilmesin.
  if (!orgFromHost(headers().get('host'))) {
    return NextResponse.json({ error: 'Geçersiz kurum adresi' }, { status: 400 });
  }

  const code = req.nextUrl.searchParams.get('code') || '';
  const next = req.nextUrl.searchParams.get('next') || '/';
  // Open-redirect koruması: yalnız site-içi mutlak path ('/x' evet, '//evil' hayır).
  const safeNext = /^\/(?!\/)/.test(next) ? next : '/';
  if (code.length < 20) return NextResponse.json({ error: 'Geçersiz kod' }, { status: 400 });

  // Atomik tek kullanımlık tüketim (İnceleme Gemini #3/Codex #13): getdel — eşzamanlı
  // iki istekten yalnız biri değeri alır (get+del yarışı yok, tek round-trip).
  const rec = await tenantRedis().getdel<ExchangeRec>(`mexch:${code}`);
  if (!rec) return NextResponse.json({ error: 'Kod geçersiz veya kullanılmış' }, { status: 403 });

  // Login-CSRF koruması (Gemini #4): kodu üreten cihazın IP'si eşleşmeli.
  // NOT: dual-stack/hücresel IP değişiminde meşru istek de reddolabilir → native taraf
  // yeni exchange üretir (Plan 3 istemci retry). Defense-in-depth, tek başına faktör değil.
  if (rec.ip !== getClientIp(req)) {
    return NextResponse.json({ error: 'Kod bu cihazda açılamaz' }, { status: 403 });
  }
  // Savunma katmanı: kod zaten tenant-prefix'li anahtarda ama payload org'u da doğrula.
  if (rec.payload.org && rec.payload.org !== currentOrg()) {
    return NextResponse.json({ error: 'Kod geçersiz veya kullanılmış' }, { status: 403 });
  }
  // İptal yineleme (İnceleme Codex #3a): kod üretildikten sonra 60 sn içinde oturum
  // iptal edildiyse (logout/cihaz iptali/şifre değişimi) cookie KURULMAZ.
  const active = await loadActiveSession(rec.sid);
  if (!active || active.revokedAt || active.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Oturum artık geçerli değil' }, { status: 403 });
  }

  const res = NextResponse.redirect(new URL(safeNext, req.nextUrl.origin), 302);
  await setSession(res, rec.payload, { maxAgeSec: COOKIE_TTL_SEC });
  res.headers.set('Referrer-Policy', 'no-referrer'); // kod query-string'i referer'da sızmasın
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
```

- [ ] **Step 3: Build doğrula + commit**

Çalıştır: `npm run build`
Beklenen: başarılı; iki yeni route listede.

```bash
git add app/api/mobile/v1/session-exchange/route.ts app/api/mobile/v1/session-open/route.ts
git commit -m "feat(mobil): session-exchange — tek kullanımlık IP-bağlı kodla native→WebView kısa cookie (atomik tüketim)"
```

---

### Task 11: Deploy + canlı sözleşme testi + doğrulama

**Files:**
- Create: `e2e/int-mobile-auth.spec.js`
- Modify: `.env.local` (yalnız yerel — `OKULIN_ORG_CODE=7JT-PSH`; gitignore'da, COMMIT EDİLMEZ)

**Operasyonel ön koşul:** `MOBILE_JWT_SECRET` Vercel production env'de tanımlı olmalı (Global Constraints). Yoksa canlı token doğrulaması dev-fallback secret'la çalışır ama üretim güvenliği için gerçek secret şart.

- [ ] **Step 1: Push et, deploy'u bekle**

```bash
git push
```

Vercel otomatik deploy'unun Ready olmasını bekle (proje `prj_CQOWv8bchQWuirm6eeb71VCmK0dk`).

- [ ] **Step 2: int spec'i yaz**

`.env.local`'e ekle (yoksa): `OKULIN_ORG_CODE=7JT-PSH`

`e2e/int-mobile-auth.spec.js`:

```javascript
/**
 * ENTEGRASYON — /api/mobile/v1 çekirdeği (canlı testkurs)
 * resolve-org → bootstrap → login (token, çoklu rol) → me (çapraz-token reddi) →
 * refresh rotation → reuse detection → logout sonrası access reddi (iptal) →
 * devices → session-exchange (IP-bağlı, atomik) → çapraz-tenant reddi.
 *
 * Rate-limit bütçesi: mobil login web ile AYNI ip:username kovasını kullanır
 * (5 deneme/15dk). director 2, teacher 1, student 1 login → toplam 4 (+ setup'ın
 * director login'i AYRI kova değil; testleri 15 dk içinde tekrar koşarsan dikkat).
 *
 * DOĞRULAMA ASKIDA (2026-07-16): OTP akışı yok → login şifre doğruysa direkt token.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { BASE, DIR_STATE } = require('./helpers');

const baseHost = new URL(BASE).hostname;                          // testkurs.okulin.com
const APEX = `https://${baseHost.split('.').slice(1).join('.')}`; // https://okulin.com
const DIR_USER = process.env.OKULIN_DIR_USER || 'testkurs_mudur';
const DIR_PASS = process.env.OKULIN_DIR_PASS;
const TEA_USER = process.env.OKULIN_TEA_USER;
const TEA_PASS = process.env.OKULIN_TEA_PASS;
const STU_USER = process.env.OKULIN_STU_USER;
const STU_PASS = process.env.OKULIN_STU_PASS;
const ORG_CODE = process.env.OKULIN_ORG_CODE;

const GRACE_WAIT_MS = 35_000; // ROTATE_GRACE_SEC (30sn) + pay

async function login(api, username, password, role) {
  const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, { data: { username, password, role } });
  return r;
}

test.describe('Mobil API çekirdeği (canlı)', () => {
  test.describe.configure({ mode: 'serial' });

  let api;              // cookie'siz istemci (native taklidi — Origin başlığı YOK)
  let web;              // session-open için cookie jar'lı istemci
  let access, r0;       // director 1. login çifti (r0 = ilk refresh token)
  let r1, r2;           // rotation zinciri: r0→r1 (normal), r0→r2 (grace-içi art-arda)

  test.beforeAll(async ({ playwright }) => {
    expect(DIR_PASS, 'OKULIN_DIR_PASS .env.local\'de tanımlı olmalı').toBeTruthy();
    api = await playwright.request.newContext();
    web = await playwright.request.newContext();
  });
  test.afterAll(async () => { await api?.dispose(); await web?.dispose(); });

  test('resolve-org: kurum kodu canonical host + marka döner', async () => {
    test.skip(!ORG_CODE, 'OKULIN_ORG_CODE tanımlı değil');
    const r = await api.post(`${APEX}/api/mobile/v1/resolve-org`, { data: { code: ORG_CODE } });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.canonicalHost).toBe(baseHost);
    expect(j.orgSlug).toBeTruthy();
    expect(j.themeColor).toMatch(/^#/);
  });

  test('bootstrap: sürüm + bakım + kurum markası/modülleri', async () => {
    const r = await api.get(`${BASE}/api/mobile/v1/bootstrap`);
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.minSupportedVersion).toBeTruthy();
    expect(j.maintenance).toHaveProperty('active');
    expect(j.org?.slug).toBeTruthy();
    expect(j.org?.modules).toBeTruthy();
  });

  test('login: müdür token çifti (Origin başlıksız — CSRF allowlist çalışıyor)', async () => {
    const r = await login(api, DIR_USER, DIR_PASS, 'management');
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.accessToken).toBeTruthy();
    expect(j.refreshToken).toMatch(/^mrt_/);
    expect(j.session.role).toBe('director');
    access = j.accessToken; r0 = j.refreshToken;
  });

  test('login: öğretmen ve öğrenci de token alır (çoklu rol)', async () => {
    test.skip(!TEA_PASS || !STU_PASS, 'öğretmen/öğrenci bilgileri tanımlı değil');
    const t = await login(api, TEA_USER, TEA_PASS, 'teacher');
    expect(t.status(), await t.text()).toBe(200);
    expect((await t.json()).session.role).toBe('teacher');
    const s = await login(api, STU_USER, STU_PASS, 'student');
    expect(s.status(), await s.text()).toBe(200);
    expect((await s.json()).session.role).toBe('student');
  });

  test('me: geçerli Bearer 200; çöp token ve web cookie JWT 401', async () => {
    const ok = await api.get(`${BASE}/api/mobile/v1/me`, { headers: { Authorization: `Bearer ${access}` } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).session.role).toBe('director');

    const bad = await api.get(`${BASE}/api/mobile/v1/me`, { headers: { Authorization: 'Bearer bozuk-token' } });
    expect(bad.status()).toBe(401);

    // Web cookie JWT'si Bearer olarak sunulamaz (ayrı secret + aud).
    const state = JSON.parse(fs.readFileSync(DIR_STATE, 'utf8'));
    const cookieJwt = (state.cookies || []).find((c) => c.name === 'etut_session')?.value;
    expect(cookieJwt, 'setup storageState içinde etut_session olmalı').toBeTruthy();
    const cross = await api.get(`${BASE}/api/mobile/v1/me`, { headers: { Authorization: `Bearer ${cookieJwt}` } });
    expect(cross.status()).toBe(401);
  });

  test('refresh: rotation yeni çift üretir (r0 → r1)', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r0 } });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.refreshToken).toMatch(/^mrt_/);
    expect(j.refreshToken).not.toBe(r0);
    r1 = j.refreshToken;
  });

  test('grace-içi art-arda: r0 hemen tekrar → r2 (meşru retry, sonsuz DEĞİL)', async () => {
    // r0 az önce r1'e rotate edildi; grace (30sn) içinde r0 tekrar sunulur (kayıp yanıt
    // senaryosu) → yeni çift (r2). rotate'te prev = önceki güncel (r1), r0 DEĞİL →
    // r0 artık ne refreshHash ne prev → üçüncü kullanımda ölür (Codex #1 düzeltmesi).
    const again = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r0 } });
    expect(again.status(), await again.text()).toBe(200);
    r2 = (await again.json()).refreshToken;
    expect(r2).not.toBe(r1);
    // r0 üçüncü kez → artık tanınmıyor → 401 (oturum bulunamadı; revoke değil)
    const third = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r0 } });
    expect(third.status()).toBe(401);
  });

  test('reuse detection: grace DIŞI eski refresh (r1) OTURUMU KAPATIR', async () => {
    test.setTimeout(150_000);
    await new Promise((res) => setTimeout(res, GRACE_WAIT_MS));
    // r1 artık prev (güncel r2); grace dışı prev kullanımı = reuse → revoke
    const replay = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r1 } });
    expect(replay.status()).toBe(401);
    // Oturum TAMAMEN kapandı: güncel r2 de reddedilir
    const after = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r2 } });
    expect(after.status()).toBe(401);
  });

  test('iptal: logout sonrası access token ANINDA geçersiz (withMobileAuth iptal kontrolü)', async () => {
    // Yeni (SON) login — rate-limit bütçesi (bkz. dosya başı)
    const r = await login(api, DIR_USER, DIR_PASS, 'management');
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    const bearer = { Authorization: `Bearer ${j.accessToken}` };

    // logout
    const lo = await api.post(`${BASE}/api/mobile/v1/auth/logout`, { headers: bearer });
    expect(lo.status()).toBe(200);
    // access token imzası geçerli ama oturum iptal → me artık 401
    const me = await api.get(`${BASE}/api/mobile/v1/me`, { headers: bearer });
    expect(me.status()).toBe(401);
    // refresh de geçersiz
    const ref = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: j.refreshToken } });
    expect(ref.status()).toBe(401);
  });

  test('devices + session-exchange (IP-bağlı, tek kullanımlık) + çapraz-tenant reddi', async () => {
    // Not: bu blok setup rate-limit'ini paylaşan 2. director login DEĞİL — yukarıdaki
    // iptal testinin token'ı iptal edildi; taze token için TEK login daha:
    const r = await login(api, DIR_USER, DIR_PASS, 'management');
    // Rate-limit bütçesi dolduysa 429 kabul (canlı ortam gerçeği) — o durumda testi atla
    test.skip(r.status() === 429, 'login rate-limit doldu (15 dk içinde tekrar koşuluyor)');
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    const bearer = { Authorization: `Bearer ${j.accessToken}` };

    const dv = await api.get(`${BASE}/api/mobile/v1/auth/devices`, { headers: bearer });
    expect(dv.status()).toBe(200);
    expect((await dv.json()).devices.some((d) => d.current)).toBe(true);

    // session-exchange → aynı istemci (aynı IP) session-open yapar → cookie oturumu
    const ex = await api.post(`${BASE}/api/mobile/v1/session-exchange`, { headers: bearer });
    expect(ex.status(), await ex.text()).toBe(200);
    const { code } = await ex.json();
    // AYNI istemci (api) ile aç → IP eşleşir
    const open = await api.get(`${BASE}/api/mobile/v1/session-open?code=${code}&next=/`);
    expect(open.status()).toBe(200); // 302 takip edildi
    // Aynı kod ikinci kez → 403 (tek kullanımlık, atomik tüketim)
    const again = await api.get(`${BASE}/api/mobile/v1/session-open?code=${code}&next=/`);
    expect(again.status()).toBe(403);

    // Çapraz-tenant: testkurs token'ı apex'te (farklı tenant bağlamı) reddedilir
    const crossTenant = await api.get(`${APEX}/api/mobile/v1/me`, { headers: bearer });
    expect(crossTenant.status()).toBe(401);
  });
});
```

- [ ] **Step 3: int testini canlıya karşı koştur**

Çalıştır: `npx playwright test e2e/int-mobile-auth.spec.js --project=int`
Beklenen: tüm testler PASS (reuse testi ~35 sn bekler). Kırılan olursa düzelt, `fix:` commit'iyle işle, push'la, yeniden koş.

- [ ] **Step 4: Kill-switch canlı smoke (superadmin)**

Superadmin ile apex'ten login olup (CLAUDE.local.md creds; curl'de `-H "Origin: https://okulin.com"` + cookie sakla) bakımı aç-kapa:

```bash
# 1) bakımı aç
curl -s -X PUT "https://okulin.com/api/superadmin/mobile-config" -b sa-cookies.txt \
  -H "Content-Type: application/json" -H "Origin: https://okulin.com" \
  -d '{"maintenance":true,"maintenanceMessage":"Bakımdayız"}'
# 2) bootstrap bakımı göstersin
curl -s "https://testkurs.okulin.com/api/mobile/v1/bootstrap" | jq '.maintenance'
# beklenen: {"active":true,"message":"Bakımdayız"}
# 3) GERİ KAPAT (unutma!)
curl -s -X PUT "https://okulin.com/api/superadmin/mobile-config" -b sa-cookies.txt \
  -H "Content-Type: application/json" -H "Origin: https://okulin.com" \
  -d '{"maintenance":false,"maintenanceMessage":null}'
```

- [ ] **Step 5: Web regresyon kontrolü (login refactor + OTP askı canlıda)**

```bash
npx playwright test --project=setup --project=smoke
```

Beklenen: setup (3 rol login) + smoke yeşil — web login davranışı (Task 5 refactor + OTP askı) canlıda çalışıyor. Superadmin 2FA'yı da elle bir kez doğrula (superadmin telefonu varsa `needsOtp` almalı — CLAUDE.local.md creds ile apex login).

- [ ] **Step 6: Commit + memory/roadmap güncelle**

```bash
git add e2e/int-mobile-auth.spec.js
git commit -m "test(mobil): /api/mobile/v1 canlı sözleşme testleri — auth/rotation/reuse/iptal/exchange/çapraz-tenant"
git push
```

`native-app-girisi.md` memory'sine "Plan 2 (/api/mobile/v1 çekirdek) canlıda ✅" notu + öğrenilen dersler; sıradaki plan (Plan 3 — Expo iskelet + cihaz kaydı) işaretlenir. `.superpowers/sdd/progress.md` ledger'ı kapatılır.

---

## Self-Review Notları (plan yazarı doldurdu)

- **Spec kapsaması:** §6 → Task 7 resolve-org (canonical host) + dar CSRF allowlist (Task 7, spec'in "User-Agent esnetme yok" kararına sadık). §7 → Task 3-4-6-8-9 (access/refresh, rotation+reuse, cihaz oturumları, tek tek + tüm cihazlardan çıkış, şifre değişiminde iptal, **her istekte iptal kontrolü**, superadmin üretilmez, org_admin dahil) + Task 10 (session-exchange, WebView refresh görmez, IP-bağlı). §9/1-3 → Task 7 (bootstrap), Task 6 (Zod request sözleşmeleri). Cihaz doğrulama (OTP/SMS) **bilinçli askıda** (Mustafa 2026-07-16) — auth çekirdeği kanaldan bağımsız, doğrulama sonra takılır.
- **İnceleme Tur 1 kaynaklı kararlar (işlendi):** Codex #2 iptal kontrolü (Task 6 withMobileAuth + Task 9 iptal kancaları) · Codex #5 assistant_director OTP (Task 5 getOtpIdentity) · Codex #6 CSRF exact-path allowlist (Task 7) · Codex #7 fail-closed tenant (Task 6/8/9) · Codex #8 org_admin dahil (Task 5/8) · Codex #9 isim ADR (Karar Notları) · Codex #12 + Gemini #6 ayrı MOBILE_JWT_SECRET (Task 3) · Gemini #3/Codex #13 atomik getdel (Task 1/10) · Gemini #4 session-donation IP-binding (Task 10) · Codex #14 test matrisi (Task 11).
- **İnceleme Tur 2 kaynaklı kararlar (işlendi):** **[Critical]** Codex #1 refresh rotation prev bug — grace yolunda `prevRefreshHash: h` eski token'ı sonsuz yaşatıyordu → CAS `refreshHash: s.refreshHash` + `prev = s.refreshHash` (Task 6), art-arda/eşzamanlı grace testi (Task 11). **[Critical]** Gemini #1 + Codex #4 org_admin `tdb()` branch enjeksiyonu — MobileSession SKIP'e alındı, orgSlug elle (Task 1/6). **[Important]** Codex #3b signToken exp = cookie maxAge (Task 2) · Codex #3a session-open sid aktiflik yineleme (Task 10) · Codex #5 session-open fail-closed tenant (Task 10) · Codex #6 + Gemini #4 dev fallback ≠ JWT_SECRET + prod eşitlik reddi + verifyToken aud reddi (Task 2/3) · Gemini #2 verifyLogin selectedRole cast (Task 5).
- **Reddedilen / yanlış alarm:** Tur 1 Gemini #2 (updateMany reddi — gerekçe yanlıştı ama düzeltme yönü doğruydu; Tur 2 Codex #1 ile gerçek bug bulundu ve düzeltildi) · full token-family (Codex #1 Tur 1 — YAGNI, ADR Task 4) · Tur 2 Gemini #3 getdel jenerik (Codex teyit: Upstash-uyumlu, mevcut `get` deseniyle aynı).
- **ADR ile kabul (düzeltilmedi):** superadmin fail-open (Codex #2 Tur 2 — Plan 2 kapsamı dışı, ayrı iş) · 12h WebView cookie iptal bağı · IP-binding kırılganlığı · her istekte iptal DB turu (hepsi Karar Notları ADR bölümü).
- **Plan 3'e devredilen:** istemci refresh mutex (Gemini #5), response/error sözleşme zarfları (Codex #9), cihaz-katmanlı rate limit (Codex #10/#11), IP-binding istemci tek-retry.
- **Tip tutarlılığı:** `MobileClaims = Session & { sid }` her katmanda; `LoginResult` Task 5→8; `MobileTokenPair` Task 6→8-9; policy `RefreshSessionState` alanları Prisma modeliyle birebir → `decideRefresh(s, ...)`'e Prisma satırı doğrudan geçer; `refreshMobileSession` `matchWhere` istemcinin sunduğu hash'e göre kurulur (grace yolunda `prevRefreshHash`, güncel yolunda `refreshHash`).
- **Deep link / assetlinks.json (spec §6/5):** bu planda YOK — statik dosya mobil binary imza hash'i gerektirir (EAS sonrası, Plan 3). Push cihaz kaydı (`DeviceInstallation` doldurma): Plan 3.
- **Placeholder taraması:** tüm kod blokları tam; silme talimatları satır aralıklarıyla verildi (Task 5).
- **Riskli nokta (bilinçli):** Task 5 web login refactor + OTP askı — güvence: mevcut vitest + build + Task 11 Step 5 canlı setup/smoke + superadmin 2FA elle doğrulama.
