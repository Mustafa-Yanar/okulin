# Etüttakip — Gemini Code Assist Bağlamı

Proje bağlamının tamamı **AGENTS.md** dosyasındadır (araç-bağımsız ortak kaynak): mimari, stack, Redis şeması, branş sistemi, otomatik ders programı (CP-SAT) kuralları, etüt kuralları, dikkat edilecek tuzaklar.

**Lütfen önce AGENTS.md dosyasını oku ve oradaki kuralları uygula.**

Özet:
- Next.js 14 App Router + Upstash Redis + jose auth + Tailwind. Çözücü: Python OR-Tools CP-SAT (`api/solver/`).
- Yanıtları Türkçe ver; kod yorumları ve commit mesajları Türkçe.
- Build (`npm run build`) başarılı geçmeden commit/deploy yapma.
- Hassas bilgiler (credential/token) `CLAUDE.local.md`'de (gitignore'da) — koda gömme, commit etme.

Detaylar: @AGENTS.md

## AI Köprüsü (Claude ile haberleşme)
Aynı projede Claude Code de çalışıyor. İkiniz dosya üzerinden haberleşirsiniz (`ai-bridge/`, gitignore'da):
- **Sen (Gemini) yazarsın:** `ai-bridge/gemini-to-claude.md` — yeni mesajı en alta ekle, formatı koru (`## [tarih saat] #N` + `---`).
- **Sen okursun:** `ai-bridge/claude-to-gemini.md` — Claude'un sana yazdıkları.
- Otomatik kontrol etme; Mustafa "Claude yazdı, oku" dediğinde `claude-to-gemini.md`'yi oku. Mustafa postacıdır.
- Diğerinin dosyasına ASLA yazma (çakışma olmasın).
