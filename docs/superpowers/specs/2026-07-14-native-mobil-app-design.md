# okulin Native Mobil Uygulama — Tasarım Dokümanı

**Tarih:** 2026-07-14
**Durum:** Mustafa onayıyla yazıldı; uygulama planı (writing-plans) bu dokümandan türetilecek.
**Karar süreci:** Üçlü AI mutabakatı — Claude (Opus/Fable), Codex (GPT-5.6 Sol), Gemini. 3 tur çapraz danışma, tüm itirazlar çözüldü, 3/3 imza.

---

## 1. Özet

okulin, Google Play ve App Store'a **hibrit native-first** bir mobil uygulama ile çıkacak:

- **Expo Router + React Native (TypeScript)** — Android ve iOS tek kod tabanı
- Öğrenci / veli / öğretmenin **günlük akışları native ekran**; yönetimsel uzun kuyruk (program oluşturucu, muhasebe, CRM, ayarlar) **güvenli WebView** içinde mevcut web'den
- **`/api/mobile/v1`** sözleşmeli mobil API + access/refresh **token auth** (mevcut cookie sistemine dokunulmaz, yanına eklenir)
- **Doğrudan FCM v1** (iOS fazında APNs) + **PostgreSQL outbox** ile kayıpsız bildirim teslimatı
- **Android önce** geliştirilir ve yayınlanır; aynı kod tabanı iOS'a taşınır
- Erken saha geri bildirimi **kapalı test kanalıyla** (Play internal testing → closed testing), mağaza kalite çıtası tutturulmadan halka açılmaz

**Yol gösteren ilke (Mustafa):** "Hız yerine kalite, istisnasız. Zaman sorunumuz yok." Kalite = günlük UX + push güvenilirliği + güvenlik/KVKK + sürdürülebilir mimari + mağaza uyumu.

---

## 2. Hedefler ve Kısıtlar

| Hedef | Açıklama |
|---|---|
| Mağaza varlığı | Ticarileşme/satış görüşmelerinde kurumsal güven ("uygulamamız var") |
| Güvenilir push | Devamsızlık/taksit/duyuru bildirimleri app kapalıyken bile kayıpsız ulaşmalı |
| Multi-tenant sürtünmesizlik | Yeni kurum (subdomain) eklendiğinde app tarafında hiçbir güncelleme gerekmemeli |
| Web temposu korunur | Mobil, web'in hızlı özellik döngüsünü yavaşlatmamalı |
| Kalite istisnasız | Takvim baskısı yok; her katman ölçülebilir kalite çıtasıyla çıkar |

**Geliştirme kapasitesi:** Üç AI ajan (Claude, Codex, Gemini) + Mustafa (ürün sahibi/karar verici). "Tek geliştirici" varsayımı geçersiz — ancak uygulama katmanında "tek el yazar, diğerleri eleştirir/doğrular" disiplini geçerli (bkz. §14).

---

## 3. Elenen Alternatifler (gerekçeli)

| Alternatif | Neden elendi |
|---|---|
| **Capacitor (uzak URL kabuk)** | okulin SSR + API + cookie + host-bazlı tenant çözümü kullandığından statik paketlenemez; uzak `server.url` gerekir. Capacitor resmi dokümanı: `server.url` ve `allowNavigation` **"not intended for use in production"** (bağımsız doğrulandı). Temel mimari desteklenmeyen moda kurulamaz. |
| **TWA / PWABuilder** | Güvenilen origin listesi APK derleme anında sabitlenir → her yeni kurum = yeni binary + Play incelemesi. Multi-tenant SaaS ile temelden uyumsuz. Native karşılama ekranı konamaz. iOS muadili yok. (İmkânsız değil; operasyonel olarak kötü uyum — Codex düzeltmesi.) |
| **Tam React Native yeniden yazım** | Web dahil tüm rol yüzeylerini (≈39.500 satır TS/TSX, 87 bileşen, ~74 route) mobile taşımak; iki istemcide davranış eşitliği + API geriye-uyumluluk + mağaza release yükü. Kod yazma kapasitesinden bağımsız olarak web temposunu böler. Yönetimsel ekranlar mobilde native değer üretmez. |
| **İnce kabuk (v1'de yalnız WebView)** | Hız optimizasyonuydu; "kalite istisnasız" öncülüne yenildi. Gemini: "Kalitesiz mobil deneyim ve zayıf push ile alınan erken geri bildirim yanıltıcı olur." Apple 4.2 riski de ancak gerçek native değerle tartışmasız aşılır. |
| **Kotlin + Jetpack Compose** | Codex önerdi, sonra geri çekti: iOS kesin planda olduğundan tek mobil kod tabanı (RN) davranış tutarlılığını ve uzun vadeli kaliteyi artırır; form/liste/takvim ağırlıklı bu uygulama sınıfında Compose'un performans üstünlüğü kullanıcıya anlamlı yansımaz; ekip React/TS'te güçlü. Kotlin'e dönüş koşulu: kiosk/MDM, yoğun arka plan servisi, donanım entegrasyonu veya **ölçülmüş** RN performans problemi. |

---

## 4. Mimari Genel Bakış

```
┌─────────────────────────────────────────────┐
│  okulin mobil (Expo Router + RN, TS)        │
│  ┌───────────────┐  ┌─────────────────────┐ │
│  │ Native ekranlar│  │ Güvenli WebView     │ │
│  │ (günlük akışlar│  │ (yönetimsel uzun    │ │
│  │  + bildirim    │  │  kuyruk, *.okulin.  │ │
│  │  merkezi)      │  │  com allowlist)     │ │
│  └───────┬───────┘  └──────────┬──────────┘ │
│          │ Bearer access token │ cookie      │
│          │ (SecureStore)       │ (exchange)  │
└──────────┼─────────────────────┼─────────────┘
           ▼                     ▼
┌─────────────────────────────────────────────┐
│  Mevcut Next.js backend (Vercel)            │
│  • /api/mobile/v1/* (YENİ — sözleşmeli BFF) │
│  • Mevcut ~74 route (web, dokunulmaz)       │
│  • middleware: host→org/branch (aynen)      │
└──────────┬──────────────────────────────────┘
           ▼
  PostgreSQL (Neon) ── outbox tabloları (YENİ)
           │
           ▼ dispatcher (cron/worker)
  FCM v1 (Android) · APNs (iOS, faz 2) · web-push VAPID (mevcut)
```

**Repo düzeni:** Aynı repo içinde `/mobile` klasörü, bağımsız `package.json`, bağımsız EAS/CI hattı. Turborepo'ya **geçilmez** (mevcut Next.js kök yapısı bozulmaz). Mobil-backend sözleşmesi route kodu import ederek değil, **Zod şemadan üretilmiş TypeScript istemciyle** paylaşılır.

---

## 5. Mobil Uygulama Yapısı

### 5.1 Native ekranlar (v1 kapsamı)

**Ortak:**
- Kurum kodu / QR karşılama (ilk açılış; kurum markası yüklenir, SecureStore'da hatırlanır)
- Giriş + OTP/cihaz doğrulama (mevcut Twilio Verify akışının mobil karşılığı)
- Rol-bazlı **"Bugün" ana ekranı** (günün programı + bekleyen işler + son bildirimler)
- Native tab/navigation, bildirim merkezi + kategori tercihleri
- Profil, cihazlar, güvenlik, çıkış · ağ yok / hata / bakım / minimum-sürüm ekranları
- Deep link / universal link işleme

**Öğrenci:** ders programı · etüt görüntüleme + rezervasyon · ödevler · duyurular · davranış puanı/deneme sonucu özeti
**Veli:** çocuk seçimi · program · ödeme/taksit durumu · duyurular · deneme sonucu özeti · yoklama görünümü
**Öğretmen:** bugünkü program · **yoklama alma** · ödev verme/kontrol · duyurular · etüt doluluk

**İkinci dalga (v1 sonrası):** müdür/rehber/muhasebeci native ekranları. **Web-only kalır:** superadmin.

### 5.2 WebView'de kalanlar

Otomatik program oluşturucu · müdür/finans/muhasebe raporları ve PDF-Excel çıktıları · CRM · kurum ayarları · optik/veri içe aktarma · (PayTR ekranı — §11 sınıflandırma kesinleşince).

### 5.3 WebView güvenlik sınırı

- Yalnız canonical `https://*.okulin.com` origin'leri yüklenir; PayTR ve dosya/video origin'leri ayrı allowlist
- `file://`, cleartext HTTP, keyfî yönlendirme kapalı; harici linkler sistem tarayıcısında
- **JS köprüsü minimum:** mesaj türü allowlist + Zod doğrulama + origin kontrolü + nonce; köprüden **asla token/şifre/gizli bilgi geçmez**
- Native→WebView oturum aktarımı **tek kullanımlık session-exchange endpoint'i** ile (WebView refresh token'ı hiç görmez)
- Android geri tuşu / iOS swipe-back / tab state tanımlı; dosya yükleme (kamera, galeri, Files) ve indirme/paylaşım native taraftan
- WebView boş ekran, SSL hatası, 401, bakım, timeout durumlarında **native** hata ekranları

### 5.4 Mobil web uyarlamaları

- WebView'e özel `html.is-mobile-app` sınıfı; `dvh` tabanlı viewport (klavye zıplaması önlenir)
- Mevcut web-push izin isteği (`AppContent.tsx` login-sonrası otomatik akış) mobil WebView'de kapatılır
- Erişilebilirlik: VoiceOver/TalkBack, Dynamic Type, 44×44pt hedefler, kontrast, Reduce Motion (native ekranlar için `ios-hig-design` quick diagnostic 10/10 release kapısı)

---

## 6. Kurum Keşfi ve Deep Link

1. İlk açılışta native kurum kodu ekranı (veya kurumsal QR)
2. Kod apex'e gider: `POST /api/mobile/v1/resolve-org` (mevcut `/api/gate` mantığı yeniden kullanılır) → `{name, orgSlug, branch, canonicalHost, logo, colors, active}`
3. İstemci **yalnız** dönen canonical host'a bağlanır (serbest girilmiş host'a asla) — yalnız `*.okulin.com` deseni kabul
4. Kurum + rastgele üretilmiş `installationId` SecureStore'da saklanır (reklam kimliği değil)
5. Universal/App Link: `okulin.com/m/<org>/<branch>/...` — `assetlinks.json` (Android) + `apple-app-site-association` (iOS) apex'ten servis edilir
6. Push payload'ı URL değil yapılandırılmış veri taşır: `{tenant, route, entityId, eventId}` — native kabuk doğru tenant + ekranı açar; oturum yoksa login sonrası bekleyen rota uygulanır
7. Kenar durumlar: kurum pasif/silinmiş/host değişmiş → native açıklayıcı ekran + kurum kodunu yeniden isteme; kurum değişiminde eski cache + cookie + push bağları temizlenir
8. Branding cache süresi tanımlı + çevrimdışı fallback

**CSRF notu:** `resolve-org` oturumsuz ve salt-okuma → middleware'de dar istisna. Kimlik doğrulamalı uçlar Bearer ile gelir (middleware Bearer'ı zaten muaf tutuyor); **User-Agent bazlı CSRF esnetme yapılmaz** (taklit edilebilir — Gemini'nin önerisi reddedildi, 3/3).

---

## 7. Auth ve Oturum

Mevcut web cookie sistemi **aynen kalır**; mobil için yanına token katmanı eklenir:

- `POST /api/mobile/v1/auth/login` → `{accessToken (10-15 dk), refreshToken}`
- **Refresh token:** DB'de hash'li, tek kullanımlık, **rotation + reuse detection**; cihaz oturumu kaydı (sunucudan tek tek iptal edilebilir, "tüm cihazlardan çıkış" var)
- **Token claim'leri:** session id, user id, role, org, branch, iat, audience, token version — tenant host ile `org/branch` uyuşmazlığında kesin ret
- Saklama: iOS Keychain / Android Keystore (Expo SecureStore)
- Şifre değişiminde refresh oturumları iptal; OTP/güvenilir-cihaz modeli mobil token'a bağlanır
- Biyometri (Face ID/parmak izi) yalnız **yerel yeniden açma kilidi** — sunucu auth'unun yerine geçmez
- Superadmin token'ları mobilde **hiç üretilmez**
- WebView oturumu: tek kullanımlık exchange → kısa ömürlü cookie; WebView cookie kaybederse native taraf yeniden exchange yapar (iOS cookie temizliğine dayanıklı — Gemini'nin "silent login" hedefi bu yolla sağlanır)

---

## 8. Push Mimarisi (Outbox)

**Mevcut sorun (Codex repo bulgusu):** `lib/notify.ts` NotifLog'u önce claim edip gönderimi best-effort yapıyor — sağlayıcı hatasında bildirim **kalıcı kaybolur**. `lib/push.ts` eşzamanlı ve doğrudan gönderiyor.

**Yeni model (web push dahil tüm kanallar bundan geçer):**

| Tablo | İçerik |
|---|---|
| `NotificationEvent` | Kullanıcıya gösterilecek kalıcı kayıt (uygulama içi bildirim merkezi bunu okur) |
| `NotificationOutbox` | Domain olayıyla **aynı Prisma transaction'ında** oluşturulan gönderim işi |
| `DeviceInstallation` | platform, provider, token, hesap, tenant, appVersion, lastSeen, enabled |
| `NotificationDelivery` | event × installation: attempt, status, providerId, nextAttemptAt, lastError |

- Dispatcher (cron/worker): pending teslimatları gönderir; 429/5xx'te exponential backoff; kalıcı invalid-token'da installation devre dışı; `eventId+installationId` unique (idempotent); dead-letter durumu + admin görünürlüğü
- Sağlayıcılar: **FCM v1** (Android, service-account) · **APNs** (iOS, faz 2, token auth) · **web-push VAPID** (mevcut, korunur)
- İstemci: `expo-notifications` ile **native cihaz token'ı** alınır (Expo Push Service kullanılmaz — SLA yok, ara katman, içerik erişimi; 3/3 karar)
- Vercel Queues kullanılırsa yalnız **tetikleyici/hızlandırıcı**; kaynak gerçek daima PostgreSQL outbox (Queues beta, 24 saat retention, DLQ yok)
- Statüler ayrık: sağlayıcıya teslim ≠ cihaza teslim ≠ okundu

**Gizlilik (Apple 4.5.4 + KVKK):** Kilit ekranı payload'ı varsayılan **genel metin** ("Yeni bildiriminiz var / Detay için okulin'i açın"). Öğrenci adı + devamsızlık/borç detayı yalnız uygulama içi inbox'ta; kullanıcı açıkça "kilit ekranında önizleme" açarsa sınırlı ayrıntı. **Mevcut devamsızlık push'u buna göre düzeltilecek** (bugün öğrenci adı + durum kilit ekranına gidiyor).

- Login → izin isteği **kullanıcı eylemiyle** (neden istendiği açıklanır, ilk açılışta otomatik değil); logout → aktif installation-hesap bağı kaldırılır (bildirim durur)

---

## 9. Backend Değişiklikleri (özet)

1. `/api/mobile/v1/*` BFF: resolve-org, auth (login/refresh/logout/devices), bootstrap, rol-bazlı ekran uçları (program, yoklama, etüt, ödev, duyuru, finans-özet), session-exchange, push cihaz kaydı
2. Her uç: rol + tenant scope + alan bazlı veri minimizasyonu + pagination + idempotency + audit — Zod şema → üretilmiş TS istemci
3. `GET /api/mobile/v1/bootstrap`: `minimumSupportedVersion`, `recommendedVersion`, bakım durumu, feature flag'ler (remote kill-switch)
4. Prisma: outbox tabloları (§8) + cihaz oturumu/refresh-session modelleri
5. `sendPushToUser` çağrıları → merkezi enqueue (outbox); FCM v1 adaptörü
6. Route'lardaki ilgili iş kuralları service katmanına (mevcut `lib/*.ts` deseni sürdürülür)
7. API geriye uyumluluk: en az **son iki mağaza sürümü** desteklenir
8. Rate limit: cihaz + hesap + tenant katmanlı

---

## 10. Güvenlik ve KVKK

- **Çocuk verisi:** 7. sınıfa kadar kullanıcı var → "yalnız yetişkin" beyanı yapılamaz. Google Play target-age + Families politikası değerlendirilir; Apple age rating doğru doldurulur. **Kids Category'ye girilmez** (hesap gerektiren genel eğitim uygulaması).
- KVKK: öğrenci/veli/kurum için ayrı aydınlatma metinleri; açık rıza gereken/gerekmeyen işleme amaçları; saklama-imha süreleri (yoklama, sınav, finans, push token, audit, cihaz oturumu); yurt dışı aktarım envanteri (Vercel, Neon, Apple, Google, Twilio, Resend, PayTR); veri sorumlusu(kurum)/veri işleyen(okulin) rolleri + DPA'lar. *(Roadmap'teki açık "KVKK aydınlatma+rıza" borcu bu işin ön koşulu — birlikte kapatılır.)*
- Hesap silme: Apple in-app başlatma + Google uygulama içi ve web silme yolu; yasal eğitim kayıtları saklama süreciyle ayrıştırılır
- Privacy by default: kilit ekranı ayrıntısı, analytics, opsiyonel izinler varsayılan kapalı
- App Privacy Nutrition Label + Google Data Safety envanteri; üçüncü taraf SDK privacy manifest listesi
- Loglarda PII/token yasağı; crash/analytics sağlayıcısı KVKK etkisiyle seçilir

---

## 11. Ödeme ve Mağaza Politikası

- Okulin SaaS lisansı uygulama içinden **satılmaz**
- PayTR ile ödenen taksit = **fiziksel dershane/kurs hizmeti** → Apple 3.1.3(e) dış-ödeme istisnası + Google "fiziksel hizmet" muafiyeti kapsamında savunulur. Bu sınıflandırma **yazılı** kilitlenmeden PayTR mobilde gösterilmez
- Kilitlenecekler: sözleşme/faturada hizmet tanımı · mobil ödeme ekranı açıklaması · App Review notes iş modeli anlatımı · 3DS/callback/iade akışının gerçek cihaz testi · başarılı ödeme sonrası universal link dönüşü · çift callback idempotency (mevcut NX lock korunur)
- Dijital LMS içeriği ile fiziksel kurs ücreti ayrımı netleştirilir (IAP riskine karşı)

**Mağaza hesapları:** Organizasyon hesabı önerilir (ticari SaaS; D-U-N-S/şirket gerekir — Mustafa'nın O2 mali müşavir kararıyla bağlantılı, bkz. §16 açık sorular). Bundle/package id: `com.okulin.app`. Tek public listing (giriş olmadan kurum verisi görünmez). Signing/APNs/service-account anahtarlarının sahipliği Mustafa'da; AI ajanlar kalıcı anahtar sahibi olmaz. App Review için canlı demo kurum (testkurs) + tüm roller için demo hesaplar; demo veride gerçek öğrenci/telefon/finans kaydı kullanılmaz. Reviewer notes: kurum seçimi, rol hesapları, PayTR sınıflandırması, native/WebView sınırı, bildirim/izin akışları.

---

## 12. Fazlama

**Fazlama hız için değil, kaliteyi kontrollü doğrulamak için** (Codex, 3/3).

| Faz | Kapsam | Çıkış kapısı |
|---|---|---|
| **F0 — Temel altyapı** | `/mobile` iskelet (Expo Router) · `/api/mobile/v1` çekirdek (resolve-org, auth, bootstrap) · outbox modeli + dispatcher · FCM v1 · Firebase/EAS/Play Console kurulumları | Sözleşme testleri yeşil; push uçtan uca gerçek cihazda |
| **F1 — Android v1 (kapalı test)** | §5.1 native ekranlar (3 rol) · WebView sınırı · deep link · bildirim merkezi · crash/analytics | Play **internal → closed testing**; testkurs'ta gerçek kullanıcılarla saha dönemi; crash-free ≥ %99.5; test matrisi (§13) yeşil |
| **F2 — Play production** | Kapalı test bulguları kapatılır; store listing (ekran görüntüleri, açıklama, data safety) | Kademeli rollout (%10→%50→%100); SLO'lar izlemede |
| **F3 — iOS** | Aynı kod tabanı; APNs adaptörü · biyometri · Apple hesap/sertifikalar · TestFlight | Apple 4.2 kontrol listesi + HIG diagnostic 10/10; App Review notes hazır |
| **F4 — Strangler + ikinci dalga** | Kullanım verisine göre WebView ekranları tek tek native'e; müdür/rehber/muhasebeci native ekranları | Ölçüm olaylarıyla önceliklendirme |

EAS release disiplini: native değişiklik → mağaza binary'si; JS/stil düzeltmesi → **EAS Update** (staging doğrulaması → kademeli production rollout → rollback prosedürü; runtime version uyumluluk sınırı gözetilir).

---

## 13. Test Stratejisi

Mevcut Playwright `int` deseni (canlı testkurs'a karşı) mobil sözleşme testlerine genişletilir:

- **Unit:** token rotation, deep-link parser, tenant resolver, push sınıflandırma
- **Contract:** her `/mobile/v1` ucu × (güncel + bir önceki) mobil sürüm
- **Tenant isolation:** org × branch × rol × endpoint (mevcut izolasyon testleri genişler)
- **Native E2E:** üç rolün ana akışları (Maestro veya Detox — planlama aşamasında seçilir)
- **WebView E2E:** session-exchange, geri tuşu, dosya yükleme/indirme, dış link, PayTR iframe/3DS
- **Auth:** ilk login, OTP, token yenileme, **refresh reuse saldırısı**, şifre değişimi, cihaz iptali, tenant değişimi, logout
- **Push:** foreground/background/killed · izin reddi/geri alma · token rotation/reinstall · çoklu cihaz · cihazda hesap değişimi · duplicate event · FCM geçici+kalıcı hata
- **Ağ/upgrade:** offline, yavaş ağ, timeout, API version mismatch, bakım modu; eski binary + yeni backend, EAS rollback
- **Güvenlik:** token sızıntısı, keyfî WebView navigasyonu, bridge injection, tenant spoofing, IDOR, loglarda PII
- **Gerçek cihaz matrisi:** düşük segment Android + Samsung + Pixel; küçük/büyük iPhone + bir iPad (F3)

---

## 14. Üç-AI Çalışma Modeli

- **Sahiplik alanları:** backend/auth/sözleşmeler · Expo/native UI · test/güvenlik/review — her PR'da yazan tek ajan, diğer ikisi eleştirmen (mevcut "tek el yazar" kuralının mobil uyarlaması)
- Aynı dosyada eşzamanlı değişiklik yok; DB migration ve auth değişiklikleri tek sorumluda **seri** ilerler
- Ortak mimari kararlar **ADR** olarak `docs/superpowers/specs/adr/` altına kaydedilir (bu doküman ADR-0001 sayılır)
- Mobil PR kapısı: contract test + Android build + (F3'ten sonra iOS build) + web build
- Web deploy temposu mobil release'e **bağlanmaz**
- SLO'lar: crash-free sessions, native startup süresi, API hata oranı, outbox backlog yaşı, provider kabul oranı, invalid token oranı
- Push/ödeme/auth incident runbook'ları; sertifika/anahtar yenileme takvimi
- Destek ekranında app version, build, tenant, anonim diagnostic id

---

## 15. Başarı Ölçütleri

- Aktif kullanıcı (rol bazlı DAU/WAU) · etüt rezervasyon tamamlama oranı · öğretmenin yoklama alma süresi · crash-free ≥ %99.5 · push açılma oranı · mağaza puanı ≥ 4.5

---

## 16. Açık Sorular (Mustafa'nın kararı gerekiyor — plan aşamasından önce)

1. **Mağaza hesabı türü:** Şahıs mı organizasyon mu? Organizasyon için şirket + D-U-N-S gerekir → O2 (mali müşavir/şirketleşme) kararıyla bağlı. Şahıs hesabıyla başlayıp sonra taşımak mümkün ama isim/organizasyon görünürlüğü değişir.
2. **Dağıtım ülkesi:** Yalnız Türkiye mi? (Öneri: evet, v1.)
3. **Tablet/iPad:** Destek mi, yalnız uyumluluk modu mu? (Öneri: uyumluluk modu, v1.)
4. **Aynı cihazda çoklu hesap:** Veli+öğretmen veya kardeş öğrenciler için hesap değiştirici? (Öneri: hesap değiştirici var, aynı anda tek aktif hesap.)
5. **Offline kapsamı:** v1'de yalnız okuma cache'i (program/duyuru çevrimdışı görüntüleme); rezervasyon/yoklama/ödeme yalnız online. (Öneri: kabul.)
6. **Firebase projesi:** FCM için `mustafayanar54@gmail.com` altında mı, ayrı hesapta mı? (Cloud Run kararıyla tutarlılık: gmail + taşıma tetikleyicileri.)
7. **Crash/analytics sağlayıcısı:** Sentry vs Firebase Crashlytics — KVKK etkisiyle planlama aşamasında seçilecek.

---

## Ekler — karar sürecinin ham kaynakları

- Codex tur-1 (Expo ince kabuk önerisi + Capacitor itirazı), tur-2 (kapasite düzeltmesi → hibrit + 12 başlıklı kilitleme listesi), tur-3 (fazlı yol imzası), tur-4 (kalite öncülü → native-first), tur-5 (Kotlin geri çekildi) — oturum kayıtları
- Gemini raporu: `~/.gemini/antigravity-cli/brain/5249f160-*/mobile_migration_proposal.md` (mermaid akışları, silent-login, dvh/klavye tuzakları)
- Doğrulama: Capacitor config dokümanı "not intended for production" (WebFetch, 2026-07-14)
