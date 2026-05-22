# Etüttakip — Gemini Code Assist Bağlamı

Proje bağlamının tamamı **AGENTS.md** dosyasındadır (araç-bağımsız ortak kaynak): mimari, stack, Redis şeması, branş sistemi, otomatik ders programı (CP-SAT) kuralları, etüt kuralları, dikkat edilecek tuzaklar.

**Lütfen önce AGENTS.md dosyasını oku ve oradaki kuralları uygula.**

Özet:
- Next.js 14 App Router + Upstash Redis + jose auth + Tailwind. Çözücü: Python OR-Tools CP-SAT (`api/solver/`).
- Yanıtları Türkçe ver; kod yorumları ve commit mesajları Türkçe.
- Build (`npm run build`) başarılı geçmeden commit/deploy yapma.
- Hassas bilgiler (credential/token) `CLAUDE.local.md`'de (gitignore'da) — koda gömme, commit etme.

Detaylar: @AGENTS.md
