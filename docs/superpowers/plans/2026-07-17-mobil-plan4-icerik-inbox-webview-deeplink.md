# Mobil Plan 4/5 — Native İçerik (Bugün) + Bildirim Merkezi + WebView + Deep Link + QR Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rol-bazlı "Bugün" ekranını gerçek içerikle doldurmak (öğrenci/veli/öğretmen için `/api/mobile/v1` ekran uçları), bildirim merkezini (NotificationEvent inbox API + UI + push tap → eventId routing) canlıya almak, yönetim rolleri için güvenli WebView'i (session-exchange istemcisi, tek-retry) açmak, QR ile kurum kodu okumayı eklemek ve Plan-3 borçlarını (fetch timeout, Gate AppState yeniden kontrolü, kurumdan-ayrıl onayı, 409-retry helper, dispatchDue sorgu optimizasyonu, DeviceView tip ayrışması) kapatmak.

**Architecture:** Backend'e üç yeni Bearer-korumalı uç eklenir: `GET /screens/today` (rol-aware aggregate — mevcut `lib/*` servis fonksiyonlarını çağırır, yeni veri modeli YOK), `GET/POST /notifications` (NotificationEvent üzerinde list/read — şema hazır, `readAt` ilk kez kullanılır). Mobil tarafta ekranlar sekmeli navigasyona (Bugün · Bildirimler · Ayarlar) taşınır; Bugün rol bileşenleriyle gerçek içerik gösterir; push tap'i `eventId` ile Bildirimler'e yönlenir (soğuk açılış + bekleyen rota dahil); yönetim rolleri WebView'de mevcut web paneline session-exchange ile girer; kurum ekranına QR tarama eklenir. Tipler `lib/mobile/api-types.ts` → `mobile/src/api/types.ts` senkron zinciriyle paylaşılır.

**Tech Stack:** Backend: Next.js 14 + Prisma/Neon + Upstash (mevcut; ŞEMA DEĞİŞİKLİĞİ YOK). Mobil: Expo SDK 57 (RN 0.86) + mevcut yığın; YENİ: `react-native-webview`, `expo-camera`, `@expo/vector-icons` (hepsi `npx expo install` ile SDK-pinli). Build: yerel `npx expo run:android` + SM-M205F (USB) — yeni native modüller Task 11'de rebuild gerektirir.

**Spec:** `docs/superpowers/specs/2026-07-14-native-mobil-app-design.md` §5.1 (rol-bazlı native ekranlar), §5.2-5.4 (WebView sınırı + güvenlik), §6 (kurum keşfi + deep link + push payload routing), §7 (WebView oturumu), §8 (bildirim merkezi/inbox), §9/1-2 (ekran uçları + veri minimizasyonu), §11 (PayTR mobilde gösterilmez).

**Plan 3'ten devralınanlar:** fetch timeout/AbortController → Task 5 · Gate AppState-active kill-switch yeniden kontrolü → Task 5 · kurumdan-ayrıl onay diyaloğu → Task 5 · 409-retry helper → Task 5 · DeviceView tip adı ayrışması → Task 1 · dispatchDue per-item sorgu optimizasyonu → Task 1 · devices.ts timingSafeEqual (Minor #4) → Task 1 · sensitive-push cihaz testi → Task 11 · session-exchange istemci + WebView → Task 7 · bildirim merkezi → Task 2+6 · deep-link/push routing → Task 9 · QR → Task 10 · gerçek "Bugün" içeriği → Task 3+8.

**Çapraz inceleme (2026-07-17):** Codex 15 bulgu (2 Critical: dispatchDue şube sahipliği + TOCTOU; 10 Important; 3 Minor) + Gemini 5 bulgu (2 Critical: web.tsx loading yönlendirmesi + NotificationRouter erken push) — HEPSİ bu plana işlendi. Çözümler ilgili task'larda `İnceleme Codex #N` / `İnceleme Gemini #N` etiketiyle gerekçeli.

## Karar Notları (ADR — bilinçli tercihler)

- **Tek aggregate "today" ucu** (`GET /api/mobile/v1/screens/today`): Bugün ekranı tek istekle dolar (mobil round-trip azaltma; spec §9/1'in "rol-bazlı ekran uçları" ilk somut örneği). Ayrıntı ekranları (tam program haftalık görünüm, ödev detay, deneme analiz) Plan 5+ — o zaman ayrı uçlar açılır; today ucu genişletilmez.
- **"Bugün" hesabı TR gününe göre** (`trToday`): sunucu TZ'i UTC (Vercel) — `getWeekKey()` yerel saat kullanır; TR gece 00:00-03:00 aralığında "bugün" kaymasın diye gün/hafta UTC+3 sabit kaymayla hesaplanır (TR'de DST yok). Saf fonksiyon, birim testli.
- **Devamsızlık görünümü Plan 4 DIŞI:** web'de veli/öğrenci `attendance/student` ucuna erişemiyor (yalnız director/counselor/teacher). Mobilde açmak yetki genişletmesi + web'de olmayan yeni görünüm = workflow-değiştiren özellik → Mustafa + öğretmen/müdür istişaresi gerekir ([[feedback_ozellik-karar-istisare]]). Spec §5.1'deki "veli yoklama görünümü" bu istişare sonrası ayrı iş.
- **PayTR mobilde YOK** (spec §11): veli Bugün'de ödeme özeti SALT-OKUNUR native gösterilir (kalan borç + sıradaki taksit + geciken sayısı); ödeme başlatma butonu yok. WebView girişleri yalnız yönetim rollerine açılır — veli WebView üzerinden PayTR'ye ulaşamaz.
- **WebView yalnız yönetim rollerinde** (director/accountant/counselor/org_admin): spec §5.2'deki WebView-kalan ekranların tamamı yönetimsel. Öğrenci/veli/öğretmen v1'de WebView'e HİÇ girmez (günlük akışları native). Köprü (postMessage/injectedJavaScript mesajlaşması) Plan 4'te HİÇ kurulmaz — spec §5.3 "minimum köprü"nün en güvenli hali köprüsüzlük.
- **WebView tek-retry deseni:** her WebView açılışında TAZE session-exchange yapılır (kod 60sn tek kullanımlık zaten); `session-open` 403 dönerse (kod tüketilmiş/IP değişti) veya ana belge 401/403 alırsa BİR KEZ yeniden exchange edilir, ikinci hatada native hata ekranı + "Yeniden dene". Web SPA'sı oturumsuzken URL değiştirmeden login kartları gösterdiğinden "login sayfasına düştü" tespiti kırılgandır — taze-exchange + HTTP-hata yakalama bilinçli olarak yeterli sayıldı.
- **Push tap hedefi HER ZAMAN Bildirimler ekranı** (`/bildirimler?focus=<eventId>`): NotificationEvent tam içeriği taşır (jenerikleştirme yalnız push metnine uygulanır — `renderPush` sunucuda); kullanıcı dokunduğu bildirimin tam halini anında görür + otomatik okundu işaretlenir. Item'daki "İlgili ekranı aç" aksiyonu url eşlemesiyle ikincil yönlendirme yapar: yönetim → WebView(`url`), diğer roller → Bugün. Rol-başına derin native rota eşlemesi (ödev detayına in vb.) Plan 5+ (detay ekranları gelince).
- **Duyuru okundu durumu iki sistemde bağımsız** (v1 kabulü): web duyuru sekmesi `AnnouncementRecipient.read`, mobil inbox `NotificationEvent.readAt` kullanır — senkron edilmez. Web'de okunan duyuru mobil inbox'ta okunmamış görünebilir (ve tersi). Birleştirme Plan 5+ değerlendirmesi.
- **Spec §5.4 web-push kapatma: web değişikliği GEREKMEZ.** Web'in login-sonrası otomatik push izni `isPushSupported()` (lib/push-client.ts:20 — `PushManager`+`Notification` in window) arkasında; Android System WebView bu API'leri sunmadığından akış WebView'de zaten no-op. `html.is-mobile-app` CSS sınıfı da ancak cihazda gerçek bir görsel sorun gözlenirse eklenir (Task 11 WebView turunda gözlenir; UA'da `okulinapp/<sürüm>` şimdiden gönderilir — `applicationNameForUserAgent`).
- **Bekleyen-unregister bayrağı YİNE ERTELENDİ** (Plan 3 ADR takibi): çevrimdışı logout'ta token'lar silindiği için sonradan Bearer'lı unregister çağrısı İMKANSIZ; sunucu tarafı korumalar (dispatchDue sahiplik kontrolü + yeni login'de re-register + 60g oturum düşmesi) pencereyi zaten sınırlıyor. Değerlendirildi, maliyet/fayda ertelemeyi haklı çıkarıyor.
- **dispatchDue optimizasyonu DB-mock'suz doğrulanır:** repo'da Prisma mock deseni yok (bilinçli — canlı int testler esas). Mevcut int süitler dispatchDue'yu TETİKLEMEZ (İnceleme Codex #12 — duyuru testi anında-gönderim yolundan geçer); kanıt = reviewer satır-satır trace + Task 4'te canlı cron'un elle tetiklenip (`/api/cron/notif-dispatch`) sayaçlarının gözlenmesi (kod yolu prod'da patlamadan çalışıyor) + QStash'in 15 dk ritmindeki ilk gerçek koşuları. Yeni birim test eklenmez.
- **Rate limit içerik uçlarında yalnız sid kovası** (`mobileContentRatelimit` 240/10dk): IP kovası bilinçli YOK — okul NAT'ında sabah yoğunluğu (N öğrenci × açılış) meşru trafiği keserdi; kimliği doğrulanmış istemcide sid kovası yeterli (token'sız istek zaten withMobileAuth'ta 401).
- **Sekmeli navigasyon Plan 4'te** (Bugün · Bildirimler · Ayarlar): spec §5.1 "native tab/navigation". expo-router `(tabs)` grubu; giriş/kurum/WebView/QR ekranları Stack'te kalır. Rota href'leri değişmez (grup segmentleri URL'de görünmez).
- **Görsel cila temel seviyede:** temiz + marka renkli (Plan 3 çizgisi devam). "Enerjik görsel yön" teması ([[enerjik-gorsel-yon]] — koda uygulanmadı, mockup aşamasında) ayrı bir istişare/iş; bu planda UI bileşenleri ona hazır ama tema uygulanmaz.
- **Veli int testi creds yokluğunda atlanır:** `.env.local`'de OKULIN_PAR_USER/PASS yok; veli today akışı Task 11 cihaz turunda gerçek veli hesabıyla doğrulanır. (İstenirse creds eklenip test açılır — spec değişmez.)
- **`before` OPAK bileşik imleç** (inbox): `<createdAtISO>_<id>` — aynı milisaniyede birden çok event sayfa sınırına düşerse kayıt atlanmasın diye `(createdAt,id)` tie-breaker'lı (İnceleme Codex #4). İstemci imleci yorumlamaz, aynen geri gönderir. Sayfa 20 (max 50). Ayrıca `?id=<eventId>` tek-kayıt modu: eski sayfalarda kalmış bir push'a dokunulduğunda içerik yine gösterilebilsin (İnceleme Codex #8).

## Operasyon Ön Koşulları (Mustafa — ilgili task'a kadar)

1. **Telefon (SM-M205F, USB)**: Task 11'e kadar hazır olsun — yeni native modüller (webview/camera) için `npx expo run:android` rebuild + konsolide doğrulama turu.
2. **Sensitive-push testi için**: Task 11'de bir veli hesabıyla telefonda oturum açılacak (testkurs'ta parentPhone'u bilinen bir öğrenci velisi) — devamsızlık push'unun kilit ekranında JENERİK göründüğü doğrulanacak.

## Global Constraints

- Web tarafı: TypeScript strict; `tsconfig` `allowJs:false` anahtarı SİLİNMEZ; **yeni npm bağımlılığı YOK**; hata formatı `{ error }` + doğru status; Prisma route'larında `export const runtime = 'nodejs';`; kimlik `lib/id.ts` `newId()` (`Math.random` yasak); loglara/yanıtlara token-hash-PII yazılmaz.
- **Şema değişikliği YOK** (`prisma/schema.prisma`'ya dokunulmaz — `NotificationEvent.readAt` + gerekli index'ler Plan 1'den beri mevcut).
- Middleware'e dokunulmaz: yeni uçların hepsi Bearer-korumalı (withMobileAuth) → CSRF Bearer istisnasından otomatik geçer; `MOBILE_CSRF_EXEMPT`'e ekleme YAPILMAZ.
- Mobil tarafı: bağımlılıklar YALNIZ `npx expo install <paket>` ile (SDK-pinli sürüm); TS strict; push/refresh token'ları asla console'a yazılmaz; UI metinleri Türkçe, emoji yok; `mobile/src/api/types.ts` elle DÜZENLENMEZ (`npm run mobile:types` üretir).
- Commit: Türkçe, `feat(mobil):` / `fix:` / `test(mobil):` önekli; her task sonunda; web değişikliğinde `npm run build` + `npx vitest run` geçmeden commit YOK; mobil değişikliğinde `cd mobile && npx tsc --noEmit && npx vitest run` geçmeden commit YOK; `git add <dosya>` (asla `-A`).
- Deploy: backend Task 1-3 yalnız local commit; Task 4'te tek push + canlı doğrulama; sonrası push serbest (Vercel `mobile/`'ı build etmez).
- Canlı testler `.env.local`'deki `OKULIN_*` creds + testkurs'a karşı (`e2e/helpers` deseni); rate-limit bütçesi dosya başında hesaplanır (login 5/15dk!).

## Dosya Haritası

| Dosya | Sorumluluk |
|---|---|
| `lib/push/outbox.ts` (değişir) | dispatchDue: event toplu ön-yükleme (per-item findUnique kalkar) + sahiplik koşuluna branch |
| `lib/mobile/devices.ts` (değişir) | token karşılaştırması timingSafeEqual (sha256 üzerinden) |
| `lib/mobile/sessions.ts` (değişir) | `DeviceView` → `MobileDeviceRow` (api-types'taki wire `DeviceView` ile ad çakışması biter) |
| `lib/mobile/contracts.ts` (değişir) | `InboxReadSchema` |
| `lib/mobile/api-types.ts` (değişir) | Inbox + SessionExchange + Today tipleri (saf, import'suz) |
| `lib/mobile/limits.ts` (yeni) | `contentLimited(sid)` — içerik uçları ortak 429 helper'ı |
| `lib/ratelimit.ts` (değişir) | `mobileContentRatelimit` (240/10dk) |
| `app/api/mobile/v1/notifications/route.ts` (yeni) | GET sayfalı inbox + unreadCount · POST okundu (tek/all) |
| `lib/mobile/today.ts` (yeni) | trToday + pickPendingOdev + rol builder'ları (student/parent/teacher/management) |
| `lib/mobile/today.test.ts` (yeni) | trToday + pickPendingOdev + isPastDue birim testleri |
| `lib/slots.ts` (değişir) | `etutAktifThisWeek` export + `getDayCellsAllTeachers`/`getAllProgramTemplates` (tek-sorgu gün görünümü — Codex #6) |
| `app/api/etut-sablon/all/route.ts` (değişir) | local `aktifThisWeek` → `etutAktifThisWeek` import (davranış birebir) |
| `app/api/mobile/v1/screens/today/route.ts` (yeni) | Rol-aware Bugün aggregate ucu |
| `e2e/int-mobile-content.spec.js` (yeni) | Canlı: today (3 rol) + inbox akışı (duyuru→listele→oku→sayaç) + izolasyon |
| `mobile/src/api/http.ts` (yeni) | `fetchWithTimeout` (AbortController) + zaman aşımı sabitleri |
| `mobile/src/api/http.test.ts` (yeni) | timeout/abort birim testleri |
| `mobile/src/api/client.ts` (değişir) | tüm fetch'ler fetchWithTimeout'tan geçer |
| `mobile/src/ui/Gate.tsx` (değişir) | fetch timeout + AppState-active'te sessiz kill-switch yeniden kontrolü (60sn throttle) |
| `mobile/src/app/kurum.tsx` (değişir) | resolve-org ortak helper'a taşınır (`org.ts`) + QR girişi linki |
| `mobile/src/org.ts` (yeni) | `resolveOrgByCode` (fetch+allowlist) + `extractOrgCode` (QR/URL/düz kod) |
| `mobile/src/org.test.ts` (yeni) | extractOrgCode birim testleri |
| `mobile/src/push.ts` (değişir) | 409-rotate tek helper'a iner (`postRegister`) |
| `mobile/src/confirm.ts` (yeni) | `confirmLeaveOrg` ortak onay diyaloğu |
| `mobile/src/app/giris.tsx` (değişir) | "Kurum değiştir" onaylı |
| `mobile/src/app/ayarlar.tsx` → `mobile/src/app/(tabs)/ayarlar.tsx` (taşınır+değişir) | "Kurumdan ayrıl" onaylı |
| `mobile/src/app/(tabs)/_layout.tsx` (yeni) | Tabs: Bugün · Bildirimler · Ayarlar (+ unread badge) |
| `mobile/src/app/bugun.tsx` → `mobile/src/app/(tabs)/bugun.tsx` (taşınır+değişir) | Gerçek içerik: rol bileşenleri + push kartı korunur |
| `mobile/src/app/(tabs)/bildirimler.tsx` (yeni) | Inbox UI: sayfalama, yenile, tap→okundu, focus, "İlgili ekranı aç" |
| `mobile/src/store/badge.tsx` (yeni) | UnreadBadgeProvider (tab rozeti + ekranlar arası sayaç) |
| `mobile/src/ui/today.tsx` (yeni) | StudentTodayView / ParentTodayView / TeacherTodayView / ManagementTodayView |
| `mobile/src/notification-routing.ts` (yeni) | `focusPathFor` + `targetForUrl` saf yönlendirme fonksiyonları |
| `mobile/src/notification-routing.test.ts` (yeni) | yönlendirme birim testleri |
| `mobile/src/app/_layout.tsx` (değişir) | UnreadBadgeProvider + NotificationRouter (tap listener + soğuk açılış + bekleyen rota) |
| `mobile/src/app/web.tsx` (yeni) | Güvenli WebView (yalnız yönetim): exchange→open, tek-retry, allowlist, geri tuşu |
| `mobile/src/app/kurum-qr.tsx` (yeni) | QR tarama (expo-camera) → extractOrgCode → resolveOrgByCode |
| `mobile/src/rol.ts` (değişir) | `roleCategoryOf` (management tespiti) |
| `mobile/app.json` (değişir) | expo-camera plugin (izin metinleri) |
| `mobile/package.json` (değişir) | react-native-webview, expo-camera, @expo/vector-icons (expo install) |

---

### Task 1: Backend Plan-3 borçları — dispatchDue event toplu ön-yükleme + timingSafeEqual + tip adı ayrışması

Üç bağımsız küçük borç, tek task: (a) `dispatchDue` döngüsü teslimat başına event `findUnique` atıyor (Plan 3 Minor #2'nin asıl borcu) — event'ler TEK `IN` sorgusuyla toplu çekilir; **sahiplik kontrolü İSE per-item ve gönderimden hemen önce KALIR** (İnceleme Codex #2: toplu ön-yükleme sahiplikte TOCTOU penceresini saniyelere büyütürdü — token devri sırasında eski kullanıcının bildirimi yeni sahibe gidebilirdi) ve sahiplik koşuluna `branch` eklenir (İnceleme Codex #1: aynı kurumun iki şubesinde aynı legacyId olabilir — mevcut kodda da eksikti, bilinçli sıkılaştırma). (b) `devices.ts` token karşılaştırması `!==` — timingSafeEqual'a geçer (Plan 3 Minor #4). (c) `lib/mobile/sessions.ts`'teki `DeviceView` (Date alanlı iç tip) api-types'taki wire `DeviceView` (string alanlı) ile aynı adı taşıyor — iç tip `MobileDeviceRow` olur (Plan 3 Minor #3).

**Files:**
- Modify: `lib/push/outbox.ts:152-206` (dispatchDue)
- Modify: `lib/mobile/devices.ts` (import + sahiplik kontrolü satırı)
- Modify: `lib/mobile/sessions.ts:143-165` (tip adı)

**Interfaces:**
- Consumes: mevcut `deliverOne`, `renderPush`, Prisma modelleri.
- Produces: dışa dönük imza DEĞİŞMEZ (`dispatchDue(limit): Promise<{processed,sent,retried,dead}>`; `registerDevice` outcome'ları aynı; `listMobileDevices` dönüşü aynı — yalnız tip ADI değişir).

**Not (TDD istisnası, ADR):** dispatchDue DB katmanı — repo'da Prisma mock deseni yok; kanıt = davranış-koruma trace + Task 4 canlı süitler. `devices.ts`/`sessions.ts` değişiklikleri davranışsal olarak görünmez (timing + ad).

- [ ] **Step 1: dispatchDue — event toplu ön-yükleme + sahiplikte branch**

`lib/push/outbox.ts` içinde `dispatchDue` fonksiyonunun TAMAMINI şu implementasyonla değiştir (dosyadaki diğer her şey aynı kalır):

```typescript
// Cron retry: vadesi gelmiş pending teslimatları global tarar (tüm kurumlar —
// kasıtlı base prisma, bkz. cron/cleanup kalıbı; hedef token satırda gömülü,
// tenant bağlamı gerekmez). Event'in push metnini yeniden üretir.
export async function dispatchDue(limit = 200): Promise<{ processed: number; sent: number; retried: number; dead: number }> {
  const due = await prisma.notificationDelivery.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
  if (due.length === 0) return { processed: 0, sent: 0, retried: 0, dead: 0 };

  // Event toplu ön-yükleme (Plan 3 Minor #2): eski döngü teslimat başına event
  // findUnique atıyordu — tek IN sorgusuna iner (event immutable, ön-yükleme risksiz).
  // SAHİPLİK kontrolü İSE bilinçli olarak per-item ve gönderimden HEMEN ÖNCE kalır
  // (İnceleme Codex #2): sahipliği batch başında okumak, token devri sırasında eski
  // kullanıcının bildirimini yeni sahibe gönderebilecek saniyeler mertebesinde bir
  // TOCTOU penceresi açardı (KVKK). N teslimat = 2N+1 sorgu (3N+'dan iner).
  const events = await prisma.notificationEvent.findMany({
    where: { id: { in: [...new Set(due.map((d) => d.eventId))] } },
  });
  const evById = new Map(events.map((e) => [e.id, e]));

  let sent = 0, retried = 0, dead = 0;
  for (const d of due) {
    const ev = evById.get(d.eventId);
    if (!ev) { // event silinmiş (retention) → teslimatı kapat
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'dead', lastError: 'event yok' } });
      dead++;
      continue;
    }

    // Sahiplik kontrolü (İnceleme Codex #2 — KVKK): teslimat kuyruğa girdikten sonra
    // hedef cihaz logout / hesap silme / token devri ile el değiştirmiş olabilir.
    // NotificationDelivery.target denormalize — körlemesine gönderilirse ESKİ
    // kullanıcının bildirimi cihazın YENİ sahibine gider. Gönderimden hemen önce
    // hedefin hâlâ event'in kullanıcısına bağlı olduğunu doğrula; değilse teslimatı
    // kapat (anında gönderim yolu bu kontrolden muaf — fan-out aynı istekte taze).
    // branch koşulu YENİ (İnceleme Codex #1): aynı kurumun iki şubesinde aynı
    // legacyId olabilir — şube de eşleşmeli (mevcut kodda eksikti, bilinçli sıkılaştırma).
    const stillOwned = d.provider === 'webpush'
      ? await prisma.pushSub.findFirst({
          where: { endpoint: d.target, orgSlug: ev.orgSlug, branch: ev.branch, role: ev.role, userId: ev.userId },
          select: { id: true },
        })
      : await prisma.deviceInstallation.findFirst({
          where: { provider: d.provider, token: d.target, enabled: true, orgSlug: ev.orgSlug, branch: ev.branch, role: ev.role, userId: ev.userId },
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
    if (status === 'sent') sent++;
    else if (status === 'dead') dead++;
    else retried++;
  }
  return { processed: due.length, sent, retried, dead };
}
```

Davranış-koruma kontrol listesi (uygulayan + reviewer):
- Sahiplik `findFirst` koşulları eskisiyle aynı + YALNIZ `branch: ev.branch` eklendi (belgeli sıkılaştırma, Codex #1).
- Sonuç sayaçları (sent/retried/dead) ve `lastError` metinleri değişmedi.
- `deliverOne` çağrı payload'ı değişmedi; tek yapısal fark event'lerin Map'ten okunması.

- [ ] **Step 2: devices.ts timingSafeEqual**

`lib/mobile/devices.ts` dosyasının başına import ekle:

```typescript
import { createHash, timingSafeEqual } from 'crypto';
```

`registerDevice` içindeki sahiplik sınırı bloğunun ÜSTÜNE helper ekle ve karşılaştırma satırını değiştir. Mevcut:

```typescript
  const existing = await prisma.deviceInstallation.findUnique({ where: { id: input.installationId } });
  const sameOwner = existing != null && existing.role === role && existing.userId === userId && existing.orgSlug === org;
  if (existing && !sameOwner && existing.token !== input.token) return 'conflict';
```

Yeni:

```typescript
  // Token karşılaştırması sabit-zamanlı (Plan 3 Minor #4): token cihaz-yerel sır —
  // uzunluk farkını da gizlemek için sha256 özetleri karşılaştırılır.
  const tokenMatches = (a: string, b: string) =>
    timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

  const existing = await prisma.deviceInstallation.findUnique({ where: { id: input.installationId } });
  const sameOwner = existing != null && existing.role === role && existing.userId === userId && existing.orgSlug === org;
  if (existing && !sameOwner && !tokenMatches(existing.token, input.token)) return 'conflict';
```

- [ ] **Step 3: sessions.ts tip adı**

`lib/mobile/sessions.ts` içinde `export interface DeviceView {` → `export interface MobileDeviceRow {` ve `listMobileDevices(...): Promise<DeviceView[]>` → `Promise<MobileDeviceRow[]>`. Üstüne bir satır yorum:

```typescript
// İç satır tipi (Date alanlı) — wire tipi api-types.ts'teki DeviceView (string alanlı,
// JSON.stringify Date→ISO çevirir). Ad ayrımı Plan 3 Minor #3.
```

Başka dosya bu tipi import ETMİYOR (devices route yalnız fonksiyonları import eder) — `grep -rn "DeviceView" lib/ app/api/` ile doğrula: yalnız `api-types.ts` (wire) + `sessions.ts` (yeni ad) kalmalı.

- [ ] **Step 4: Test + build**

Çalıştır: `npx vitest run && npm run build`
Beklenen: tüm birim testler PASS (davranış değişikliği yok), build başarılı.

- [ ] **Step 5: Commit (local — push Task 4'te)**

```bash
git add lib/push/outbox.ts lib/mobile/devices.ts lib/mobile/sessions.ts
git commit -m "fix: Plan-3 borçları — dispatchDue toplu ön-yükleme (3N+→sabit sorgu), cihaz token timingSafeEqual, MobileDeviceRow ad ayrımı"
```

---

### Task 2: Bildirim merkezi API — inbox list + okundu + unreadCount

`NotificationEvent` üzerinde ilk OKUMA yüzeyi (spec §8 inbox): `GET /api/mobile/v1/notifications` (sayfalı liste + unreadCount) ve `POST /api/mobile/v1/notifications` (okundu işaretleme — tek event veya tümü). `readAt` alanı ilk kez yazılır. Middleware değişikliği GEREKMEZ (Bearer istisnası otomatik). NotificationEvent normal tenant tablosu → `tdb()` orgSlug/branch otomatik enjekte eder; `role`+`userId` koşulu IDOR sınırıdır.

**Files:**
- Modify: `lib/mobile/contracts.ts` (dosya sonuna `InboxReadSchema`)
- Modify: `lib/mobile/api-types.ts` (dosya sonuna inbox + exchange tipleri)
- Modify: `lib/ratelimit.ts` (son limiter'ın altına `mobileContentRatelimit`)
- Create: `lib/mobile/limits.ts`
- Create: `app/api/mobile/v1/notifications/route.ts`

**Interfaces:**
- Consumes: `withMobileAuth` (session: `sid, role, id`), `tdb()`, `parseBody`, `safeLimit/formatResetWait`.
- Produces (Task 3/4/6/8/9 kullanır): `contentLimited(sid: string): Promise<NextResponse | null>` · `InboxReadSchema` · api-types: `InboxItem { id,title,body,url,createdAt,read }`, `InboxListResponse { items, nextBefore, unreadCount }`, `InboxReadRequest { eventId?, all? }`, `InboxReadResponse { ok, updated, unreadCount }`, `SessionExchangeResponse { code, expiresIn }`.
- Uç sözleşmesi: `GET /api/mobile/v1/notifications?before=<opak-imleç>&limit=<1-50>` → `InboxListResponse` · `GET ?id=<eventId>` → tek kayıt (`items:[item]`, sahiplik dışı 404) · `POST /api/mobile/v1/notifications` gövde `InboxReadRequest` → `InboxReadResponse` (bilinmeyen eventId → 404).

**Not (TDD istisnası):** route DB katmanı — kanıt Task 4 canlı sözleşme testleri (liste şekli, sayfalama, okundu, izolasyon, 404).

- [ ] **Step 1: contracts.ts'e şema ekle**

`lib/mobile/contracts.ts` sonuna:

```typescript
// Inbox okundu işaretleme: tek event VEYA tümü (yalnız biri).
export const InboxReadSchema = z
  .object({
    eventId: z.string().min(1).max(64).optional(),
    all: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.eventId) !== Boolean(d.all), { message: 'eventId veya all (yalnız biri) gerekli' });
```

- [ ] **Step 2: api-types.ts'e tipleri ekle**

`lib/mobile/api-types.ts` sonuna (`OkResponse`'un altına — dosya import İÇERMEZ kuralı sürer):

```typescript
// ── Bildirim merkezi (inbox — spec §8) ──────────────────────────────────────
// NotificationEvent tam içeriği taşır: push metni jenerikleşse bile (sensitive)
// inbox gerçek title/body gösterir (jenerikleştirme yalnız push'a uygulanır).
export interface InboxItem {
  id: string; // NotificationEvent.id (ne_ önekli) — push data.eventId ile eşleşir
  title: string;
  body: string;
  url: string | null; // web path'i (/?tab=odev vb.) — yönlendirme eşlemesi istemcide
  createdAt: string; // ISO
  read: boolean;
}
export interface InboxListResponse {
  items: InboxItem[];
  nextBefore: string | null; // OPAK sayfalama imleci — aynen geri gönderilir; null = son sayfa
  unreadCount: number;
}
export interface InboxReadRequest {
  eventId?: string;
  all?: boolean;
}
export interface InboxReadResponse {
  ok: true;
  updated: number;
  unreadCount: number;
}

// ── WebView oturum aktarımı (spec §7 — uç Plan 2'den beri canlı, tip şimdi paylaşılıyor) ──
export interface SessionExchangeResponse {
  code: string; // tek kullanımlık, 60 sn, IP-bağlı
  expiresIn: number;
}
```

- [ ] **Step 3: ratelimit.ts'e limiter ekle**

`lib/ratelimit.ts` içinde son limiter tanımının altına:

```typescript
// Mobil içerik uçları (screens/today, notifications): 240 istek / 10 dk — yalnız
// oturum (sid) kovası. IP kovası bilinçli YOK: okul NAT'ında sabah yoğunluğu meşru
// trafiği keserdi; token'sız istek zaten withMobileAuth'ta 401 yer (plan ADR'si).
export const mobileContentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(240, '10 m'),
  analytics: false,
  prefix: 'rl:mcnt',
});
```

- [ ] **Step 4: limits.ts helper'ını yaz**

`lib/mobile/limits.ts` (yeni — TAMAMI):

```typescript
import { NextResponse } from 'next/server';
import { mobileContentRatelimit, formatResetWait, safeLimit } from '@/lib/ratelimit';

// İçerik uçları ortak rate-limit yanıtı (notifications + screens/today).
// null = devam; NextResponse = 429 döndür.
export async function contentLimited(sid: string): Promise<NextResponse | null> {
  const hit = await safeLimit(mobileContentRatelimit, `sid:${sid}`);
  if (hit.success) return null;
  return NextResponse.json(
    { error: `Çok fazla istek. Lütfen ${formatResetWait(hit.reset)} tekrar deneyin.` },
    { status: 429 },
  );
}
```

- [ ] **Step 5: notifications route'unu yaz**

`app/api/mobile/v1/notifications/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { tdb } from '@/lib/sqldb';
import { parseBody } from '@/lib/validate';
import { InboxReadSchema } from '@/lib/mobile/contracts';
import { contentLimited } from '@/lib/mobile/limits';

// Bildirim merkezi (spec §8 inbox): NotificationEvent kullanıcının kalıcı bildirim
// kaydı. GET: sayfalı liste + unreadCount. POST: okundu (tek/all). Kilit ekranı
// jenerikleştirmesi yalnız push metnine uygulanır (renderPush) — inbox tam içerik.
// NotificationEvent normal tenant tablosu → tdb() orgSlug/branch otomatik enjekte
// eder; role+userId koşulu IDOR sınırı (kullanıcı yalnız kendi kutusunu görür).
export const runtime = 'nodejs';

// Opak bileşik imleç "<createdAtISO>_<id>" (İnceleme Codex #4: yalnız createdAt
// aynı milisaniyedeki kayıtları sayfa sınırında atlardı). İstemci yorumlamaz.
function parseCursor(raw: string): { at: Date; id: string } | null {
  const sep = raw.indexOf('_');
  if (sep <= 0) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

const itemOut = (e: { id: string; title: string; body: string; url: string | null; createdAt: Date; readAt: Date | null }) => ({
  id: e.id,
  title: e.title,
  body: e.body,
  url: e.url,
  createdAt: e.createdAt.toISOString(),
  read: e.readAt != null,
});

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const userId = String(session.id ?? '');
  const unreadWhere = { role: session.role, userId, readAt: null };

  // Tek-kayıt modu (İnceleme Codex #8): push tap'i eski sayfada kalmış bir event'i
  // işaret edebilir — içerik yine gösterilebilsin. Sahiplik koşulu aynı (IDOR yok).
  const idParam = searchParams.get('id');
  if (idParam) {
    const [e, unreadCount] = await Promise.all([
      tdb().notificationEvent.findFirst({ where: { id: idParam, role: session.role, userId } }),
      tdb().notificationEvent.count({ where: unreadWhere }),
    ]);
    if (!e) return NextResponse.json({ error: 'Bildirim bulunamadı' }, { status: 404 });
    return NextResponse.json({ items: [itemOut(e)], nextBefore: null, unreadCount });
  }

  const beforeRaw = searchParams.get('before');
  const before = beforeRaw ? parseCursor(beforeRaw) : null;
  if (beforeRaw && !before) {
    return NextResponse.json({ error: 'before geçersiz' }, { status: 400 });
  }
  const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
  const take = Math.min(Math.max(Number.isNaN(limitRaw) ? 20 : limitRaw, 1), 50);

  const [rows, unreadCount] = await Promise.all([
    tdb().notificationEvent.findMany({
      where: {
        role: session.role,
        userId,
        ...(before
          ? { OR: [{ createdAt: { lt: before.at } }, { createdAt: before.at, id: { lt: before.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1, // bir fazlası: sonraki sayfa var mı
    }),
    tdb().notificationEvent.count({ where: unreadWhere }),
  ]);
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  const nextBefore = rows.length > take && last ? `${last.createdAt.toISOString()}_${last.id}` : null;
  return NextResponse.json({ items: page.map(itemOut), nextBefore, unreadCount });
});

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const parsed = await parseBody(req, InboxReadSchema);
  if (!parsed.ok) return parsed.response;
  const userId = String(session.id ?? '');

  // refine tam-bir-tanesi'ni garantiler; all değilse eventId kesin var (! güvenli —
  // devices route'un parsed.data.sessionId! deseniyle aynı).
  const where = parsed.data.all
    ? { role: session.role, userId, readAt: null }
    : { id: parsed.data.eventId!, role: session.role, userId, readAt: null };
  const r = await tdb().notificationEvent.updateMany({ where, data: { readAt: new Date() } });

  if (!parsed.data.all && r.count === 0) {
    // Ayrım: zaten-okunmuş (idempotent tekrar → ok) vs hiç yok/başkasının (404).
    const exists = await tdb().notificationEvent.findFirst({
      where: { id: parsed.data.eventId!, role: session.role, userId },
      select: { id: true },
    });
    if (!exists) return NextResponse.json({ error: 'Bildirim bulunamadı' }, { status: 404 });
  }

  const unreadCount = await tdb().notificationEvent.count({ where: { role: session.role, userId, readAt: null } });
  return NextResponse.json({ ok: true, updated: r.count, unreadCount });
});
```

- [ ] **Step 6: Tip senkronu + test + build**

Çalıştır: `npm run mobile:types && npx vitest run && npm run build`
Beklenen: `mobile/src/api/types.ts` güncellendi, drift testi dahil tüm testler PASS, build başarılı.

- [ ] **Step 7: Commit (local)**

```bash
git add lib/mobile/contracts.ts lib/mobile/api-types.ts lib/ratelimit.ts lib/mobile/limits.ts app/api/mobile/v1/notifications/route.ts mobile/src/api/types.ts
git commit -m "feat(mobil): bildirim merkezi API — NotificationEvent inbox list/okundu/unreadCount + içerik rate limit"
```

---

### Task 3: Bugün API — rol-aware `GET /screens/today`

Rol-bazlı Bugün aggregate ucu (spec §5.1 + §9/1): mevcut servis katmanını (`lib/slots`, `lib/odev`, `lib/davranis`, `lib/deneme/store`, finance sorgusu) çağırır, YENİ veri modeli yok. Gün/hafta TR saatine göre hesaplanır (`trToday` — saf, birim testli). Modül kapalıysa ilgili alan `null` döner (istemci kartı gizler); veri minimizasyonu: her rol yalnız kendi görebileceği alanları alır (öğrenci kendi, veli `children` içindeki çocuk, öğretmen kendi programı).

**Files:**
- Modify: `lib/slots.ts` (`etutAktifThisWeek` export — etut-sablon/all'daki local kopya taşınır)
- Modify: `app/api/etut-sablon/all/route.ts` (local `aktifThisWeek` silinir, import'a geçer)
- Create: `lib/mobile/today.ts`
- Create: `lib/mobile/today.test.ts`
- Modify: `lib/mobile/api-types.ts` (Today tipleri)
- Create: `app/api/mobile/v1/screens/today/route.ts`

**Interfaces:**
- Consumes: `getTeacherWeekSlots/getProgramTemplate/getDaySlotTimes` + `EtutSablonu` (lib/slots), `ALL_DAYS/daySlots` (lib/constants), `getOrgConfig('modules')`, `listOdevForStudent(cls, id)/listOdevForParent(children)`, `getStudentBehavior(id)`, `buildStudentPoints(id)`, `canReadStudent` YERİNE children-liste kontrolü (aşağıda), `contentLimited` (Task 2), `HttpError`.
- Produces (Task 4/8 kullanır): `trToday(now?): { date, dayIndex, dayLabel, weekKey }` · `pickPendingOdev(list, today, max?)` · `isPastDue(dueDate, today)` · `buildStudentToday(session, unread)` / `buildParentToday(session, unread, childId)` / `buildTeacherToday(session, unread)` / `buildManagementToday(session, unread)` · lib/slots: `getDayCellsAllTeachers(weekKey, dayIndex)` / `getAllProgramTemplates()` / `etutAktifThisWeek(sb, weekKey)` · api-types: `TodayResponse` (aşağıdaki union) · Uç: `GET /api/mobile/v1/screens/today[?child=<studentId>]` → `TodayResponse`.

- [ ] **Step 1: api-types.ts'e Today tiplerini ekle**

`lib/mobile/api-types.ts` sonuna:

```typescript
// ── Bugün ekranı (screens/today — spec §5.1/§9-1) ───────────────────────────
// Modül kapalıysa ilgili alan null (istemci kartı gizler). date/dayIndex TR günü.
export interface TodayLesson {
  slotId: string;
  slotLabel: string; // "09:45–10:20"
  teacherId: string;
  teacherName: string;
  branch: string;
  subBranch: string;
}
export interface TodayEtut {
  id: string;
  start: string; // "16:30"
  end: string;
  teacherName: string;
  branch: string | null;
  studentName: string | null; // öğretmen görünümünde dolu; öğrenci/veli kendi rezervasyonu
  booked: boolean;
}
export interface TodayOdevItem {
  id: string;
  title: string;
  branch: string;
  dueDate: string; // 'YYYY-MM-DD' veya '' (vadesiz)
  submitted: boolean;
  overdue: boolean; // vadesi geçmiş ve hâlâ teslim edilmemiş (UI kırmızı vurgular)
}
export interface TodayCommon {
  date: string; // YYYY-MM-DD (TR)
  dayLabel: string; // "Cuma"
  weekKey: string; // "2026-W29"
  unreadNotifications: number;
}
export interface StudentToday extends TodayCommon {
  role: 'student';
  lessons: TodayLesson[];
  etuts: TodayEtut[] | null; // etut modülü kapalıysa null
  odev: { pending: number; items: TodayOdevItem[] } | null;
  davranis: { total: number } | null;
  deneme: { name: string; dateLabel: string; toplamNet: number; rank: number; total: number } | null;
}
export interface ParentChildView {
  id: string;
  name: string;
  cls: string;
}
export interface ParentToday extends TodayCommon {
  role: 'parent';
  children: ParentChildView[];
  child: {
    id: string;
    name: string;
    cls: string;
    lessons: TodayLesson[];
    etuts: TodayEtut[] | null;
    odev: { pending: number; items: TodayOdevItem[] } | null;
    finance: {
      netFee: number;
      balance: number;
      nextInstallment: { idx: number; dueDate: string; amount: number } | null;
      overdueCount: number;
    } | null; // finance modülü kapalı veya kayıt yoksa null
  } | null; // çocuk kaydı yoksa null
}
export interface TeacherSlotView {
  slotId: string;
  slotLabel: string;
  type: 'ders' | 'etut';
  cls: string | null; // ders: sınıf; etüt: öğrenci sınıfı
  studentName: string | null; // slot-etüt: öğrenci adı
  branch: string;
}
export interface TeacherToday extends TodayCommon {
  role: 'teacher';
  lessons: TeacherSlotView[]; // bugünün grid'i (ders + dolu slot-etüt), saat sıralı
  etuts: TodayEtut[] | null; // bugünkü serbest etüt şablonları (doluluk görünümü)
}
export interface ManagementToday extends TodayCommon {
  role: 'management'; // director/accountant/counselor/org_admin — native içerik 2. dalga (WebView girişi)
}
export type TodayResponse = StudentToday | ParentToday | TeacherToday | ManagementToday;
```

- [ ] **Step 2: lib/slots.ts — etutAktifThisWeek + tek-sorgu gün yardımcıları**

`lib/slots.ts` içinde `EtutSablonu` interface tanımının ALTINA ekle:

```typescript
// Bir serbest etüt şablonu verilen haftada efektif aktif mi?
// (kalıcı aktif + bu hafta pasif listesinde değil). etut-sablon/all + mobil today ortak.
export function etutAktifThisWeek(sb: EtutSablonu, weekKey: string): boolean {
  if (sb.aktif === false) return false;
  if (Array.isArray(sb.pasifHaftalar) && sb.pasifHaftalar.includes(weekKey)) return false;
  return true;
}
```

`app/api/etut-sablon/all/route.ts`'te: local `aktifThisWeek` fonksiyonunu SİL, import satırını genişlet (`import { getAllTeachers, getProgramTemplate, etutAktifThisWeek, type EtutSablonu } from '@/lib/slots';`), çağrıyı `etutAktifThisWeek(sb, weekKey)` yap. Davranış birebir.

Ardından `lib/slots.ts` içinde `getAllTeachers` fonksiyonunun ALTINA iki toplu yardımcı ekle (İnceleme Codex #6: öğretmen başına `getTeacherWeekSlots`+`getProgramTemplate` çağrısı N-öğretmen kurumda isteği 4N seri sorguya çıkarıp mobil 15 sn timeout'unu zorlardı):

```typescript
// Bir günün TÜM öğretmen hücreleri TEK sorguda (mobil "Bugün" ekranı). Öğretmen
// başına getTeacherWeekSlots çağırmak yerine: 1 teacher + 1 slotBooking sorgusu.
export interface DayCellRow {
  teacherLegacyId: string;
  teacherName: string;
  slotId: string;
  cell: SlotCell;
}
export async function getDayCellsAllTeachers(weekKey: string, dayIndex: number): Promise<DayCellRow[]> {
  const teachers = await tdb().teacher.findMany({ select: { id: true, legacyId: true, name: true } });
  const byDbId = new Map(teachers.map((t) => [t.id, t]));
  const rows = await tdb().slotBooking.findMany({ where: { weekKey, dayIndex } });
  const out: DayCellRow[] = [];
  for (const row of rows) {
    const t = byDbId.get(row.teacherId);
    if (!t) continue;
    out.push({ teacherLegacyId: t.legacyId, teacherName: t.name, slotId: row.slotId, cell: cellFromRow(row) });
  }
  return out;
}

// Tüm öğretmenlerin program şablonları TEK sorguda (etüt şablonu taraması için).
export interface TeacherTemplateRow {
  legacyId: string;
  name: string;
  template: Record<string, unknown>;
}
export async function getAllProgramTemplates(): Promise<TeacherTemplateRow[]> {
  const rows = await tdb().teacher.findMany({ select: { legacyId: true, name: true, programTemplate: true } });
  return rows.map((r) => ({ legacyId: r.legacyId, name: r.name, template: (r.programTemplate || {}) as Record<string, unknown> }));
}
```

- [ ] **Step 3: Başarısız birim testleri yaz**

`lib/mobile/today.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { trToday, pickPendingOdev, isPastDue } from './today';

describe('trToday — TR (UTC+3) gün/hafta hesabı', () => {
  it('normal gün: 17 Tem 2026 Cuma', () => {
    const t = trToday(new Date('2026-07-17T10:00:00Z'));
    expect(t).toEqual({ date: '2026-07-17', dayIndex: 4, dayLabel: 'Cuma', weekKey: '2026-W29' });
  });
  it('UTC gece yarısı öncesi ama TR ertesi gün (kritik kayma penceresi)', () => {
    const t = trToday(new Date('2026-07-16T22:30:00Z')); // TR 17 Tem 01:30
    expect(t.date).toBe('2026-07-17');
    expect(t.dayIndex).toBe(4);
  });
  it('TR pazar 23:59 → hâlâ pazar/W29', () => {
    const t = trToday(new Date('2026-07-19T20:59:00Z'));
    expect(t).toMatchObject({ date: '2026-07-19', dayIndex: 6, weekKey: '2026-W29' });
  });
  it('TR pazartesi 00:00 → yeni gün + yeni hafta', () => {
    const t = trToday(new Date('2026-07-19T21:00:00Z'));
    expect(t).toMatchObject({ date: '2026-07-20', dayIndex: 0, weekKey: '2026-W30' });
  });
  it('ISO yıl başı: 1 Oca 2026 Perşembe → W01', () => {
    const t = trToday(new Date('2026-01-01T00:00:00Z')); // TR 03:00
    expect(t).toMatchObject({ date: '2026-01-01', dayIndex: 3, weekKey: '2026-W01' });
  });
});

describe('pickPendingOdev', () => {
  const mk = (id: string, dueDate: string, sub: unknown = null) => ({ id, title: `Ödev ${id}`, branch: 'Matematik', dueDate, sub });
  it('teslim edilmemiş HER ödev bekler — vadesi geçmiş dahil (overdue işaretli); yalnız teslimli elenir', () => {
    const r = pickPendingOdev(
      [mk('a', '2026-07-20'), mk('b', '2026-07-10'), mk('c', '2026-07-18', { status: 'teslim' }), mk('d', '')],
      '2026-07-17',
    );
    expect(r.pending).toBe(3); // a (ileride) + b (GEÇMİŞ ama teslim edilmemiş) + d (vadesiz)
    expect(r.items.map((i) => i.id)).toEqual(['b', 'a', 'd']); // vade artan: geçmiş önce, vadesiz sonda
    expect(r.items.map((i) => i.overdue)).toEqual([true, false, false]);
  });
  it('vade artan sıralar ve max ile kırpar (pending sayısı kırpılmaz)', () => {
    const r = pickPendingOdev([mk('a', '2026-07-30'), mk('b', '2026-07-18'), mk('c', '2026-07-20'), mk('d', '2026-07-19')], '2026-07-17', 2);
    expect(r.items.map((i) => i.id)).toEqual(['b', 'd']);
    expect(r.pending).toBe(4);
  });
  it('bugün vadeli ödev beklemede ve overdue DEĞİL', () => {
    const r = pickPendingOdev([mk('a', '2026-07-17')], '2026-07-17');
    expect(r.pending).toBe(1);
    expect(r.items[0].overdue).toBe(false);
  });
});

describe('isPastDue', () => {
  it('YYYY-MM-DD: dün geçmiş, bugün/yarın değil', () => {
    expect(isPastDue('2026-07-16', '2026-07-17')).toBe(true);
    expect(isPastDue('2026-07-17', '2026-07-17')).toBe(false);
    expect(isPastDue('2026-07-18', '2026-07-17')).toBe(false);
  });
  it('boş/biçimsiz vade asla geçmiş sayılmaz', () => {
    expect(isPastDue('', '2026-07-17')).toBe(false);
    expect(isPastDue(null, '2026-07-17')).toBe(false);
    expect(isPastDue('17.07.2026', '2026-07-17')).toBe(false);
  });
});
```

- [ ] **Step 4: Testlerin başarısız olduğunu doğrula**

Çalıştır: `npx vitest run lib/mobile/today.test.ts`
Beklenen: FAIL — `./today` modülü yok.

- [ ] **Step 5: lib/mobile/today.ts'i yaz**

`lib/mobile/today.ts` (yeni — TAMAMI):

```typescript
import { tdb } from '@/lib/sqldb';
import { ALL_DAYS, daySlots } from '@/lib/constants';
import {
  getTeacherWeekSlots, getProgramTemplate, getDaySlotTimes,
  getDayCellsAllTeachers, getAllProgramTemplates,
  etutAktifThisWeek, type EtutSablonu,
} from '@/lib/slots';
import { getOrgConfig } from '@/lib/config';
import { listOdevForStudent, listOdevForParent } from '@/lib/odev';
import { getStudentBehavior } from '@/lib/davranis';
import { buildStudentPoints } from '@/lib/deneme/store';
import { HttpError } from '@/lib/errors';
import type { PaymentEntry } from '@/lib/finance';
import type { Session } from '@/lib/auth';
import type {
  StudentToday, ParentToday, TeacherToday, ManagementToday,
  TodayLesson, TodayEtut, TodayOdevItem, TeacherSlotView, ParentChildView, TodayCommon,
} from './api-types';

// "Bugün" ekranı servis katmanı (spec §5.1/§9-1): mevcut lib servislerini rol-aware
// birleştirir, YENİ veri modeli yok. Tüm sorgular tdb() ile tenant-scoped; rol sınırı
// çağıran route'ta withMobileAuth claim'lerinden gelir (öğrenci kendi cls/id'si,
// veli yalnız payload children'ı, öğretmen kendi programı).

export interface TrToday {
  date: string; // YYYY-MM-DD
  dayIndex: number; // 0=Pazartesi … 6=Pazar
  dayLabel: string;
  weekKey: string; // "2026-W29"
}

// TR günü/haftası — sunucu TZ'inden bağımsız (Vercel=UTC, dev=TR fark etmez):
// TR = UTC+3 SABİT (DST yok) → şimdiye 3 saat ekle, UTC bileşenleriyle oku.
// getWeekKey (lib/constants) yerel saat kullanır; TR 00:00-03:00 penceresinde
// "bugün" bir gün geri kayardı — bu yüzden ISO hafta burada UTC ile yeniden hesaplanır.
export function trToday(now: Date = new Date()): TrToday {
  const tr = new Date(now.getTime() + 3 * 3600 * 1000);
  const y = tr.getUTCFullYear();
  const m = tr.getUTCMonth();
  const d = tr.getUTCDate();
  const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dayIndex = (tr.getUTCDay() + 6) % 7;
  const iso = new Date(Date.UTC(y, m, d));
  iso.setUTCDate(iso.getUTCDate() + 4 - (iso.getUTCDay() || 7));
  const yearStart = Date.UTC(iso.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((iso.getTime() - yearStart) / 86400000 + 1) / 7);
  return {
    date,
    dayIndex,
    dayLabel: ALL_DAYS[dayIndex]?.label ?? '',
    weekKey: `${iso.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
  };
}

// 'YYYY-MM-DD' biçimli vade bugünden önce mi (string karşılaştırma; biçim dışı false —
// taksit vadesi date-input'tan gelir, yine de savunmacı).
export function isPastDue(dueDate: string | null | undefined, today: string): boolean {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) return false;
  return dueDate.slice(0, 10) < today;
}

export interface OdevListRow {
  id: string;
  title: string;
  branch: string;
  dueDate: string;
  sub: unknown;
}

// Ödev listesinden bekleyenleri seç: teslim edilmemiş HER ödev bekler — vadesi
// geçmiş olan da (İnceleme Codex #5: geçmişi elemek "bekleyen ödev yok" yanılgısı
// üretirdi; overdue işaretlenir, UI kırmızı vurgular). items: vade artan (geçmişler
// doğal olarak önce, vadesizler sonda), max ile kırpılır; pending toplam sayıdır.
export function pickPendingOdev(list: OdevListRow[], today: string, max = 3): { pending: number; items: TodayOdevItem[] } {
  const pending = list.filter((o) => !o.sub);
  const sorted = [...pending].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  return {
    pending: pending.length,
    items: sorted.slice(0, max).map((o) => ({
      id: o.id,
      title: o.title,
      branch: o.branch,
      dueDate: o.dueDate,
      submitted: false,
      overdue: isPastDue(o.dueDate, today),
    })),
  };
}

function common(t: TrToday, unread: number): TodayCommon {
  return { date: t.date, dayLabel: t.dayLabel, weekKey: t.weekKey, unreadNotifications: unread };
}

// Bir sınıfın BUGÜNKÜ dersleri + (istenirse) bir öğrencinin bugünkü etüt rezervasyonları.
// class-schedule route'unun gün-filtreli paritesi — ama öğretmen-başına sorgu YOK
// (İnceleme Codex #6): tüm hücreler getDayCellsAllTeachers (1 teacher + 1 slotBooking),
// etüt şablonları getAllProgramTemplates (1 sorgu). Toplam sabit sorgu sayısı.
async function collectClassDay(
  cls: string,
  weekKey: string,
  dayIndex: number,
  etutStudentId: string | null,
): Promise<{ lessons: TodayLesson[]; etuts: TodayEtut[] }> {
  const slotTimes = await getDaySlotTimes();
  const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
  const labelBySlotId = new Map(slots.map((s) => [s.id, s.label]));
  const idxBySlotId = new Map(slots.map((s, i) => [s.id, i]));

  const lessons: TodayLesson[] = [];
  for (const r of await getDayCellsAllTeachers(weekKey, dayIndex)) {
    const sd = r.cell;
    if (!sd || sd.lessonType !== 'ders' || sd.cls !== cls) continue;
    lessons.push({
      slotId: r.slotId,
      slotLabel: labelBySlotId.get(r.slotId) ?? '',
      teacherId: r.teacherLegacyId,
      teacherName: r.teacherName,
      branch: sd.branch || sd.subBranch || '',
      subBranch: sd.subBranch || '',
    });
  }
  // Satırlar slotBooking sırasıyla gelir — günün slot dizilimine göre sırala
  // (slotLabel lexicographic DEĞİL: "9:45" vs "10:20" yanılttığı için index kullanılır).
  lessons.sort((a, b) => (idxBySlotId.get(a.slotId) ?? 99) - (idxBySlotId.get(b.slotId) ?? 99));

  const etuts: TodayEtut[] = [];
  if (etutStudentId) {
    for (const t of await getAllProgramTemplates()) {
      const list = Array.isArray(t.template.etutSablonlari) ? (t.template.etutSablonlari as EtutSablonu[]) : [];
      for (const sb of list) {
        if (sb.dayIndex !== dayIndex || !etutAktifThisWeek(sb, weekKey)) continue;
        if (sb.studentId !== etutStudentId) continue; // yalnız KENDİ rezervasyonu (veri minimizasyonu)
        etuts.push({
          id: sb.id, start: sb.start, end: sb.end,
          teacherName: t.name, branch: sb.branch || null,
          studentName: sb.studentName || null, booked: true,
        });
      }
    }
    etuts.sort((a, b) => a.start.localeCompare(b.start));
  }
  return { lessons, etuts };
}

export async function buildStudentToday(session: Session, unread: number): Promise<StudentToday> {
  const t = trToday();
  const mods = await getOrgConfig('modules');
  const me = String(session.id ?? '');
  const cls = String(session.cls ?? '');
  const etutOn = mods.etut !== false;
  const { lessons, etuts } = await collectClassDay(cls, t.weekKey, t.dayIndex, etutOn ? me : null);

  let odev: StudentToday['odev'] = null;
  if (mods.odev !== false) {
    const rows = await listOdevForStudent(cls, me);
    odev = pickPendingOdev(
      rows.map((r) => ({ id: r.id, title: r.title, branch: r.branch, dueDate: r.dueDate, sub: r.sub })),
      t.date,
    );
  }
  let davranis: StudentToday['davranis'] = null;
  if (mods.davranis !== false) {
    davranis = { total: (await getStudentBehavior(me)).total };
  }
  let deneme: StudentToday['deneme'] = null;
  if (mods.deneme !== false) {
    const points = await buildStudentPoints(me); // eskiden yeniye
    const last = points[points.length - 1];
    // toplamNet kaynak tipte optional (DenemeRow) — strict build için ?? 0 (Codex #3).
    if (last) deneme = { name: last.name, dateLabel: last.dateLabel, toplamNet: last.toplamNet ?? 0, rank: last.rank, total: last.total };
  }
  return { role: 'student', ...common(t, unread), lessons, etuts: etutOn ? etuts : null, odev, davranis, deneme };
}

export async function buildParentToday(session: Session, unread: number, childId: string | null): Promise<ParentToday> {
  const t = trToday();
  const mods = await getOrgConfig('modules');
  const children: ParentChildView[] = (session.children ?? [])
    .map((c) => (typeof c === 'string' ? null : { id: String(c.id ?? ''), name: String(c.name ?? ''), cls: String(c.cls ?? '') }))
    .filter((c): c is ParentChildView => c != null && c.id !== '');

  // Çocuk sınırı: yalnız oturum payload'ındaki children (web canReadStudent paritesi).
  if (childId && !children.some((c) => c.id === childId)) {
    throw new HttpError(403, 'Bu öğrenciye erişim yetkiniz yok');
  }
  const chosen = (childId ? children.find((c) => c.id === childId) : children[0]) ?? null;
  if (!chosen) return { role: 'parent', ...common(t, unread), children, child: null };

  const etutOn = mods.etut !== false;
  const { lessons, etuts } = await collectClassDay(chosen.cls, t.weekKey, t.dayIndex, etutOn ? chosen.id : null);

  let odev: NonNullable<ParentToday['child']>['odev'] = null;
  if (mods.odev !== false) {
    const rows = await listOdevForParent([{ id: chosen.id, name: chosen.name, cls: chosen.cls }]);
    odev = pickPendingOdev(
      rows.map((r) => ({ id: r.id, title: r.title, branch: r.branch, dueDate: r.dueDate, sub: r.children[0]?.sub ?? null })),
      t.date,
    );
  }

  let finance: NonNullable<ParentToday['child']>['finance'] = null;
  if (mods.finance !== false) {
    const stu = await tdb().student.findFirst({
      where: { legacyId: chosen.id },
      include: { finance: { include: { installments: { orderBy: { idx: 'asc' } } } } },
    });
    const f = stu?.finance;
    if (f) {
      const payments = (f.payments as unknown as PaymentEntry[] | null) || [];
      const balance = f.netFee - payments.reduce((s, p) => s + (p.amount || 0), 0);
      const unpaid = (f.installments || []).filter((i) => !i.paid);
      const next = unpaid[0] ?? null;
      finance = {
        netFee: f.netFee,
        balance,
        nextInstallment: next ? { idx: next.idx, dueDate: next.dueDate ?? '', amount: next.amount } : null,
        overdueCount: unpaid.filter((i) => isPastDue(i.dueDate, t.date)).length,
      };
    }
  }

  return {
    role: 'parent', ...common(t, unread), children,
    child: { id: chosen.id, name: chosen.name, cls: chosen.cls, lessons, etuts: etutOn ? etuts : null, odev, finance },
  };
}

export async function buildTeacherToday(session: Session, unread: number): Promise<TeacherToday> {
  const t = trToday();
  const mods = await getOrgConfig('modules');
  const me = String(session.id ?? '');

  const grid = await getTeacherWeekSlots(me, t.weekKey);
  const slotTimes = await getDaySlotTimes();
  const slots = daySlots(t.dayIndex, slotTimes.days[t.dayIndex]);
  const lessons: TeacherSlotView[] = [];
  (grid[t.dayIndex] || []).forEach((sd, i) => {
    if (!sd) return;
    const isDers = sd.lessonType === 'ders';
    const isBookedEtut = !isDers && !!sd.booked; // boş/disabled hücre gösterilmez
    if (!isDers && !isBookedEtut) return;
    const slot = slots[i];
    lessons.push({
      slotId: slot?.id ?? '',
      slotLabel: slot?.label ?? '',
      type: isDers ? 'ders' : 'etut',
      cls: sd.cls || sd.studentCls || null,
      studentName: sd.studentName || null,
      branch: sd.branch || sd.subBranch || '',
    });
  });

  let etuts: TodayEtut[] | null = null;
  if (mods.etut !== false) {
    const prog = await getProgramTemplate(me);
    const list = Array.isArray(prog.etutSablonlari) ? (prog.etutSablonlari as EtutSablonu[]) : [];
    etuts = list
      .filter((sb) => sb.dayIndex === t.dayIndex && etutAktifThisWeek(sb, t.weekKey))
      .map((sb) => ({
        id: sb.id, start: sb.start, end: sb.end,
        teacherName: String(session.name ?? ''), branch: sb.branch || null,
        studentName: sb.studentName || null, booked: !!sb.studentId,
      }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  return { role: 'teacher', ...common(t, unread), lessons, etuts };
}

// Yönetim rolleri (director/accountant/counselor/org_admin): native içerik 2. dalga
// (spec §5.1) — karşılama + WebView girişi istemcide; uç yalnız ortak alanları döner.
export function buildManagementToday(_session: Session, unread: number): ManagementToday {
  return { role: 'management', ...common(trToday(), unread) };
}
```

- [ ] **Step 6: Birim testlerin geçtiğini doğrula**

Çalıştır: `npx vitest run lib/mobile/today.test.ts`
Beklenen: PASS (5+3+2 test).

- [ ] **Step 7: screens/today route'unu yaz**

`app/api/mobile/v1/screens/today/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { tdb } from '@/lib/sqldb';
import { contentLimited } from '@/lib/mobile/limits';
import { buildStudentToday, buildParentToday, buildTeacherToday, buildManagementToday } from '@/lib/mobile/today';

// Rol-aware "Bugün" aggregate ucu (spec §5.1/§9-1): tek istekte günün içeriği.
// Rol sınırı claim'lerden — istemci parametresiyle başka kullanıcı/sınıf çekilemez
// (veli ?child yalnız payload children içinden, today.ts 403 fırlatır).
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const unread = await tdb().notificationEvent.count({
    where: { role: session.role, userId: String(session.id ?? ''), readAt: null },
  });

  if (session.role === 'student') return NextResponse.json(await buildStudentToday(session, unread));
  if (session.role === 'parent') {
    const child = new URL(req.url).searchParams.get('child');
    return NextResponse.json(await buildParentToday(session, unread, child));
  }
  if (session.role === 'teacher') return NextResponse.json(await buildTeacherToday(session, unread));
  // director/accountant/counselor/org_admin (superadmin mobil token alamaz — Plan 2)
  return NextResponse.json(buildManagementToday(session, unread));
});
```

- [ ] **Step 8: Tip senkronu + tüm testler + build**

Çalıştır: `npm run mobile:types && npx vitest run && npm run build`
Beklenen: hepsi PASS + build başarılı.

- [ ] **Step 9: Commit (local)**

```bash
git add lib/mobile/today.ts lib/mobile/today.test.ts lib/mobile/api-types.ts lib/slots.ts app/api/etut-sablon/all/route.ts app/api/mobile/v1/screens/today/route.ts mobile/src/api/types.ts
git commit -m "feat(mobil): Bugün ekranı API — rol-aware screens/today (TR günü, modül-gate, veri minimizasyonu) + etutAktifThisWeek tek kaynak"
```

---

### Task 4: Deploy + canlı sözleşme testleri (int-mobile-content)

Task 1-3 tek push'la canlıya çıkar; yeni uçlar testkurs'a karşı canlı doğrulanır (Plan 2/3 `int` deseni). Duyuru gönderimi web (cookie) istemcisiyle yapılır → aynı olayın mobil inbox'a düştüğü uçtan uca kanıtlanır.

**Files:**
- Create: `e2e/int-mobile-content.spec.js`

**Interfaces:**
- Consumes: Task 2/3 uçları; `e2e/helpers` (BASE, DIR_STATE); `.env.local` creds (OKULIN_STU/TEA/DIR); mevcut `int` Playwright projesi (`playwright.config` — int spec'leri nasıl seçiyorsa aynı desen: mevcut `int-mobile-push.spec.js` dosyasının başındaki yapılandırmayı birebir izle).

**Rate-limit bütçesi:** login 5/15dk kovası — bu spec 3 login yapar (stu/tea/dir); aynı 15 dk penceresinde başka mobil suite koşulmamalı. İçerik uçları 240/10dk (bol). 429 görülürse `test.skip` kabul (Plan 3 deseni).

- [ ] **Step 1: Deploy**

```bash
git push origin main
```

Vercel deploy READY olana kadar bekle (`vercel ls` veya dashboard). Deploy SHA'sının Task 3 commit'i olduğunu doğrula.

- [ ] **Step 2: int spec'i yaz**

`e2e/int-mobile-content.spec.js` (yeni — TAMAMI; `int-mobile-push.spec.js` dosya-başı yapılandırma desenini birebir izle: `test.describe.configure({ mode: 'serial' })`, creds beforeAll doğrulaması, `api` = Origin'siz istemci, `web` = DIR_STATE + Origin):

```javascript
// Canlı sözleşme testleri: screens/today (3 rol) + notifications inbox akışı.
// RATE LİMİT BÜTÇESİ: 3 mobil login (5/15dk kovası) — bu pencerede başka mobil
// suite koşma. Duyuru web istemcisiyle (DIR_STATE cookie) gönderilir.
const { test, expect, request } = require('@playwright/test');
const { BASE, DIR_STATE } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const CREDS = {
  student: { user: process.env.OKULIN_STU_USER, pass: process.env.OKULIN_STU_PASS },
  teacher: { user: process.env.OKULIN_TEA_USER, pass: process.env.OKULIN_TEA_PASS },
  management: { user: process.env.OKULIN_DIR_USER, pass: process.env.OKULIN_DIR_PASS },
};

let api; // Origin'siz native taklidi
let web; // cookie'li yönetici (duyuru gönderimi)
const tokens = {}; // role -> accessToken
let stuId = null; // duyuru hedefi (login yanıtındaki session.id)
let annId = null; // temizlik için
let annEventId = null;

const H = (t) => ({ Authorization: 'Bearer ' + t });

test.beforeAll(async () => {
  for (const [role, c] of Object.entries(CREDS)) {
    expect(c.user, `OKULIN_${role} creds .env.local'de olmalı`).toBeTruthy();
    expect(c.pass).toBeTruthy();
  }
  api = await request.newContext();
  web = await request.newContext({ storageState: DIR_STATE, extraHTTPHeaders: { Origin: BASE } });
  for (const [role, c] of Object.entries(CREDS)) {
    const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, {
      data: { username: c.user, password: c.pass, role },
    });
    if (r.status() === 429) test.skip(true, 'login rate limit penceresi — sonra tekrar koş');
    expect(r.status(), `${role} login`).toBe(200);
    const j = await r.json();
    tokens[role] = j.accessToken;
    if (role === 'student') stuId = j.session.id;
  }
});

test.afterAll(async () => {
  // Test duyurusunu sil (yönetici web ucu) — inbox event'i kalır (90g retention, zararsız).
  if (annId) await web.delete(`${BASE}/api/announcements?id=${encodeURIComponent(annId)}`).catch(() => {});
  await api?.dispose();
  await web?.dispose();
});

test('today: öğrenci şekli (role/date/lessons/unread)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('student');
  expect(j.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(j.weekKey).toMatch(/^\d{4}-W\d{2}$/);
  expect(Array.isArray(j.lessons)).toBe(true);
  expect(typeof j.unreadNotifications).toBe('number');
  // modül alanları: null YA DA doğru şekil
  if (j.odev) expect(typeof j.odev.pending).toBe('number');
  if (j.davranis) expect(typeof j.davranis.total).toBe('number');
});

test('today: öğretmen şekli', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tokens.teacher) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('teacher');
  expect(Array.isArray(j.lessons)).toBe(true);
});

test('today: yönetici management döner (native 2. dalga)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tokens.management) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('management');
  expect(j.lessons).toBeUndefined();
});

test('today: Bearer\'sız 401', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`);
  expect(r.status()).toBe(401);
});

test('inbox: liste şekli + geçersiz before 400', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(Array.isArray(j.items)).toBe(true);
  expect(typeof j.unreadCount).toBe('number');
  const bad = await api.get(`${BASE}/api/mobile/v1/notifications?before=garbage`, { headers: H(tokens.student) });
  expect(bad.status()).toBe(400);
});

test('uçtan uca: duyuru gönder → öğrenci inbox\'ında görünür → okundu → sayaç düşer', async () => {
  const title = `Plan4 int ${Date.now()}`;
  const send = await web.post(`${BASE}/api/announcements`, {
    data: { action: 'send', title, body: 'Plan 4 canlı test duyurusu', audience: { role: 'student', scope: 'selected', ids: [stuId] } },
  });
  expect(send.status()).toBe(200);
  annId = (await send.json()).id ?? null; // yanıt id dönmüyorsa temizlik GET listesinden bulunur (aşağıda fallback)

  // Fan-out senkron (enqueue login isteği içinde) — kısa bekleme yeterli.
  let found = null;
  for (let i = 0; i < 5 && !found; i++) {
    const list = await api.get(`${BASE}/api/mobile/v1/notifications?limit=10`, { headers: H(tokens.student) });
    expect(list.status()).toBe(200);
    const j = await list.json();
    found = j.items.find((it) => it.title.includes(title));
    if (!found) await new Promise((r2) => setTimeout(r2, 1000));
  }
  expect(found, 'duyuru event\'i inbox\'a düşmeli').toBeTruthy();
  expect(found.read).toBe(false);
  annEventId = found.id;

  const before = await api.get(`${BASE}/api/mobile/v1/notifications?limit=1`, { headers: H(tokens.student) });
  const unreadBefore = (await before.json()).unreadCount;

  const read = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { eventId: annEventId } });
  expect(read.status()).toBe(200);
  const rj = await read.json();
  expect(rj.updated).toBe(1);
  expect(rj.unreadCount).toBe(unreadBefore - 1);

  // idempotent tekrar: updated 0 ama 200
  const again = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { eventId: annEventId } });
  expect(again.status()).toBe(200);
  expect((await again.json()).updated).toBe(0);
});

test('izolasyon: öğrenci, öğretmenin GERÇEK event\'ini okuyamaz/işaretleyemez (IDOR)', async () => {
  // Gerçek IDOR kanıtı (İnceleme Codex #13): öğretmene hedefli duyuru üret,
  // event id'sini ÖĞRETMEN kutusundan al, öğrenci token'ıyla erişmeyi dene.
  const title = `Plan4 idor ${Date.now()}`;
  const teaRes = await api.get(`${BASE}/api/mobile/v1/me`, { headers: H(tokens.teacher) });
  const teaId = (await teaRes.json()).session.id;
  const send = await web.post(`${BASE}/api/announcements`, {
    data: { action: 'send', title, body: 'izolasyon testi', audience: { role: 'teacher', scope: 'selected', ids: [teaId] } },
  });
  expect(send.status()).toBe(200);
  let teaEvent = null;
  for (let i = 0; i < 5 && !teaEvent; i++) {
    const tl = await api.get(`${BASE}/api/mobile/v1/notifications?limit=10`, { headers: H(tokens.teacher) });
    teaEvent = (await tl.json()).items.find((it) => it.title.includes(title));
    if (!teaEvent) await new Promise((r2) => setTimeout(r2, 1000));
  }
  expect(teaEvent, 'öğretmen event\'i üretilmiş olmalı').toBeTruthy();
  // Okundu işaretleme (POST) ve tek-kayıt okuma (GET ?id=) ikisi de 404 (varlık sızdırma yok)
  const w = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { eventId: teaEvent.id } });
  expect(w.status()).toBe(404);
  const g = await api.get(`${BASE}/api/mobile/v1/notifications?id=${encodeURIComponent(teaEvent.id)}`, { headers: H(tokens.student) });
  expect(g.status()).toBe(404);
});

test('tek-kayıt modu: sahibi ?id= ile eski event\'i çekebilir', async () => {
  const list = await api.get(`${BASE}/api/mobile/v1/notifications?limit=1`, { headers: H(tokens.student) });
  const item = (await list.json()).items[0];
  test.skip(!item, 'öğrenci kutusu boş');
  const g = await api.get(`${BASE}/api/mobile/v1/notifications?id=${encodeURIComponent(item.id)}`, { headers: H(tokens.student) });
  expect(g.status()).toBe(200);
  const j = await g.json();
  expect(j.items).toHaveLength(1);
  expect(j.items[0].id).toBe(item.id);
});

test('read-all: unreadCount sıfırlanır', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { all: true } });
  expect(r.status()).toBe(200);
  expect((await r.json()).unreadCount).toBe(0);
});

test('veli today (creds varsa)', async () => {
  const user = process.env.OKULIN_PAR_USER, pass = process.env.OKULIN_PAR_PASS;
  test.skip(!user || !pass, 'veli creds yok — cihaz turunda doğrulanır (plan ADR)');
  const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, { data: { username: user, password: pass, role: 'parent' } });
  expect(r.status()).toBe(200);
  const tok = (await r.json()).accessToken;
  const t = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tok) });
  expect(t.status()).toBe(200);
  const j = await t.json();
  expect(j.role).toBe('parent');
  expect(Array.isArray(j.children)).toBe(true);
});
```

Uygulama notları (spec yazarken doğrula, tahmin etme):
- `POST /api/announcements` send yanıtının gövdesini `app/api/announcements/route.ts`'ten oku — `id` dönmüyorsa `annId`'yi yönetici GET listesinden (`title` eşleşmesi) bul, DELETE parametre biçimini de aynı dosyadan doğrula.
- int projesi spec seçimini `playwright.config`'ten doğrula (dosya adı deseni `int-*.spec.js` ise bu ad uyar).

- [ ] **Step 3: Canlı koşu**

Çalıştır: `npx playwright test e2e/int-mobile-content.spec.js --project=int` (proje adını config'ten doğrula)
Beklenen: tümü yeşil (veli testi skip normal). 429 skip'i görülürse 15 dk sonra tekrar.

- [ ] **Step 4: Regresyon — mevcut mobil suite'ler + dispatchDue cron smoke**

Çalıştır: `npx playwright test e2e/int-mobile-auth.spec.js e2e/int-mobile-push.spec.js --project=int`
Beklenen: 24/24 yeşil — register/unregister/F1 yollarının (devices.ts timingSafeEqual dahil) canlı kanıtı. Login rate-limit penceresine dikkat — gerekirse 15 dk bekle.

dispatchDue smoke (İnceleme Codex #12 — int süitler retry yolunu TETİKLEMEZ, cron elle tetiklenir):

```bash
curl -s -H "Authorization: Bearer <CRON_SECRET>" https://okulin.com/api/cron/notif-dispatch
```

(`CRON_SECRET` CLAUDE.local.md'de.) Beklenen: HTTP 200 + `{ processed, sent, retried, dead }` sayaçları (büyük olasılıkla `processed: 0` — pending teslimat yoksa bile refactor edilmiş kod yolunun prod'da hatasız koştuğunu kanıtlar; QStash 15 dk ritmi sonraki gerçek teslimatlarda aynı yolu işletir).

- [ ] **Step 5: Commit + push**

```bash
git add e2e/int-mobile-content.spec.js
git commit -m "test(mobil): canlı sözleşme testleri — screens/today (3 rol) + inbox uçtan uca (duyuru→listele→okundu→izolasyon)"
git push origin main
```

---

### Task 5: Mobil borç paketi — fetch timeout + 409 helper + Gate yeniden kontrolü + onay diyalogları

Plan-3 final review borçlarının mobil istemci kısmı. Dört bağımsız küçük iş, tek task: (a) tüm ağ çağrılarına AbortController timeout'u; (b) push 409-rotate deseni tek helper'a iner; (c) Gate, uygulama ön plana gelince kill-switch'i SESSİZCE yeniden kontrol eder (60 sn throttle; 'ok' ekranını titretmez); (d) "Kurumdan ayrıl" / "Kurum değiştir" onay diyaloğuna bağlanır (yanlış dokunuş oturum + kurum kaydını silmesin).

**Files:**
- Create: `mobile/src/api/http.ts`
- Create: `mobile/src/api/http.test.ts`
- Modify: `mobile/src/api/client.ts` (3 fetch noktası)
- Modify: `mobile/src/ui/Gate.tsx`
- Modify: `mobile/src/push.ts`
- Create: `mobile/src/confirm.ts`
- Modify: `mobile/src/app/giris.tsx`, `mobile/src/app/ayarlar.tsx`

**Interfaces:**
- Produces (sonraki task'lar kullanır): `fetchWithTimeout(f, url, init?, timeoutMs?): Promise<Response>` + `DEFAULT_TIMEOUT_MS = 15000` / `BOOT_TIMEOUT_MS = 10000` (http.ts) · `confirmLeaveOrg(onConfirm): void` (confirm.ts) · `postRegister(api, base, token, rotate?)` push.ts iç helper'ı (dışa imzalar değişmez).

- [ ] **Step 1: Başarısız http testlerini yaz**

`mobile/src/api/http.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from './http';

// Asla çözülmeyen ama abort'u dinleyen sahte fetch.
const hangingFetch = ((_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })) as unknown as typeof fetch;

afterEach(() => vi.useRealTimers());

describe('fetchWithTimeout', () => {
  it('süre dolunca abort ile reddeder', async () => {
    vi.useFakeTimers();
    const p = fetchWithTimeout(hangingFetch, 'https://x.okulin.com/api', {}, 5000);
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });

  it('zamanında yanıt gelirse timer temizlenir ve yanıt döner', async () => {
    const ok = ((_u: unknown) => Promise.resolve(new Response('{}', { status: 200 }))) as unknown as typeof fetch;
    const r = await fetchWithTimeout(ok, 'https://x.okulin.com/api', {}, 5000);
    expect(r.status).toBe(200);
  });

  it('init alanlarını (method/headers/body) korur', async () => {
    let seen: RequestInit | undefined;
    const spy = ((_u: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    await fetchWithTimeout(spy, 'https://x.okulin.com/api', { method: 'POST', body: '{"a":1}' }, 5000);
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"a":1}');
    expect(seen?.signal).toBeDefined();
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Çalıştır: `cd mobile && npx vitest run src/api/http.test.ts`
Beklenen: FAIL — `./http` modülü yok.

- [ ] **Step 3: http.ts'i yaz**

`mobile/src/api/http.ts` (yeni — TAMAMI):

```typescript
// Ağ çağrısı zaman aşımı (Plan 3 borcu): RN fetch'inde varsayılan timeout YOK —
// ölü Wi-Fi/asansör senaryosunda istek sonsuz asılı kalır, UI "busy"de kilitlenirdi.
// AbortController ile sınırlanır; çağıran AbortError'u ağ hatası gibi ele alır
// (client.ts zaten tüm fetch hatalarını ApiError(0)'a çevirir).

export const DEFAULT_TIMEOUT_MS = 15000; // içerik/auth istekleri
export const BOOT_TIMEOUT_MS = 10000; // bootstrap/resolve-org (Gate hızlı karar vermeli)

export async function fetchWithTimeout(
  f: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Çalıştır: `cd mobile && npx vitest run src/api/http.test.ts`
Beklenen: PASS (3 test).

- [ ] **Step 5: client.ts'te üç fetch noktasını sar**

`mobile/src/api/client.ts`:

(a) import ekle: `import { fetchWithTimeout } from './http';`

(b) `doRefresh` içindeki `attempt` tanımını değiştir:

```typescript
    const attempt = () =>
      fetchWithTimeout(f, `${opts.baseUrl}/api/mobile/v1/auth/refresh`, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({ refreshToken }),
      });
```

(c) `request` içindeki `res = await f(opts.baseUrl + path, {...})` çağrısını:

```typescript
      res = await fetchWithTimeout(f, opts.baseUrl + path, {
        method,
        headers: { ...baseHeaders(), ...(access ? { authorization: `Bearer ${access}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
```

(d) `login` içindeki fetch çağrısını değiştir:

```typescript
        res = await fetchWithTimeout(f, `${opts.baseUrl}/api/mobile/v1/auth/login`, {
          method: 'POST',
          headers: baseHeaders(),
          body: JSON.stringify(body),
        });
```

Mevcut client testleri kırılmamalı: `fetchFn` enjeksiyonu korunur (fetchWithTimeout `f`'i sarar). `cd mobile && npx vitest run` → tüm testler PASS.

- [ ] **Step 6: push.ts 409 helper'ı**

`mobile/src/push.ts` içinde `registerToken`'ın ÜSTÜNE helper ekle; `registerToken` ve `watchTokenRotation` onu kullanır (davranış birebir — Plan 3 Minor #9):

```typescript
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
```

`watchTokenRotation` gövdesini sadeleştir:

```typescript
export function watchTokenRotation(api: ApiClient, base: RegisterBase, rotate?: RotateInstallationId): { remove(): void } {
  return Notifications.addPushTokenListener((t) => {
    void postRegister(api, base, String(t.data), rotate).catch(() => {
      /* sessiz — bir sonraki açılış dener (rotate() hatası dahil, Plan 3 fix'i korunur) */
    });
  });
}
```

- [ ] **Step 7: Gate — timeout + AppState sessiz yeniden kontrol**

`mobile/src/ui/Gate.tsx` TAMAMINI şu içerikle değiştir:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../store/session';
import { semverLt } from '../semver';
import { fetchWithTimeout, BOOT_TIMEOUT_MS } from '../api/http';
import { LoadingScreen, StatusScreen } from './kit';
import type { BootstrapResponse } from '../api/types';

// Kill-switch kapısı (spec §9/3): kurum host'undan bootstrap çekilir; bakım /
// minimum sürüm / kurum-pasif / ağ-yok durumları TÜM uygulamayı (login dahil) kapatır.
// Kurum seçilmemişken kapı atlanır (resolve-org apex'te, kill-switch'ten bağımsız).
// Plan 4 borç kapanışı: (a) fetch 10 sn timeout; (b) uygulama ön plana gelince
// SESSİZ yeniden kontrol (60 sn throttle) — bakım açıldıysa açık uygulama da yakalar.
// Sessiz mod YALNIZ daha önce 'ok' geçmiş host'ta geçerlidir (İnceleme Codex #7):
// kurum değişiminde ilk kontrol tam kontroldür, hatası fail-closed 'offline'a düşer.

type GateState = 'checking' | 'ok' | 'offline' | 'maintenance' | 'update' | 'inactive';
const RECHECK_MIN_MS = 60_000;

export function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { org, appVersion, retryBoot } = useSession();
  const [state, setState] = useState<GateState>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastCheckAt = useRef(0);
  const lastOkHost = useRef<string | null>(null); // son BAŞARIYLA geçen canonicalHost

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
    const silent = lastOkHost.current === org.canonicalHost;
    let cancelled = false;
    (async () => {
      // Sessiz yeniden kontrol: daha önce geçmiş host'ta 'ok' ekranı checking'e
      // DÜŞÜRÜLMEZ (çocuklar unmount olmasın); sorun bulunursa duruma geçilir.
      setState((s) => (silent && s === 'ok' ? s : 'checking'));
      try {
        const res = await fetchWithTimeout(fetch, `https://${org.canonicalHost}/api/mobile/v1/bootstrap`, {}, BOOT_TIMEOUT_MS);
        if (!res.ok) throw new Error(`bootstrap ${res.status}`); // 5xx/4xx → offline yolu (fail-closed)
        const j = (await res.json()) as BootstrapResponse;
        if (cancelled) return;
        lastCheckAt.current = Date.now();
        if (j.maintenance?.active) {
          setMessage(j.maintenance.message);
          setState('maintenance');
          return;
        }
        if (j.org && j.org.active === false) {
          setState('inactive'); // kurum pasif (spec §6/7 kenar durumu)
          return;
        }
        if (semverLt(appVersion, j.minSupportedVersion)) {
          setState('update');
          return;
        }
        lastOkHost.current = org.canonicalHost;
        setState('ok');
      } catch {
        // Sessiz kontrolde ağ hatası 'ok' ekranını DÜŞÜRMEZ (uygulama offline
        // durumunu istek düzeyinde zaten gösterir); ilk yükleme/kurum değişiminde
        // fail-closed offline.
        if (!cancelled) setState((s) => (silent && s === 'ok' ? s : 'offline'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, appVersion, tick]);

  // Ön plana dönüşte kill-switch'i tazele (60 sn throttle) — Plan 3 borcu.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !org) return;
      if (Date.now() - lastCheckAt.current < RECHECK_MIN_MS) return;
      setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, [org]);

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
  if (state === 'inactive') {
    return (
      <StatusScreen
        title="Kurum aktif değil"
        message="Bu kurumun okulin hizmeti şu anda aktif görünmüyor. Kurumunuzla iletişime geçin."
        actionLabel="Yeniden dene"
        onAction={retry}
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

Dikkat: `retryBoot` AppState yolunda ÇAĞRILMAZ (yalnız kullanıcı "Yeniden dene"sinde) — sessiz kontrol oturum akışını tetiklemez.

- [ ] **Step 8: Onay diyalogları**

`mobile/src/confirm.ts` (yeni — TAMAMI):

```typescript
import { Alert } from 'react-native';

// Kurumdan ayrılma onayı (Plan 3 Minor #7): oturum + push bağı + kayıtlı kurum
// silinir — yanlış dokunuş geri alınamaz olmasın. "Tüm cihazlardan çıkış" Alert'iyle
// tutarlı desen.
export function confirmLeaveOrg(onConfirm: () => void): void {
  Alert.alert('Kurumdan ayrıl', 'Oturumunuz kapatılacak ve kayıtlı kurum bu cihazdan silinecek.', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Ayrıl', style: 'destructive', onPress: onConfirm },
  ]);
}
```

`mobile/src/app/giris.tsx` — "Kurum değiştir" butonunu değiştir (import: `import { confirmLeaveOrg } from '../confirm';`):

```tsx
        <Button
          label="Kurum değiştir"
          onPress={() => confirmLeaveOrg(() => void leaveOrg().then(() => router.replace('/kurum')))}
          color={brand}
          variant="ghost"
        />
```

`mobile/src/app/ayarlar.tsx` — "Kurumdan ayrıl" butonunu değiştir (aynı import; `../confirm` yolu ayarlar Task 6'da `(tabs)/`e taşınınca `../../confirm` olur — taşıma sırasında güncellenir):

```tsx
        <Button
          label="Kurumdan ayrıl"
          onPress={() => confirmLeaveOrg(() => void leaveOrg().then(() => router.replace('/kurum')))}
          color={brand}
          variant="ghost"
        />
```

- [ ] **Step 9: Mobil test + tip kontrolü**

Çalıştır: `cd mobile && npx tsc --noEmit && npx vitest run`
Beklenen: tsc temiz; testler PASS (yeni 3 + mevcut 14).

- [ ] **Step 10: Commit**

```bash
git add mobile/src/api/http.ts mobile/src/api/http.test.ts mobile/src/api/client.ts mobile/src/ui/Gate.tsx mobile/src/push.ts mobile/src/confirm.ts mobile/src/app/giris.tsx mobile/src/app/ayarlar.tsx
git commit -m "fix(mobil): Plan-3 borç paketi — fetch timeout (AbortController), Gate ön-plan kill-switch yeniden kontrolü, 409-rotate tek helper, kurumdan-ayrıl onayı"
```

---

### Task 6: Sekmeli navigasyon + Bildirimler ekranı

Ekranlar `(tabs)` grubuna taşınır (Bugün · Bildirimler · Ayarlar — spec §5.1 "native tab/navigation"); Bildirimler ekranı inbox listesini gösterir (sayfalama, pull-to-refresh, tap→okundu, tümünü okundu say, `focus` paramı). Okunmamış sayacı tab rozetinde (`UnreadBadgeProvider`).

**Files:**
- Modify: `mobile/package.json` (`npx expo install @expo/vector-icons`)
- Create: `mobile/src/store/badge.tsx`
- Move: `mobile/src/app/bugun.tsx` → `mobile/src/app/(tabs)/bugun.tsx` · `mobile/src/app/ayarlar.tsx` → `mobile/src/app/(tabs)/ayarlar.tsx` (göreli import'lar `../` → `../../`)
- Create: `mobile/src/app/(tabs)/_layout.tsx`
- Create: `mobile/src/app/(tabs)/bildirimler.tsx`
- Modify: `mobile/src/app/_layout.tsx` (UnreadBadgeProvider)

**Interfaces:**
- Consumes: `InboxListResponse/InboxItem/InboxReadResponse` (Task 2 tipleri, types.ts'te senkron), `ApiClient`, kit bileşenleri.
- Produces (Task 8/9 kullanır): `useUnreadBadge(): { unread: number; setUnread(n: number): void }` · `/bildirimler` rotası `focus?: string` paramını işler (listede bulursa okundu işaretler + vurgular; bulamazsa `?id=` tek-kayıt modundan çekip üstte gösterir ve okundu işaretler — Codex #8).
- Rota href'leri DEĞİŞMEZ: `/bugun`, `/bildirimler`, `/ayarlar` (grup segmentleri URL'de görünmez; `experiments.typedRoutes` yeni rotaları üretir).

- [ ] **Step 1: İkon paketini kur**

```bash
cd mobile && npx expo install @expo/vector-icons
```

- [ ] **Step 2: badge.tsx'i yaz**

`mobile/src/store/badge.tsx` (yeni — TAMAMI):

```tsx
import React, { createContext, useContext, useMemo, useState } from 'react';

// Okunmamış bildirim sayacı — tab rozeti + ekranlar arası paylaşım.
// Kaynak gerçek sunucu (unreadCount her today/inbox yanıtında gelir); bu context
// yalnız son bilinen değeri taşır.
interface BadgeValue {
  unread: number;
  setUnread(n: number): void;
}

const BadgeContext = createContext<BadgeValue | null>(null);

export function UnreadBadgeProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState(0);
  const value = useMemo(() => ({ unread, setUnread }), [unread]);
  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}

export function useUnreadBadge(): BadgeValue {
  const ctx = useContext(BadgeContext);
  if (!ctx) throw new Error('useUnreadBadge, UnreadBadgeProvider içinde kullanılmalı');
  return ctx;
}
```

- [ ] **Step 3: Ekranları (tabs) grubuna taşı**

```bash
cd mobile && mkdir -p "src/app/(tabs)" && git mv src/app/bugun.tsx "src/app/(tabs)/bugun.tsx" && git mv src/app/ayarlar.tsx "src/app/(tabs)/ayarlar.tsx"
```

İki dosyada göreli import'ları bir seviye derinleştir: `../store/session` → `../../store/session`, `../push` → `../../push`, `../ui/kit` → `../../ui/kit`, `../rol` → `../../rol`, `../confirm` → `../../confirm` (Task 5'te eklendi). `ayarlar.tsx` içindeki `<Link href="/ayarlar">`/`router.replace` çağrıları aynı kalır.

- [ ] **Step 4: (tabs)/_layout.tsx'i yaz**

`mobile/src/app/(tabs)/_layout.tsx` (yeni — TAMAMI):

```tsx
import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../../store/session';
import { useUnreadBadge } from '../../store/badge';
import { LoadingScreen, palette } from '../../ui/kit';

// Ana sekmeler (spec §5.1): Bugün · Bildirimler · Ayarlar. Giriş/kurum/WebView/QR
// ekranları kök Stack'te kalır. Rozet: okunmamış bildirim (badge store).
// Rota guard'ı (İnceleme Codex #9): sekmelere deep link ile oturumsuz gelinirse
// index yönlendirmesine döner — ekranlar api'siz boş durumda takılı kalmaz.
export default function TabsLayout() {
  const { org, status } = useSession();
  const { unread } = useUnreadBadge();
  const brand = org?.themeColor || palette.brandFallback;
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'ready') return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: brand }}>
      <Tabs.Screen
        name="bugun"
        options={{
          title: 'Bugün',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bildirimler"
        options={{
          title: 'Bildirimler',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="ayarlar"
        options={{
          title: 'Ayarlar',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 5: Kök _layout'a provider ekle**

`mobile/src/app/_layout.tsx` içinde import ekle (`import { UnreadBadgeProvider } from '../store/badge';`) ve `RootLayout`'u değiştir:

```tsx
function RootLayout() {
  return (
    <SessionProvider>
      <UnreadBadgeProvider>
        <BootstrapGate>
          <Stack screenOptions={{ headerShown: false }} />
        </BootstrapGate>
      </UnreadBadgeProvider>
    </SessionProvider>
  );
}
```

- [ ] **Step 6: bildirimler.tsx'i yaz**

`mobile/src/app/(tabs)/bildirimler.tsx` (yeni — TAMAMI):

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../store/session';
import { useUnreadBadge } from '../../store/badge';
import { Screen, Title, Sub, Button, ErrorText, palette } from '../../ui/kit';
import type { InboxItem, InboxListResponse, InboxReadResponse } from '../../api/types';

// Bildirim merkezi (spec §8): NotificationEvent inbox'u. Kilit ekranı metni
// jenerikleşse bile TAM içerik burada görünür (jenerikleştirme yalnız push'a
// uygulanır — sunucu renderPush). Tap → okundu; focus paramı (push tap
// yönlendirmesi) ilgili bildirimi okundu işaretleyip vurgular.
export default function BildirimlerEkrani() {
  const { api, org } = useSession();
  const { setUnread } = useUnreadBadge();
  const brand = org?.themeColor || palette.brandFallback;
  const params = useLocalSearchParams<{ focus?: string }>();
  const focus = typeof params.focus === 'string' ? params.focus : null;
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Push tap'i eski sayfada kalmış bir event'i işaret edebilir — tek-kayıt modundan
  // çekilip üstte gösterilir (İnceleme Codex #8).
  const [focusItem, setFocusItem] = useState<InboxItem | null>(null);
  const processedFocus = useRef<string | null>(null);

  const applyCounts = useCallback(
    (n: number) => {
      setUnreadCount(n);
      setUnread(n);
    },
    [setUnread],
  );

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const r = await api.get<InboxListResponse>('/api/mobile/v1/notifications?limit=20');
      setItems(r.items);
      setNextBefore(r.nextBefore);
      applyCounts(r.unreadCount);
    } catch {
      setError('Bildirimler yüklenemedi. İnternetinizi kontrol edin.');
      setItems((prev) => prev ?? []);
    }
  }, [api, applyCounts]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function loadMore() {
    if (!api || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.get<InboxListResponse>(
        `/api/mobile/v1/notifications?limit=20&before=${encodeURIComponent(nextBefore)}`,
      );
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setNextBefore(r.nextBefore);
      applyCounts(r.unreadCount);
    } catch {
      /* sayfa sonu denemesi — sessiz; kullanıcı yenileyebilir */
    } finally {
      setLoadingMore(false);
    }
  }

  const markRead = useCallback(
    async (eventId: string) => {
      if (!api) return;
      // İyimser: satırı hemen okundu göster; HATADA GERİ AL (İnceleme Gemini #5).
      const flip = (read: boolean) => {
        setItems((prev) => (prev ?? []).map((x) => (x.id === eventId ? { ...x, read } : x)));
        setFocusItem((prev) => (prev && prev.id === eventId ? { ...prev, read } : prev));
      };
      flip(true);
      try {
        const r = await api.post<InboxReadResponse>('/api/mobile/v1/notifications', { eventId });
        applyCounts(r.unreadCount);
      } catch {
        flip(false); // sunucu onaylamadı — iyimser işareti geri çek
      }
    },
    [api, applyCounts],
  );

  // focus (push tap, Task 9 yönlendirir): her focus değeri BİR KEZ işlenir. Listede
  // yoksa (eski sayfada) tek-kayıt modundan çekilip üstte gösterilir (Codex #8) —
  // kullanıcı dokunduğu bildirimin tam halini her durumda görür; sonra okundu.
  useEffect(() => {
    if (!focus || processedFocus.current === focus || items === null || !api) return;
    processedFocus.current = focus;
    const inList = items.find((x) => x.id === focus);
    void (async () => {
      if (!inList) {
        try {
          const r = await api.get<InboxListResponse>(`/api/mobile/v1/notifications?id=${encodeURIComponent(focus)}`);
          if (r.items[0]) setFocusItem(r.items[0]);
          applyCounts(r.unreadCount);
        } catch {
          /* bulunamadı/ağ hatası — liste yine görünür */
        }
      }
      if (!inList || !inList.read) await markRead(focus);
    })();
  }, [focus, items, api, markRead, applyCounts]);

  async function markAll() {
    if (!api || items === null) return;
    const snapshot = items;
    setItems(items.map((x) => ({ ...x, read: true })));
    try {
      const r = await api.post<InboxReadResponse>('/api/mobile/v1/notifications', { all: true });
      applyCounts(r.unreadCount);
    } catch {
      setItems(snapshot); // sunucu onaylamadı — geri al (İnceleme Gemini #5)
    }
  }

  return (
    <Screen>
      <FlatList
        style={s.wrap}
        contentContainerStyle={s.content}
        data={items ?? []}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[brand]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListHeaderComponent={
          <View>
            <Title>Bildirimler</Title>
            {error ? <ErrorText>{error}</ErrorText> : null}
            {unreadCount > 0 ? (
              <Button label={`Tümünü okundu say (${unreadCount})`} onPress={() => void markAll()} color={brand} variant="ghost" />
            ) : null}
            {focusItem && !(items ?? []).some((x) => x.id === focusItem.id) ? (
              <View style={[s.item, { borderColor: brand, borderWidth: 2 }]}>
                <Text style={s.itemTitle}>{focusItem.title}</Text>
                <Text style={s.itemBody}>{focusItem.body}</Text>
                <Text style={s.itemDate}>{new Date(focusItem.createdAt).toLocaleString('tr-TR')}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={items === null ? <Sub>Yükleniyor…</Sub> : <Sub>Henüz bildiriminiz yok.</Sub>}
        ListFooterComponent={loadingMore ? <Sub>Yükleniyor…</Sub> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => (item.read ? undefined : void markRead(item.id))}>
            <View style={[s.item, !item.read && s.unreadItem, focus === item.id && { borderColor: brand, borderWidth: 2 }]}>
              <View style={s.itemHead}>
                {!item.read ? <View style={[s.dot, { backgroundColor: brand }]} /> : null}
                <Text style={s.itemTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
              <Text style={s.itemBody}>{item.body}</Text>
              <Text style={s.itemDate}>{new Date(item.createdAt).toLocaleString('tr-TR')}</Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  item: {
    backgroundColor: palette.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    marginTop: 12,
  },
  unreadItem: { backgroundColor: '#f5f3ff' },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: palette.text, flexShrink: 1 },
  itemBody: { fontSize: 14, color: palette.text, marginTop: 6 },
  itemDate: { fontSize: 12, color: palette.sub, marginTop: 8 },
});
```

- [ ] **Step 7: Tip + test kontrolü**

Çalıştır: `cd mobile && npx tsc --noEmit && npx vitest run`
Beklenen: temiz. (typedRoutes tuzağı: yeni rota dosyaları `.expo/types`'a `expo start` sırasında yazılır — tsc `href` tiplerinde hata verirse `npx expo start --port 8082` ile dev sunucusunu bir kez açıp kapat, sonra tsc'yi tekrar koş. Bu tuzak Task 7/9/10'daki yeni rotalar için de geçerlidir.)

- [ ] **Step 8: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/store/badge.tsx "mobile/src/app/(tabs)" mobile/src/app/_layout.tsx
git commit -m "feat(mobil): sekmeli navigasyon (Bugün/Bildirimler/Ayarlar) + bildirim merkezi ekranı — sayfalama, okundu, rozet"
```

(`git mv` taşımaları `git add` kapsamında otomatik stage'lidir; emin olmak için `git status` kontrol et.)

---

### Task 7: Güvenli WebView (yalnız yönetim) — session-exchange istemcisi + tek-retry

Yönetim rolleri (director/accountant/counselor/org_admin) mevcut web panelini uygulama içinde açar (spec §5.2-5.4): her açılışta taze `session-exchange` → `session-open` cookie kurulumu; 401/403'te BİR KEZ yeniden exchange; WebView içinde YALNIZ kullanıcının kendi `org.canonicalHost`'u yüklenir (Codex #10 — diğer subdomainler dahil her şey dışarıda, dışa açılış güvenli şema allowlist'iyle); yükleme zaman sınırı + 5xx + render-süreci ölümü native hata ekranına düşer (Codex #11); Android geri tuşu yalnız ekran odaktayken WebView geçmişini izler (Gemini #4); köprü KURULMAZ. Oturum çözülmeden yönlendirme yapılmaz (Gemini #1); diğer roller rotaya gelirse Bugün'e yönlenir.

**Files:**
- Modify: `mobile/package.json` (`npx expo install react-native-webview`)
- Modify: `mobile/src/rol.ts` (`roleCategoryOf`)
- Create: `mobile/src/app/web.tsx`

**Interfaces:**
- Consumes: `SessionExchangeResponse` (Task 2), `isAllowedHost` (config), `ApiClient.post`, kit.
- Produces (Task 8/9 kullanır): `/web` rotası `path?: string` paramıyla (yüklenecek web path'i, `/` varsayılan) · `roleCategoryOf(role): 'student'|'parent'|'teacher'|'management'|null`.
- Native modül: react-native-webview — cihazda çalışması Task 11 rebuild'ini bekler (tsc/vitest bundan etkilenmez).

- [ ] **Step 1: WebView paketini kur**

```bash
cd mobile && npx expo install react-native-webview
```

- [ ] **Step 2: rol.ts'e kategori fonksiyonu ekle**

`mobile/src/rol.ts` sonuna:

```typescript
export type RoleCategory = 'student' | 'parent' | 'teacher' | 'management';

// Oturum rolü → kategori (sunucu MobileRoleCategory karşılığı).
// director/accountant/counselor/org_admin (+asst director payload'ı 'director' taşır)
// = management. Rol yoksa null (guard'lar yönlendirme yapar).
export function roleCategoryOf(role: string | undefined | null): RoleCategory | null {
  if (!role) return null;
  if (role === 'student' || role === 'parent' || role === 'teacher') return role;
  return 'management';
}
```

- [ ] **Step 3: web.tsx'i yaz**

`mobile/src/app/web.tsx` (yeni — TAMAMI):

```tsx
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
  const target = typeof params.path === 'string' && params.path.startsWith('/') && !params.path.startsWith('//') ? params.path : '/';
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
          if (protocol === 'https:' && hostname === org?.canonicalHost) return true;
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
```

- [ ] **Step 4: Tip + test kontrolü**

Çalıştır: `cd mobile && npx tsc --noEmit && npx vitest run`
Beklenen: temiz. (`/web` rotası typedRoutes'a girer — Task 8'in `router.push('/web')` çağrıları için hazır.)

- [ ] **Step 5: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/rol.ts mobile/src/app/web.tsx
git commit -m "feat(mobil): güvenli WebView (yalnız yönetim) — taze session-exchange + 401/403 tek-retry + *.okulin.com allowlist + köprüsüz"
```

---

### Task 8: Bugün ekranı gerçek içerik — rol bileşenleri

`(tabs)/bugun.tsx` gerçek içeriği çeker (`GET /screens/today`), rol bileşenleri gösterir: öğrenci (bugünün dersleri + etütlerim + bekleyen ödev + davranış/deneme özeti), veli (çocuk seçici + program + ödev + ödeme özeti — ödeme başlatma YOK, spec §11), öğretmen (bugünkü program + etüt doluluk), yönetim (WebView girişi). Push izin kartı ve rotasyon dinleyicisi AYNEN korunur. Modül alanı `null` ise kart hiç render edilmez.

**Files:**
- Create: `mobile/src/ui/today.tsx`
- Modify: `mobile/src/app/(tabs)/bugun.tsx`

**Interfaces:**
- Consumes: `TodayResponse` ve alt tipleri (Task 3, types.ts senkron), `useUnreadBadge` (Task 6), `/web` rotası (Task 7), mevcut push fonksiyonları.
- Produces: `StudentTodayView/ParentTodayView/TeacherTodayView/ManagementTodayView` (today.tsx — props aşağıda).

- [ ] **Step 1: ui/today.tsx'i yaz**

`mobile/src/ui/today.tsx` (yeni — TAMAMI):

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Sub, palette } from './kit';
import type {
  ParentToday, StudentToday, TeacherToday, TodayEtut, TodayLesson, TodayOdevItem,
} from '../api/types';

// Bugün ekranı rol bileşenleri (spec §5.1). Veri sözleşmesi TodayResponse (Task 3):
// modül alanı null ise kart HİÇ render edilmez (kurum konfigürasyonuna saygı).
// Para: TR biçimi; ödeme başlatma YOK (spec §11 — PayTR mobilde gösterilmez).

const tl = (n: number) => `₺${n.toLocaleString('tr-TR')}`;

function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.cardTitle}>{children}</Text>;
}

function LessonRows({ lessons, empty }: { lessons: TodayLesson[]; empty: string }) {
  if (lessons.length === 0) return <Sub>{empty}</Sub>;
  return (
    <View>
      {lessons.map((l, i) => (
        <View key={`${l.slotId}-${i}`} style={s.row}>
          <Text style={s.rowTime}>{l.slotLabel}</Text>
          <View style={s.rowMain}>
            <Text style={s.rowTitle}>{l.branch || 'Ders'}</Text>
            <Text style={s.rowSub}>{l.teacherName}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function EtutRows({ etuts, empty, showStudent }: { etuts: TodayEtut[]; empty: string; showStudent?: boolean }) {
  if (etuts.length === 0) return <Sub>{empty}</Sub>;
  return (
    <View>
      {etuts.map((e) => (
        <View key={e.id} style={s.row}>
          <Text style={s.rowTime}>{`${e.start}–${e.end}`}</Text>
          <View style={s.rowMain}>
            <Text style={s.rowTitle}>
              {showStudent ? (e.booked ? e.studentName || 'Dolu' : 'Boş') : e.branch || 'Etüt'}
            </Text>
            <Text style={s.rowSub}>{showStudent ? e.branch || '' : e.teacherName}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function OdevCard({ odev }: { odev: { pending: number; items: TodayOdevItem[] } }) {
  return (
    <Card>
      <CardTitle>Bekleyen ödevler ({odev.pending})</CardTitle>
      {odev.pending === 0 ? (
        <Sub>Bekleyen ödev yok.</Sub>
      ) : (
        <View>
          {odev.items.map((o) => (
            <View key={o.id} style={s.row}>
              <View style={s.rowMain}>
                <Text style={s.rowTitle}>{o.title}</Text>
                <Text style={[s.rowSub, o.overdue && { color: palette.danger, fontWeight: '700' }]}>
                  {o.branch}
                  {o.dueDate ? ` · son gün ${o.dueDate}` : ''}
                  {o.overdue ? ' · gecikti' : ''}
                </Text>
              </View>
            </View>
          ))}
          {odev.pending > odev.items.length ? <Sub>… ve {odev.pending - odev.items.length} ödev daha</Sub> : null}
        </View>
      )}
    </Card>
  );
}

export function StudentTodayView({ data }: { data: StudentToday }) {
  return (
    <View>
      <Card>
        <CardTitle>Bugünün dersleri</CardTitle>
        <LessonRows lessons={data.lessons} empty="Bugün dersin yok." />
      </Card>
      {data.etuts !== null ? (
        <Card>
          <CardTitle>Bugünkü etütlerim</CardTitle>
          <EtutRows etuts={data.etuts} empty="Bugün etüt rezervasyonun yok." />
        </Card>
      ) : null}
      {data.odev ? <OdevCard odev={data.odev} /> : null}
      {data.davranis || data.deneme ? (
        <Card>
          <CardTitle>Özet</CardTitle>
          {data.davranis ? <Text style={s.statLine}>Davranış puanı: {data.davranis.total}</Text> : null}
          {data.deneme ? (
            <Text style={s.statLine}>
              Son deneme: {data.deneme.name} — {data.deneme.toplamNet} net
              {data.deneme.rank ? ` (${data.deneme.rank}/${data.deneme.total})` : ''}
            </Text>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

export function ParentTodayView({
  data,
  brand,
  onSelectChild,
}: {
  data: ParentToday;
  brand: string;
  onSelectChild: (id: string) => void;
}) {
  const c = data.child;
  return (
    <View>
      {data.children.length > 1 ? (
        <View style={s.chips}>
          {data.children.map((ch) => {
            const active = c?.id === ch.id;
            return (
              <Pressable
                key={ch.id}
                onPress={() => onSelectChild(ch.id)}
                style={[s.chip, active && { borderColor: brand, backgroundColor: '#fff' }]}
              >
                <Text style={[s.chipLabel, active && { color: brand, fontWeight: '700' }]}>{ch.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {!c ? (
        <Card>
          <Sub>Öğrenci kaydı bulunamadı.</Sub>
        </Card>
      ) : (
        <View>
          <Card>
            <CardTitle>
              {c.name} — bugünün dersleri
            </CardTitle>
            <LessonRows lessons={c.lessons} empty="Bugün ders görünmüyor." />
          </Card>
          {c.etuts !== null ? (
            <Card>
              <CardTitle>Bugünkü etütleri</CardTitle>
              <EtutRows etuts={c.etuts} empty="Bugün etüt rezervasyonu yok." />
            </Card>
          ) : null}
          {c.odev ? <OdevCard odev={c.odev} /> : null}
          {c.finance ? (
            <Card>
              <CardTitle>Ödeme durumu</CardTitle>
              <Text style={s.statLine}>Kalan borç: {tl(c.finance.balance)}</Text>
              {c.finance.nextInstallment ? (
                <Text style={s.statLine}>
                  Sıradaki taksit: {tl(c.finance.nextInstallment.amount)}
                  {c.finance.nextInstallment.dueDate ? ` — ${c.finance.nextInstallment.dueDate}` : ''}
                </Text>
              ) : null}
              {c.finance.overdueCount > 0 ? (
                <Text style={[s.statLine, { color: palette.danger, fontWeight: '700' }]}>
                  Vadesi geçmiş {c.finance.overdueCount} taksit var.
                </Text>
              ) : null}
              <Sub>Ödeme işlemleri için kurumunuzla iletişime geçin.</Sub>
            </Card>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function TeacherTodayView({ data }: { data: TeacherToday }) {
  return (
    <View>
      <Card>
        <CardTitle>Bugünkü programım</CardTitle>
        {data.lessons.length === 0 ? (
          <Sub>Bugün programında ders görünmüyor.</Sub>
        ) : (
          <View>
            {data.lessons.map((l, i) => (
              <View key={`${l.slotId}-${i}`} style={s.row}>
                <Text style={s.rowTime}>{l.slotLabel}</Text>
                <View style={s.rowMain}>
                  <Text style={s.rowTitle}>
                    {l.type === 'ders' ? `${l.cls || ''} ${l.branch}`.trim() : l.studentName || 'Etüt'}
                  </Text>
                  <Text style={s.rowSub}>{l.type === 'ders' ? 'Ders' : 'Etüt'}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
      {data.etuts !== null ? (
        <Card>
          <CardTitle>Bugünkü etüt blokları</CardTitle>
          <EtutRows etuts={data.etuts} empty="Bugün etüt bloğun yok." showStudent />
        </Card>
      ) : null}
    </View>
  );
}

export function ManagementTodayView({ brand }: { brand: string }) {
  return (
    <Card>
      <CardTitle>Yönetim paneli</CardTitle>
      <Sub>Program oluşturucu, muhasebe, CRM ve kurum ayarları web panelinde.</Sub>
      <Button label="Paneli aç" onPress={() => router.push('/web')} color={brand} />
    </Card>
  );
}

const s = StyleSheet.create({
  cardTitle: { fontSize: 16, fontWeight: '600', color: palette.text, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  rowTime: { fontSize: 13, fontWeight: '700', color: palette.sub, minWidth: 88 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: palette.text },
  rowSub: { fontSize: 13, color: palette.sub, marginTop: 1 },
  statLine: { fontSize: 15, color: palette.text, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.card,
  },
  chipLabel: { fontSize: 14, color: palette.text },
});
```

- [ ] **Step 2: bugun.tsx'i gerçek içerikle değiştir**

`mobile/src/app/(tabs)/bugun.tsx` TAMAMINI şu içerikle değiştir (push kartı + izin/rotasyon efektleri Plan 3'ten AYNEN taşınır — davranış değişmez):

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../../store/session';
import { useUnreadBadge } from '../../store/badge';
import { ApiError } from '../../api/client';
import {
  currentPermission, enablePush, refreshRegistration, watchTokenRotation,
  type EnableResult, type RegisterBase,
} from '../../push';
import { Screen, Title, Sub, Card, Button, ErrorText, palette } from '../../ui/kit';
import { StudentTodayView, ParentTodayView, TeacherTodayView, ManagementTodayView } from '../../ui/today';
import { rolEtiketi } from '../../rol';
import type { TodayResponse } from '../../api/types';

export default function BugunEkrani() {
  const { org, session, api, installationId, appVersion, rotateInstallationId } = useSession();
  const { setUnread } = useUnreadBadge();
  const brand = org?.themeColor || palette.brandFallback;
  const [perm, setPerm] = useState<EnableResult | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const base: RegisterBase | null = useMemo(
    () => (installationId ? { installationId, platform: 'android', appVersion } : null),
    [installationId, appVersion],
  );

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const q = childId ? `?child=${encodeURIComponent(childId)}` : '';
      const r = await api.get<TodayResponse>(`/api/mobile/v1/screens/today${q}`);
      setToday(r);
      setUnread(r.unreadNotifications);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Bugün yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api, childId, setUnread]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Soğuk açılış: izin varsa sessiz yeniden kayıt + rotasyon dinleyicisi (Plan 3 — aynen).
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

  // Ayarlar'dan izin değişimi: ön plana dönüşte tazele (Plan 3 — aynen).
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
      <ScrollView
        style={s.wrap}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} colors={[brand]} />}
      >
        <Sub>{org?.name}</Sub>
        <Title>Merhaba{session?.name ? `, ${session.name}` : ''}</Title>
        <Text style={s.role}>
          {rolEtiketi(session?.role)}
          {today ? ` · ${today.dayLabel}` : ''}
        </Text>

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

        {error ? <ErrorText>{error}</ErrorText> : null}
        {!today && !error ? <Sub>Yükleniyor…</Sub> : null}
        {today?.role === 'student' ? <StudentTodayView data={today} /> : null}
        {today?.role === 'parent' ? <ParentTodayView data={today} brand={brand} onSelectChild={setChildId} /> : null}
        {today?.role === 'teacher' ? <TeacherTodayView data={today} /> : null}
        {today?.role === 'management' ? <ManagementTodayView brand={brand} /> : null}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  role: { fontSize: 14, color: palette.sub, marginTop: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: palette.text, marginBottom: 4 },
});
```

Not: eski `Link href="/ayarlar"` satırı kalkar (Ayarlar artık tab'da).

- [ ] **Step 3: Tip + test kontrolü**

Çalıştır: `cd mobile && npx tsc --noEmit && npx vitest run`
Beklenen: temiz.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/ui/today.tsx "mobile/src/app/(tabs)/bugun.tsx"
git commit -m "feat(mobil): Bugün gerçek içerik — öğrenci/veli/öğretmen rol kartları + yönetim WebView girişi + pull-to-refresh"
```

---

### Task 9: Push tap → eventId routing + deep link + inbox "İlgili ekranı aç"

Push'a dokununca uygulama Bildirimler'e `focus=<eventId>` ile gider (spec §6/6: foreground/background/killed üç durumda da; oturum yoksa BEKLEYEN ROTA olarak tutulur, login sonrası uygulanır). Inbox item'ında url eşlemesi "İlgili ekranı aç" aksiyonunu üretir: yönetim → WebView(path), diğer roller → Bugün. `okulin://` scheme deep link'leri expo-router tarafından zaten rotalara eşlenir (app.json `scheme: "okulin"` Plan 3'ten beri var) — bu task push-payload yolunu kurar; `assetlinks.json`/https App Links Plan 5 (ADR).

**Files:**
- Create: `mobile/src/notification-routing.ts`
- Create: `mobile/src/notification-routing.test.ts`
- Modify: `mobile/src/app/_layout.tsx` (NotificationRouter)
- Modify: `mobile/src/app/(tabs)/bildirimler.tsx` ("İlgili ekranı aç")

**Interfaces:**
- Consumes: FCM `data.eventId` (Plan 3'te sunucu göndermeye başladı — `lib/push/providers.ts` `data: { eventId }`), `roleCategoryOf` (Task 7), `/bildirimler` focus işleme (Task 6), `/web` (Task 7), `useSession().status` (bekleyen rota kapısı).
- Produces: `eventIdFrom(data: unknown): string | null` · `targetForUrl(url, roleCategory): { type:'today' } | { type:'web'; path: string } | null`.

- [ ] **Step 1: Başarısız yönlendirme testlerini yaz**

`mobile/src/notification-routing.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { eventIdFrom, targetForUrl } from './notification-routing';

describe('eventIdFrom — FCM data payload\'ından eventId', () => {
  it('geçerli eventId döner', () => {
    expect(eventIdFrom({ eventId: 'ne_abc123', url: '/' })).toBe('ne_abc123');
  });
  it('eksik/boş/yanlış tipte null', () => {
    expect(eventIdFrom({})).toBeNull();
    expect(eventIdFrom({ eventId: '' })).toBeNull();
    expect(eventIdFrom({ eventId: 42 })).toBeNull();
    expect(eventIdFrom(null)).toBeNull();
    expect(eventIdFrom(undefined)).toBeNull();
  });
});

describe('targetForUrl — inbox "İlgili ekranı aç" eşlemesi', () => {
  it('yönetim: path korunarak WebView', () => {
    expect(targetForUrl('/?tab=takvim', 'management')).toEqual({ type: 'web', path: '/?tab=takvim' });
    expect(targetForUrl('/', 'management')).toEqual({ type: 'web', path: '/' });
  });
  it('öğrenci/veli/öğretmen: içerik kartları Bugün\'de', () => {
    expect(targetForUrl('/?tab=odev', 'student')).toEqual({ type: 'today' });
    expect(targetForUrl('/?sekme=odeme', 'parent')).toEqual({ type: 'today' });
    expect(targetForUrl('/?tab=davranis', 'teacher')).toEqual({ type: 'today' });
  });
  it('kök url native rollerde aksiyon üretmez (zaten inbox\'tayız)', () => {
    expect(targetForUrl('/', 'student')).toBeNull();
  });
  it('güvenlik: mutlak/protokol-göreli/boş url reddedilir', () => {
    expect(targetForUrl('https://evil.com/x', 'management')).toBeNull();
    expect(targetForUrl('//evil.com', 'management')).toBeNull();
    expect(targetForUrl('', 'student')).toBeNull();
    expect(targetForUrl(null, 'management')).toBeNull();
  });
  it('rol yoksa aksiyon yok', () => {
    expect(targetForUrl('/?tab=odev', null)).toBeNull();
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Çalıştır: `cd mobile && npx vitest run src/notification-routing.test.ts`
Beklenen: FAIL — modül yok.

- [ ] **Step 3: notification-routing.ts'i yaz**

`mobile/src/notification-routing.ts` (yeni — TAMAMI):

```typescript
import type { RoleCategory } from './rol';

// Push tap yönlendirmesi (spec §6/6, plan ADR'si): hedef HER ZAMAN Bildirimler
// (+focus) — inbox tam içeriği gösterir ve okundu işaretler. Rol-başına derin
// native rota eşlemesi detay ekranları gelince (Plan 5+).

// FCM data payload'ından eventId (sunucu lib/push/providers.ts data.eventId gönderir).
export function eventIdFrom(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const v = (data as Record<string, unknown>).eventId;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Inbox item aksiyonu: NotificationEvent.url web path'i taşır (/?tab=odev,
// /?sekme=odeme...). Yönetim WebView'e path'le gider; native roller Bugün'e
// (ilgili kartlar orada). Yalnız aynı-origin path kabul (// ve mutlak URL ret).
export type UrlTarget = { type: 'today' } | { type: 'web'; path: string } | null;

export function targetForUrl(url: string | null | undefined, role: RoleCategory | null): UrlTarget {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return null;
  if (role === 'management') return { type: 'web', path: url };
  if (role === null) return null;
  if (url === '/') return null; // kök: inbox'tan gidilecek ek ekran yok
  return { type: 'today' };
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Çalıştır: `cd mobile && npx vitest run src/notification-routing.test.ts`
Beklenen: PASS.

- [ ] **Step 5: _layout.tsx'e NotificationRouter ekle**

`mobile/src/app/_layout.tsx` TAMAMINI şu içerikle değiştir:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '../config';
import { SessionProvider, useSession } from '../store/session';
import { UnreadBadgeProvider } from '../store/badge';
import { BootstrapGate } from '../ui/Gate';
import { eventIdFrom } from '../notification-routing';

// Crash raporlama (spec §17, 3/3 karar): EU/Frankfurt, PII kapalı, replay YOK,
// dev'de kapalı. Kullanıcı kimliği Sentry'ye GÖNDERİLMEZ.
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

// Push tap yönlendirmesi (spec §6/6): foreground/background tap listener + killed
// (soğuk açılış) son yanıt. Oturum hazır değilse BEKLEYEN ROTA — login/kurum akışı
// bitince uygulanır. Dedupe (İnceleme Codex #14): soğuk açılışta getLastNotification-
// ResponseAsync ile canlı listener AYNI yanıtı yarışabilir — identifier set'i tek
// işlenmeyi garantiler (clearLast... ayrıca sonraki açılışlara sızmayı keser).
function NotificationRouter() {
  const { status } = useSession();
  // Navigator mount olmadan router.push atılmaz (İnceleme Gemini #2: Gate 'checking'
  // iken status 'ready' olabilir — Stack henüz ekranda değilken push çökerdi).
  const rootNav = useRootNavigationState();
  const [pending, setPending] = useState<{ focus: string | null } | null>(null);
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    const accept = (resp: Notifications.NotificationResponse) => {
      const key = `${resp.notification.request.identifier}:${resp.actionIdentifier}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      setPending({ focus: eventIdFrom(resp.notification.request.content.data) });
    };
    let mounted = true;
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (!mounted || !resp) return;
      accept(resp);
      void Notifications.clearLastNotificationResponseAsync();
    });
    const sub = Notifications.addNotificationResponseReceivedListener(accept);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!pending || status !== 'ready') return; // login/kurum bekleniyor — rota bekler
    if (!rootNav?.key) return; // Stack henüz mount olmadı (Gate checking) — bekle
    router.push(pending.focus ? { pathname: '/bildirimler', params: { focus: pending.focus } } : '/bildirimler');
    setPending(null);
  }, [pending, status, rootNav?.key]);

  return null;
}

function RootLayout() {
  return (
    <SessionProvider>
      <UnreadBadgeProvider>
        <NotificationRouter />
        <BootstrapGate>
          <Stack screenOptions={{ headerShown: false }} />
        </BootstrapGate>
      </UnreadBadgeProvider>
    </SessionProvider>
  );
}

export default Sentry.wrap(RootLayout);
```

- [ ] **Step 6: bildirimler.tsx'e "İlgili ekranı aç" ekle**

`mobile/src/app/(tabs)/bildirimler.tsx`:

(a) import'lara ekle:

```tsx
import { router } from 'expo-router';
import { roleCategoryOf } from '../../rol';
import { targetForUrl } from '../../notification-routing';
```

(b) bileşen başında `session`'ı da al: `const { api, org, session } = useSession();`

(c) `renderItem` içinde tarih satırının ALTINA aksiyon butonu ekle:

```tsx
              {(() => {
                const t = targetForUrl(item.url, roleCategoryOf(session?.role));
                if (!t) return null;
                return (
                  <Button
                    label="İlgili ekranı aç"
                    variant="ghost"
                    color={brand}
                    onPress={() => {
                      if (!item.read) void markRead(item.id);
                      if (t.type === 'today') router.push('/bugun');
                      else router.push({ pathname: '/web', params: { path: t.path } });
                    }}
                  />
                );
              })()}
```

- [ ] **Step 7: Tip + test kontrolü**

Çalıştır: `cd mobile && npx tsc --noEmit && npx vitest run`
Beklenen: temiz (yeni 2 describe dahil).

- [ ] **Step 8: Commit**

```bash
git add mobile/src/notification-routing.ts mobile/src/notification-routing.test.ts mobile/src/app/_layout.tsx "mobile/src/app/(tabs)/bildirimler.tsx"
git commit -m "feat(mobil): push tap yönlendirmesi — eventId→Bildirimler(focus), soğuk açılış + bekleyen rota, inbox 'İlgili ekranı aç' eşlemesi"
```

---

### Task 10: QR ile kurum kodu

Kurum ekranına "QR kod ile tara" girişi (spec §5.1/§6-1): kamera izni kullanıcı eylemiyle, `CameraView` QR tarar, içerikten kod çıkarılır (`extractOrgCode` — düz kod VEYA okulin.com URL'i), mevcut resolve-org akışına beslenir. resolve-org çağrısı ortak helper'a (`org.ts`) taşınır — kurum.tsx ve kurum-qr.tsx aynı yolu kullanır (allowlist kontrolü tek yerde).

**Files:**
- Modify: `mobile/package.json` (`npx expo install expo-camera`)
- Modify: `mobile/app.json` (expo-camera plugin + izin metni)
- Create: `mobile/src/org.ts`
- Create: `mobile/src/org.test.ts`
- Modify: `mobile/src/app/kurum.tsx` (helper'a geçiş + QR linki)
- Create: `mobile/src/app/kurum-qr.tsx`

**Interfaces:**
- Consumes: `fetchWithTimeout/BOOT_TIMEOUT_MS` (Task 5), `OrgInfo`/`saveOrg` (session), `isAllowedHost` (config), `ResolveOrgResponse` (types).
- Produces: `extractOrgCode(raw: string): string | null` · `resolveOrgByCode(code: string): Promise<{ ok: true; org: OrgInfo } | { ok: false; error: string }>` · `/kurum-qr` rotası.
- Native modül: expo-camera — cihazda Task 11 rebuild'ini bekler.

- [ ] **Step 1: Kamera paketini kur + plugin**

```bash
cd mobile && npx expo install expo-camera
```

`mobile/app.json` `plugins` dizisine ekle (mevcut girdilerin yanına):

```json
      [
        "expo-camera",
        {
          "cameraPermission": "Kurum QR kodunu taramak için kamera izni gerekir.",
          "recordAudioAndroid": false
        }
      ]
```

(`recordAudioAndroid: false` — İnceleme Codex #15: plugin varsayılanı `true` olup QR tarayan uygulamaya gereksiz `RECORD_AUDIO` izni eklerdi; mağaza incelemesinde de soru işareti yaratır.)

- [ ] **Step 2: Başarısız extractOrgCode testlerini yaz**

`mobile/src/org.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { extractOrgCode } from './org';

describe('extractOrgCode — QR içeriğinden kurum kodu', () => {
  it('düz kod: trim + büyük harf', () => {
    expect(extractOrgCode(' 7jt-psh ')).toBe('7JT-PSH');
    expect(extractOrgCode('7JT-PSH')).toBe('7JT-PSH');
  });
  it('okulin.com URL query paramı (code/kod)', () => {
    expect(extractOrgCode('https://okulin.com/?code=7jt-psh')).toBe('7JT-PSH');
    expect(extractOrgCode('https://okulin.com/kayit?kod=7JT-PSH&x=1')).toBe('7JT-PSH');
  });
  it('okulin.com URL son path segmenti', () => {
    expect(extractOrgCode('https://okulin.com/m/kurum/7JT-PSH')).toBe('7JT-PSH');
  });
  it('yabancı host URL reddedilir (kod sızdırma/oltalama QR\'ı)', () => {
    expect(extractOrgCode('https://evil.com/?code=7JT-PSH')).toBeNull();
    expect(extractOrgCode('https://okulin.com.evil.com/?code=X')).toBeNull();
  });
  it('boş / aşırı uzun / rastgele içerik null', () => {
    expect(extractOrgCode('')).toBeNull();
    expect(extractOrgCode('   ')).toBeNull();
    expect(extractOrgCode('x'.repeat(64))).toBeNull();
    expect(extractOrgCode('https://okulin.com/')).toBeNull(); // ne query ne segment
  });
});
```

- [ ] **Step 3: Testlerin başarısız olduğunu doğrula**

Çalıştır: `cd mobile && npx vitest run src/org.test.ts`
Beklenen: FAIL — modül yok.

- [ ] **Step 4: org.ts'i yaz**

`mobile/src/org.ts` (yeni — TAMAMI):

```typescript
import { APEX_BASE, isAllowedHost } from './config';
import { fetchWithTimeout, BOOT_TIMEOUT_MS } from './api/http';
import type { OrgInfo } from './store/session';
import type { ResolveOrgResponse } from './api/types';

// Kurum keşfi ortak yolu (spec §6): elle kod girişi (kurum.tsx) + QR (kurum-qr.tsx)
// aynı çözümlemeden geçer — allowlist kontrolü tek yerde.

// QR/elle giriş içeriğinden kurum kodu: düz kod ("7JT-PSH") VEYA okulin.com URL'i
// (?code=/?kod= paramı ya da son path segmenti). Yabancı host URL'leri REDDEDİLİR
// (oltalama QR'ı gate'e kod deneme yaptıramaz). Kod doğrulaması sunucuda (resolve-org).
export function extractOrgCode(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (!/(^|\.)okulin\.com$/i.test(u.hostname)) return null;
      const q = u.searchParams.get('code') || u.searchParams.get('kod');
      if (q && q.trim()) return q.trim().toUpperCase();
      const seg = u.pathname.split('/').filter(Boolean).pop();
      return seg && seg.trim() ? seg.trim().toUpperCase() : null;
    } catch {
      return null;
    }
  }
  if (s.length > 32) return null; // kurum kodu değil (rastgele QR içeriği)
  return s.toUpperCase();
}

export type ResolveOutcome = { ok: true; org: OrgInfo } | { ok: false; error: string };

// Kod → kurum (apex resolve-org). İstemci YALNIZ dönen canonicalHost'a bağlanır;
// allowlist dışı host reddedilir (spec §6/3 — kurum.tsx'ten taşındı, davranış aynı).
export async function resolveOrgByCode(code: string): Promise<ResolveOutcome> {
  try {
    const res = await fetchWithTimeout(
      fetch,
      `${APEX_BASE}/api/mobile/v1/resolve-org`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      },
      BOOT_TIMEOUT_MS,
    );
    const j = (await res.json().catch(() => null)) as (Partial<ResolveOrgResponse> & { error?: string }) | null;
    if (!res.ok || !j?.ok || !j.canonicalHost) {
      return { ok: false, error: j?.error ?? 'Kurum bulunamadı. Kodu kontrol edin.' };
    }
    if (!isAllowedHost(j.canonicalHost)) {
      return { ok: false, error: 'Kurum adresi doğrulanamadı.' };
    }
    return {
      ok: true,
      org: {
        orgSlug: j.orgSlug!,
        canonicalHost: j.canonicalHost,
        name: j.name!,
        shortName: j.shortName!,
        logoUrl: j.logoUrl ?? '',
        themeColor: j.themeColor!,
      },
    };
  } catch {
    return { ok: false, error: 'Bağlantı kurulamadı. İnternetinizi kontrol edin.' };
  }
}
```

- [ ] **Step 5: Testlerin geçtiğini doğrula**

Çalıştır: `cd mobile && npx vitest run src/org.test.ts`
Beklenen: PASS.

- [ ] **Step 6: kurum.tsx'i helper'a geçir + QR linki ekle**

`mobile/src/app/kurum.tsx` TAMAMINI şu içerikle değiştir (davranış aynı; fetch → resolveOrgByCode; "QR kod ile tara" butonu eklenir):

```tsx
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
    await saveOrg(r.org);
    setBusy(false);
    router.replace('/giris');
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
```

- [ ] **Step 7: kurum-qr.tsx'i yaz**

`mobile/src/app/kurum-qr.tsx` (yeni — TAMAMI):

```tsx
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
```

- [ ] **Step 8: Tip + test kontrolü**

Çalıştır: `cd mobile && npx tsc --noEmit && npx vitest run`
Beklenen: temiz.

- [ ] **Step 9: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/src/org.ts mobile/src/org.test.ts mobile/src/app/kurum.tsx mobile/src/app/kurum-qr.tsx
git commit -m "feat(mobil): QR ile kurum kodu — expo-camera, extractOrgCode (yabancı host reddi), resolve-org ortak yolu"
```

---

### Task 11: Rebuild + konsolide cihaz doğrulaması (Mustafa ile)

Yeni native modüller (react-native-webview, expo-camera) dev client'a girsin diye telefon build'i yenilenir; sonra tüm Plan 4 yüzeyi gerçek cihazda tek turda doğrulanır — Plan 3'ten devreden **sensitive-push kilit ekranı testi** dahil. Cihaz gerektiren adımlar Mustafa ile yürütülür (plan bu adımları "CİHAZ" ile işaretler).

**Files:** (kod değişikliği beklenmez; bulgu çıkarsa ayrı fix commit'leri)

**Ön koşullar:** telefon USB'de + `adb devices` görüyor; Metro için `adb reverse tcp:8081 tcp:8081` (Plan 3 dersi — telefon Wi-Fi'siz).

- [ ] **Step 1: CİHAZ — rebuild**

```bash
cd mobile && npx expo run:android
```

Beklenen: build başarılı, uygulama telefonda açılıyor. (İlk build'de Gradle yeni native modülleri derler — birkaç dakika.)

- [ ] **Step 2: CİHAZ — Bugün içerik turu (3+1 rol)**

1. **Öğrenci** (OKULIN_STU hesabı): Bugün'de günün dersleri/etütler/ödev/özet kartları makul veriyle görünür; pull-to-refresh çalışır; sekmeler geçer.
2. **Öğretmen** (OKULIN_TEA): bugünkü program + etüt blokları.
3. **Veli** (testkurs'ta parentPhone'u bilinen bir öğrencinin velisi): çocuk kartları + ödeme özeti (ödeme BUTONU OLMADIĞI doğrulanır — spec §11); birden çok çocuk varsa seçici.
4. **Müdür** (OKULIN_DIR): management karşılama + "Paneli aç".

- [ ] **Step 3: CİHAZ — bildirim merkezi + push tap (üç durum)**

1. Müdür web'den öğrenciye duyuru gönderir → telefonda (öğrenci oturumu) push gelir; Bildirimler'de tam içerik, okunmamış rozeti tab'da.
2. **Foreground** tap: banner'a dokun → Bildirimler + ilgili item vurgulu + okundu.
3. **Background** tap: uygulama arka planda → bildirime dokun → aynı davranış.
4. **Killed** tap: uygulamayı kapat (recent'ten at) → bildirime dokun → soğuk açılış → Bildirimler'e düşer.
5. **Bekleyen rota**: çıkış yap → duyuru push'u gelsin → dokun → login ekranı → giriş → Bildirimler otomatik açılır.
6. "Tümünü okundu say" → rozet sıfırlanır.

- [ ] **Step 4: CİHAZ — sensitive-push kilit ekranı (Plan 3 devri)**

1. Telefonda VELİ oturumu açık + bildirim izni verili; ekran kilitli.
2. Web'den öğretmen, velinin çocuğuna bugünün bir dersinde 'yok' işaretler (yoklama) → `notifyAbsentParents` sensitive push üretir.
3. **Kilit ekranında**: "Yeni bildiriminiz var / Detayları görmek için okulin uygulamasını açın" JENERİK metni — öğrenci adı/devamsızlık detayı GÖRÜNMEZ (spec §8 gizlilik).
4. Uygulama açılınca Bildirimler'de TAM içerik görünür.
5. Test yoklaması web'den geri alınır.

- [ ] **Step 5: CİHAZ — WebView turu (müdür)**

1. "Paneli aç" → panel cookie'li açılır (login ekranı DEĞİL).
2. Panel içinde gezinme (muhasebe/ayarlar) çalışır; Android geri tuşu WebView geçmişinde geri gider, geçmiş bitince ekrandan çıkar.
3. Dış link (varsa PDF/harici) sistem tarayıcısında açılır.
4. Uygulamayı 15+ dk arka planda bırakıp dönünce panel yeniden açılabilir (tek-retry/yeni exchange).
5. Panelde tarayıcı push-izin diyaloğu ÇIKMAZ (isPushSupported WebView'de false — ADR); çıkarsa veya belirgin görsel bozulma (klavye/viewport) varsa bulgu olarak not edilir (is-mobile-app CSS sınıfı o zaman gündeme gelir).

- [ ] **Step 6: CİHAZ — QR + deep link + Gate + timeout smoke**

1. QR: kurumdan ayrıl → kurum ekranı → "QR kod ile tara" → izin akışı → `7JT-PSH` içerikli bir QR (herhangi bir üreticiyle, düz metin) taranır → giriş ekranı testkurs markasıyla açılır.
2. Deep link smoke: `adb shell am start -a android.intent.action.VIEW -d "okulin://bildirimler"` → uygulama Bildirimler'de açılır.
3. Gate yeniden kontrolü: superadmin'den bakım modu AÇ → uygulama arka plana → 60+ sn sonra ön plana → bakım ekranı görünür → bakımı KAPAT → "Yeniden dene" → normal akış.
4. Timeout: uçak modu → Bugün'de pull-to-refresh → ~10-15 sn içinde makul hata mesajı (sonsuz spinner YOK).

- [ ] **Step 7: Final koşular**

```bash
cd mobile && npx tsc --noEmit && npx vitest run
cd .. && npx vitest run && npm run build
npx playwright test e2e/int-mobile-auth.spec.js e2e/int-mobile-push.spec.js e2e/int-mobile-content.spec.js --project=int
```

Beklenen: hepsi yeşil (rate-limit penceresine dikkat).

- [ ] **Step 8: Bulgular + commit + push**

Cihaz turunda çıkan düzeltmeler ayrı `fix(mobil):` commit'leriyle işlenir; tur temizse kalan değişiklikler push edilir. Ledger (`.superpowers/sdd/progress.md`) PLAN 4 bölümü kapatılır; memory (`native-app-girisi.md`) Plan 4 sonucu + Plan 5'e devirlerle güncellenir (subagent-driven-development süreci).

---

## Plan Sonu Notları

- **Plan 5'e bilinen devirler:** assetlinks.json + https App Links (release keystore ile), EAS release hattı + source-map upload (SENTRY_AUTH_TOKEN), mağaza hazırlığı (listing/data safety), detay ekranları (program haftalık görünüm, ödev/deneme detayı) + inbox'tan derin native rotalar, bildirim kategori tercihleri (spec §5.1 — inbox v1 tercihsiz), offline okuma cache'i (inbox/today cache), duyuru okundu senkronu (web↔mobil), devamsızlık görünümü (İSTİŞARE SONRASI), veli int-test creds'i, "enerjik görsel yön" tema turu (İSTİŞARE/mockup onayı sonrası), `html.is-mobile-app` CSS sınıfı (yalnız cihazda sorun gözlenirse).
- **Görev sırası bilinçli:** backend (1-4) önce canlıya çıkar → mobil task'lar (5-10) canlı uçlara karşı geliştirilir → tek rebuild + tek konsolide cihaz turu (11). Task 6-10 arası cihaz doğrulaması YOK (tsc+vitest kapıları yeter) — Plan 3'te işleyen desen.





