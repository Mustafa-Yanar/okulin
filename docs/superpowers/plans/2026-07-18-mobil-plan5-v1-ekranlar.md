# Mobil Plan 5/6 — v1 Native Ekran Tamamlama (etüt rezervasyon + haftalık program + ödev + şifre + bildirim tercihleri + eski-WebView + derin rotalar) Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** okulin native mobil uygulamanın v1 ekranlarını tamamlamak — en kritik eksik olan **etüt görüntüleme + rezervasyon** akışı (öğrenci self-servis; iş kuralları web'de mevcut, mobil uçlar + native ekran eklenir), **haftalık program görünümü** (öğrenci/veli/öğretmen), **ödev listesi + teslim** (öğrenci teslim; öğrenci/veli görüntüleme), **bildirim kategori tercihleri** (yeni backend altyapısı + native ekran), **mobilde şifre değiştirme** (`mustChangePassword` boşluğu + zorunlu değişim kapısı), **eski-WebView tespiti + güncelleme uyarısı** (Plan 4 tur bulgusu), ve **inbox'tan derin native rotalar**.

**Architecture:** Mevcut `/api/mobile/v1` BFF deseni genişletilir — her yeni uç `withMobileAuth` (Bearer + fail-closed tenant + iptal kontrolü) ile korunur. **İş kuralları servis katmanına çıkarılır**, hem web route hem mobil route aynı servisi çağırır (spec §9/6): etüt rezervasyon kuralları `app/api/etut-sablon/rezervasyon/route.ts`'ten `lib/etut/rezervasyon.ts`'e (davranış-koruyan), şifre değişimi `app/api/auth/route.ts`'ten `lib/password.ts`'e (davranış-koruyan); ödev (`lib/odev.ts`) zaten servis — mobil route yalnız sarar. Haftalık program `lib/mobile/today.ts` yardımcılarını 7 güne genişletir (`lib/mobile/week.ts` + tek-sorgu `getWeekCellsAllTeachers`). Bildirim tercihleri **yeni** `NotificationPreference` tablosu + `categoryOf(tag)` saf fonksiyonu; enforcement push fan-out'ta (`enqueueNotification`) — muted kategori **push'a çıkmaz ama inbox'a yazılır** (güvenlik kategorisi hariç, hep gider). Eski-WebView tespiti sunucu tarafında (`session-open` UA'dan `Chrome/(\d+)` parse) — köprü kurulmaz, mobil taraf değişmez. Tipler `lib/mobile/api-types.ts` → `mobile/src/api/types.ts` senkron zinciriyle paylaşılır. Yeni native ekranlar kök Stack rotaları (`src/app/<ad>.tsx`) — Plan 4 `web.tsx` deseniyle birebir. Backend önce canlıya (local commit → tek push + canlı doğrulama), sonra mobil ekranlar (tsc+vitest kapıları), sonra tek rebuild + konsolide cihaz turu.

**Tech Stack:** Backend: Next.js 14.2.5 + Prisma 6 / Neon Postgres + Upstash Redis (mevcut). Şema yönetimi `prisma db push` (migration klasörü YOK — `npm run db:push`). Mobil: Expo SDK 57 (RN 0.86, React 19.2) + mevcut yığın (react-native-webview 13.16, expo-camera, expo-notifications, Ionicons). **YENİ native modül YOK** (mevcut modüllerle yetinilir → Task 15 rebuild yalnız JS değişikliği + schema; native rebuild GEREKMEZ eğer yeni native paket eklenmezse). Build: yerel `npx expo run:android` + SM-M205F (USB).

**Spec:** `docs/superpowers/specs/2026-07-14-native-mobil-app-design.md` §5.1 (rol-bazlı native ekranlar: etüt görüntüleme+rezervasyon, program, ödev, kategori tercihleri, şifre), §5.2-5.4 (WebView sınırı + eski-WebView), §7 (şifre değişiminde oturum iptali), §8 (bildirim merkezi + kategori), §9 (ekran uçları + veri minimizasyonu + iş kuralları servis katmanına), §13 (test stratejisi: contract + tenant isolation + auth).

**Plan 4'ten devralınan Minor'lar (bu planda kapatılanlar):** #11 focus zaten-okunmuşa gereksiz markRead → Task 14 · #16 roleCategoryOf/guard test → Task 14 · #18 load() istek-iptal guard → Task 10/11 (yeni ekranlarda uygulanır) · #23 buton-içinde-buton cihaz QA → Task 15 tur · geri kalan Minor'lar (kozmetik) bilinçli bırakılır (bkz Plan 4 ledger).

## Karar Notları (ADR — bilinçli tercihler)

- **Etüt rezervasyon = ÖĞRENCİ self-servis, mobilde yalnız öğrenci yazar** (spec §5.1 "öğrenci: etüt görüntüleme + rezervasyon"). Web'de öğrenci `/api/etut-sablon/rezervasyon` ile kendini yazabiliyor (`withAuth('auth','etut')`, rol dallanmasında `student → session.id`); **veli rezerve EDEMEZ** (web'de else dalı 403). Mobil uç aynı sınırı korur: `POST/DELETE /api/mobile/v1/etut/reserve` yalnız öğrenci rolü. Öğretmen/müdür başkası-adına yazma web'de kalır (mobilde açılmaz). Öğretmen mobilde **etüt doluluğunu GÖRÜR** (haftalık programda), yazmaz.
- **İş kuralları servise çıkar (davranış-koruyan) — spec §9/6.** Etüt rezervasyon kuralları şu an `app/api/etut-sablon/rezervasyon/route.ts` içinde INLINE. `lib/etut/rezervasyon.ts`'e `reserveEtut(actor, input)`/`cancelEtut(actor, input)`/`listBookableEtuts(studentId, weekKey)` olarak çıkarılır; web route bu servisi çağırır (satır-satır davranış korunur, web regresyon testiyle kanıtlanır); mobil route aynı servisi `withMobileAuth` ardından çağırır. `studentBookedEtuts`'un N-sorgusu servis içinde `getAllProgramTemplates()` (Plan 4, tek-sorgu) ile değiştirilir — **aynı sonuç kümesi, daha az sorgu** (davranış-koruyan optimizasyon; web regresyonu bunu da kapsar).
- **Etüt config kapıları mobilde de UYGULANMAZ** (web etut-sablon yolu ile paritede): `studentSelfBooking`/`maxWeeklyPerStudent`/`cancelLockHours` (eski `/api/slots` yolunda vardı) yeni etut-sablon yolunda YOK. Mobil bu yolu birebir çağırdığından aynı davranışı sürdürür (öğrenci self-booking `etut` modülü açıksa her zaman açık). Bu bilinçli parite kararıdır; kapıları eklemek web+mobil ortak servise ayrı bir iş olur (Plan 6+ değerlendirme).
- **Haftalık program = SALT-OKUNUR görünüm, `today` ucundan AYRI `screens/week` ucu** (ADR-Plan4: "today ucu genişletilmez, ayrıntı ekranları ayrı uçlar"). `lib/mobile/today.ts`'in `collectClassDay`/`getTeacherWeekSlots` mantığı 7 güne genişletilir (`lib/mobile/week.ts`), veri modeli YOK yeni. Öğrenci/veli: 7 günün dersleri + kendi etütleri; öğretmen: 7 günün grid'i (ders + dolu etüt). `?week=` ile ±hafta gezinme (`shiftWeek`, `isEditableWeek` penceresiyle sınırlı DEĞİL — görüntüleme geçmiş/gelecek haftaları da gösterir; yalnız rezervasyon geçmişi engellenir).
- **Ödev mobil kapsamı = öğrenci teslim + öğrenci/veli görüntüleme.** Öğretmen ödev VERME/KONTROL (spec §5.1 teacher) Plan 5 DIŞI — create/check roster yönetimi ağır, kullanıcı Plan 5 kapsamını "ödev listesi + teslim" (öğrenci aksiyonu) olarak verdi. Öğretmen ödev yönetimi WebView'de (yönetim paneli) kalır / Plan 6+ native. `lib/odev.ts` servisi hazır (`listOdevForStudent`/`listOdevForParent`/`submitOdev`) — mobil route yalnız `withMobileAuth` sarar; **yeni iş mantığı YOK**.
- **`/api/odev` mobilde ÇAĞRILAMAZ** (kritik bulgu): web route `withAuth`→`getSession()` yalnız web cookie okur, mobil Bearer (aud=`okulin-mobile`) 401 alır. Bu yüzden ayrı `app/api/mobile/v1/odev/route.ts` (`withMobileAuth`) gerekir — servis fonksiyonlarını yeniden kullanır.
- **Bildirim kategori tercihleri: push-only suppression, inbox HER ZAMAN tam.** Muted kategori → o kullanıcıya **push gönderilmez** ama `NotificationEvent` (inbox kaydı) yine yazılır (kullanıcı uygulamada görebilir; kayıp yok). Enforcement `enqueueNotification`'ta: kategori `tag`'den türetilir (`categoryOf`), muted ise `deliveries` boş bırakılır (event yine oluşur, `dispatchStatus:'done'`). `dispatchDue` (cron retry) gönderimden önce tercihi YENİDEN denetler (enqueue'dan SONRA susturulan kategorinin pending teslimatı `dead` yapılır — İnceleme Codex #5). **Güvenlik kategorisi (`guvenlik` — yeni cihaz girişi) asla muted olamaz** (koddan zorlanır; UI'de gösterilmez/kilitli). Kategori tercihi = kullanıcı bazlı (role+userId), cihaz bazlı DEĞİL (tüm cihazlarda tutarlı).
- **Kategori = `tag` önekinden türetilir, şemaya `category` alanı EKLENMEZ.** `categoryOf(tag): NotifCategory` saf fonksiyon (`odev-*`→`odev`, `devamsizlik-*`→`devamsizlik`, `ann-*`→`duyuru`, `davranis-*`→`davranis`, `deneme-*`→`deneme`, `form-*`→`form`, `etkinlik-*`→`takvim`, `odeme-*`→`odeme`, `yeni-cihaz`→`guvenlik`; bilinmeyen→`duyuru` fail-open, bildirim asla susmaz). Tek YENİ tablo `NotificationPreference` (kullanıcının SUSTURDUĞU kategoriler; satır yoksa = açık varsayılan).
- **Şifre değişimi mobil: diğer oturumlar iptal + MEVCUT oturum korunur.** Web change_password TÜM mobil oturumları iptal eder (`revokeMobileSessionsFor`) → kullanıcı yeniden login. Mobil self-değişimde bu kullanıcıyı ANINDA logout ederdi (kötü UX). Mobil uç: `changePasswordFor` (ortak servis) sonrası `applyPasswordChange(sid, ...)` — **mevcut sid HARİÇ** diğer oturumları iptal eder, mevcut oturumun payload'ını `mustChangePassword:false` yapar, taze token çifti üretir (rotation), döner. Client yeni çifti yazar + session state'i günceller → zorunlu-değişim kapısı açılır.
- **Şifre değiştirme yalnız `mustChangePassword` alanı OLAN rollerde** (web paritesi): web change_password gerçek müdürü (`director` asst değil) ve org_admin'i 403 ile reddeder (bu roller alanı taşımaz). Mobil uç aynı: `student/parent/teacher/accountant/counselor` + `director&asst→assistantDirector`; gerçek director/org_admin → 403 (bu roller WebView'den web change_password kullanır). Yönetim rolleri native'de zaten WebView'e gider; native şifre ekranı pratikte öğrenci/veli/öğretmen içindir.
- **Eski-WebView tespiti SUNUCU tarafında — köprü kurulmaz.** Plan 4 ADR'si (köprüsüz WebView, token sızıntısı yüzeyi yok) korunur. `session-open` isteği WebView'in gerçek UA'sını (`Chrome/XX` System WebView sürümü dahil) taşır; sunucu `parseChromeMajor(ua) < MIN_CHROME_MAJOR` ise 302 yerine **minimal statik HTML** (modern JS yok → eski motorda da render olur) döndürür: "WebView güncel değil, Google Play'den güncelleyin" + Play WebView linki (web.tsx dış link olarak açar). Native `injectedJavaScript`/`onMessage` EKLENMEZ. `MIN_CHROME_MAJOR` tur bulgusuyla ayarlanır (WebView 81 boş sayfa verdi → eşik başlangıç 90; Task 15'te cihazda doğrulanır/ince ayar).
- **Derin native rotalar: `targetForUrl` url→native path eşlemesi.** Şu an native roller HER url için `{type:'today'}` dönüyor. Plan 5 sonunda 3 yeni native rota var (`/etut`, `/hafta`, `/odev`). `UrlTarget`'a `{type:'native', path}` varyantı eklenir; `tag` url'lerinden eşleme: ödev url (`/?tab=odev`)→`/odev`, program url (`/?sekme=program`)→`/hafta`; eşlenmeyen (davranış/deneme/form/takvim/ödeme — native ekranı YOK) → `{type:'today'}` (mevcut davranış). Yönetim → WebView (değişmez). Saf fonksiyon + test.
- **Görsel cila temel seviyede** (Plan 3-4 çizgisi): temiz + marka renkli (`kit.tsx` palette). "Enerjik görsel yön" teması ([[enerjik-gorsel-yon]]) ayrı istişare — bu planda UYGULANMAZ.
- **Bakım-modu / offline cache / duyuru okundu senkronu Plan 5 DIŞI** (Plan 6+ / istişare). Devamsızlık görünümü Plan 5 DIŞI (öğretmen+müdür istişaresi — [[feedback_ozellik-karar-istisare]]).

## Çapraz İnceleme Bulguları (Codex + Gemini, 2026-07-18)

Plan yazıldıktan sonra Codex (12 bulgu) + Gemini (3 bulgu, 3'ü Codex ile örtüşür) koda karşı inceledi.

**Plana İŞLENDİ (8):**
- **[Critical] Şifre sonrası token ezilmesi** (Codex #2/Gemini #1): `applyPasswordChanged` `tokens.clear()` ile epoch++ → uçuştaki refresh taze token'ı ezmez / 401'i logout'a çevirmez. (Task 12)
- **[Important] Şifre rotasyonu CAS'sız** (Codex #1): `applyPasswordChange` `refreshHash` CAS + retry (eşzamanlı /refresh kaybettirmesin). (Task 5)
- **[Important] setPref P2002 yarışı** (Codex #7/Gemini #2): atomik `upsert` (org/branch elle). (Task 6)
- **[Important] categoryOf fail-open değil** (Codex #6/Gemini #3): bilinmeyen tag → `null` → `isPushMuted` daima false. (Task 6)
- **[Important] dispatchDue tercih re-check** (Codex #5): kuyruğa girmiş ama sonradan susturulmuş kategori retry'da `dead`. (Task 6 Step 8b)
- **[Important] session-open fallback referer sızıntısı** (Codex #8): `Referrer-Policy: no-referrer` + `nosniff` + `<meta referrer>`. (Task 7)
- **[Minor] targetForUrl ham substring** (Codex #10): `new URL`+`searchParams.get` tam eşleşme (`/?notab=odev` yanlış eşlemesi kapandı). (Task 14)
- **[Minor] hafta W00/W99 doğrulama** (Codex #11): W01-53 regex — mobil GET/reserve/week (web PostSchema davranış-koruma için DOKUNULMADI). (Task 2/3)

**BİLİNÇLİ ERTELENDİ / ADR (pre-existing veya kapsam — Plan 6+):**
- **[Important] Etüt & ödev JSON atomiklik yarışı** (Codex #3/#4): `Teacher.programTemplate` ve `Odev.data.submissions` read-modify-write MEVCUT WEB KODUNDA da lost-update/çift-rezervasyon riski taşır. Task 1 servisi web davranışını BİREBİR korur (yeni risk eklemez); mobil UI `busy` guard'ı tek-kullanıcı çift-dokunuşu engeller; çapraz-kullanıcı yarışı web+mobil ortak pre-existing. **Kalıcı çözüm (normalize `OdevSubmission` tablosu + `(odevId,studentId)` unique · etüt için CAS/interactive-transaction) Plan 6+ ayrı iş** — şema + servis yeniden yazımı web yolunu da eşit etkiler, Plan 5 kapsamını aşar (Plan 4'ün cellFromRow/Redis-race pre-existing devirleri gibi bilinçli).
- **[Important] Structured deep-link sözleşmesi** (Codex #9, spec §6/6): push data'ya versiyonlu `{route, entityId, orgSlug, branch}` + istemci tenant-eşleşme kontrolü. v1'de push tap DAİMA inbox'a (eventId) gider + "İlgili ekranı aç" event.url eşlemesi; app tek-tenant'a bağlı (installationId→org) + dispatchDue sahiplik kontrolü çapraz-tenant push'u zaten engeller → **v1'de cross-tenant açığı YOK**. Versiyonlu structured contract (tüm event üreticilerini etkiler) Plan 6+.
- **[Important] Öğretmen ödev verme/kontrol** (Codex #12, spec §5.1): Mustafa Plan 5 kapsamını "ödev listesi + teslim" (öğrenci aksiyonu) olarak SINIRLADI (2026-07-17 bölünme kararı). Öğretmen ödev-verme/kontrol Plan 6+ / istişare — **Plan spec §5.1'i TAM karşılamaz; bu bilinçli kapsam daraltması** (Plan Sonu Notları + self-review'de açık).

## Operasyon Ön Koşulları (Mustafa — ilgili task'a kadar)

1. **Şema push (Task 6):** `NotificationPreference` tablosu `npm run db:push` ile Neon'a yazılır — Mustafa onayı/gözetiminde çalıştırılır (canlı DB; yalnız YENİ tablo ekler, mevcut veriye dokunmaz). `prisma db push` prod DATABASE_URL'e uygulanır (`.env.local`).
2. **Deploy (Task 8):** backend tek push + Vercel deploy → canlı doğrulama (`.env.local` creds, testkurs). Web regresyon (etüt + şifre refactor'ları) ZORUNLU yeşil.
3. **Telefon (SM-M205F, USB) — Task 15:** yeni native modül eklenmediyse rebuild yalnız JS+asset (Metro reload yeterli olabilir); yine de temiz kurulum için `npx expo run:android`. JAVA_HOME shell'e inline (zshrc non-interactive gelmiyor); LAN-IP açılışında `adb reverse tcp:8081` + localhost relaunch (Plan 3-4 tuzağı).
4. **Zorunlu-şifre cihaz testi (Task 15):** `mustChangePassword=true` bir hesapla (veli 5394870054 hâlâ true — Plan 4 notu) mobil girişte zorunlu-değişim kapısının çıktığı + değişim sonrası açıldığı doğrulanır.

## Global Constraints

- **Web tarafı:** TypeScript strict; `tsconfig` `allowJs:false` SİLİNMEZ; hata formatı `{ error }` + doğru HTTP status (PayTR callback düz-metin istisnası dışında); Prisma route'larında `export const runtime = 'nodejs';`; kimlik `lib/id.ts` `newId()` (`Math.random` yasak); loglara/yanıtlara token-hash-PII yazılmaz; tenant tabloları `tdb()` (orgSlug/branch otomatik) — MobileSession/NotificationEvent gibi SKIP/base kullanımı ilgili dosyanın desenini izler.
- **Şema:** `NotificationPreference` DIŞINDA `prisma/schema.prisma`'ya dokunulmaz. Yeni tablo `npm run db:push` ile uygulanır (migration klasörü yok). Yeni tablo tenant-scoped (`orgSlug`+`branch`+`@@unique`).
- **Middleware'e dokunulmaz:** yeni uçların hepsi Bearer-korumalı (`withMobileAuth`) → CSRF Bearer istisnasından otomatik geçer; `session-open` mevcut (oturumsuz, cookie kurar) — UA-fallback dalı eklenirken CSRF/redirect güvenliği korunur.
- **Mobil tarafı:** bağımlılıklar YALNIZ `npx expo install <paket>` ile (SDK-pinli); **bu planda yeni native paket EKLENMEZ** (mevcut modüllerle çözülür); TS strict; push/refresh token'ları asla console'a yazılmaz; UI metinleri Türkçe, emoji YASAK; `mobile/src/api/types.ts` elle DÜZENLENMEZ (`npm run mobile:types` üretir).
- **Commit:** Türkçe, `feat(mobil):` / `fix:` / `test(mobil):` önekli; her task sonunda; web değişikliğinde `npm run build` + `npx vitest run` geçmeden commit YOK; mobil değişikliğinde `cd mobile && npx tsc --noEmit && npx vitest run` geçmeden commit YOK; `git add <dosya>` (asla `-A`).
- **Deploy:** backend Task 1-7 yalnız local commit; Task 8'de tek push + canlı doğrulama (web regresyon dahil); sonrası mobil push serbest (Vercel `mobile/`'ı build etmez).
- **Canlı testler** `.env.local`'deki `OKULIN_*` creds + testkurs'a karşı (`e2e/helpers` deseni); rate-limit bütçesi dosya başında hesaplanır (login 5/15dk!). Veli testleri için `OKULIN_PAR_USER/PASS` yoksa cihaz turuna (Task 15) ertelenir — ADR.

## Dosya Haritası

| Dosya | Sorumluluk |
|---|---|
| `lib/etut/rezervasyon.ts` (yeni) | `reserveEtut`/`cancelEtut`/`listBookableEtuts` — etut-sablon rezervasyon iş kuralları servisi (route'tan çıkarıldı, HttpError fırlatır) |
| `lib/etut/rezervasyon.test.ts` (yeni) | Saf kural yardımcıları (çakışma/matematik-ailesi/branş) birim testleri |
| `app/api/etut-sablon/rezervasyon/route.ts` (değişir) | Inline kurallar → `reserveEtut`/`cancelEtut` çağrısı (davranış-koruyan) |
| `lib/mobile/api-types.ts` (değişir) | Etüt/Hafta/Ödev/Şifre/BildirimTercihi tipleri (saf, import'suz) |
| `lib/mobile/contracts.ts` (değişir) | `ReserveEtutSchema`/`CancelEtutSchema`/`OdevSubmitSchema`/`ChangePasswordSchema`/`NotifPrefUpdateSchema` |
| `app/api/mobile/v1/etut/route.ts` (yeni) | `GET` bookable etüt listesi (öğrenci, haftalık) |
| `app/api/mobile/v1/etut/reserve/route.ts` (yeni) | `POST` rezerve / `DELETE` iptal (öğrenci, withMobileAuth→servis) |
| `lib/slots.ts` (değişir) | `getWeekCellsAllTeachers(weekKey)` — bir haftanın TÜM öğretmen hücreleri tek sorguda |
| `lib/mobile/week.ts` (yeni) | `buildStudentWeek`/`buildParentWeek`/`buildTeacherWeek` — 7-gün program builder'ları (today.ts collectClassDay mantığının genişlemesi) |
| `app/api/mobile/v1/screens/week/route.ts` (yeni) | Rol-aware haftalık program aggregate ucu (`?week=`, `?child=`) — DB katmanı, kanıt Task 8 canlı int |
| `app/api/mobile/v1/odev/route.ts` (yeni) | `GET` ödev listesi (öğrenci/veli) · `POST` teslim (yalnız öğrenci) — lib/odev sarar |
| `lib/password.ts` (yeni) | `changePasswordFor(roleKey, userId, current, next)` — bcrypt doğrula+güncelle (web+mobil ortak) |
| `app/api/auth/route.ts` (değişir) | change_password inline → `changePasswordFor` çağrısı (davranış-koruyan) |
| `lib/mobile/sessions.ts` (değişir) | `applyPasswordChange(sid, role, userId)` — diğer oturumları iptal + payload patch + token re-issue; `revokeMobileSessionsExcept` |
| `app/api/mobile/v1/auth/change-password/route.ts` (yeni) | `POST` mobil şifre değiştir (withMobileAuth→changePasswordFor→applyPasswordChange) |
| `prisma/schema.prisma` (değişir) | `NotificationPreference` modeli (tek yeni tablo) |
| `lib/notify-prefs.ts` (yeni) | `categoryOf`/`NOTIF_CATEGORIES`/`categoriesForRole`/`getPrefs`/`setPref`/`isPushMuted` |
| `lib/notify-prefs.test.ts` (yeni) | `categoryOf` + `categoriesForRole` + `isPushMuted` (güvenlik hep açık) birim testleri |
| `lib/push/outbox.ts` (değişir) | `enqueueNotification`: muted kategoride push atlanır (event+inbox korunur) |
| `app/api/mobile/v1/notification-prefs/route.ts` (yeni) | `GET` kategori+durum listesi (role-aware) · `POST` tekil toggle |
| `lib/mobile/webview-compat.ts` (yeni) | `parseChromeMajor(ua)` + `MIN_CHROME_MAJOR` + `isOutdatedWebView(ua)` + `outdatedWebViewHtml()` |
| `lib/mobile/webview-compat.test.ts` (yeni) | UA parse (Chrome sürümü, WebView/eksik/eski) birim testleri |
| `app/api/mobile/v1/session-open/route.ts` (değişir) | Eski-WebView UA'da minimal fallback HTML (302 yerine) |
| `e2e/int-mobile-v2.spec.js` (yeni) | Canlı: etüt reserve/cancel (kurallar) + hafta + ödev submit + change-password + notif-prefs + webview-compat UA |
| `mobile/src/app/etut.tsx` (yeni) | Etüt rezervasyon ekranı (öğrenci): haftalık uygun etütler + rezerve/iptal |
| `mobile/src/app/hafta.tsx` (yeni) | Haftalık program ekranı (3 rol): 7-gün grid + hafta gezinme |
| `mobile/src/app/odev.tsx` (yeni) | Ödev ekranı: liste + teslim/geri-al (öğrenci) · liste (veli) |
| `mobile/src/app/sifre.tsx` (yeni) | Şifre değiştirme ekranı (mustChangePassword zorunlu + ayarlardan isteğe bağlı) |
| `mobile/src/app/bildirim-tercihleri.tsx` (yeni) | Bildirim kategori tercihleri ekranı (toggle) |
| `mobile/src/store/session.tsx` (değişir) | `mustChangePassword` kapısı + `applyTokenPair` (şifre sonrası taze çift) |
| `mobile/src/app/index.tsx` (değişir) | `ready && mustChangePassword` → `/sifre` yönlendirme |
| `mobile/src/ui/today.tsx` (değişir) | StudentToday/ParentToday/TeacherToday'e "Haftalık program"/"Etüt al"/"Ödevler" link butonları |
| `mobile/src/app/(tabs)/ayarlar.tsx` (değişir) | "Şifre değiştir" + "Bildirim tercihleri" link butonları |
| `mobile/src/notification-routing.ts` (değişir) | `targetForUrl` url→native path eşlemesi (`UrlTarget` `native` varyantı) |
| `mobile/src/notification-routing.test.ts` (değişir) | native rota eşleme case'leri |
| `mobile/src/app/(tabs)/bildirimler.tsx` (değişir) | "İlgili ekranı aç" native path dalı + focus zaten-okunmuş guard (Minor #11) |

---

### Task 1: Etüt rezervasyon servis katmanı (`lib/etut/rezervasyon.ts`) + web route davranış-koruyan refactor

Etüt rezervasyon iş kuralları şu an `app/api/etut-sablon/rezervasyon/route.ts` içinde INLINE (öğrenci self-servis yolu). Mobil route aynı kuralları çağıracağı için mantık `lib/etut/rezervasyon.ts` servisine çıkarılır (spec §9/6). Web route servisi çağırır — **satır-satır davranış korunur** (aynı kontrol sırası, aynı hata metinleri/status'lar, aynı yazım). `HttpError` kullanılır (route/servis sınırı codebase deseni). `studentBookedEtuts`'un öğretmen-başına `getProgramTemplate` çağrısı servis içinde `getAllProgramTemplates()` (Plan 4, tek-sorgu) ile değiştirilir — aynı sonuç, daha az sorgu (mobil için de gerekli).

**Files:**
- Create: `lib/etut/rezervasyon.ts`
- Create: `lib/etut/rezervasyon.test.ts`
- Modify: `app/api/etut-sablon/rezervasyon/route.ts`

**Interfaces:**
- Consumes: `getAllTeachers`, `getAllStudents`, `getAllProgramTemplates`, `getProgramTemplate`, `setProgramTemplate`, `slotStartTime`, `etutAktifThisWeek` (lib/slots), `allowedBranchesForClass`, `MATH_FAMILY`, `getWeekKey` (lib/constants), `HttpError` (lib/errors).
- Produces (Task 2 kullanır):
  - `EtutActor = { role: string; id: string; isManager: boolean }`
  - `reserveEtut(actor: EtutActor, input: { teacherId: string; etutId: string; branch?: string; studentId?: string; weekKey?: string }): Promise<EtutSablonu>` — başarıda güncellenmiş şablonu döner; ihlalde `HttpError`.
  - `cancelEtut(actor: EtutActor, input: { teacherId: string; etutId: string }): Promise<void>`
  - `listBookableEtuts(studentId: string, weekKey: string): Promise<BookableEtut[]>` (Task 2'de kullanılır) — `BookableEtut = { teacherId, teacherName, etutId, dayIndex, start, end, branches: string[]; mine: boolean; booked: boolean; branch: string | null }`

- [ ] **Step 1: Saf kural yardımcıları için başarısız birim testleri yaz**

`lib/etut/rezervasyon.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { timeConflicts, branchConflicts, mathFamilyConflict } from './rezervasyon';

const sb = (dayIndex: number, start: string, branch?: string) => ({ id: 'x', dayIndex, start, end: '00:00', branch });

describe('timeConflicts — aynı gün+saat başka etüt', () => {
  it('aynı gün aynı saat → çakışır', () => {
    expect(timeConflicts([sb(2, '14:00')], 2, '14:00')).toBe(true);
  });
  it('farklı saat → çakışmaz', () => {
    expect(timeConflicts([sb(2, '14:00')], 2, '15:00')).toBe(false);
  });
  it('farklı gün → çakışmaz', () => {
    expect(timeConflicts([sb(3, '14:00')], 2, '14:00')).toBe(false);
  });
  it('boş liste → çakışmaz', () => {
    expect(timeConflicts([], 2, '14:00')).toBe(false);
  });
});

describe('branchConflicts — aynı dersten ikinci etüt', () => {
  it('aynı branş yazılı → çakışır', () => {
    expect(branchConflicts([sb(1, '10:00', 'Fizik')], 'Fizik')).toBe(true);
  });
  it('farklı branş → çakışmaz', () => {
    expect(branchConflicts([sb(1, '10:00', 'Fizik')], 'Kimya')).toBe(false);
  });
});

describe('mathFamilyConflict — matematik ailesi tek etüt', () => {
  it('TYT Matematik yazılıyken AYT Matematik → çakışır', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'TYT Matematik')], 'AYT Matematik')).toBe(true);
  });
  it('Geometri yazılıyken TYT Matematik → çakışır', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'Geometri')], 'TYT Matematik')).toBe(true);
  });
  it('yeni branş matematik değil → çakışmaz', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'TYT Matematik')], 'Fizik')).toBe(false);
  });
  it('matematik ailesinden hiç yazılı yok → çakışmaz', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'Fizik')], 'TYT Matematik')).toBe(false);
  });
});
```

- [ ] **Step 2: Test'i çalıştır, kırmızı gör**

Run: `npx vitest run lib/etut/rezervasyon.test.ts`
Expected: FAIL — `lib/etut/rezervasyon.ts` yok / export'lar tanımsız.

- [ ] **Step 3: `lib/etut/rezervasyon.ts` servisini yaz**

`lib/etut/rezervasyon.ts` (yeni — TAMAMI). Mantık `app/api/etut-sablon/rezervasyon/route.ts`'in POST/DELETE gövdesinden BİREBİR taşınır (kontrol sırası + hata metinleri + status'lar korunur); yalnız `NextResponse.json({error},{status})` → `throw new HttpError(status, error)`, `canManage` çağrısı → `actor.isManager`, `studentBookedEtuts` → `getAllProgramTemplates()` tek-sorgu.

```typescript
import {
  getAllTeachers,
  getAllStudents,
  getAllProgramTemplates,
  getProgramTemplate,
  setProgramTemplate,
  slotStartTime,
  etutAktifThisWeek,
  type EtutSablonu,
} from '@/lib/slots';
import { allowedBranchesForClass, MATH_FAMILY, getWeekKey } from '@/lib/constants';
import { HttpError } from '@/lib/errors';

// Etüt rezervasyon iş kuralları servisi (spec §9/6 — route'tan çıkarıldı, davranış birebir).
// Web route (etut-sablon/rezervasyon) + mobil route (mobile/v1/etut/reserve) bu servisi çağırır.

export interface EtutActor {
  role: string;
  id: string;
  isManager: boolean; // müdür/rehber (readOnly değil) — Kural 2/3 muafiyeti
}

// ── Saf kural yardımcıları (birim testli) ──
export function timeConflicts(booked: { dayIndex: number; start: string }[], dayIndex: number, start: string): boolean {
  return booked.some((b) => b.dayIndex === dayIndex && b.start === start);
}
export function branchConflicts(booked: { branch?: string }[], bookingBranch: string): boolean {
  return booked.some((b) => b.branch === bookingBranch);
}
export function mathFamilyConflict(booked: { branch?: string }[], bookingBranch: string): boolean {
  if (!MATH_FAMILY.includes(bookingBranch)) return false;
  return booked.some((b) => MATH_FAMILY.includes((b.branch as string) ?? ''));
}

// Bir öğrencinin bu hafta yazılı TÜM etüt şablonları (tüm öğretmenlerde) — TEK sorgu
// (getAllProgramTemplates, Plan 4). Eski route öğretmen başına getProgramTemplate atıyordu;
// aynı sonuç kümesi, daha az sorgu (davranış-koruyan optimizasyon).
async function studentBookedEtuts(studentId: string, weekKey: string): Promise<{ teacherId: string; sb: EtutSablonu }[]> {
  const templates = await getAllProgramTemplates();
  const out: { teacherId: string; sb: EtutSablonu }[] = [];
  for (const t of templates) {
    const list: EtutSablonu[] = Array.isArray(t.template.etutSablonlari) ? (t.template.etutSablonlari as EtutSablonu[]) : [];
    for (const sb of list) {
      if (sb.studentId === studentId && etutAktifThisWeek(sb, weekKey)) out.push({ teacherId: t.legacyId, sb });
    }
  }
  return out;
}

// Rezerve et — route POST gövdesiyle BİREBİR kontrol sırası/metin/status.
export async function reserveEtut(
  actor: EtutActor,
  input: { teacherId: string; etutId: string; branch?: string; studentId?: string; weekKey?: string },
): Promise<EtutSablonu> {
  const { teacherId, etutId, branch } = input;
  const weekKey = input.weekKey || getWeekKey();

  // Hedef öğrenci: öğrenci kendini, öğretmen kendi etüdüne, yönetici başkasını
  let targetStudentId: string | undefined;
  if (actor.role === 'student') {
    targetStudentId = actor.id;
  } else if (actor.role === 'teacher') {
    if (teacherId !== actor.id) throw new HttpError(403, 'Sadece kendi etütlerinize öğrenci yazabilirsiniz');
    targetStudentId = input.studentId;
  } else if (actor.isManager) {
    targetStudentId = input.studentId;
  } else {
    throw new HttpError(403, 'Yetkisiz');
  }
  if (!targetStudentId) throw new HttpError(400, 'Öğrenci belirtilmedi');

  const allStudents = await getAllStudents();
  const targetStudent = allStudents.find((s) => s.id === targetStudentId);
  if (!targetStudent) throw new HttpError(404, 'Öğrenci bulunamadı');

  const allTeachers = await getAllTeachers();
  const teacher = allTeachers.find((t) => t.id === teacherId);
  if (!teacher) throw new HttpError(404, 'Öğretmen bulunamadı');

  const allowedGroups = teacher.allowedGroups || [];
  if (allowedGroups.length === 0) throw new HttpError(400, 'Bu öğretmenin grup etiketi tanımlanmamış');
  if (!allowedGroups.includes(targetStudent.group)) throw new HttpError(400, 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz');

  const template = await getProgramTemplate(teacherId);
  const list: EtutSablonu[] = Array.isArray(template.etutSablonlari) ? (template.etutSablonlari as EtutSablonu[]) : [];
  const idx = list.findIndex((s) => s.id === etutId);
  if (idx === -1) throw new HttpError(404, 'Etüt bulunamadı');
  const sb = { ...list[idx] };

  if (!etutAktifThisWeek(sb, weekKey)) throw new HttpError(400, 'Bu etüt bu hafta aktif değil');
  if (sb.studentId && sb.studentId !== targetStudentId) throw new HttpError(400, 'Bu etüt zaten dolu');
  if (sb.studentId === targetStudentId) throw new HttpError(400, 'Bu öğrenci zaten bu etüde kayıtlı');

  const startAt = slotStartTime(weekKey, sb.dayIndex, sb.start);
  if (startAt.getTime() <= Date.now()) throw new HttpError(400, 'Geçmiş bir etüde rezervasyon yapılamaz');

  const studentAllowed = allowedBranchesForClass(targetStudent.cls);
  let bookingBranch: string | undefined = branch;
  if (!bookingBranch) {
    const candidates = (teacher.branches || []).filter((b) => studentAllowed.includes(b));
    if (candidates.length === 1) bookingBranch = candidates[0];
  }
  if (!bookingBranch || !(teacher.branches || []).includes(bookingBranch) || !studentAllowed.includes(bookingBranch)) {
    throw new HttpError(400, 'Geçersiz veya seçilmemiş ders. Uygun bir ders seçin.');
  }

  const booked = await studentBookedEtuts(targetStudentId, weekKey);
  if (timeConflicts(booked.map((b) => b.sb), sb.dayIndex, sb.start)) {
    throw new HttpError(400, 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı');
  }
  if (!actor.isManager) {
    if (branchConflicts(booked.map((b) => b.sb), bookingBranch)) {
      throw new HttpError(400, `Bu öğrenci bu hafta ${bookingBranch} dersinden zaten etüt almış`);
    }
    if (mathFamilyConflict(booked.map((b) => b.sb), bookingBranch)) {
      throw new HttpError(400, 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış');
    }
  }

  sb.studentId = targetStudentId;
  sb.studentName = targetStudent.name;
  sb.studentCls = targetStudent.cls || '';
  sb.branch = bookingBranch;
  sb.bookedBy = actor.role;
  sb.bookedAt = new Date().toISOString();
  list[idx] = sb;
  template.etutSablonlari = list;
  await setProgramTemplate(teacherId, template);
  return sb;
}

// İptal — route DELETE gövdesiyle BİREBİR.
export async function cancelEtut(actor: EtutActor, input: { teacherId: string; etutId: string }): Promise<void> {
  const { teacherId, etutId } = input;
  const template = await getProgramTemplate(teacherId);
  const list: EtutSablonu[] = Array.isArray(template.etutSablonlari) ? (template.etutSablonlari as EtutSablonu[]) : [];
  const idx = list.findIndex((s) => s.id === etutId);
  if (idx === -1) throw new HttpError(404, 'Etüt bulunamadı');
  const sb = { ...list[idx] };
  if (!sb.studentId) throw new HttpError(404, 'Bu etütte rezervasyon yok');
  if (actor.role === 'student' && sb.studentId !== actor.id) throw new HttpError(403, 'Yetkisiz');
  if (actor.role === 'teacher' && teacherId !== actor.id) throw new HttpError(403, 'Yetkisiz');
  if (!actor.isManager && actor.role !== 'student' && actor.role !== 'teacher') throw new HttpError(403, 'Yetkisiz');

  delete sb.studentId; delete sb.studentName; delete sb.studentCls;
  delete sb.branch; delete sb.bookedBy; delete sb.bookedAt;
  list[idx] = sb;
  template.etutSablonlari = list;
  await setProgramTemplate(teacherId, template);
}

// Öğrencinin bu hafta REZERVE EDEBİLECEĞİ etütler (mobil ekran listesi).
// Öğrencinin grubuna açık öğretmenlerin, bu hafta efektif-aktif şablonları;
// her biri için o öğrencinin görebileceği branş adayları + doluluk/sahiplik.
export interface BookableEtut {
  teacherId: string;
  teacherName: string;
  etutId: string;
  dayIndex: number;
  start: string;
  end: string;
  branches: string[]; // öğrencinin seçebileceği ders adayları (öğretmen branşları ∩ sınıf dersleri)
  booked: boolean;    // başka öğrenci tarafından dolu
  mine: boolean;      // bu öğrencinin rezervasyonu
  branch: string | null; // mine ise rezerve edilen ders
}
export async function listBookableEtuts(studentId: string, weekKey: string): Promise<BookableEtut[]> {
  const [students, teachers, templates] = await Promise.all([getAllStudents(), getAllTeachers(), getAllProgramTemplates()]);
  const student = students.find((s) => s.id === studentId);
  if (!student) throw new HttpError(404, 'Öğrenci bulunamadı');
  const studentAllowed = allowedBranchesForClass(student.cls);
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const out: BookableEtut[] = [];
  for (const tpl of templates) {
    const teacher = teacherById.get(tpl.legacyId);
    if (!teacher) continue;
    const allowedGroups = teacher.allowedGroups || [];
    // Öğrencinin grubuna kapalı öğretmenin etütleri listede gösterilmez (rezerve edilemez).
    const groupOk = allowedGroups.includes(student.group);
    const list: EtutSablonu[] = Array.isArray(tpl.template.etutSablonlari) ? (tpl.template.etutSablonlari as EtutSablonu[]) : [];
    for (const sb of list) {
      if (!etutAktifThisWeek(sb, weekKey)) continue;
      const mine = sb.studentId === studentId;
      if (!groupOk && !mine) continue; // kendi rezervasyonu farklı grup olsa bile görünsün (iptal için)
      const branches = (teacher.branches || []).filter((b) => studentAllowed.includes(b));
      out.push({
        teacherId: tpl.legacyId,
        teacherName: teacher.name,
        etutId: sb.id,
        dayIndex: sb.dayIndex,
        start: sb.start,
        end: sb.end,
        branches,
        booked: Boolean(sb.studentId) && !mine,
        mine,
        branch: mine ? (sb.branch ?? null) : null,
      });
    }
  }
  out.sort((a, b) => (a.dayIndex - b.dayIndex) || a.start.localeCompare(b.start));
  return out;
}
```

- [ ] **Step 4: Test'i çalıştır, yeşil gör**

Run: `npx vitest run lib/etut/rezervasyon.test.ts`
Expected: PASS (11 test).

- [ ] **Step 5: Web route'u servise bağla (davranış-koruyan)**

`app/api/etut-sablon/rezervasyon/route.ts`'i şu hale getir — inline kurallar SİLİNİR, servis çağrılır. `withAuth`/`canManage`/`parseBody`/Zod şemalar KORUNUR; `HttpError`→`{error}`+status'a çevrim `errorResponse` ile (route deseni). TAMAMI:

```typescript
import { NextResponse } from 'next/server';
import { withAuth, canManage } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { reserveEtut, cancelEtut, type EtutActor } from '@/lib/etut/rezervasyon';

// Serbest etüt şablonuna öğrenci REZERVASYONU. İş kuralları lib/etut/rezervasyon.ts
// servisinde (spec §9/6); bu route yalnız yetki + parse + servis çağrısı.
// program:<teacherId>.etutSablonlari = [ { id, dayIndex, start, end, aktif, studentId?, ... } ]
// Servis HttpError fırlatır → withAuth tek noktada { error }+status'a çevirir (kendi try/catch YOK; lib/auth.ts:167-172).
export const runtime = 'nodejs';

const PostSchema = z.object({
  teacherId: zId,
  etutId: zId, // makeId→UUID göçü sonrası 36 char (max20 yeni şablonu keserdi) → zId(max100)
  branch: z.string().max(60).optional(),
  studentId: zId.optional(),
  weekKey: z.string().max(40).optional(),
});
const DeleteSchema = z.object({ teacherId: zId, etutId: zId });

export const POST = withAuth('auth', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, PostSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: session.role, id: String(session.id ?? ''), isManager: await canManage(session) };
  const etut = await reserveEtut(actor, parsed.data);
  return NextResponse.json({ ok: true, etut });
});

export const DELETE = withAuth('auth', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: session.role, id: String(session.id ?? ''), isManager: await canManage(session) };
  await cancelEtut(actor, parsed.data);
  return NextResponse.json({ ok: true });
});
```

Davranış-koruma kontrol listesi (uygulayan + reviewer):
- Kontrol sırası + tüm hata metinleri + status'lar BİREBİR (madde madde route eskisiyle karşılaştır).
- `getWeekKey()` fallback korundu (input.weekKey yoksa).
- `bookedBy = actor.role` (eski `session.role`) — mobil'de 'student', web'de session rolü; birebir.
- Route kendi try/catch YAPMAZ: `withAuth` HttpError'ı `errorResponse` ile `{ error }`+status'a çevirir (lib/errors.ts + lib/auth.ts:167-172 doğrulandı); non-HttpError yeniden fırlar (gerçek 500).

- [ ] **Step 6: Build + test**

Run: `npm run build && npx vitest run`
Expected: build başarılı; tüm testler PASS (yeni 11 + mevcut).

- [ ] **Step 7: Commit (local — push Task 8'de)**

```bash
git add lib/etut/rezervasyon.ts lib/etut/rezervasyon.test.ts app/api/etut-sablon/rezervasyon/route.ts
git commit -m "refactor: etüt rezervasyon iş kuralları lib/etut/rezervasyon.ts servisine (davranış-koruyan; web route servisi çağırır; N-sorgu→tek-sorgu)"
```

---

### Task 2: Mobil etüt uçları — bookable liste + rezerve/iptal (`withMobileAuth`)

Öğrenci mobilde bu haftanın uygun etütlerini görür ve rezerve/iptal eder. `GET /api/mobile/v1/etut?week=` → `listBookableEtuts` (öğrenci); `POST /api/mobile/v1/etut/reserve` → `reserveEtut` (actor=öğrenci, isManager=false); `DELETE /api/mobile/v1/etut/reserve` → `cancelEtut`. **Yalnız öğrenci rolü** (veli/öğretmen/yönetim → 403; spec ADR). Rate-limit `contentLimited(sid)`.

**Files:**
- Modify: `lib/mobile/api-types.ts` (Etüt tipleri)
- Modify: `lib/mobile/contracts.ts` (`ReserveEtutSchema`, `CancelEtutSchema`)
- Create: `app/api/mobile/v1/etut/route.ts`
- Create: `app/api/mobile/v1/etut/reserve/route.ts`

**Interfaces:**
- Consumes: `withMobileAuth`, `contentLimited` (Task 2 mevcut Plan 4'ten), `listBookableEtuts`/`reserveEtut`/`cancelEtut` (Task 1), `trToday` (lib/mobile/today — weekKey fallback), `ALL_DAYS` (gün etiketi), `HttpError`.
- Produces (mobil `etut.tsx` kullanır): api-types `EtutSlotView`, `EtutScreenResponse`, `ReserveEtutRequest`, `ReserveEtutResponse`, `CancelEtutRequest`, `OkResponse` (mevcut). Uçlar:
  - `GET /api/mobile/v1/etut[?week=<weekKey>]` → `EtutScreenResponse`
  - `POST /api/mobile/v1/etut/reserve` gövde `ReserveEtutRequest` → `ReserveEtutResponse`
  - `DELETE /api/mobile/v1/etut/reserve` gövde `CancelEtutRequest` → `OkResponse`

- [ ] **Step 1: api-types.ts'e Etüt tiplerini ekle**

`lib/mobile/api-types.ts` sonuna:

```typescript
// ── Etüt rezervasyon (spec §5.1 öğrenci) ────────────────────────────────────
export interface EtutSlotView {
  teacherId: string;
  teacherName: string;
  etutId: string;
  dayIndex: number; // 0=Pzt
  dayLabel: string; // "Salı"
  start: string; // "14:00"
  end: string;
  branches: string[]; // seçilebilir ders adayları (öğrenci sınıfı ∩ öğretmen branşları)
  booked: boolean; // başkası dolu
  mine: boolean; // bu öğrencinin rezervasyonu
  branch: string | null; // mine ise rezerve edilen ders
}
export interface EtutScreenResponse {
  weekKey: string;
  slots: EtutSlotView[]; // gün+saat sıralı; UI güne göre gruplar
}
export interface ReserveEtutRequest {
  teacherId: string;
  etutId: string;
  branch?: string; // tek aday varsa boş bırakılabilir (sunucu otomatik seçer)
  weekKey?: string;
}
export interface ReserveEtutResponse {
  ok: true;
  // güncellenmiş şablon (studentId dolu) — istemci listeyi tazeler; ham şablonu döner
  etut: { id: string; dayIndex: number; start: string; end: string; branch?: string; studentName?: string };
}
export interface CancelEtutRequest {
  teacherId: string;
  etutId: string;
}
```

- [ ] **Step 2: contracts.ts'e şemaları ekle**

`lib/mobile/contracts.ts` sonuna:

```typescript
// Etüt rezervasyon (mobil — yalnız öğrenci kendini yazar; studentId GÖNDERİLMEZ,
// server session.id kullanır). weekKey opsiyonel (yoksa server trToday).
export const ReserveEtutSchema = z.object({
  teacherId: z.string().min(1).max(100),
  etutId: z.string().min(1).max(100),
  branch: z.string().max(60).optional(),
  // W01-W53 (İnceleme Codex #11): W00/W99 gibi biçimsel-geçerli ama anlamsız haftalar reddedilir.
  weekKey: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/).optional(),
});
export const CancelEtutSchema = z.object({
  teacherId: z.string().min(1).max(100),
  etutId: z.string().min(1).max(100),
});
```

- [ ] **Step 3: `GET /api/mobile/v1/etut` route'unu yaz**

`app/api/mobile/v1/etut/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { listBookableEtuts } from '@/lib/etut/rezervasyon';
import { trToday } from '@/lib/mobile/today';
import { ALL_DAYS } from '@/lib/constants';

// Öğrencinin bu hafta rezerve edebileceği etütler (spec §5.1). Yalnız öğrenci rolü;
// veli/öğretmen/yönetim 403 (mobil etüt yazma = öğrenci self-servis, plan ADR).
// Servis HttpError fırlatır → withMobileAuth tek noktada çevirir (kendi try/catch YOK).
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  // Hafta biçim doğrulaması (İnceleme Codex #11): W00/W99 anlamsız haftalar getMondayOfWeek'i
  // saçma tarihlere normalize eder → geçersizde bu haftaya düş.
  const rawWeek = new URL(req.url).searchParams.get('week');
  const weekKey = rawWeek && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(rawWeek) ? rawWeek : trToday().weekKey;
  const bookable = await listBookableEtuts(String(session.id ?? ''), weekKey);
  const slots = bookable.map((b) => ({ ...b, dayLabel: ALL_DAYS[b.dayIndex]?.label ?? '' }));
  return NextResponse.json({ weekKey, slots });
});
```

- [ ] **Step 4: `POST/DELETE /api/mobile/v1/etut/reserve` route'unu yaz**

`app/api/mobile/v1/etut/reserve/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { parseBody } from '@/lib/validate';
import { ReserveEtutSchema, CancelEtutSchema } from '@/lib/mobile/contracts';
import { reserveEtut, cancelEtut, type EtutActor } from '@/lib/etut/rezervasyon';

// Öğrenci etüt rezervasyon/iptal (mobil). actor daima öğrenci (isManager:false);
// studentId GÖNDERİLMEZ — reserveEtut öğrenci dalında session.id'yi hedef alır.
// Servis HttpError fırlatır → withMobileAuth tek noktada çevirir (kendi try/catch YOK).
export const runtime = 'nodejs';

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, ReserveEtutSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: 'student', id: String(session.id ?? ''), isManager: false };
  const etut = await reserveEtut(actor, parsed.data);
  return NextResponse.json({ ok: true, etut: { id: etut.id, dayIndex: etut.dayIndex, start: etut.start, end: etut.end, branch: etut.branch, studentName: etut.studentName } });
});

export const DELETE = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, CancelEtutSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: 'student', id: String(session.id ?? ''), isManager: false };
  await cancelEtut(actor, parsed.data);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 5: Tip senkron + build + test**

Run: `npm run mobile:types && npm run build && npx vitest run`
Expected: `mobile/src/api/types.ts` güncellendi (drift testi PASS), build başarılı, testler PASS.

- [ ] **Step 6: Commit (local)**

```bash
git add lib/mobile/api-types.ts lib/mobile/contracts.ts app/api/mobile/v1/etut/route.ts app/api/mobile/v1/etut/reserve/route.ts mobile/src/api/types.ts
git commit -m "feat(mobil): etüt uçları — GET bookable liste + POST/DELETE reserve (öğrenci, withMobileAuth→servis)"
```

---

### Task 3: Haftalık program ucu — `lib/mobile/week.ts` + `getWeekCellsAllTeachers` + `GET /screens/week`

Rol-aware haftalık program aggregate ucu (spec §5.1). `lib/mobile/today.ts`'in `collectClassDay` mantığı 7 güne genişletilir (`lib/mobile/week.ts`), YENİ veri modeli yok. Öğretmen-başına sorgu önlenir: `getWeekCellsAllTeachers(weekKey)` (1 teacher + 1 slotBooking, TÜM hafta) + `getAllProgramTemplates()` (1) + `getDaySlotTimes()` (1). Öğrenci/veli: 7 günün dersleri + kendi etütleri; öğretmen: 7 günün grid'i (ders + dolu etüt slotu). `?week=` ile hafta gezinme (görüntüleme sınırsız; yalnız rezervasyon geçmişi Task 1'de engellenir). **DB katmanı — repo'da Prisma mock yok (Plan 4 ADR); kanıt Task 8 canlı int testleri** (3 rol × şekil + izolasyon).

**Files:**
- Modify: `lib/slots.ts` (`getWeekCellsAllTeachers` — `getDayCellsAllTeachers`'ın haftalık kardeşi)
- Create: `lib/mobile/week.ts`
- Modify: `lib/mobile/api-types.ts` (Week tipleri)
- Create: `app/api/mobile/v1/screens/week/route.ts`

**Interfaces:**
- Consumes: `getWeekCellsAllTeachers`/`getAllProgramTemplates`/`getDaySlotTimes`/`getTeacherWeekSlots`/`dateStrForWeekDay`/`etutAktifThisWeek` (lib/slots), `ALL_DAYS`/`daySlots` (lib/constants), `getOrgConfig` (lib/config), `trToday` (lib/mobile/today), `contentLimited`, `withMobileAuth`, `HttpError`, `Session`.
- Produces (mobil `hafta.tsx` kullanır): api-types `WeekDay`, `StudentWeek`, `ParentWeekChild`, `ParentWeek`, `TeacherWeekDay`, `TeacherWeek`, `ManagementWeek`, `WeekResponse` · `buildStudentWeek(session, weekKey)`/`buildParentWeek(session, weekKey, childId)`/`buildTeacherWeek(session, weekKey)`/`buildManagementWeek(weekKey)` · lib/slots `getWeekCellsAllTeachers(weekKey): Promise<Record<number, DayCellRow[]>>`. Uç: `GET /api/mobile/v1/screens/week[?week=<weekKey>][?child=<studentId>]` → `WeekResponse`.

- [ ] **Step 1: api-types.ts'e Week tiplerini ekle**

`lib/mobile/api-types.ts` sonuna:

```typescript
// ── Haftalık program (screens/week — spec §5.1) ─────────────────────────────
// today.ts'in tek-gün TodayLesson/TodayEtut/TeacherSlotView tipleri 7 güne yayılır.
export interface WeekDay {
  dayIndex: number; // 0=Pzt
  dayLabel: string; // "Pazartesi"
  date: string; // YYYY-MM-DD
  lessons: TodayLesson[];
  etuts: TodayEtut[] | null; // etut modülü kapalı → null
}
export interface StudentWeek {
  role: 'student';
  weekKey: string;
  days: WeekDay[]; // 7 gün (Pzt..Paz)
}
export interface ParentWeekChild {
  id: string;
  name: string;
  cls: string;
  days: WeekDay[];
}
export interface ParentWeek {
  role: 'parent';
  weekKey: string;
  children: ParentChildView[];
  child: ParentWeekChild | null; // çocuk yoksa null
}
export interface TeacherWeekDay {
  dayIndex: number;
  dayLabel: string;
  date: string;
  slots: TeacherSlotView[]; // ders + dolu etüt slotları (saat sıralı)
}
export interface TeacherWeek {
  role: 'teacher';
  weekKey: string;
  days: TeacherWeekDay[];
}
export interface ManagementWeek {
  role: 'management';
  weekKey: string;
}
export type WeekResponse = StudentWeek | ParentWeek | TeacherWeek | ManagementWeek;
```

- [ ] **Step 2: lib/slots.ts'e `getWeekCellsAllTeachers` ekle**

`lib/slots.ts` içinde `getDayCellsAllTeachers` fonksiyonunun ALTINA ekle (aynı `DayCellRow`/`cellFromRow`/`tdb` kullanır — gün filtresi kalkar, güne göre gruplanır):

```typescript
// Bir HAFTANIN tüm öğretmen hücreleri TEK sorguda, güne göre gruplu (mobil haftalık
// program). getDayCellsAllTeachers'ın 7-gün kardeşi: dayIndex filtresi kalkar,
// çıktı gün → hücreler. 1 teacher + 1 slotBooking sorgusu (tüm hafta).
export async function getWeekCellsAllTeachers(weekKey: string): Promise<Record<number, DayCellRow[]>> {
  const teachers = await tdb().teacher.findMany({ select: { id: true, legacyId: true, name: true } });
  const byDbId = new Map(teachers.map((t) => [t.id, t]));
  const rows = await tdb().slotBooking.findMany({ where: { weekKey } });
  const out: Record<number, DayCellRow[]> = {};
  for (const row of rows) {
    const t = byDbId.get(row.teacherId);
    if (!t) continue;
    (out[row.dayIndex] ??= []).push({ teacherLegacyId: t.legacyId, teacherName: t.name, slotId: row.slotId, cell: cellFromRow(row) });
  }
  return out;
}
```

- [ ] **Step 3: `lib/mobile/week.ts` builder'larını yaz**

`lib/mobile/week.ts` (yeni — TAMAMI). `collectClassWeek` = `today.ts` `collectClassDay`'in hafta versiyonu (aynı ders filtresi `lessonType==='ders' && cls`, aynı etüt veri-minimizasyonu `sb.studentId===etutStudentId`, aynı slot-index sıralaması):

```typescript
import { ALL_DAYS, daySlots } from '@/lib/constants';
import {
  getWeekCellsAllTeachers, getAllProgramTemplates, getDaySlotTimes,
  getTeacherWeekSlots, dateStrForWeekDay, etutAktifThisWeek, type EtutSablonu,
} from '@/lib/slots';
import { getOrgConfig } from '@/lib/config';
import { HttpError } from '@/lib/errors';
import type { Session } from '@/lib/auth';
import type {
  StudentWeek, ParentWeek, TeacherWeek, ManagementWeek,
  WeekDay, TeacherWeekDay, TodayLesson, TodayEtut, TeacherSlotView, ParentChildView,
} from './api-types';

// Haftalık program servis katmanı (spec §5.1) — today.ts collectClassDay mantığının
// 7 güne genişlemesi. Öğretmen-başına sorgu YOK (getWeekCellsAllTeachers tüm hafta,
// getAllProgramTemplates tek, getDaySlotTimes tek). Öğrenci yalnız KENDİ etütleri.

async function collectClassWeek(cls: string, weekKey: string, etutStudentId: string | null): Promise<WeekDay[]> {
  const [weekCells, templates, slotTimes] = await Promise.all([
    getWeekCellsAllTeachers(weekKey),
    etutStudentId ? getAllProgramTemplates() : Promise.resolve([]),
    getDaySlotTimes(),
  ]);
  const days: WeekDay[] = [];
  for (const day of ALL_DAYS) {
    const dayIndex = day.index;
    const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
    const labelBySlotId = new Map(slots.map((s) => [s.id, s.label]));
    const idxBySlotId = new Map(slots.map((s, i) => [s.id, i]));

    const lessons: TodayLesson[] = [];
    for (const r of weekCells[dayIndex] ?? []) {
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
    lessons.sort((a, b) => (idxBySlotId.get(a.slotId) ?? 99) - (idxBySlotId.get(b.slotId) ?? 99));

    let etuts: TodayEtut[] | null = null;
    if (etutStudentId) {
      const collected: TodayEtut[] = [];
      for (const t of templates) {
        const list = Array.isArray(t.template.etutSablonlari) ? (t.template.etutSablonlari as EtutSablonu[]) : [];
        for (const sb of list) {
          if (sb.dayIndex !== dayIndex || !etutAktifThisWeek(sb, weekKey)) continue;
          if (sb.studentId !== etutStudentId) continue; // yalnız KENDİ rezervasyonu (veri minimizasyonu)
          collected.push({ id: sb.id, start: sb.start, end: sb.end, teacherName: t.name, branch: sb.branch || null, studentName: sb.studentName || null, booked: true });
        }
      }
      collected.sort((a, b) => a.start.localeCompare(b.start));
      etuts = collected;
    }

    days.push({ dayIndex, dayLabel: day.label, date: dateStrForWeekDay(weekKey, dayIndex), lessons, etuts });
  }
  return days;
}

export async function buildStudentWeek(session: Session, weekKey: string): Promise<StudentWeek> {
  const mods = await getOrgConfig('modules');
  const etutOn = mods.etut !== false;
  const days = await collectClassWeek(String(session.cls ?? ''), weekKey, etutOn ? String(session.id ?? '') : null);
  return { role: 'student', weekKey, days };
}

export async function buildParentWeek(session: Session, weekKey: string, childId: string | null): Promise<ParentWeek> {
  const mods = await getOrgConfig('modules');
  const children: ParentChildView[] = (session.children ?? [])
    .map((c) => (typeof c === 'string' ? null : { id: String(c.id ?? ''), name: String(c.name ?? ''), cls: String(c.cls ?? '') }))
    .filter((c): c is ParentChildView => c != null && c.id !== '');
  if (childId && !children.some((c) => c.id === childId)) throw new HttpError(403, 'Bu öğrenciye erişim yetkiniz yok');
  const chosen = (childId ? children.find((c) => c.id === childId) : children[0]) ?? null;
  if (!chosen) return { role: 'parent', weekKey, children, child: null };
  const etutOn = mods.etut !== false;
  const days = await collectClassWeek(chosen.cls, weekKey, etutOn ? chosen.id : null);
  return { role: 'parent', weekKey, children, child: { id: chosen.id, name: chosen.name, cls: chosen.cls, days } };
}

export async function buildTeacherWeek(session: Session, weekKey: string): Promise<TeacherWeek> {
  const me = String(session.id ?? '');
  const [grid, slotTimes] = await Promise.all([getTeacherWeekSlots(me, weekKey), getDaySlotTimes()]);
  const days: TeacherWeekDay[] = [];
  for (const day of ALL_DAYS) {
    const dayIndex = day.index;
    const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
    const dayCells: TeacherSlotView[] = [];
    (grid[dayIndex] || []).forEach((sd, i) => {
      if (!sd) return;
      const isDers = sd.lessonType === 'ders';
      const isBookedEtut = !isDers && !!sd.booked; // boş/disabled gösterilmez
      if (!isDers && !isBookedEtut) return;
      const slot = slots[i];
      dayCells.push({
        slotId: slot?.id ?? '',
        slotLabel: slot?.label ?? '',
        type: isDers ? 'ders' : 'etut',
        cls: sd.cls || sd.studentCls || null,
        studentName: sd.studentName || null,
        branch: sd.branch || sd.subBranch || '',
      });
    });
    days.push({ dayIndex, dayLabel: day.label, date: dateStrForWeekDay(weekKey, dayIndex), slots: dayCells });
  }
  return { role: 'teacher', weekKey, days };
}

export function buildManagementWeek(weekKey: string): ManagementWeek {
  return { role: 'management', weekKey };
}
```

- [ ] **Step 4: `GET /api/mobile/v1/screens/week` route'unu yaz**

`app/api/mobile/v1/screens/week/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { trToday } from '@/lib/mobile/today';
import { buildStudentWeek, buildParentWeek, buildTeacherWeek, buildManagementWeek } from '@/lib/mobile/week';

// Rol-aware haftalık program (spec §5.1). ?week= ile gezinme (biçim doğrulanır;
// geçersizse bu haftaya düşer). ?child= yalnız veli. Servis HttpError → withMobileAuth çevirir.
export const runtime = 'nodejs';

const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/; // W01-W53 (İnceleme Codex #11: W00/W99 reddedilir → bu haftaya düşer)

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const raw = new URL(req.url).searchParams.get('week');
  const weekKey = raw && WEEK_RE.test(raw) ? raw : trToday().weekKey;

  if (session.role === 'student') return NextResponse.json(await buildStudentWeek(session, weekKey));
  if (session.role === 'parent') {
    const child = new URL(req.url).searchParams.get('child');
    return NextResponse.json(await buildParentWeek(session, weekKey, child));
  }
  if (session.role === 'teacher') return NextResponse.json(await buildTeacherWeek(session, weekKey));
  return NextResponse.json(buildManagementWeek(weekKey));
});
```

- [ ] **Step 5: Tip senkron + build + test**

Run: `npm run mobile:types && npm run build && npx vitest run`
Expected: drift testi PASS, build başarılı, testler PASS.

- [ ] **Step 6: Commit (local)**

```bash
git add lib/slots.ts lib/mobile/week.ts lib/mobile/api-types.ts app/api/mobile/v1/screens/week/route.ts mobile/src/api/types.ts
git commit -m "feat(mobil): haftalık program ucu — getWeekCellsAllTeachers + 7-gün rol builder'ları + GET /screens/week"
```

---

### Task 4: Mobil ödev uçları — liste + teslim (`withMobileAuth`)

Web `/api/odev` `getSession()` yalnız web cookie okur → mobil Bearer 401 alır. Ayrı `app/api/mobile/v1/odev/route.ts` (`withMobileAuth`) mevcut `lib/odev.ts` servisini sarar — YENİ iş mantığı yok. `GET` → öğrenci (`listOdevForStudent`) / veli (`listOdevForParent`); `POST` teslim/geri-al → **yalnız öğrenci** (`submitOdev`, studentId+cls session'dan). Öğretmen ödev verme/kontrol Plan 5 DIŞI (ADR).

**Files:**
- Modify: `lib/mobile/api-types.ts` (Ödev tipleri)
- Modify: `lib/mobile/contracts.ts` (`OdevSubmitSchema`)
- Create: `app/api/mobile/v1/odev/route.ts`

**Interfaces:**
- Consumes: `withMobileAuth`, `contentLimited`, `parseBody`, `listOdevForStudent`/`listOdevForParent`/`submitOdev` (lib/odev), `getOrgConfig` (modül gate), `trToday` (overdue tarihi), `isPastDue` (lib/mobile/today).
- Produces (mobil `odev.tsx` kullanır): api-types `OdevSubmission`, `OdevListItem`, `OdevParentChildRow`, `OdevListItemParent`, `OdevListResponse`, `OdevSubmitRequest`, `OdevSubmitResponse`. Uçlar:
  - `GET /api/mobile/v1/odev` → öğrenci `{ role:'student', items: OdevListItem[] }` / veli `{ role:'parent', items: OdevListItemParent[] }` / diğer 403
  - `POST /api/mobile/v1/odev` gövde `OdevSubmitRequest` → `OdevSubmitResponse` (yalnız öğrenci)

- [ ] **Step 1: api-types.ts'e Ödev tiplerini ekle**

`lib/mobile/api-types.ts` sonuna:

```typescript
// ── Ödev ekranı (spec §5.1 — öğrenci teslim + öğrenci/veli görüntüleme) ──────
// status: '' (teslim edilmedi) | 'teslim' | 'kontrol' (öğretmen puanladı/onayladı)
export interface OdevSubmission {
  status: string; // '' | 'teslim' | 'kontrol'
  note: string;
  score: string;
  feedback: string;
  submittedAt: string;
  checkedAt: string;
}
export interface OdevListItem {
  id: string;
  title: string;
  desc: string;
  branch: string;
  dueDate: string; // YYYY-MM-DD veya ''
  createdByName: string;
  createdAt: string; // ISO veya ''
  status: string; // '' | 'teslim' | 'kontrol' (öğrencinin kendi durumu)
  note: string;
  score: string;
  feedback: string;
  overdue: boolean; // dueDate geçmiş VE status='' (teslim edilmemiş)
}
export interface OdevParentChildRow {
  childId: string;
  childName: string;
  cls: string;
  status: string; // '' | 'teslim' | 'kontrol'
}
export interface OdevListItemParent {
  id: string;
  title: string;
  desc: string;
  branch: string;
  dueDate: string;
  createdByName: string;
  createdAt: string;
  children: OdevParentChildRow[];
}
export type OdevListResponse =
  | { role: 'student'; items: OdevListItem[] }
  | { role: 'parent'; items: OdevListItemParent[] };
export interface OdevSubmitRequest {
  id: string;
  note?: string;
  done?: boolean; // false = teslimi geri al
}
export interface OdevSubmitResponse {
  ok: true;
  status: string | null; // yeni durum ('teslim'|'kontrol') veya null (geri alındı)
}
```

- [ ] **Step 2: contracts.ts'e şema ekle**

`lib/mobile/contracts.ts` sonuna:

```typescript
// Ödev teslim (mobil — yalnız öğrenci; id + opsiyonel not + done). studentId/cls
// GÖNDERİLMEZ (server session'dan). done:false = teslimi geri al.
export const OdevSubmitSchema = z.object({
  id: z.string().min(1).max(100),
  note: z.string().max(1000).optional(),
  done: z.boolean().optional(),
});
```

- [ ] **Step 3: `/api/mobile/v1/odev` route'unu yaz**

`app/api/mobile/v1/odev/route.ts` (yeni — TAMAMI). Öğrenci/veli listesini `lib/odev` servisinden alır; `sub`'ı wire şekline (status/note/...) düzleştirir; overdue hesabı `isPastDue` (today.ts, TR günü):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { parseBody } from '@/lib/validate';
import { OdevSubmitSchema } from '@/lib/mobile/contracts';
import { listOdevForStudent, listOdevForParent, submitOdev } from '@/lib/odev';
import { getOrgConfig } from '@/lib/config';
import { trToday, isPastDue } from '@/lib/mobile/today';
import type { ParentChildView } from '@/lib/mobile/api-types';

// Mobil ödev (spec §5.1): GET liste (öğrenci/veli), POST teslim (öğrenci). lib/odev
// servisini sarar (yeni iş mantığı yok). /api/odev cookie-only olduğundan mobil ayrı uç.
export const runtime = 'nodejs';

// lib/odev submission'ının wire şekline düzleştirilmesi (null → boş alanlar).
function subOut(sub: { status?: string; note?: string; score?: string; feedback?: string; submittedAt?: string; checkedAt?: string } | null) {
  return {
    status: sub?.status ?? '',
    note: sub?.note ?? '',
    score: sub?.score ?? '',
    feedback: sub?.feedback ?? '',
    submittedAt: sub?.submittedAt ?? '',
    checkedAt: sub?.checkedAt ?? '',
  };
}

export const GET = withMobileAuth(async (_req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const mods = await getOrgConfig('modules');
  if (mods.odev === false) return NextResponse.json({ error: 'Bu modül kurumunuzda kapalı' }, { status: 403 });
  const today = trToday().date;

  if (session.role === 'student') {
    const rows = await listOdevForStudent(String(session.cls ?? ''), String(session.id ?? ''));
    const items = rows.map((r) => {
      const s = subOut(r.sub as never);
      return {
        id: r.id, title: r.title, desc: r.desc, branch: r.branch, dueDate: r.dueDate,
        createdByName: r.createdByName, createdAt: r.createdAt ?? '',
        status: s.status, note: s.note, score: s.score, feedback: s.feedback,
        overdue: s.status === '' && isPastDue(r.dueDate, today),
      };
    });
    return NextResponse.json({ role: 'student', items });
  }

  if (session.role === 'parent') {
    const children: ParentChildView[] = (session.children ?? [])
      .map((c) => (typeof c === 'string' ? null : { id: String(c.id ?? ''), name: String(c.name ?? ''), cls: String(c.cls ?? '') }))
      .filter((c): c is ParentChildView => c != null && c.id !== '');
    const rows = await listOdevForParent(children.map((c) => ({ id: c.id, name: c.name, cls: c.cls })));
    const items = rows.map((r) => ({
      id: r.id, title: r.title, desc: r.desc, branch: r.branch, dueDate: r.dueDate,
      createdByName: r.createdByName, createdAt: r.createdAt ?? '',
      children: r.children.map((ch) => ({
        childId: String(ch.childId ?? ''), childName: String(ch.childName ?? ''),
        cls: String(ch.cls ?? ''), status: subOut(ch.sub as never).status,
      })),
    }));
    return NextResponse.json({ role: 'parent', items });
  }

  return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
});

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, OdevSubmitSchema);
  if (!parsed.ok) return parsed.response;
  // studentId + cls session'dan (öğrenci başkası adına teslim edemez) — web submit paritesi.
  const r = await submitOdev({ id: parsed.data.id, studentId: String(session.id ?? ''), cls: String(session.cls ?? ''), note: parsed.data.note, done: parsed.data.done });
  return NextResponse.json({ ok: true, status: r.status });
});
```

- [ ] **Step 4: Tip senkron + build + test**

Run: `npm run mobile:types && npm run build && npx vitest run`
Expected: drift testi PASS, build başarılı, testler PASS.

- [ ] **Step 5: Commit (local)**

```bash
git add lib/mobile/api-types.ts lib/mobile/contracts.ts app/api/mobile/v1/odev/route.ts mobile/src/api/types.ts
git commit -m "feat(mobil): ödev uçları — GET liste (öğrenci/veli) + POST teslim (öğrenci, lib/odev sarar)"
```

---

### Task 5: Mobil şifre değiştirme — `lib/password.ts` servisi + web refactor + `applyPasswordChange` + mobil uç

Şifre değişimi mantığı `app/api/auth/route.ts` change_password içinde INLINE. Ortak `lib/password.ts` `changePasswordFor`'a çıkarılır (bcrypt doğrula + hash + `mustChangePassword:false`); web route bunu çağırır (davranış-koruyan: oturum iptali + `setSession` route'ta kalır). Mobil uç `changePasswordFor` sonrası `applyPasswordChange(sid)` çağırır: **mevcut sid HARİÇ** diğer oturumları iptal eder, mevcut oturum payload'ını `mustChangePassword:false` yapar, taze token çifti üretir (rotation) — kullanıcı logout olmaz. Bu task BACKEND; mobil ekran + gate Task 12.

**Files:**
- Create: `lib/password.ts`
- Modify: `app/api/auth/route.ts` (change_password → `changePasswordFor`)
- Modify: `lib/mobile/sessions.ts` (`revokeMobileSessionsExcept` + `applyPasswordChange`)
- Modify: `lib/mobile/contracts.ts` (`ChangePasswordSchema`)
- Modify: `lib/mobile/api-types.ts` (Şifre tipleri)
- Create: `app/api/mobile/v1/auth/change-password/route.ts`

**Interfaces:**
- Consumes: `bcrypt`, `tdb`, `withMobileAuth`, `parseBody`, `passwordChangeRatelimit`/`safeLimit`/`formatResetWait`/`getClientIp` (lib/ratelimit), `signMobileAccessToken`/`newRefreshToken`/`hashRefreshToken`/`ACCESS_TTL_SEC` (lib/mobile/token), `nextExpiry` (lib/mobile/policy).
- Produces:
  - `changePasswordFor(roleKey: string, userId: string, currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; status: number; error: string }>`
  - `revokeMobileSessionsExcept(role, userId, exceptSid, reason): Promise<number>`
  - `applyPasswordChange(sid, role, userId): Promise<{ pair: MobileTokenPair; payload: Session } | null>`
  - api-types: `ChangePasswordRequest`, `ChangePasswordResponse` (Task 12 mobil kullanır). Uç: `POST /api/mobile/v1/auth/change-password` gövde `ChangePasswordRequest` → `ChangePasswordResponse`.

- [ ] **Step 1: `lib/password.ts` servisini yaz**

`lib/password.ts` (yeni — TAMAMI). Web `updatePasswordFor`'un DB+bcrypt kısmıyla BİREBİR (rol→delege cast, parent→phone; oturum iptali/setSession ÇAĞIRANA ait):

```typescript
import bcrypt from 'bcryptjs';
import { tdb } from '@/lib/sqldb';

// Şifre değiştirme servisi (web change_password + mobil change-password ortak). Mevcut
// şifre doğrulanır, yeni hash yazılır, mustChangePassword:false. Oturum iptali/cookie
// yenileme ÇAĞIRANA ait (web: setSession + revoke tüm; mobil: applyPasswordChange).
// Rol→Prisma delegesi statik ifade edilemez (route'taki updatePasswordFor ile aynı cast).
export type ChangePasswordResult = { ok: true } | { ok: false; status: number; error: string };

export async function changePasswordFor(
  roleKey: string,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const db = tdb() as unknown as Record<string, {
    findFirst: (a: { where: Record<string, string> }) => Promise<{ id: string; passwordHash: string } | null>;
    update: (a: { where: { id: string }; data: { passwordHash: string; mustChangePassword: boolean } }) => Promise<unknown>;
  }>;
  const rec = roleKey === 'parent'
    ? await db.parent.findFirst({ where: { phone: userId } })
    : await db[roleKey].findFirst({ where: { legacyId: userId } });
  if (!rec) return { ok: false, status: 404, error: 'Kullanıcı bulunamadı' };
  const ok = await bcrypt.compare(currentPassword, rec.passwordHash);
  if (!ok) return { ok: false, status: 400, error: 'Mevcut şifre hatalı' };
  const newHash = await bcrypt.hash(newPassword, 10);
  await db[roleKey].update({ where: { id: rec.id }, data: { passwordHash: newHash, mustChangePassword: false } });
  return { ok: true };
}
```

- [ ] **Step 2: Web route'u servise bağla (davranış-koruyan)**

`app/api/auth/route.ts`'te:
(a) import ekle: `import { changePasswordFor } from '@/lib/password';`
(b) `updatePasswordFor` closure'ının DB+bcrypt gövdesini (satır 186-197) `changePasswordFor` çağrısıyla değiştir. Yeni closure (revoke + setSession KORUNUR):

```typescript
    async function updatePasswordFor(roleKey: string, sessionPayloadFields: Record<string, unknown>): Promise<NextResponse> {
      const r = await changePasswordFor(roleKey, String(session!.id ?? ''), password, newPassword);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      // Spec §7: şifre değişiminde tüm mobil refresh oturumları iptal (web oturumu sürer).
      // Best-effort: iptal hatası şifre değişimini/setSession'ı düşürmesin (logAudit kalıbı).
      try {
        await revokeMobileSessionsFor(session!.role, String(session!.id ?? ''), 'şifre değişti');
      } catch (e) {
        console.warn('[mobil] şifre değişiminde oturum iptali başarısız:', e instanceof Error ? e.message : e);
      }
      const res = NextResponse.json({ ok: true });
      await setSession(res, { ...session!, mustChangePassword: false, ...sessionPayloadFields });
      return res;
    }
```

Davranış-koruma kontrol listesi: 404 "Kullanıcı bulunamadı" + 400 "Mevcut şifre hatalı" + revoke best-effort try/catch + setSession payload alanları (asst/teacher/student/accountant/counselor/parent dallanması) BİREBİR korunur; `changePasswordFor` parent'ı `phone`, diğerlerini `legacyId` ile bulur (eski inline ile aynı). `reset_password` bloğu DEĞİŞMEZ.

- [ ] **Step 3: `lib/mobile/sessions.ts`'e helper'ları ekle**

`lib/mobile/sessions.ts` sonuna (mevcut `revokeMobileSessionsFor`'un altına):

```typescript
// Kullanıcının MEVCUT sid HARİÇ tüm oturumlarını iptal (mobil şifre değişimi — kendi
// oturumu logout olmadan diğer cihazlar düşer). revokeMobileSessionsFor'un "hariç" varyantı.
export async function revokeMobileSessionsExcept(role: string, userId: string, exceptSid: string, reason: string): Promise<number> {
  const r = await tdb().mobileSession.updateMany({
    where: { orgSlug: currentOrg(), role, userId, revokedAt: null, id: { not: exceptSid } },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}

// Mobil şifre değişimi sonrası: diğer oturumları iptal + mevcut oturumun payload'ını
// mustChangePassword:false yap + taze token çifti üret (rotation; prevRefreshHash sıfırlanır
// → grace penceresi kapanır). Client yeni çifti yazar, session state'i günceller.
// Oturum yoksa/kapatılmışsa null. (SKIP tablosu → orgSlug ELLE.)
export async function applyPasswordChange(sid: string, role: string, userId: string): Promise<{ pair: MobileTokenPair; payload: Session } | null> {
  const org = currentOrg();
  await revokeMobileSessionsExcept(role, userId, sid, 'şifre değişti');
  // CAS + retry (İnceleme Codex #1): eşzamanlı /refresh aynı kaydı rotate edebilir; CAS
  // koşulu (refreshHash HÂLÂ okuduğumuz mu) olmadan son-yazan-kazanır → istemciye dönen
  // çift anında geçersiz kalır veya eski refresh reuse sayılıp oturum kapanır. refreshHash'i
  // where'e ekle; kaybedersek (count=0) yeniden oku ve bir kez dene.
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await tdb().mobileSession.findFirst({ where: { id: sid, orgSlug: org } });
    if (!s || s.revokedAt) return null;
    const payload = { ...(s.payload as unknown as Session), mustChangePassword: false };
    const refreshToken = newRefreshToken();
    const now = new Date();
    const r = await tdb().mobileSession.updateMany({
      where: { id: sid, orgSlug: org, revokedAt: null, refreshHash: s.refreshHash }, // CAS
      data: {
        payload: payload as object,
        refreshHash: hashRefreshToken(refreshToken),
        prevRefreshHash: null, // rotation zinciri sıfırlanır (grace kapanır)
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt: nextExpiry(now),
      },
    });
    if (r.count > 0) {
      const accessToken = await signMobileAccessToken(payload, sid);
      return { pair: { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC, sessionId: sid }, payload };
    }
    // CAS kaybı: araya eşzamanlı rotasyon girdi → yeniden oku, tekrar dene (bir kez).
  }
  return null;
}
```

- [ ] **Step 4: contracts.ts + api-types.ts**

`lib/mobile/contracts.ts` sonuna:

```typescript
// Mobil şifre değiştirme (zorunlu değişim + isteğe bağlı). newPassword min 6 (web zNewPassword paritesi).
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6).max(200),
});
```

`lib/mobile/api-types.ts` sonuna:

```typescript
// ── Şifre değiştirme (spec §7 — mobil forced-change + isteğe bağlı) ──────────
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
export interface ChangePasswordResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  session: MobileSessionInfo; // mustChangePassword artık false
}
```

- [ ] **Step 5: `POST /api/mobile/v1/auth/change-password` route'unu yaz**

`app/api/mobile/v1/auth/change-password/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { parseBody } from '@/lib/validate';
import { ChangePasswordSchema } from '@/lib/mobile/contracts';
import { changePasswordFor } from '@/lib/password';
import { applyPasswordChange } from '@/lib/mobile/sessions';
import { passwordChangeRatelimit, safeLimit, formatResetWait, getClientIp } from '@/lib/ratelimit';

// Mobil şifre değiştirme (spec §7). changePasswordFor (web ile ortak) + applyPasswordChange
// (diğer oturumlar iptal, mevcut korunur, taze token). Gerçek director/org_admin
// mustChangePassword taşımaz → 403 (WebView'den web change_password kullanır).
export const runtime = 'nodejs';

function roleKeyFor(session: { role: string; asst?: unknown }): string | null {
  if (session.role === 'director' && session.asst) return 'assistantDirector';
  if (session.role === 'teacher') return 'teacher';
  if (session.role === 'student') return 'student';
  if (session.role === 'accountant') return 'accountant';
  if (session.role === 'counselor') return 'counselor';
  if (session.role === 'parent') return 'parent';
  return null;
}

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const roleKey = roleKeyFor(session);
  if (!roleKey) return NextResponse.json({ error: 'Bu rol mobilde şifre değiştiremez' }, { status: 403 });

  // Rate limit — kapılmış oturumda mevcut şifre tahminini yavaşlat (web paritesi).
  const rl = await safeLimit(passwordChangeRatelimit, `${getClientIp(req)}:${session.id}`);
  if (!rl.success) return NextResponse.json({ error: `Çok fazla deneme. Lütfen ${formatResetWait(rl.reset)} tekrar deneyin.` }, { status: 429 });

  const parsed = await parseBody(req, ChangePasswordSchema);
  if (!parsed.ok) return parsed.response;

  const r = await changePasswordFor(roleKey, String(session.id ?? ''), parsed.data.currentPassword, parsed.data.newPassword);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const applied = await applyPasswordChange(session.sid, session.role, String(session.id ?? ''));
  if (!applied) return NextResponse.json({ error: 'Oturum bulunamadı. Yeniden giriş yapın.' }, { status: 401 });

  // payload = saklanan Session (JWT meta claim'i yok — login `session: payload` deseniyle aynı).
  return NextResponse.json({
    accessToken: applied.pair.accessToken,
    refreshToken: applied.pair.refreshToken,
    expiresIn: applied.pair.expiresIn,
    session: applied.payload,
  });
});
```

- [ ] **Step 6: Tip senkron + build + test**

Run: `npm run mobile:types && npm run build && npx vitest run`
Expected: drift testi PASS, build başarılı, testler PASS (web change_password davranışı değişmedi — mevcut testler yeşil).

- [ ] **Step 7: Commit (local)**

```bash
git add lib/password.ts app/api/auth/route.ts lib/mobile/sessions.ts lib/mobile/contracts.ts lib/mobile/api-types.ts app/api/mobile/v1/auth/change-password/route.ts mobile/src/api/types.ts
git commit -m "feat(mobil): şifre değiştirme — lib/password.ts servisi (web+mobil ortak) + applyPasswordChange (diğer oturumlar iptal, mevcut korunur) + mobil uç"
```

---

### Task 6: Bildirim kategori tercihleri — şema + `lib/notify-prefs.ts` + fan-out enforcement + mobil uç

Bildirim kategori tercihleri altyapısı SIFIRDAN (mevcut altyapı yok — `NotificationEvent`'te kategori alanı yok, tercih tablosu yok). Kategori `tag` önekinden türetilir (`categoryOf` — şemaya alan EKLENMEZ). Tek YENİ tablo `NotificationPreference` (susturulan kategoriler). Enforcement `enqueueNotification`'ta: muted kategori → **push atlanır ama `NotificationEvent` (inbox) yine yazılır** (kayıp yok). Güvenlik kategorisi asla susturulamaz. Kategori tercihi kullanıcı bazlı (role+userId), cihaz bazlı değil.

**Files:**
- Modify: `prisma/schema.prisma` (`NotificationPreference` modeli)
- Create: `lib/notify-prefs.ts`
- Create: `lib/notify-prefs.test.ts`
- Modify: `lib/push/outbox.ts` (`enqueueNotification` muted kontrolü)
- Modify: `lib/mobile/api-types.ts` (BildirimTercihi tipleri)
- Modify: `lib/mobile/contracts.ts` (`NotifPrefUpdateSchema`)
- Create: `app/api/mobile/v1/notification-prefs/route.ts`
- Modify: `app/api/superadmin/route.ts` (`TENANT_MODELS`'e `notificationPreference`)

**Interfaces:**
- Consumes: `tdb` (lib/sqldb), `currentOrg`/`currentBranch` (lib/tenant), `prisma` (outbox dispatchDue re-check), `withMobileAuth`, `parseBody`, `contentLimited`.
- Produces:
  - `NotifCategory` (api-types union) · `categoryOf(tag): NotifCategory` · `NOTIF_CATEGORY_LABELS` · `categoriesForRole(role): NotifCategory[]` · `getMutedCategories(role, userId): Promise<Set<NotifCategory>>` · `setPref(role, userId, category, enabled): Promise<void>` · `isPushMuted(role, userId, tag): Promise<boolean>`
  - api-types: `NotifCategory`, `NotifPrefItem`, `NotifPrefsResponse`, `NotifPrefUpdateRequest`, `NotifPrefUpdateResponse`. Uçlar: `GET /api/mobile/v1/notification-prefs` → `NotifPrefsResponse` · `POST` gövde `NotifPrefUpdateRequest` → `NotifPrefUpdateResponse`.

- [ ] **Step 1: Şema — `NotificationPreference` modeli**

`prisma/schema.prisma` sonuna (mevcut modellerin yanına) ekle:

```prisma
// Kullanıcı bazlı bildirim kategori tercihi (spec §5.1). Satır YOKSA = kategori AÇIK
// (varsayılan enabled). Yalnız SUSTURULAN kategoriler için satır olur (enabled=false).
// Kategori tag önekinden türetilir (lib/notify-prefs categoryOf) — NotificationEvent'te
// kategori alanı yok. guvenlik kategorisi burada saklanmaz (asla susturulamaz).
model NotificationPreference {
  id        String   @id @default(cuid())
  orgSlug   String
  branch    String   @default("main")
  role      String
  userId    String
  category  String
  enabled   Boolean  @default(true)
  updatedAt DateTime @updatedAt
  @@unique([orgSlug, branch, role, userId, category])
  @@index([orgSlug, branch, role, userId])
}
```

Uygula (Mustafa gözetiminde — canlı Neon, yalnız YENİ tablo ekler):

```bash
npm run db:push
```

Beklenen: "The database is now in sync with the Prisma schema" + `NotificationPreference` tablosu oluştu. `prisma generate` postinstall/db:push ile client'a yansır.

- [ ] **Step 2: `categoryOf` + `categoriesForRole` için başarısız birim testleri yaz**

`lib/notify-prefs.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { categoryOf, categoriesForRole } from './notify-prefs';

describe('categoryOf — tag önekinden kategori', () => {
  it('odev-<id> → odev', () => expect(categoryOf('odev-abc')).toBe('odev'));
  it('devamsizlik-<date> → devamsizlik', () => expect(categoryOf('devamsizlik-2026-07-18')).toBe('devamsizlik'));
  it('ann-<id> → duyuru', () => expect(categoryOf('ann-x')).toBe('duyuru'));
  it('davranis-<sid> → davranis', () => expect(categoryOf('davranis-s1')).toBe('davranis'));
  it('deneme-<eid> → deneme', () => expect(categoryOf('deneme-e1')).toBe('deneme'));
  it('form-<id> → form', () => expect(categoryOf('form-f1')).toBe('form'));
  it('etkinlik-<id> → takvim', () => expect(categoryOf('etkinlik-ev1')).toBe('takvim'));
  it('odeme-hatirlatma → odeme', () => expect(categoryOf('odeme-hatirlatma')).toBe('odeme'));
  it('yeni-cihaz → guvenlik', () => expect(categoryOf('yeni-cihaz')).toBe('guvenlik'));
  it('bilinmeyen/null → null (gerçek fail-open, isPushMuted daima false)', () => {
    expect(categoryOf(null)).toBeNull();
    expect(categoryOf('bilinmeyen-xyz')).toBeNull();
    expect(categoryOf(undefined)).toBeNull();
  });
});

describe('categoriesForRole — role-relevant toggle kategorileri', () => {
  it('öğrenci: ödev var; güvenlik/devamsızlık/ödeme YOK', () => {
    const c = categoriesForRole('student');
    expect(c).toContain('odev');
    expect(c).not.toContain('guvenlik');
    expect(c).not.toContain('devamsizlik');
    expect(c).not.toContain('odeme');
  });
  it('veli: devamsızlık + ödeme var; ödev YOK', () => {
    const c = categoriesForRole('parent');
    expect(c).toContain('devamsizlik');
    expect(c).toContain('odeme');
    expect(c).not.toContain('odev');
  });
  it('hiçbir rol güvenlik kategorisini toggle listesine koymaz', () => {
    for (const role of ['student', 'parent', 'teacher', 'director', 'accountant']) {
      expect(categoriesForRole(role)).not.toContain('guvenlik');
    }
  });
});
```

- [ ] **Step 3: Test'i çalıştır, kırmızı gör**

Run: `npx vitest run lib/notify-prefs.test.ts`
Expected: FAIL — `lib/notify-prefs.ts` yok.

- [ ] **Step 4: `lib/notify-prefs.ts` servisini yaz**

`lib/notify-prefs.ts` (yeni — TAMAMI):

```typescript
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import type { NotifCategory } from '@/lib/mobile/api-types';

// Bildirim kategori tercihi servisi (spec §5.1). Kategori tag önekinden türetilir
// (şemaya alan eklemeden); tercih NotificationPreference tablosunda (yalnız susturulanlar).
// guvenlik kategorisi asla susturulamaz (koddan zorlanır).

export const NOTIF_CATEGORY_LABELS: Record<NotifCategory, string> = {
  devamsizlik: 'Devamsızlık',
  odev: 'Ödev',
  davranis: 'Davranış',
  deneme: 'Deneme sonucu',
  duyuru: 'Duyuru',
  form: 'Form/anket',
  takvim: 'Takvim',
  odeme: 'Ödeme',
  guvenlik: 'Güvenlik',
};

// tag öneki → kategori (saf). Bilinmeyen/boş → null (İnceleme Codex #6/Gemini #3:
// 'duyuru' dönmek, kullanıcı duyuruyu susturunca bilinmeyen/gelecek/test tag'lerini de
// susturuyordu; null → isPushMuted DAİMA false = gerçek fail-open, bildirim asla susmaz).
export function categoryOf(tag: string | null | undefined): NotifCategory | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith('devamsizlik')) return 'devamsizlik';
  if (t.startsWith('odev')) return 'odev';
  if (t.startsWith('davranis')) return 'davranis';
  if (t.startsWith('deneme')) return 'deneme';
  if (t.startsWith('ann')) return 'duyuru';
  if (t.startsWith('form')) return 'form';
  if (t.startsWith('etkinlik')) return 'takvim';
  if (t.startsWith('odeme')) return 'odeme';
  if (t.startsWith('yeni-cihaz')) return 'guvenlik';
  return null;
}

// Bir rolün ALABİLECEĞİ (dolayısıyla toggle edebileceği) kategoriler — push hedeflerinden
// türetildi (bkz sendPushToUser envanteri). guvenlik HİÇBİR role dahil değil (susturulamaz).
export function categoriesForRole(role: string): NotifCategory[] {
  switch (role) {
    case 'student':
      return ['odev', 'davranis', 'duyuru', 'form', 'takvim'];
    case 'parent':
      return ['devamsizlik', 'deneme', 'odeme', 'duyuru', 'form', 'takvim'];
    case 'teacher':
      return ['duyuru', 'form'];
    default:
      return ['duyuru']; // director/accountant/counselor/org_admin — yalnız duyuru
  }
}

// Kullanıcının SUSTURDUĞU kategoriler (enabled=false satırları). tdb() tenant-scoped.
export async function getMutedCategories(role: string, userId: string): Promise<Set<NotifCategory>> {
  const rows = await tdb().notificationPreference.findMany({
    where: { role, userId, enabled: false },
    select: { category: true },
  });
  return new Set(rows.map((r) => r.category as NotifCategory));
}

// Tercih yaz — ATOMİK upsert (İnceleme Codex #7/Gemini #2: findFirst+create eşzamanlı ilk
// toggle'da P2002 500 üretiyordu). tdb() upsert'e orgSlug/branch ENJEKTE ETMEZ (sqldb.ts:7
// "upsert dokunulmaz") → composite where + create'e ELLE yaz. guvenlik susturulamaz.
export async function setPref(role: string, userId: string, category: NotifCategory, enabled: boolean): Promise<void> {
  if (category === 'guvenlik') return;
  const orgSlug = currentOrg();
  const branch = currentBranch();
  await tdb().notificationPreference.upsert({
    where: { orgSlug_branch_role_userId_category: { orgSlug, branch, role, userId, category } },
    update: { enabled },
    create: { orgSlug, branch, role, userId, category, enabled },
  });
}

// Fan-out kararı: bu tag'in kategorisi bu kullanıcı için susturulmuş mu? bilinmeyen (null)
// ve guvenlik DAİMA gider (fail-open).
export async function isPushMuted(role: string, userId: string, tag: string | null | undefined): Promise<boolean> {
  const category = categoryOf(tag);
  if (category === null || category === 'guvenlik') return false;
  const muted = await getMutedCategories(role, userId);
  return muted.has(category);
}
```

- [ ] **Step 5: Test'i çalıştır, yeşil gör**

Run: `npx vitest run lib/notify-prefs.test.ts`
Expected: PASS.

- [ ] **Step 6: api-types.ts'e tipleri ekle**

`lib/mobile/api-types.ts` sonuna (`NotifCategory` union — notify-prefs bunu import eder):

```typescript
// ── Bildirim kategori tercihleri (spec §5.1) ────────────────────────────────
export type NotifCategory =
  | 'devamsizlik' | 'odev' | 'davranis' | 'deneme' | 'duyuru' | 'form' | 'takvim' | 'odeme' | 'guvenlik';
export interface NotifPrefItem {
  category: NotifCategory;
  label: string; // sunucudan gelir (NOTIF_CATEGORY_LABELS)
  enabled: boolean;
}
export interface NotifPrefsResponse {
  items: NotifPrefItem[]; // yalnız role-relevant kategoriler (guvenlik dahil DEĞİL)
}
export interface NotifPrefUpdateRequest {
  category: NotifCategory;
  enabled: boolean;
}
export interface NotifPrefUpdateResponse {
  ok: true;
  items: NotifPrefItem[]; // güncellenmiş liste
}
```

- [ ] **Step 7: contracts.ts'e şema ekle**

`lib/mobile/contracts.ts` sonuna (guvenlik enum'da YOK → toggle denemesi 400):

```typescript
// Bildirim kategori toggle (mobil). guvenlik enum dışı (susturulamaz → 400).
export const NotifPrefUpdateSchema = z.object({
  category: z.enum(['devamsizlik', 'odev', 'davranis', 'deneme', 'duyuru', 'form', 'takvim', 'odeme']),
  enabled: z.boolean(),
});
```

- [ ] **Step 8: Fan-out enforcement — `enqueueNotification`**

`lib/push/outbox.ts`'e import ekle: `import { isPushMuted, categoryOf } from '@/lib/notify-prefs';`

Ardından device fan-out + deliveries kurulumunu şu şekilde değiştir (satır 81-102 bölgesi). Mevcut:

```typescript
  const webSubs = await tdb().pushSub.findMany({ where: { role, userId } });
  const devices = await tdb().deviceInstallation.findMany({ where: { role, userId, enabled: true } });
```

Bunun ALTINA (event oluşturmadan önce) ekle + `deliveries`'i koşullu yap:

```typescript
  const webSubs = await tdb().pushSub.findMany({ where: { role, userId } });
  const devices = await tdb().deviceInstallation.findMany({ where: { role, userId, enabled: true } });

  // Kategori tercihi (spec §5.1): kullanıcı bu kategoriyi susturmuşsa PUSH gönderilmez
  // ama NotificationEvent (inbox) YİNE yazılır — kayıp yok. guvenlik hep açık (isPushMuted).
  // Muted → deliveries boş: event oluşur (dispatchStatus:'done'), retry'a düşmez.
  const muted = await isPushMuted(role, userId, payload.tag);
```

Ve `deliveries` dizisini:

```typescript
  const deliveries: NewDelivery[] = muted ? [] : [
    ...webSubs.map((s) => ({
      id: newId('nd_'), eventId, orgSlug: org, branch,
      provider: 'webpush', target: s.endpoint, keys: (s.keys ?? {}) as object,
    })),
    ...devices.map((di) => ({
      id: newId('nd_'), eventId, orgSlug: org, branch,
      provider: di.provider, target: di.token,
    })),
  ];
```

Kontrol: event transaction'ı DEĞİŞMEZ (event her zaman oluşur); yalnız `deliveries` muted'da boş. `if (deliveries.length === 0) return ...` mevcut satırı muted'ı da doğal olarak yakalar (push atlanır, event inbox'ta).

- [ ] **Step 8b: `dispatchDue` retry'da tercih re-check (İnceleme Codex #5)**

Enqueue anında tercih kontrol edilir; ama enqueue'dan SONRA kuyruğa girmiş `pending` bir teslimat cron retry'ında hâlâ gidebilir (kullanıcı arada kategoriyi susturmuşsa). `lib/push/outbox.ts` `dispatchDue` döngüsünde, sahiplik kontrolünden HEMEN SONRA (deliverOne'dan önce) tercih re-check ekle. dispatchDue **tenant-siz global tarar** → base `prisma` + event'in `orgSlug/branch/role/userId` alanları (sahiplik kontrolüyle aynı desen):

```typescript
    // Kategori tercihi re-check (İnceleme Codex #5): teslimat kuyruğa girdikten sonra
    // kullanıcı kategoriyi susturmuş olabilir. base prisma (dispatchDue tenant-siz; org/branch
    // event'ten). bilinmeyen (null) + guvenlik daima gider (isPushMuted paritesi).
    const cat = categoryOf(ev.tag);
    if (cat && cat !== 'guvenlik') {
      const muted = await prisma.notificationPreference.findFirst({
        where: { orgSlug: ev.orgSlug, branch: ev.branch, role: ev.role, userId: ev.userId, category: cat, enabled: false },
        select: { id: true },
      });
      if (muted) {
        await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'dead', lastError: 'kategori susturuldu' } });
        dead++;
        continue;
      }
    }
```

(Yerleşim: `if (!stillOwned) {...}` bloğundan sonra, `const meta = ...`/`renderPush` satırından önce. `dead` sayacı mevcut.)

- [ ] **Step 9: `notification-prefs` route'unu yaz**

`app/api/mobile/v1/notification-prefs/route.ts` (yeni — TAMAMI):

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { parseBody } from '@/lib/validate';
import { NotifPrefUpdateSchema } from '@/lib/mobile/contracts';
import { categoriesForRole, getMutedCategories, setPref, NOTIF_CATEGORY_LABELS } from '@/lib/notify-prefs';

// Bildirim kategori tercihleri (spec §5.1). GET role-relevant kategori+durum listesi;
// POST tekil toggle. guvenlik kategorisi listede YOK (susturulamaz).
export const runtime = 'nodejs';

async function buildItems(role: string, userId: string) {
  const cats = categoriesForRole(role);
  const muted = await getMutedCategories(role, userId);
  return cats.map((category) => ({ category, label: NOTIF_CATEGORY_LABELS[category], enabled: !muted.has(category) }));
}

export const GET = withMobileAuth(async (_req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  return NextResponse.json({ items: await buildItems(session.role, String(session.id ?? '')) });
});

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, NotifPrefUpdateSchema);
  if (!parsed.ok) return parsed.response;
  // role-relevant olmayan kategori (ör. öğrenciye devamsizlik) reddedilir.
  if (!categoriesForRole(session.role).includes(parsed.data.category)) {
    return NextResponse.json({ error: 'Bu kategori rolünüz için geçerli değil' }, { status: 400 });
  }
  await setPref(session.role, String(session.id ?? ''), parsed.data.category, parsed.data.enabled);
  return NextResponse.json({ ok: true, items: await buildItems(session.role, String(session.id ?? '')) });
});
```

- [ ] **Step 10: `TENANT_MODELS`'e ekle (kurum silme — KVKK)**

`app/api/superadmin/route.ts`'te `TENANT_MODELS` dizisine `'notificationPreference'` ekle (mobil/bildirim satırının yanına):

```typescript
  'assistantDirector', 'notifLog', 'notificationEvent', 'notificationDelivery',
  'mobileSession', 'deviceInstallation', 'notificationPreference',
```

- [ ] **Step 11: Tip senkron + build + test**

Run: `npm run mobile:types && npm run build && npx vitest run`
Expected: drift testi PASS, notify-prefs testleri PASS, build başarılı.

- [ ] **Step 12: Commit (local)**

```bash
git add prisma/schema.prisma lib/notify-prefs.ts lib/notify-prefs.test.ts lib/push/outbox.ts lib/mobile/api-types.ts lib/mobile/contracts.ts app/api/mobile/v1/notification-prefs/route.ts app/api/superadmin/route.ts mobile/src/api/types.ts
git commit -m "feat(mobil): bildirim kategori tercihleri — NotificationPreference tablosu + categoryOf + fan-out push suppression (inbox korunur, güvenlik hep açık) + mobil uç"
```

---

### Task 7: Eski-WebView tespiti — `lib/mobile/webview-compat.ts` + `session-open` minimal fallback

Plan 4 tur bulgusu: SM-M205F'te Android System WebView 81 (2020) yönetim panelini BOŞ sayfa verdi (modern JS bundle eski motorda parse edilemiyor). `session-open` isteği WebView'in gerçek UA'sını (System WebView `Chrome/XX` token'ı) taşır; sunucu eşik altındaysa 302 yerine **minimal statik HTML** (JS yok → eski motorda da render) döndürür. Kod TÜKETİLMEZ (getdel'den önce) → güncelleme sonrası taze exchange çalışır. Native köprü KURULMAZ (Plan 4 ADR korunur). `MIN_CHROME_MAJOR` başlangıç 90 (WebView 81 fail etti); Task 15'te cihazda doğrulanır/ayarlanır.

**Files:**
- Create: `lib/mobile/webview-compat.ts`
- Create: `lib/mobile/webview-compat.test.ts`
- Modify: `app/api/mobile/v1/session-open/route.ts`

**Interfaces:**
- Produces: `MIN_CHROME_MAJOR: number` · `parseChromeMajor(ua): number | null` · `isOutdatedWebView(ua): boolean` · `outdatedWebViewHtml(): string`.

- [ ] **Step 1: Başarısız birim testleri yaz**

`lib/mobile/webview-compat.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { parseChromeMajor, isOutdatedWebView, MIN_CHROME_MAJOR } from './webview-compat';

describe('parseChromeMajor', () => {
  it('WebView 81 UA → 81', () => {
    expect(parseChromeMajor('Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/81.0.4044.138 Mobile Safari/537.36')).toBe(81);
  });
  it('modern WebView 120 → 120', () => {
    expect(parseChromeMajor('Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36')).toBe(120);
  });
  it('Chrome token yok (Safari) → null', () => {
    expect(parseChromeMajor('Mozilla/5.0 (iPhone) Version/17.0 Safari/605')).toBeNull();
  });
  it('boş/null → null', () => {
    expect(parseChromeMajor(null)).toBeNull();
    expect(parseChromeMajor('')).toBeNull();
  });
});

describe('isOutdatedWebView (eşik MIN_CHROME_MAJOR)', () => {
  it('81 < eşik → true (eski)', () => {
    expect(isOutdatedWebView('Mozilla/5.0 Chrome/81.0.4044 Mobile')).toBe(true);
  });
  it('eşik ve üstü → false', () => {
    expect(isOutdatedWebView(`Mozilla/5.0 Chrome/${MIN_CHROME_MAJOR}.0 Mobile`)).toBe(false);
    expect(isOutdatedWebView('Mozilla/5.0 Chrome/120.0 Mobile')).toBe(false);
  });
  it('Chrome token yok → false (fail-open, modern WebView UA Chrome taşır)', () => {
    expect(isOutdatedWebView('Safari/605')).toBe(false);
    expect(isOutdatedWebView(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Test'i çalıştır, kırmızı gör**

Run: `npx vitest run lib/mobile/webview-compat.test.ts`
Expected: FAIL — dosya yok.

- [ ] **Step 3: `lib/mobile/webview-compat.ts` yaz**

`lib/mobile/webview-compat.ts` (yeni — TAMAMI):

```typescript
// Eski-WebView tespiti (Plan 4 tur bulgusu). Android System WebView sürümü UA'daki
// Chrome/XX token'ında görünür; eşik altı WebView modern JS bundle'ı parse edemez
// (boş sayfa). session-open UA'yı sunucuda okur (native köprü yok — Plan 4 ADR).
// MIN_CHROME_MAJOR: WebView 81 fail etti; 90 başlangıç, cihazda ince ayar (Task 15).
export const MIN_CHROME_MAJOR = 90;

export function parseChromeMajor(ua: string | null | undefined): number | null {
  if (!ua) return null;
  const m = /Chrome\/(\d+)/.exec(ua);
  return m ? parseInt(m[1], 10) : null;
}

// Chrome token yoksa (nadir; modern WebView UA daima taşır) fail-open (bloklamaz).
export function isOutdatedWebView(ua: string | null | undefined): boolean {
  const major = parseChromeMajor(ua);
  if (major === null) return false;
  return major < MIN_CHROME_MAJOR;
}

// Minimal statik uyarı sayfası — hiç JS yok, inline stil → WebView 81'de bile render olur.
// Play WebView linki https (web.tsx onShouldStartLoadWithRequest sistem tarayıcısında açar).
export function outdatedWebViewHtml(): string {
  return [
    '<!doctype html><html lang="tr"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<title>Guncelleme gerekli</title></head>',
    '<body style="font-family:sans-serif;margin:0;padding:24px;background:#f8fafc;color:#0f172a">',
    '<div style="max-width:420px;margin:40px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">',
    '<h1 style="font-size:18px;margin:0 0 12px">Tarayıcı bileşeni güncel değil</h1>',
    '<p style="font-size:14px;line-height:1.5;color:#475569">Yönetim panelini açmak için cihazınızdaki “Android System WebView” bileşeninin güncellenmesi gerekiyor. Google Play’den güncelledikten sonra tekrar deneyin.</p>',
    '<p style="margin-top:20px"><a href="https://play.google.com/store/apps/details?id=com.google.android.webview" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:14px">Google Play’de güncelle</a></p>',
    '</div></body></html>',
  ].join('');
}
```

- [ ] **Step 4: Test'i çalıştır, yeşil gör**

Run: `npx vitest run lib/mobile/webview-compat.test.ts`
Expected: PASS.

- [ ] **Step 5: `session-open` route'una fallback dalı ekle**

`app/api/mobile/v1/session-open/route.ts`'te:
(a) import ekle: `import { isOutdatedWebView, outdatedWebViewHtml } from '@/lib/mobile/webview-compat';`
(b) tenant guard bloğundan HEMEN SONRA (kod okumadan önce — kod tüketilmesin) ekle:

```typescript
  // Eski-WebView tespiti (Plan 4 tur bulgusu — WebView 81 boş sayfa): eşik altı WebView
  // modern bundle'ı parse edemez. UA'yı BURADA gör (WebView'in gerçek isteği), 302 yerine
  // minimal statik HTML döndür. Kod TÜKETİLMEZ (getdel'den önce) → güncelleme sonrası
  // taze exchange çalışır. Native köprü kurulmaz (Plan 4 ADR).
  if (isOutdatedWebView(headers().get('user-agent'))) {
    return new NextResponse(outdatedWebViewHtml(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer', // kod query-string'i Play linkine referer olarak sızmasın (İnceleme Codex #8)
        'x-content-type-options': 'nosniff',
      },
    });
  }
```

Not: `headers` zaten import'lu (tenant guard kullanıyor); `NextResponse` de import'lu. Diğer her şey (open-redirect, getdel, IP/org/aktiflik) DEĞİŞMEZ.

- [ ] **Step 6: Build + test**

Run: `npm run build && npx vitest run`
Expected: build başarılı, tüm testler PASS.

- [ ] **Step 7: Commit (local)**

```bash
git add lib/mobile/webview-compat.ts lib/mobile/webview-compat.test.ts app/api/mobile/v1/session-open/route.ts
git commit -m "feat(mobil): eski-WebView tespiti — session-open UA'dan Chrome sürümü, eşik altı minimal güncelleme sayfası (köprüsüz)"
```

---

### Task 8: Backend deploy + canlı doğrulama (int-mobile-v2 + web regresyon)

Task 1-7 backend tek push → Vercel deploy → canlıya. Yeni uçlar canlı testkurs'a karşı doğrulanır (`int-mobile-v2.spec.js`); **iki refactor (etüt servisi + şifre servisi) için WEB regresyonu ZORUNLU** (web `/api/etut-sablon/rezervasyon` + web `/api/auth` change_password birebir çalışmalı). `NotificationPreference` tablosu Task 6'da zaten canlı DB'ye push edildi (kod deploy'dan önce tablo var — güvenli sıra). Bu, Plan 4 ADR'siyle uyumlu "DB katmanı → canlı int kanıtı" adımı.

**Files:**
- Create: `e2e/int-mobile-v2.spec.js`

**Interfaces:**
- Consumes: `e2e/helpers` (BASE, DIR_STATE, STU_STATE, getWeekKey, slotStartTime, shiftWeek), `@playwright/test`, `.env.local` `OKULIN_*` creds.

- [ ] **Step 1: Backend commit'leri push et → deploy**

```bash
git push
```
Vercel otomatik deploy. **Deploy READY'yi bekle + SHA doğrula:**
```bash
git rev-parse HEAD
# Vercel dashboard/CLI'da bu SHA'nın Production READY olduğunu doğrula.
```

- [ ] **Step 2: Canlı DB tablosunu doğrula (Task 6 db:push)**

`NotificationPreference` tablosunun canlıda olduğunu doğrula (Task 6'da push edildi; deploy'dan önce olmalı):
```bash
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.notificationPreference.count().then(c=>{console.log('NotificationPreference OK, satır:',c);process.exit(0)}).catch(e=>{console.error('TABLO YOK:',e.message);process.exit(1)})"
```
Expected: "NotificationPreference OK, satır: 0" (boş tablo).

- [ ] **Step 3: `int-mobile-v2.spec.js` yaz**

`e2e/int-mobile-v2.spec.js` (yeni — TAMAMI). `int-mobile-content.spec.js` desenini izler (aynı 3 mobil login, serial, rate-limit bütçesi). Etüt/ödev round-trip'leri canlı veriden DİNAMİK keşfeder (uygun kayıt yoksa `test.skip` + log — cihaz turu Task 15 kapsar):

```javascript
// Canlı sözleşme testleri (Plan 5): etüt reserve/cancel + hafta + ödev submit +
// change-password + notification-prefs + webview-compat + web refactor regresyonu.
// RATE LİMİT BÜTÇESİ: 3 mobil login (5/15dk) — bu pencerede başka mobil suite koşma.
const { test, expect, request } = require('@playwright/test');
const { BASE, STU_STATE, getWeekKey, slotStartTime, shiftWeek } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const CREDS = {
  student: { user: process.env.OKULIN_STU_USER, pass: process.env.OKULIN_STU_PASS },
  teacher: { user: process.env.OKULIN_TEA_USER, pass: process.env.OKULIN_TEA_PASS },
  management: { user: process.env.OKULIN_DIR_USER, pass: process.env.OKULIN_DIR_PASS },
};

let api; // Origin'siz native taklidi
let webStu; // cookie'li öğrenci (web etüt/şifre regresyonu)
const tokens = {};
const H = (t) => ({ Authorization: 'Bearer ' + t });

test.beforeAll(async () => {
  for (const [role, c] of Object.entries(CREDS)) {
    expect(c.user, `OKULIN_${role} creds .env.local'de olmalı`).toBeTruthy();
    expect(c.pass).toBeTruthy();
  }
  api = await request.newContext();
  webStu = await request.newContext({ storageState: STU_STATE, extraHTTPHeaders: { Origin: BASE } });
  for (const [role, c] of Object.entries(CREDS)) {
    const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, { data: { username: c.user, password: c.pass, role } });
    if (r.status() === 429) test.skip(true, 'login rate limit penceresi — sonra tekrar koş');
    expect(r.status(), `${role} login`).toBe(200);
    tokens[role] = (await r.json()).accessToken;
  }
});

test.afterAll(async () => {
  await api?.dispose();
  await webStu?.dispose();
});

// ── Etüt ──────────────────────────────────────────────────────────────────
test('etüt: GET bookable liste şekli (öğrenci)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/etut`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.weekKey).toMatch(/^\d{4}-W\d{2}$/);
  expect(Array.isArray(j.slots)).toBe(true);
  for (const s of j.slots) {
    expect(typeof s.teacherId).toBe('string');
    expect(typeof s.etutId).toBe('string');
    expect(typeof s.dayLabel).toBe('string');
    expect(typeof s.booked).toBe('boolean');
    expect(typeof s.mine).toBe('boolean');
    expect(Array.isArray(s.branches)).toBe(true);
  }
});

test('etüt: GET rol guard (öğretmen/yönetim 403)', async () => {
  expect((await api.get(`${BASE}/api/mobile/v1/etut`, { headers: H(tokens.teacher) })).status()).toBe(403);
  expect((await api.get(`${BASE}/api/mobile/v1/etut`, { headers: H(tokens.management) })).status()).toBe(403);
});

test('etüt: reserve → mine → cancel round-trip (uygun slot varsa)', async () => {
  const wk = getWeekKey();
  const list = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  // Uygun: dolu değil + benim değil + en az 1 branş + GELECEKTE (geçmiş slot reddedilir)
  const slot = (list.slots || []).find((s) => !s.booked && !s.mine && s.branches.length >= 1 && slotStartTime(wk, s.dayIndex, s.start).getTime() > Date.now());
  test.skip(!slot, 'bu hafta rezerve edilebilir gelecek etüt yok — cihaz turu (Task 15) kapsar');
  const body = { teacherId: slot.teacherId, etutId: slot.etutId, branch: slot.branches[0], weekKey: wk };
  const res = await api.post(`${BASE}/api/mobile/v1/etut/reserve`, { data: body, headers: H(tokens.student) });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).ok).toBe(true);
  // Tekrar listele → mine:true
  const after = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  const now = after.slots.find((s) => s.etutId === slot.etutId && s.teacherId === slot.teacherId);
  expect(now.mine).toBe(true);
  // İptal
  const del = await api.delete(`${BASE}/api/mobile/v1/etut/reserve`, { data: { teacherId: slot.teacherId, etutId: slot.etutId }, headers: H(tokens.student) });
  expect(del.status()).toBe(200);
  const after2 = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  const back = after2.slots.find((s) => s.etutId === slot.etutId && s.teacherId === slot.teacherId);
  expect(back.mine).toBe(false);
});

// ── Haftalık program ────────────────────────────────────────────────────────
test('week: öğrenci 7 gün şekli', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/week`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('student');
  expect(j.days.length).toBe(7);
  for (const d of j.days) {
    expect(typeof d.dayIndex).toBe('number');
    expect(typeof d.dayLabel).toBe('string');
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(d.lessons)).toBe(true);
  }
});

test('week: öğretmen 7 gün + hafta gezinme', async () => {
  const jt = await (await api.get(`${BASE}/api/mobile/v1/screens/week`, { headers: H(tokens.teacher) })).json();
  expect(jt.role).toBe('teacher');
  expect(jt.days.length).toBe(7);
  const next = shiftWeek(getWeekKey(), 1);
  const jn = await (await api.get(`${BASE}/api/mobile/v1/screens/week?week=${next}`, { headers: H(tokens.teacher) })).json();
  expect(jn.weekKey).toBe(next);
});

// ── Ödev ─────────────────────────────────────────────────────────────────────
test('ödev: GET liste şekli (öğrenci)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/odev`, { headers: H(tokens.student) });
  expect([200, 403]).toContain(r.status()); // 403 = odev modülü kapalı
  if (r.status() === 200) {
    const j = await r.json();
    expect(j.role).toBe('student');
    expect(Array.isArray(j.items)).toBe(true);
  }
});

test('ödev: submit → undo round-trip (teslim edilmemiş ödev varsa)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/odev`, { headers: H(tokens.student) });
  test.skip(r.status() !== 200, 'odev modülü kapalı');
  const items = (await r.json()).items || [];
  const target = items.find((i) => i.status === '');
  test.skip(!target, 'teslim edilmemiş ödev yok — cihaz turu (Task 15) kapsar');
  const sub = await api.post(`${BASE}/api/mobile/v1/odev`, { data: { id: target.id, note: 'int test', done: true }, headers: H(tokens.student) });
  expect(sub.status(), await sub.text()).toBe(200);
  expect((await sub.json()).status).toBe('teslim');
  const undo = await api.post(`${BASE}/api/mobile/v1/odev`, { data: { id: target.id, done: false }, headers: H(tokens.student) });
  expect(undo.status()).toBe(200);
  expect((await undo.json()).status).toBeNull();
});

test('ödev: POST rol guard (öğretmen 403)', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/odev`, { data: { id: 'x', done: true }, headers: H(tokens.teacher) });
  expect(r.status()).toBe(403);
});

// ── Bildirim tercihleri ───────────────────────────────────────────────────────
test('notif-prefs: GET role-relevant + güvenlik yok', async () => {
  const j = await (await api.get(`${BASE}/api/mobile/v1/notification-prefs`, { headers: H(tokens.student) })).json();
  expect(Array.isArray(j.items)).toBe(true);
  const cats = j.items.map((i) => i.category);
  expect(cats).toContain('odev');
  expect(cats).not.toContain('guvenlik');
  for (const it of j.items) expect(typeof it.enabled).toBe('boolean');
});

test('notif-prefs: toggle odev kapat/aç round-trip', async () => {
  const off = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'odev', enabled: false }, headers: H(tokens.student) });
  expect(off.status()).toBe(200);
  expect((await off.json()).items.find((i) => i.category === 'odev').enabled).toBe(false);
  const on = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'odev', enabled: true }, headers: H(tokens.student) });
  expect(on.status()).toBe(200);
  expect((await on.json()).items.find((i) => i.category === 'odev').enabled).toBe(true);
});

test('notif-prefs: role-dışı kategori 400, güvenlik 400 (schema)', async () => {
  // öğrenciye devamsizlik geçerli değil
  const r1 = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'devamsizlik', enabled: false }, headers: H(tokens.student) });
  expect(r1.status()).toBe(400);
  // guvenlik enum dışı → parseBody 400
  const r2 = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'guvenlik', enabled: false }, headers: H(tokens.student) });
  expect(r2.status()).toBe(400);
});

// ── Şifre değiştirme (non-destructive) ────────────────────────────────────────
test('change-password: yanlış mevcut şifre → 400 (şifre değişmez)', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/auth/change-password`, { data: { currentPassword: 'kesinlikle-yanlis-xyz', newPassword: 'yeni123456' }, headers: H(tokens.student) });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toMatch(/Mevcut şifre hatalı/);
});

test('change-password: gerçek müdür (management) → 403', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/auth/change-password`, { data: { currentPassword: 'x', newPassword: 'yeni123456' }, headers: H(tokens.management) });
  expect(r.status()).toBe(403);
});

// ── Eski-WebView (session-open UA fallback) ────────────────────────────────────
test('webview-compat: eski UA → 200 HTML güncelleme sayfası', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/session-open?code=${'x'.repeat(25)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/81.0.4044.138 Mobile Safari/537.36' },
  });
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/text\/html/);
  expect(await r.text()).toMatch(/güncel değil/i);
});

test('webview-compat: modern UA → HTML DEĞİL (kod kontrolüne düşer)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/session-open?code=x`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36' },
  });
  expect(r.status()).toBe(400); // code<20 → "Geçersiz kod" (HTML değil, JSON)
  expect(r.headers()['content-type']).toMatch(/application\/json/);
});

// ── Web refactor regresyonu (etüt + şifre servisleri) ─────────────────────────
test('web regresyon: change_password yanlış şifre → 400 (servis çıkarımı sağlam)', async () => {
  const r = await webStu.post(`${BASE}/api/auth`, { data: { action: 'change_password', password: 'kesinlikle-yanlis-xyz', newPassword: 'yeni123456' } });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toMatch(/Mevcut şifre hatalı/);
});

test('web regresyon: etüt reserve/cancel (cookie yolu — servis çıkarımı sağlam)', async () => {
  const wk = getWeekKey();
  const list = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  const slot = (list.slots || []).find((s) => !s.booked && !s.mine && s.branches.length >= 1 && slotStartTime(wk, s.dayIndex, s.start).getTime() > Date.now());
  test.skip(!slot, 'web etüt regresyonu için uygun slot yok — cihaz turu kapsar');
  const body = { teacherId: slot.teacherId, etutId: slot.etutId, branch: slot.branches[0], weekKey: wk };
  const res = await webStu.post(`${BASE}/api/etut-sablon/rezervasyon`, { data: body });
  expect(res.status(), await res.text()).toBe(200);
  const del = await webStu.delete(`${BASE}/api/etut-sablon/rezervasyon`, { data: { teacherId: slot.teacherId, etutId: slot.etutId } });
  expect(del.status()).toBe(200);
});
```

- [ ] **Step 4: int-mobile-v2'yi canlıya karşı koş**

Run: `npx playwright test int-mobile-v2 --project=int`
Expected: hepsi yeşil (round-trip'ler uygun veri yoksa skip — log'da görünür). 429 gelirse temiz rate-limit penceresinde tekrar koş.

- [ ] **Step 5: Regresyon süitleri (Plan 4 mobil + web smoke)**

Auth+push+content mobil süitleri ve web smoke hâlâ yeşil olmalı (yeni uçlar/refactor eskiyi bozmadı):
```bash
npx playwright test int-mobile-auth int-mobile-content --project=int
npx playwright test smoke --project=chromium   # veya proje adına göre
```
Expected: int-mobile-auth 13/13, int-mobile-content 12/12, smoke yeşil. (Rate-limit: mobil süitleri ARDIŞIK değil, pencere aç.)

- [ ] **Step 6: Ledger + commit + push**

`.superpowers/sdd/progress.md`'ye Task 1-8 sonuçları + canlı doğrulama yazılır (subagent-driven-development süreci). int spec commit:
```bash
git add e2e/int-mobile-v2.spec.js
git commit -m "test(mobil): int-mobile-v2 — etüt/hafta/ödev/şifre/bildirim-tercihi/webview-compat + web refactor regresyonu (canlı testkurs)"
git push
```

---

> **MOBİL TASK NOTU (9-14):** Expo SDK 57 — kod yazmadan önce `mobile/AGENTS.md` uyarısı gereği https://docs.expo.dev/versions/v57.0.0/ ilgili API'yi doğrula (expo-router `router.push`/`useFocusEffect`/`useLocalSearchParams`). typedRoutes açık: yeni rota dosyası eklenince `npx expo start` ile tip cache'i yenilenir (bayat cache `as any` ile MASKELENMEZ — Plan 4 dersi). Her ekran `useSession().api` + `useFocusEffect(load)` + `ApiError` yakalama + `kit` bileşenleri (emoji YASAK, Türkçe). Cihaz doğrulaması Task 15 (tsc+vitest kapıları ara task'larda yeter — Plan 3-4 deseni).

### Task 9: Mobil etüt rezervasyon ekranı (`src/app/etut.tsx`) + Bugün kısayolu

Öğrenci bu haftanın uygun etütlerini görür, rezerve/iptal eder. `GET /api/mobile/v1/etut` → güne göre grupla; slot durumuna göre (mine/booked/branch seçimi) aksiyon. `POST/DELETE /etut/reserve`. Hata `ApiError.message` inline gösterilir. Bugün ekranına "Hızlı erişim" kartı + "Etüt al" butonu (bu task kartı kurar; Task 10/11 anchor'a ekler).

**Files:**
- Create: `mobile/src/app/etut.tsx`
- Modify: `mobile/src/app/(tabs)/bugun.tsx` (router import + Hızlı erişim kartı + etüt butonu)

**Interfaces:**
- Consumes: `useSession` (api/org), `ApiError` (../api/client), kit bileşenleri, `EtutScreenResponse`/`EtutSlotView` (../api/types), `router`/`useFocusEffect` (expo-router).

- [ ] **Step 1: `src/app/etut.tsx` yaz**

`mobile/src/app/etut.tsx` (yeni — TAMAMI):

```tsx
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, Button, ErrorText, palette } from '../ui/kit';
import type { EtutScreenResponse, EtutSlotView } from '../api/types';

// Etüt rezervasyon (spec §5.1 — öğrenci). Bu haftanın uygun etütleri; slot durumuna
// göre rezerve/iptal. İş kuralları sunucuda (reserveEtut); ihlalde ApiError mesajı gösterilir.
export default function EtutEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [data, setData] = useState<EtutScreenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // işlemdeki etutId

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      setData(await api.get<EtutScreenResponse>('/api/mobile/v1/etut'));
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Etütler yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const reserve = useCallback(async (slot: EtutSlotView, branch: string) => {
    if (!api || busy) return;
    setBusy(slot.etutId);
    setError(null);
    try {
      await api.post('/api/mobile/v1/etut/reserve', { teacherId: slot.teacherId, etutId: slot.etutId, branch });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Rezervasyon yapılamadı.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, load]);

  const cancel = useCallback(async (slot: EtutSlotView) => {
    if (!api || busy) return;
    setBusy(slot.etutId);
    setError(null);
    try {
      await api.del('/api/mobile/v1/etut/reserve', { teacherId: slot.teacherId, etutId: slot.etutId });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İptal edilemedi.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, load]);

  // Güne göre grupla (slots zaten gün+saat sıralı geliyor).
  const byDay: { dayLabel: string; slots: EtutSlotView[] }[] = [];
  for (const s of data?.slots ?? []) {
    const last = byDay[byDay.length - 1];
    if (last && last.dayLabel === s.dayLabel) last.slots.push(s);
    else byDay.push({ dayLabel: s.dayLabel, slots: [s] });
  }

  return (
    <Screen>
      <ScrollView style={st.wrap} contentContainerStyle={st.content}>
        <Title>Etüt rezervasyonu</Title>
        <Sub>Bu haftanın uygun etütleri. Grubuna ve dersine uygun bir etüt seçebilirsin.</Sub>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!data ? <Sub>Yükleniyor…</Sub> : null}
        {data && byDay.length === 0 ? <Sub>Bu hafta rezerve edilebilir etüt yok.</Sub> : null}
        {byDay.map((day) => (
          <View key={day.dayLabel}>
            <Text style={st.day}>{day.dayLabel}</Text>
            {day.slots.map((slot) => (
              <Card key={`${slot.teacherId}-${slot.etutId}`}>
                <Text style={st.time}>{`${slot.start}–${slot.end}`}</Text>
                <Sub>{slot.teacherName}</Sub>
                {slot.mine ? (
                  <View>
                    <Text style={[st.status, { color: brand, fontWeight: '700' }]}>
                      Rezerve edildi{slot.branch ? ` — ${slot.branch}` : ''}
                    </Text>
                    <Button label={busy === slot.etutId ? 'İşleniyor…' : 'İptal et'} onPress={() => void cancel(slot)} disabled={busy === slot.etutId} variant="danger" />
                  </View>
                ) : slot.booked ? (
                  <Text style={st.status}>Dolu</Text>
                ) : slot.branches.length === 0 ? (
                  <Text style={st.status}>Bu etüt için uygun dersin yok.</Text>
                ) : slot.branches.length === 1 ? (
                  <Button label={busy === slot.etutId ? 'İşleniyor…' : `Rezerve et — ${slot.branches[0]}`} onPress={() => void reserve(slot, slot.branches[0])} disabled={busy === slot.etutId} color={brand} />
                ) : (
                  <View>
                    <Sub>Ders seç:</Sub>
                    {slot.branches.map((b) => (
                      <Button key={b} label={busy === slot.etutId ? 'İşleniyor…' : b} onPress={() => void reserve(slot, b)} disabled={busy === slot.etutId} color={brand} variant="ghost" />
                    ))}
                  </View>
                )}
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  day: { fontSize: 14, fontWeight: '700', color: palette.sub, marginTop: 20, textTransform: 'uppercase' },
  time: { fontSize: 15, fontWeight: '700', color: palette.text },
  status: { fontSize: 14, color: palette.sub, marginTop: 8 },
});
```

- [ ] **Step 2: Bugün ekranına Hızlı erişim kartı + etüt butonu**

`mobile/src/app/(tabs)/bugun.tsx`'te:
(a) expo-router import'una `router` ekle: `import { router, useFocusEffect } from 'expo-router';`
(b) rol view'larından SONRA, `</ScrollView>`'dan ÖNCE ekle:

```tsx
        {today ? (
          <Card>
            <Text style={s.cardTitle}>Hızlı erişim</Text>
            {/* PLAN5-QUICKLINKS: sonraki task'lar buraya buton ekler */}
            {today.role === 'student' ? (
              <Button label="Etüt al / görüntüle" onPress={() => router.push('/etut')} color={brand} variant="ghost" />
            ) : null}
          </Card>
        ) : null}
```

- [ ] **Step 3: tsc + vitest**

Run: `cd mobile && npx tsc --noEmit && npx vitest run`
Expected: temiz (yeni rota typedRoutes'a girer — gerekirse `npx expo start` ile tip cache yenile, sonra tsc).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/etut.tsx "mobile/src/app/(tabs)/bugun.tsx"
git commit -m "feat(mobil): etüt rezervasyon ekranı (öğrenci — uygun etütler, rezerve/iptal) + Bugün Hızlı erişim kartı"
```

---

### Task 10: Mobil haftalık program ekranı (`src/app/hafta.tsx`) + Bugün kısayolu

3 rol için haftalık program (spec §5.1). `GET /screens/week?week=` → 7 gün. Öğrenci/veli: dersler + kendi etütleri; öğretmen: grid (ders + dolu etüt). Veli çocuk seçici. Hafta gezinme (`◀ ▶`) — client tarafı basit weekKey aritmetiği (`shiftWeekKey` saf yardımcı). Bugün ekranına "Haftalık program" butonu (anchor'a).

**Files:**
- Create: `mobile/src/app/hafta.tsx`
- Create: `mobile/src/week-nav.ts` (`shiftWeekKey` saf — istemci hafta gezinmesi)
- Create: `mobile/src/week-nav.test.ts`
- Modify: `mobile/src/app/(tabs)/bugun.tsx` (Haftalık program butonu — QUICKLINKS anchor)

**Interfaces:**
- Consumes: `useSession`, `ApiError`, kit, `WeekResponse`/`WeekDay`/`ParentChildView` (../api/types), `shiftWeekKey`.
- Produces: `shiftWeekKey(weekKey, delta): string` (saf; ISO hafta aritmetiği).

- [ ] **Step 1: `shiftWeekKey` için başarısız test**

`mobile/src/week-nav.test.ts` (yeni — TAMAMI):

```typescript
import { describe, it, expect } from 'vitest';
import { shiftWeekKey } from './week-nav';

describe('shiftWeekKey — ISO hafta gezinme', () => {
  it('sonraki hafta', () => expect(shiftWeekKey('2026-W29', 1)).toBe('2026-W30'));
  it('önceki hafta', () => expect(shiftWeekKey('2026-W29', -1)).toBe('2026-W28'));
  it('yıl sınırı ileri (2026-W53 yok → 2027-W01)', () => {
    // 2026 ISO'da 53 hafta değil; son haftadan +1 yeni yıla geçer
    const r = shiftWeekKey('2026-W52', 1);
    expect(r === '2026-W53' || r === '2027-W01').toBe(true);
  });
  it('yıl sınırı geri (W01 → önceki yıl son hafta)', () => {
    expect(shiftWeekKey('2026-W01', -1)).toMatch(/^2025-W5[23]$/);
  });
  it('delta 0 → aynı', () => expect(shiftWeekKey('2026-W29', 0)).toBe('2026-W29'));
});
```

- [ ] **Step 2: `src/week-nav.ts` yaz**

`mobile/src/week-nav.ts` (yeni — TAMAMI). Helpers.js `getMondayOfWeek`/`getWeekKey` mantığıyla aynı (ISO):

```typescript
// İstemci hafta gezinmesi (haftalık program ◀ ▶). e2e/helpers.js shiftWeek ile aynı ISO
// mantık; sunucu ?week= param'ını doğrular, geçersizse bu haftaya düşer (savunma sunucuda).
function getMondayOfWeek(weekKey: string): Date {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr, 10);
  const jan4 = new Date(parseInt(year, 10), 0, 4);
  const dow = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
  return monday;
}
function weekKeyOf(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function shiftWeekKey(weekKey: string, delta: number): string {
  const mon = getMondayOfWeek(weekKey);
  mon.setDate(mon.getDate() + delta * 7);
  return weekKeyOf(mon);
}
```

- [ ] **Step 3: Test yeşil**

Run: `cd mobile && npx vitest run src/week-nav.test.ts`
Expected: PASS.

- [ ] **Step 4: `src/app/hafta.tsx` yaz**

`mobile/src/app/hafta.tsx` (yeni — TAMAMI):

```tsx
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, ErrorText, palette } from '../ui/kit';
import { shiftWeekKey } from '../week-nav';
import type { WeekResponse, WeekDay, TeacherWeekDay, ParentChildView } from '../api/types';

// Haftalık program (spec §5.1 — 3 rol, salt-okunur). ?week= ile ◀ ▶ gezinme;
// veli çocuk seçici. Dersler + (öğrenci/veli) kendi etütleri; öğretmen grid.
export default function HaftaEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [week, setWeek] = useState<string | null>(null); // null = sunucu bu haftayı seçsin
  const [childId, setChildId] = useState<string | null>(null);
  const [data, setData] = useState<WeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const qs: string[] = [];
      if (week) qs.push(`week=${encodeURIComponent(week)}`);
      if (childId) qs.push(`child=${encodeURIComponent(childId)}`);
      const r = await api.get<WeekResponse>(`/api/mobile/v1/screens/week${qs.length ? `?${qs.join('&')}` : ''}`);
      setData(r);
      if (!week) setWeek(r.weekKey); // ilk yükte sunucunun haftasını sabitle (gezinme için)
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Program yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api, week, childId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shift = (delta: number) => setWeek((w) => (w ? shiftWeekKey(w, delta) : w));

  return (
    <Screen>
      <ScrollView style={st.wrap} contentContainerStyle={st.content}>
        <Title>Haftalık program</Title>
        <View style={st.nav}>
          <Pressable style={st.navBtn} onPress={() => shift(-1)}><Text style={[st.navLabel, { color: brand }]}>◀ Önceki</Text></Pressable>
          <Text style={st.weekLabel}>{data?.weekKey ?? ''}</Text>
          <Pressable style={st.navBtn} onPress={() => shift(1)}><Text style={[st.navLabel, { color: brand }]}>Sonraki ▶</Text></Pressable>
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!data ? <Sub>Yükleniyor…</Sub> : null}

        {data?.role === 'parent' && data.children.length > 1 ? (
          <View style={st.chips}>
            {data.children.map((ch: ParentChildView) => {
              const active = (childId ?? data.child?.id) === ch.id;
              return (
                <Pressable key={ch.id} onPress={() => setChildId(ch.id)} style={[st.chip, active && { borderColor: brand }]}>
                  <Text style={[st.chipLabel, active && { color: brand, fontWeight: '700' }]}>{ch.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {data?.role === 'student' ? data.days.map((d) => <DayCard key={d.dayIndex} day={d} />) : null}
        {data?.role === 'parent' ? (data.child ? data.child.days.map((d) => <DayCard key={d.dayIndex} day={d} />) : <Card><Sub>Öğrenci kaydı bulunamadı.</Sub></Card>) : null}
        {data?.role === 'teacher' ? data.days.map((d) => <TeacherDayCard key={d.dayIndex} day={d} />) : null}
        {data?.role === 'management' ? <Card><Sub>Program görünümü öğrenci/veli/öğretmen içindir.</Sub></Card> : null}
      </ScrollView>
    </Screen>
  );
}

function DayCard({ day }: { day: WeekDay }) {
  const empty = day.lessons.length === 0 && (!day.etuts || day.etuts.length === 0);
  return (
    <Card>
      <Text style={st.dayTitle}>{day.dayLabel} · {day.date}</Text>
      {empty ? <Sub>Bu gün ders/etüt yok.</Sub> : null}
      {day.lessons.map((l, i) => (
        <View key={`${l.slotId}-${i}`} style={st.row}>
          <Text style={st.rowTime}>{l.slotLabel}</Text>
          <View style={st.rowMain}>
            <Text style={st.rowTitle}>{l.branch || 'Ders'}</Text>
            <Text style={st.rowSub}>{l.teacherName}</Text>
          </View>
        </View>
      ))}
      {(day.etuts ?? []).map((e) => (
        <View key={e.id} style={st.row}>
          <Text style={st.rowTime}>{`${e.start}–${e.end}`}</Text>
          <View style={st.rowMain}>
            <Text style={st.rowTitle}>{e.branch || 'Etüt'}</Text>
            <Text style={st.rowSub}>{e.teacherName} · etüt</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function TeacherDayCard({ day }: { day: TeacherWeekDay }) {
  return (
    <Card>
      <Text style={st.dayTitle}>{day.dayLabel} · {day.date}</Text>
      {day.slots.length === 0 ? <Sub>Bu gün ders/etüt yok.</Sub> : null}
      {day.slots.map((l, i) => (
        <View key={`${l.slotId}-${i}`} style={st.row}>
          <Text style={st.rowTime}>{l.slotLabel}</Text>
          <View style={st.rowMain}>
            <Text style={st.rowTitle}>{l.type === 'ders' ? `${l.cls || ''} ${l.branch}`.trim() : l.studentName || 'Etüt'}</Text>
            <Text style={st.rowSub}>{l.type === 'ders' ? 'Ders' : 'Etüt'}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  navBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  navLabel: { fontSize: 15, fontWeight: '600' },
  weekLabel: { fontSize: 15, fontWeight: '700', color: palette.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.line, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card },
  chipLabel: { fontSize: 14, color: palette.text },
  dayTitle: { fontSize: 15, fontWeight: '700', color: palette.text, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  rowTime: { fontSize: 13, fontWeight: '700', color: palette.sub, minWidth: 88 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: palette.text },
  rowSub: { fontSize: 13, color: palette.sub, marginTop: 1 },
});
```

- [ ] **Step 5: Bugün kısayoluna "Haftalık program" ekle**

`mobile/src/app/(tabs)/bugun.tsx`'te `{/* PLAN5-QUICKLINKS: ... */}` satırının ALTINA ekle:

```tsx
            {today.role === 'student' || today.role === 'parent' || today.role === 'teacher' ? (
              <Button label="Haftalık program" onPress={() => router.push('/hafta')} color={brand} variant="ghost" />
            ) : null}
```

- [ ] **Step 6: tsc + vitest**

Run: `cd mobile && npx tsc --noEmit && npx vitest run`
Expected: temiz, week-nav testi PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/app/hafta.tsx mobile/src/week-nav.ts mobile/src/week-nav.test.ts "mobile/src/app/(tabs)/bugun.tsx"
git commit -m "feat(mobil): haftalık program ekranı (3 rol, hafta gezinme, veli çocuk seçici) + Bugün kısayolu"
```

---

### Task 11: Mobil ödev ekranı (`src/app/odev.tsx`) + Bugün kısayolu

Öğrenci ödev listesi + teslim/geri-al; veli ödev listesi (salt-okunur, çocuk durumları). `GET /api/mobile/v1/odev` → rol-aware; `POST` teslim (öğrenci). Bugün kısayoluna "Tüm ödevler".

**Files:**
- Create: `mobile/src/app/odev.tsx`
- Modify: `mobile/src/app/(tabs)/bugun.tsx` (Ödevler butonu — QUICKLINKS anchor)

**Interfaces:**
- Consumes: `useSession`, `ApiError`, kit, `OdevListResponse`/`OdevListItem`/`OdevListItemParent`/`OdevSubmitResponse` (../api/types).

- [ ] **Step 1: `src/app/odev.tsx` yaz**

`mobile/src/app/odev.tsx` (yeni — TAMAMI):

```tsx
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, Button, Input, ErrorText, palette } from '../ui/kit';
import type { OdevListResponse, OdevListItem, OdevListItemParent, OdevSubmitResponse } from '../api/types';

const STATUS_LABEL: Record<string, string> = { '': 'Teslim edilmedi', teslim: 'Teslim edildi', kontrol: 'Kontrol edildi' };

// Ödev (spec §5.1): öğrenci liste + teslim/geri-al; veli salt-okunur çocuk durumları.
export default function OdevEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [data, setData] = useState<OdevListResponse | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      setData(await api.get<OdevListResponse>('/api/mobile/v1/odev'));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'Ödev modülü kurumunuzda kapalı.' : e instanceof ApiError && e.status !== 0 ? e.message : 'Ödevler yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const submit = useCallback(async (id: string, done: boolean) => {
    if (!api || busy) return;
    setBusy(id);
    setError(null);
    try {
      await api.post<OdevSubmitResponse>('/api/mobile/v1/odev', { id, note: notes[id] ?? undefined, done });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'İşlem başarısız.');
    } finally {
      setBusy(null);
    }
  }, [api, busy, notes, load]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content}>
        <Title>Ödevler</Title>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!data ? <Sub>Yükleniyor…</Sub> : null}
        {data && data.items.length === 0 ? <Sub>Ödev bulunmuyor.</Sub> : null}

        {data?.role === 'student' ? data.items.map((o: OdevListItem) => (
          <Card key={o.id}>
            <Text style={st.title}>{o.title}</Text>
            <Sub>{o.branch}{o.dueDate ? ` · son gün ${o.dueDate}` : ''}{o.createdByName ? ` · ${o.createdByName}` : ''}</Sub>
            {o.desc ? <Text style={st.desc}>{o.desc}</Text> : null}
            <Text style={[st.status, o.overdue && { color: palette.danger, fontWeight: '700' }]}>
              {STATUS_LABEL[o.status] ?? o.status}{o.overdue ? ' · gecikti' : ''}
            </Text>
            {o.status === 'kontrol' ? (
              <View>
                {o.score ? <Text style={st.fb}>Puan: {o.score}</Text> : null}
                {o.feedback ? <Text style={st.fb}>Geri bildirim: {o.feedback}</Text> : null}
              </View>
            ) : o.status === 'teslim' ? (
              <Button label={busy === o.id ? 'İşleniyor…' : 'Teslimi geri al'} onPress={() => void submit(o.id, false)} disabled={busy === o.id} variant="danger" />
            ) : (
              <View>
                <Input placeholder="Not (isteğe bağlı)" value={notes[o.id] ?? ''} onChangeText={(t) => setNotes((p) => ({ ...p, [o.id]: t }))} multiline />
                <Button label={busy === o.id ? 'İşleniyor…' : 'Teslim et'} onPress={() => void submit(o.id, true)} disabled={busy === o.id} color={brand} />
              </View>
            )}
          </Card>
        )) : null}

        {data?.role === 'parent' ? data.items.map((o: OdevListItemParent) => (
          <Card key={o.id}>
            <Text style={st.title}>{o.title}</Text>
            <Sub>{o.branch}{o.dueDate ? ` · son gün ${o.dueDate}` : ''}{o.createdByName ? ` · ${o.createdByName}` : ''}</Sub>
            {o.desc ? <Text style={st.desc}>{o.desc}</Text> : null}
            {o.children.map((ch) => (
              <Text key={ch.childId} style={st.status}>{ch.childName}: {STATUS_LABEL[ch.status] ?? ch.status}</Text>
            ))}
          </Card>
        )) : null}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  title: { fontSize: 16, fontWeight: '700', color: palette.text },
  desc: { fontSize: 14, color: palette.text, marginTop: 6 },
  status: { fontSize: 14, color: palette.sub, marginTop: 8 },
  fb: { fontSize: 14, color: palette.text, marginTop: 4 },
});
```

- [ ] **Step 2: Bugün kısayoluna "Tüm ödevler" ekle**

`mobile/src/app/(tabs)/bugun.tsx`'te `{/* PLAN5-QUICKLINKS: ... */}` bloğuna (Haftalık program butonunun altına) ekle:

```tsx
            {today.role === 'student' || today.role === 'parent' ? (
              <Button label="Tüm ödevler" onPress={() => router.push('/odev')} color={brand} variant="ghost" />
            ) : null}
```

- [ ] **Step 3: tsc + vitest**

Run: `cd mobile && npx tsc --noEmit && npx vitest run`
Expected: temiz.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/odev.tsx "mobile/src/app/(tabs)/bugun.tsx"
git commit -m "feat(mobil): ödev ekranı (öğrenci teslim/geri-al + veli görüntüleme) + Bugün kısayolu"
```

---

### Task 12: Mobil şifre değiştirme ekranı + `mustChangePassword` zorunlu kapısı

`src/app/sifre.tsx` (zorunlu + isteğe bağlı mod). Session store'a `applyPasswordChanged` (taze token çifti + session güncelle). `mustChangePassword=true` kullanıcı `ready` olduğunda `/sifre`'ye zorlanır (index + tabs guard). Ayarlar'a "Şifre değiştir" linki.

**Files:**
- Modify: `mobile/src/store/session.tsx` (`applyPasswordChanged` + interface + value)
- Create: `mobile/src/app/sifre.tsx`
- Modify: `mobile/src/app/index.tsx` (mustChangePassword → /sifre)
- Modify: `mobile/src/app/(tabs)/_layout.tsx` (ready + mustChangePassword → /sifre)
- Modify: `mobile/src/app/(tabs)/ayarlar.tsx` ("Şifre değiştir" butonu)

**Interfaces:**
- Consumes: `ChangePasswordResponse` (../api/types), `useSession`, kit, `ApiError`, `router`.
- Produces: `applyPasswordChanged(pair: { accessToken: string; refreshToken: string }, session: MobileSessionInfo): Promise<void>` (context).

- [ ] **Step 1: session store'a `applyPasswordChanged` ekle**

`mobile/src/store/session.tsx`'te:
(a) `SessionContextValue` interface'ine ekle:

```typescript
  // Mobil şifre değişimi sonrası: yeni token çifti + güncel session (mustChangePassword:false).
  applyPasswordChanged(pair: { accessToken: string; refreshToken: string }, session: MobileSessionInfo): Promise<void>;
```

(b) `login` callback'inin yanına helper ekle:

```typescript
  const applyPasswordChanged = useCallback(
    async (pair: { accessToken: string; refreshToken: string }, newSession: MobileSessionInfo) => {
      // Epoch'u artır (İnceleme Codex #2 / Gemini #1 — Critical): şifre değişimi sırasında
      // UÇUŞTA olan bir doRefresh yanıtı taze token'ları EZMESİN ve 401'ini logout'a
      // çevirMESİN. clear() epoch++ → eski epoch'lu setPair reddedilir (false), eski
      // epoch'lu doRefresh outcome 'stale' olur (onSessionExpired tetiklenmez).
      await tokens.clear();
      await tokens.setPair(pair);
      setSession(newSession);
    },
    [tokens],
  );
```

(c) `value` memo'suna `applyPasswordChanged` ekle (hem obje hem bağımlılık dizisi):

```typescript
  const value = useMemo<SessionContextValue>(
    () => ({ status, org, session, api, installationId, appVersion, saveOrg, leaveOrg, login, logout, retryBoot, rotateInstallationId, applyPasswordChanged }),
    [status, org, session, api, installationId, appVersion, saveOrg, leaveOrg, login, logout, retryBoot, rotateInstallationId, applyPasswordChanged],
  );
```

- [ ] **Step 2: `src/app/sifre.tsx` yaz**

`mobile/src/app/sifre.tsx` (yeni — TAMAMI):

```tsx
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Input, Button, ErrorText } from '../ui/kit';
import type { ChangePasswordResponse } from '../api/types';

// Şifre değiştirme (spec §7). Zorunlu (mustChangePassword) → Vazgeç yok; isteğe bağlı
// (ayarlardan) → Vazgeç var. Başarıda taze token çifti yazılır, session güncellenir (kapı açılır).
export default function SifreEkrani() {
  const { api, session, applyPasswordChanged } = useSession();
  const forced = Boolean(session?.mustChangePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (next.length < 6) { setError('Yeni şifre en az 6 karakter olmalı.'); return; }
    if (next !== again) { setError('Yeni şifreler eşleşmiyor.'); return; }
    if (next === current) { setError('Yeni şifre mevcut şifreyle aynı olamaz.'); return; }
    if (!api) return;
    setBusy(true);
    try {
      const r = await api.post<ChangePasswordResponse>('/api/mobile/v1/auth/change-password', { currentPassword: current, newPassword: next });
      await applyPasswordChanged({ accessToken: r.accessToken, refreshToken: r.refreshToken }, r.session);
      router.replace('/bugun');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Şifre değiştirilemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content}>
        <Title>Şifre değiştir</Title>
        <Sub>{forced ? 'Devam etmek için şifrenizi değiştirmeniz gerekiyor.' : 'Hesap şifrenizi güncelleyin.'}</Sub>
        <Input placeholder="Mevcut şifre" secureTextEntry value={current} onChangeText={setCurrent} autoCapitalize="none" />
        <Input placeholder="Yeni şifre (en az 6)" secureTextEntry value={next} onChangeText={setNext} autoCapitalize="none" />
        <Input placeholder="Yeni şifre (tekrar)" secureTextEntry value={again} onChangeText={setAgain} autoCapitalize="none" />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button label={busy ? 'Kaydediliyor…' : 'Şifreyi değiştir'} onPress={() => void submit()} disabled={busy} />
        {!forced ? <Button label="Vazgeç" onPress={() => router.back()} variant="ghost" /> : null}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({ content: { padding: 24, paddingTop: 32, paddingBottom: 48 } });
```

- [ ] **Step 3: index.tsx kapısı**

`mobile/src/app/index.tsx`'i güncelle:

```tsx
import { Redirect } from 'expo-router';
import { useSession } from '../store/session';
import { LoadingScreen } from '../ui/kit';

// Duruma göre yönlendirici — ekranlar arası akışın tek karar noktası.
export default function Index() {
  const { status, session } = useSession();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'needs-org') return <Redirect href="/kurum" />;
  if (status === 'needs-login') return <Redirect href="/giris" />;
  if (session?.mustChangePassword) return <Redirect href="/sifre" />; // zorunlu şifre değişimi
  return <Redirect href="/bugun" />;
}
```

- [ ] **Step 4: tabs guard**

`mobile/src/app/(tabs)/_layout.tsx`'te `useSession()`'dan `session` de al ve `status !== 'ready'` guard'ından SONRA ekle (deep-link ile tab'a girip zorunlu değişimi atlamayı önler):

```tsx
  if (status === 'ready' && session?.mustChangePassword) return <Redirect href="/sifre" />;
```

- [ ] **Step 5: Ayarlar'a "Şifre değiştir" linki**

`mobile/src/app/(tabs)/ayarlar.tsx`'te profil Card'ından sonra (Cihazlar bölümünden önce veya "Kurumdan ayrıl"dan önce) ekle:

```tsx
        <Button label="Şifre değiştir" onPress={() => router.push('/sifre')} color={brand} variant="ghost" />
```

- [ ] **Step 6: tsc + vitest**

Run: `cd mobile && npx tsc --noEmit && npx vitest run`
Expected: temiz.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/store/session.tsx mobile/src/app/sifre.tsx mobile/src/app/index.tsx "mobile/src/app/(tabs)/_layout.tsx" "mobile/src/app/(tabs)/ayarlar.tsx"
git commit -m "feat(mobil): şifre değiştirme ekranı + mustChangePassword zorunlu kapısı (index+tabs guard) + applyPasswordChanged + Ayarlar linki"
```

---

### Task 13: Mobil bildirim tercihleri ekranı (`src/app/bildirim-tercihleri.tsx`) + Ayarlar linki

Kullanıcı push kategorilerini aç/kapatır (`Switch`). `GET/POST /notification-prefs`. Kapalı kategori push almaz ama inbox'ta görünür (ekranda açıklanır). Ayarlar'a "Bildirim tercihleri" linki.

**Files:**
- Create: `mobile/src/app/bildirim-tercihleri.tsx`
- Modify: `mobile/src/app/(tabs)/ayarlar.tsx` ("Bildirim tercihleri" butonu)

**Interfaces:**
- Consumes: `useSession`, `ApiError`, kit, `NotifPrefsResponse`/`NotifPrefUpdateResponse`/`NotifPrefItem` (../api/types), RN `Switch`.

- [ ] **Step 1: `src/app/bildirim-tercihleri.tsx` yaz**

`mobile/src/app/bildirim-tercihleri.tsx` (yeni — TAMAMI):

```tsx
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../store/session';
import { ApiError } from '../api/client';
import { Screen, Title, Sub, Card, ErrorText, palette } from '../ui/kit';
import type { NotifPrefsResponse, NotifPrefUpdateResponse, NotifPrefItem } from '../api/types';

// Bildirim kategori tercihleri (spec §5.1). Kapalı kategori PUSH almaz; bildirim yine
// inbox'ta görünür. Güvenlik kategorisi listede yok (susturulamaz — sunucu zorlar).
export default function BildirimTercihleriEkrani() {
  const { api, org } = useSession();
  const brand = org?.themeColor || palette.brandFallback;
  const [items, setItems] = useState<NotifPrefItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      setItems((await api.get<NotifPrefsResponse>('/api/mobile/v1/notification-prefs')).items);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Tercihler yüklenemedi. İnternetinizi kontrol edin.');
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggle = useCallback(async (item: NotifPrefItem, enabled: boolean) => {
    if (!api || busy) return;
    setBusy(item.category);
    setItems((prev) => (prev ?? []).map((x) => (x.category === item.category ? { ...x, enabled } : x))); // iyimser
    try {
      const r = await api.post<NotifPrefUpdateResponse>('/api/mobile/v1/notification-prefs', { category: item.category, enabled });
      setItems(r.items);
    } catch (e) {
      setItems((prev) => (prev ?? []).map((x) => (x.category === item.category ? { ...x, enabled: !enabled } : x))); // geri al
      setError(e instanceof ApiError ? e.message : 'Tercih kaydedilemedi.');
    } finally {
      setBusy(null);
    }
  }, [api, busy]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content}>
        <Title>Bildirim tercihleri</Title>
        <Sub>Kapattığınız kategorilerde push bildirimi almazsınız; bildirimler yine uygulama içinde (Bildirimler sekmesi) görünür. Güvenlik bildirimleri her zaman açıktır.</Sub>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!items ? <Sub>Yükleniyor…</Sub> : null}
        {(items ?? []).map((item) => (
          <Card key={item.category}>
            <View style={st.row}>
              <Text style={st.label}>{item.label}</Text>
              <Switch value={item.enabled} onValueChange={(v) => void toggle(item, v)} disabled={busy === item.category} trackColor={{ true: brand, false: palette.line }} />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '600', color: palette.text, flex: 1, marginRight: 12 },
});
```

- [ ] **Step 2: Ayarlar'a "Bildirim tercihleri" linki**

`mobile/src/app/(tabs)/ayarlar.tsx`'te "Şifre değiştir" butonunun yanına (aynı bölge) ekle:

```tsx
        <Button label="Bildirim tercihleri" onPress={() => router.push('/bildirim-tercihleri')} color={brand} variant="ghost" />
```

- [ ] **Step 3: tsc + vitest**

Run: `cd mobile && npx tsc --noEmit && npx vitest run`
Expected: temiz.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/bildirim-tercihleri.tsx "mobile/src/app/(tabs)/ayarlar.tsx"
git commit -m "feat(mobil): bildirim tercihleri ekranı (kategori toggle, güvenlik hariç) + Ayarlar linki"
```

---

### Task 14: Inbox'tan derin native rotalar (`targetForUrl` genişletme + focus guard)

`targetForUrl`'e `native` varyantı: ödev url'i → `/odev`, program url'i → `/hafta` (native roller). Yönetim → WebView (değişmez), eşlenmeyen → Bugün. `bildirimler.tsx` "İlgili ekranı aç" native dalı (typedRoutes için literal push). Plan 4 Minor #11: focus tek-kayıt zaten-okunmuşa gereksiz markRead kaldırılır.

**Files:**
- Modify: `mobile/src/notification-routing.ts` (`UrlTarget` + `targetForUrl`)
- Modify: `mobile/src/notification-routing.test.ts` (native case'ler)
- Modify: `mobile/src/app/(tabs)/bildirimler.tsx` (native push dalı + focus-read guard)

**Interfaces:**
- Produces: `UrlTarget` genişler `{ type: 'native'; path: '/odev' | '/hafta' }` varyantıyla.

- [ ] **Step 1: notification-routing.test.ts'e native case'ler ekle (kırmızı)**

`mobile/src/notification-routing.test.ts` sonuna yeni describe ekle:

```typescript
describe('targetForUrl — derin native rotalar (Plan 5)', () => {
  it('ödev url → native /odev (öğrenci)', () => {
    expect(targetForUrl('/?tab=odev', 'student')).toEqual({ type: 'native', path: '/odev' });
  });
  it('program url → native /hafta (veli)', () => {
    expect(targetForUrl('/?sekme=program', 'parent')).toEqual({ type: 'native', path: '/hafta' });
  });
  it('yönetim → daima web (native eşleme yok)', () => {
    expect(targetForUrl('/?tab=odev', 'management')).toEqual({ type: 'web', path: '/?tab=odev' });
  });
  it('eşlenmeyen url (davranış) → today (native rol)', () => {
    expect(targetForUrl('/?tab=davranis', 'student')).toEqual({ type: 'today' });
  });
  it('sahte substring (/?notab=odev) → today (tam param eşleşmesi, Codex #10)', () => {
    expect(targetForUrl('/?notab=odev', 'student')).toEqual({ type: 'today' });
  });
  it('kök / → null', () => {
    expect(targetForUrl('/', 'student')).toBeNull();
  });
});
```

Run: `cd mobile && npx vitest run src/notification-routing.test.ts` → FAIL (native varyant yok).

- [ ] **Step 2: `targetForUrl`'i genişlet**

`mobile/src/notification-routing.ts`'te `UrlTarget` tipini ve `targetForUrl` gövdesini güncelle:

```typescript
export type UrlTarget =
  | { type: 'today' }
  | { type: 'native'; path: '/odev' | '/hafta' }
  | { type: 'web'; path: string }
  | null;

export function targetForUrl(url: string | null | undefined, role: RoleCategory | null): UrlTarget {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return null;
  if (role === 'management') return { type: 'web', path: url }; // yönetim → WebView (değişmez)
  if (role === null) return null;
  if (url === '/') return null;
  // Query param'ı GÜVENLİ relative kontrolden SONRA TAM ayrıştır (İnceleme Codex #10: ham
  // substring '/?notab=odev'i yanlış eşlerdi). Sabit origin yalnız parse için (harici çağrı yok).
  let tab: string | null = null, sekme: string | null = null;
  try {
    const u = new URL(url, 'https://x.invalid');
    tab = u.searchParams.get('tab');
    sekme = u.searchParams.get('sekme');
  } catch {
    return { type: 'today' };
  }
  if (tab === 'odev') return { type: 'native', path: '/odev' };
  if (sekme === 'program' || tab === 'program') return { type: 'native', path: '/hafta' };
  return { type: 'today' }; // eşlenmeyen (davranış/deneme/form/takvim/ödeme) → Bugün
}
```

(`RoleCategory` import'u mevcut — dokunma.) Run: test PASS.

- [ ] **Step 3: bildirimler.tsx — native dal + focus-read guard**

`mobile/src/app/(tabs)/bildirimler.tsx`'te:

(a) "İlgili ekranı aç" `onPress`'ini güncelle (typedRoutes için LİTERAL push):

```tsx
                    onPress={() => {
                      if (!item.read) void markRead(item.id);
                      if (t.type === 'today') router.push('/bugun');
                      else if (t.type === 'native') { if (t.path === '/odev') router.push('/odev'); else router.push('/hafta'); }
                      else router.push({ pathname: '/web', params: { path: t.path } });
                    }}
```

(b) focus efektindeki tek-kayıt markRead'i zaten-okunmuşa göre guard'la (Minor #11) — efekt gövdesindeki `void (async () => { ... })()` bloğunu şu şekilde değiştir:

```tsx
    void (async () => {
      let alreadyRead = inList?.read ?? false;
      if (!inList) {
        try {
          const r = await api.get<InboxListResponse>(`/api/mobile/v1/notifications?id=${encodeURIComponent(focus)}`);
          if (cancelled) return;
          if (r.items[0]) { setFocusItem(r.items[0]); alreadyRead = r.items[0].read; }
          applyCounts(r.unreadCount);
        } catch {
          /* bulunamadı/ağ hatası — liste yine görünür */
        }
      }
      if (!cancelled && !alreadyRead) await markRead(focus);
    })();
```

- [ ] **Step 4: tsc + vitest**

Run: `cd mobile && npx tsc --noEmit && npx vitest run`
Expected: temiz, notification-routing testleri PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/notification-routing.ts mobile/src/notification-routing.test.ts "mobile/src/app/(tabs)/bildirimler.tsx"
git commit -m "feat(mobil): inbox derin native rotalar (ödev→/odev, program→/hafta) + focus zaten-okunmuş guard (Minor #11)"
```

---

### Task 15: Rebuild + konsolide cihaz turu (Mustafa — SM-M205F)

Tüm mobil ekranlar (etüt/hafta/ödev/şifre/tercihler/derin-rota) gerçek cihazda uçtan uca doğrulanır. **Yeni native modül EKLENMEDİ** (mevcut webview/camera/notifications yeterli) → rebuild yalnız JS+asset; temiz kurulum için yine `run:android`. Cihaz turu bulguları ayrı `fix(mobil):` commit'leriyle işlenir; tur temizse push edilir. Ledger + memory güncellenir.

**Operasyon (Mustafa + telefon):**
- JAVA_HOME shell'e inline (zshrc non-interactive gelmiyor — Plan 3-4 tuzağı). LAN-IP açılışında `adb reverse tcp:8081` + localhost relaunch.
- Rebuild: `cd mobile && <JAVA_HOME inline> npx expo run:android` (veya çalışan dev client'ta Metro reload — yeni native yok).

- [ ] **Step 1: Rebuild + boot**

Telefon USB bağlı, `adb devices` görüyor. Rebuild + uygulama açılır, kurum + giriş (Plan 4 turundan hatırlanan) korunmuş.

- [ ] **Step 2: Etüt rezervasyon turu (öğrenci)**

Öğrenci girişi → Bugün → Hızlı erişim "Etüt al" → gün gün uygun etütler görünür → uygun bir etüde (grubuna+dersine) rezerve et → "Rezerve edildi" görünür + Bugün "etütlerim"de görünür → geri gel, "İptal et" → kalkar. Kural denemesi: dolu bir etüde/geçmiş güne rezerve → uygun hata mesajı.

- [ ] **Step 3: Haftalık program turu (3 rol)**

Öğrenci/veli/öğretmen: Bugün "Haftalık program" → 7 gün doğru (bugün Cumartesi ise Cmt vurgusu bilgi amaçlı değil, tüm gün görünür), ◀ ▶ hafta gezinme çalışır (weekKey değişir), veli çoklu çocukta seçici. Öğretmen grid'i (ders + dolu etüt) doğru.

- [ ] **Step 4: Ödev turu (öğrenci + veli)**

Öğrenci: Ödevler → bir ödeve not yazıp "Teslim et" → "Teslim edildi" → "Teslimi geri al" → geri döner. Kontrol edilmiş ödev geri alınamaz (buton yok). Veli: çocukların ödev durumları görünür (teslim butonu YOK).

- [ ] **Step 5: Şifre değiştirme turu (zorunlu + isteğe bağlı)**

Zorunlu: `mustChangePassword=true` bir hesapla (veli 5394870054 Plan 4'te true kaldı) giriş → uygulama `/sifre`'ye zorlar (sekmelere geçilemez) → yeni şifre → `/bugun` açılır, sekmeler gelir. İsteğe bağlı: Ayarlar → Şifre değiştir → değiştir → **turdan sonra şifreyi eski haline geri al** (test hesabı temizliği). Yanlış mevcut şifre → hata. Diğer cihaz oturumu (varsa) düşer, bu cihaz düşmez.

- [ ] **Step 6: Bildirim tercihleri turu**

Ayarlar → Bildirim tercihleri → güvenlik kategorisi YOK, rol-uygun kategoriler var → bir kategoriyi (ör. ödev/duyuru) KAPAT → o kategoride bildirim üret (web'den ödev ver / duyuru gönder) → **push GELMEZ ama Bildirimler sekmesinde görünür** (inbox korunur) → tekrar AÇ → yeni bildirim push gelir. Tur sonrası tercihleri sıfırla.

- [ ] **Step 7: Eski-WebView + WebView turu (yönetim)**

Yönetim girişi → Paneli aç → panel açılır (güncel WebView). Eski-WebView senaryosu int'te kanıtlı (Task 8); elde eski WebView'li cihaz varsa güncelleme sayfası + Play linki doğrulanır (opsiyonel).

- [ ] **Step 8: Derin native rota turu**

Öğrenci: ödev push'una dokun → Bildirimler açılır (focus) → item'da "İlgili ekranı aç" → `/odev` açılır. Program bildirimi varsa → `/hafta`. Yönetim ödev/program bildiriminde → WebView.

- [ ] **Step 9: Bulgular + temizlik + commit + push**

Tur temizse kalan mobil değişiklikler push. Cihaz bulguları `fix(mobil):` commit'leri. Temizlik: test rezervasyonları iptal, test şifre geri, test tercihleri sıfırla, test ödev teslimleri geri, üretilen test bildirimleri sil. Ledger (`.superpowers/sdd/progress.md`) PLAN 5 kapatılır; memory (`native-app-girisi.md`) Plan 5 sonucu + Plan 6'ya devirler.

---

## Plan Sonu Notları

- **Plan 6'ya (release/mağaza) devirler:** assetlinks.json + https App Links (release keystore), EAS release hattı + source-map upload (SENTRY_AUTH_TOKEN), mağaza hazırlığı (Play kapalı test, store listing, Data Safety, hesap silme akışı, KVKK aydınlatma+rıza metinleri), `MIN_CHROME_MAJOR` mağaza-öncesi kesin değeri (cihaz matrisi), PayTR mobil ödeme sınıflandırması (Apple 3.1.3-e), iOS fazı (APNs + biyometri + TestFlight).
- **Plan 5 sonrası açık (istişare/Plan 6+):** devamsızlık görünümü (öğretmen+müdür istişaresi — [[feedback_ozellik-karar-istisare]]), enerjik görsel yön teması (mockup onayı), duyuru okundu senkronu (web↔mobil), offline okuma cache'i (inbox/today/week), öğretmen ödev VERME/KONTROL native (Plan 5'te WebView/ertelendi — spec §5.1 v1), etüt gelecek-hafta rezervasyonu için mobil hafta gezinmesi (v1'de bu hafta), etüt config kapıları (studentSelfBooking/maxWeeklyPerStudent/cancelLockHours) web+mobil ortak servise, **etüt/ödev JSON yazımı atomiklik** (normalize `OdevSubmission` tablosu + unique / etüt CAS-transaction — Codex #3/#4, pre-existing web riski), **structured deep-link push sözleşmesi** (`{route,entityId,orgSlug,branch}` versiyonlu — spec §6/6, Codex #9).
- **Görev sırası bilinçli** (Plan 3-4 deseni): backend (1-7) local commit → Task 8 tek push + canlı doğrulama (iki refactor için WEB regresyonu ZORUNLU) → mobil ekranlar (9-14) tsc+vitest kapılarıyla → tek rebuild + konsolide cihaz turu (15). Task 9-14 arası cihaz doğrulaması YOK.
- **İki davranış-koruyan refactor** (etüt servisi Task 1, şifre servisi Task 5) en yüksek regresyon riski taşır — reviewer'lar satır-satır davranış-koruma trace'i yapmalı; canlı web regresyonu (Task 8) bunları kanıtlar.
- **Tek şema değişikliği** (`NotificationPreference`, Task 6) — `db push` Mustafa gözetiminde, deploy'dan önce (tablo koddan önce var).

## Self-Review (spec kapsam + tip tutarlılığı — yazım sonrası)

**Spec §5.1 kapsam eşlemesi:** etüt görüntüleme+rezervasyon (Task 1-2-9 ✅), program (Task 3-10 ✅), ödev listesi+teslim (öğrenci — Task 4-11 ✅), kategori tercihleri (Task 6-13 ✅), şifre/mustChangePassword (Task 5-12 ✅), native tab/navigation (mevcut + kısayollar ✅). Spec §5.4 eski-WebView (Task 7 ✅). §6/6 push→native rota (Task 14 ✅ — url-eşleme; structured contract Codex #9 Plan 6). **§5.1 TAM DEĞİL — bilinçli kapsam daraltması (Mustafa 2026-07-17):** öğretmen ödev VERME/KONTROL (§5.1 teacher v1) ERTELENDİ; devamsızlık görünümü (istişare), enerjik tema, duyuru senkronu, offline cache Plan 5 dışı. Etüt/ödev JSON atomiklik (Codex #3/#4) pre-existing web riski — Plan 6 normalize tablo.

**Tip tutarlılığı (tasklar arası):** `EtutActor`/`reserveEtut`/`cancelEtut`/`listBookableEtuts` (Task 1↔2 imzaları eşleşir); `EtutSlotView.branches`/`mine`/`booked` (Task 1 BookableEtut → Task 2 EtutSlotView → Task 9 UI aynı alanlar); `WeekDay`/`TeacherWeekDay` (Task 3 tip ↔ Task 10 UI); `OdevListItem.status`/`overdue` (Task 4 ↔ Task 11); `ChangePasswordResponse` (Task 5 ↔ Task 12 `applyPasswordChanged`); `NotifPrefItem` (Task 6 ↔ Task 13); `UrlTarget.native.path: '/odev'|'/hafta'` (Task 14 tip ↔ bildirimler literal push). `categoryOf`/`isPushMuted` (Task 6 servis ↔ outbox enforcement). Tüm mobil tipler `lib/mobile/api-types.ts` → `mobile/src/api/types.ts` senkron zinciriyle (her backend task `npm run mobile:types` çalıştırır).

**Placeholder taraması:** yok — her step tam kod/komut içerir; DB-katmanı route'ları (today/week/etüt/ödev/notif-prefs) bilinçli olarak canlı int testleriyle (Task 8) kanıtlanır (Plan 4 ADR — repo'da Prisma mock yok); saf fonksiyonlar (kural yardımcıları, categoryOf, parseChromeMajor, shiftWeekKey, targetForUrl) TDD ile birim testli.
