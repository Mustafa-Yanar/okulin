# okulin — Claude Talimatları

> Hassas bilgiler (credential): CLAUDE.local.md (gitignore'da).
> Detaylı mimari bağlam gerekirse: AGENTS.md (otomatik yüklenmiyor, ihtiyaçta oku)

## Proje
Eğitim/etüt takip uygulaması — Next.js 14 (App Router) + Upstash Redis + Prisma/PostgreSQL + Tailwind + Vercel.
Canlı: okulin.com | Test kurumu: testkurs.okulin.com

## Klasör Yapısı
- `app/page.js` — ana SPA (müdür/öğretmen/öğrenci panelleri)
- `app/api/` — 60+ API route
- `app/_components/` — UI bileşenleri (director/finance/program/rehberlik/odev/davranis/crm/form/library/etkinlik)
- `lib/` — auth.js, db.js, redis.js, prisma.js, tenant.js, constants.js, slots.js, finance.js, push.js, org.js
- `api/solve.py` + `api/solver/` — Python CP-SAT çözücü (Next'in app/api'sinden AYRI)
- `prisma/schema.prisma` — veritabanı şeması
- `e2e/` — Playwright testleri | `scripts/` — tek seferlik araçlar

## Çalışma Kuralı: Otomatik Commit & Deploy

Her özellik veya düzeltme tamamlandığında **onay beklemeden:**
1. İlgili dosyaları stage'e al (`git add <dosya>` — `-A` kullanma)
2. Açıklayıcı Türkçe commit mesajı yaz
3. Push et → Vercel otomatik deploy

**Koşul:** `npm run build` başarılı geçmeli. Kırıksa commit atma.

## Yapma
- Mock/test endpoint'leri prod kodda bırakma
- Auth token'ları client'a expose etme
- `git add -A` kullanma — değişen dosyaları seç
- Build hatalıyken commit
- `.env.local` veya credentials commit etme

---

## Bağımsız Kod Denetimi (Qwen Code — 2026-06-26)

> ~20.000 satır okundu, tüm lib/ + API route'lar + Python solver + ana paneller + e2e + config.
> Yorumlara/md dosyalarına değil sadece koda dayalı bağımsız değerlendirme.

### Güçlü Yönler

1. **Güvenlik katmanları eksiksiz:** CSP + CSRF (middleware) + bcrypt + rate limiting (5 limiter) + AES-256-GCM (payment key) + timingSafeEqual + JWT httpOnly cookie + org/branch tenant izolasyonu + OTP/cihaz tanıma.

2. **İş mantığı doğru:** Etüt kuralları (aynı ders 2. etüt yok, matematik ailesi tek, mezun w9 yasağı, hafta içi w1-w6 sadece mezun), izin günü, geçmiş slot koruması, sınıf çakışma kontrolü, müdür bypass — hepsi kodda mevcut.

3. **Audit log disiplini:** Tüm kritik mutasyonlar loglanıyor (öğrenci/öğretmen silme, finans, ödeme, duyuru, şifre sıfırlama). `actorFrom(session)` ile aktör bilgisi.

4. **İdempotency:** Ödeme callback NX lock + PayOrder durum kontrolü. Devamsızlık bildirimi `att_notif` NX kilidi. Deneme sonuç `deneme_notif` NX kilidi. Hepsi best-effort.

5. **Validasyon:** Tüm route'larda Zod `parseBody`, telefon `normalizeTurkishMobile`, diploma notu 50-100 kontrolü.

6. **Test altyapısı:** 112 birim test (8 dosya, hepsi geçiyor), 8 Playwright e2e spec, build başarılı.

7. **Operasyonel:** Haftalık slot döngüsü (cron), günlük ödeme hatırlatma push'u, GitHub backup (type-aware, 30 gün rotasyon), PWA dinamik manifest.

8. **Tenant izolasyonu:** Redis prefix scoping + Prisma `$extends` otomatik orgSlug/branch enjeksiyonu. Çapraz-tenant cookie koruması.

### Zayıf Yönler

1. **TypeScript yok:** ~194 JS dosyası. Tip güvenliği eksik, Prisma tipleri kullanılmıyor. SQL göçü sonrası regresyon riski.

2. **`makeId()` Math.random kullanıyor:** `Math.random().toString(36).slice(2, 10)` kalıbı 6 farklı route dosyasında tekrar ediyor. Kriptografik değil. `crypto.randomUUID()` kullanılmalı.

3. **İstemci tarafı kod tekrarı:** `getAdjacentWeek`, `isSlotPast`, `WeekNav`, `api()` helper 3 panelde kopya. ChevronLeft/ChevronRight SVG'leri `lucide-react` import edilmiş olmasına rağmen inline tanımlanmış.

4. **Yetkilendirme kontrolleri dağınık:** Her route'ta inline `session.role === 'director'` vb. Merkezi `withAuth(roles)` wrapper yok. Yeni route'ta unutulma riski.

5. **API route testleri yok:** 70 route handler'ının hiçbiri için birim/entegrasyon testi yok. Auth flow, payment callback, program solver manuel test dışında kapsanmıyor.

6. **Hata formatı tutarsız:** Bazı route'larda `{ error: 'msg' }`, bazı lib fonksiyonlarında `{ ok: false, error: 'msg', status: 404 }`. Global hata handler yok.

7. **Küçük çaplı race condition riski:** `slots/route.js` POST Redis yolunda `get`+`set` (non-atomic). SQL yolunda `upsert` (atomic). Çift-yolun yarattığı davranış farkı.

### Güncel Durum ve Öncelikli Aksiyonlar

| # | Aksiyon | Durum |
|---|---------|-------|
| 1 | SQL göçünü tamamla, Redis kod yolunu temizle | ✅ TAMAMLANDI (2026-07-08) — `isSqlEnabled`/çift-yol kod tabanında sıfır, `lib/usesql.js` silindi, Vercel `OKULIN_USE_SQL` env kaldırıldı. Redis yalnız bilinçli alt-sistemlerde (OTP cihaz tanıma, haftalık arşiv, rate-limit, backup snapshot) kalıyor. |
| 2 | TypeScript'e geçiş | ✅ TAMAMLANDI (2026-07-10, dalga-1) — lib/ + app/api/ %100 strict TS (tsconfig strict+allowJs, typescript@5.9); app/_components bilinçli JS (Faz 3) |
| 3 | `makeId` → `crypto.randomUUID()` | ✅ `lib/id.js` tek kaynak (newId + sortable), 19 dosya geçti. courses slug / audit-errlog key / payment oid bilinçli hariç. |
| 4 | Merkezi yetkilendirme wrapper'ı | ✅ TAMAMLANDI (2026-07-10) — 71/71 route withAuth'ta; login/cron/callback gibi istisnalar yorumla gerekçeli |
| 5 | Kritik route'lara entegrasyon testi | ⏳ |
| 6 | İstemci ortak yardımcıları: `shared.js` | ✅ TAMAMLANDI (2026-07-10) — app/_components/shared.js tek kaynak; 13 api() + hafta/slot yardımcı kopyası silindi |
| 7 | Global hata handler | ✅ Hata formatı birleşti (2026-07-10): her uçta `{ error }` + doğru status (PayTR callback düz metin istisnası); global handler ihtiyacı kalktı |

**NOT:** Dalga-1 (2026-07-10) ile #2/#4/#6/#7 kapandı. Kalan borç: #5 (route entegrasyon testleri) + app/_components TS'e geçişi (Faz 3). Redis'in kalıcı anahtarları (ratelimit, backup, OTP cihaz tanıma, haftalık arşiv) bilinçli olarak kalmaya devam ediyor.
