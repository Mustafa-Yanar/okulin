# Etüttakip — Claude Talimatları

> Detaylı proje bağlamı (mimari, branş sistemi, CP-SAT çözücü, Redis şeması) için: @AGENTS.md
> Hassas bilgiler (credential): CLAUDE.local.md (gitignore'da).

## Proje
Eğitim/etüt takip uygulaması. Öğrenci-öğretmen-ders takibi, yoklama, program yönetimi.

## Stack
- **Framework:** Next.js 14.2 (App Router)
- **Storage:** Upstash Redis (KV)
- **Auth:** bcryptjs + jose (JWT)
- **UI:** Tailwind CSS + lucide-react
- **Data:** xlsx (Excel import/export)
- **Deploy:** Vercel (otomatik, her push)

## Klasör Yapısı (önemli olanlar)
- `app/` — Next.js App Router sayfaları + API routes
- `app/api/` — server endpoint'leri
- `lib/` — Redis client, auth helpers, util

## Çalışma Kuralı: Otomatik Commit & Deploy

Her özellik veya düzeltme tamamlandığında **onay beklemeden:**
1. İlgili dosyaları stage'e al (`git add <dosya>` — `-A` kullanma)
2. Açıklayıcı Türkçe commit mesajı yaz
3. Push et
4. Vercel otomatik deploy alır

**Why:** Mustafa her seferinde ayrıca "deploy et" demek istemiyor.
**Koşul:** Build başarılı geçtikten sonra. Build kırılırsa commit atma, önce düzelt.

## AI Köprüsü (Gemini ile haberleşme)
Aynı projede Gemini de çalışıyor. Dosya üzerinden haberleşirsiniz (`ai-bridge/`, gitignore'da):
- **Sen (Claude) yazarsın:** `ai-bridge/claude-to-gemini.md` — yeni mesajı en alta ekle (`## [tarih saat] #N` + `---`).
- **Sen okursun:** `ai-bridge/gemini-to-claude.md` — Gemini'nin yazdıkları. Otomatik kontrol etme; Mustafa "Gemini yazdı, oku" deyince oku.
- Gemini'nin dosyasına ASLA yazma. Gemini rakip değil, ortak — çıktısını tamamla, hata avlama.

## Yapma
- Mock/test endpoint'leri prod kodda bırakma
- Auth token'ları client'a expose etme
- `git add -A` ile her şeyi staging'e atma — değişen dosyaları seç
- Build hatalıyken commit
- `.env.local` veya credentials commit etme
