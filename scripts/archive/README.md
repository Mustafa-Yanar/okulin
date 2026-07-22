# scripts/archive — Görevi Bitmiş Göç Scriptleri

Buradaki scriptler tarihsel göçleri tamamladı ve **güncel şemayla uyumsuz olabilir**.
Hepsinin başında çalıştırmayı engelleyen bir kill-switch var (`process.exit(1)`), bilinçli
koşum için dosya başındaki iki satırın silinmesi gerekir.

| Script | Görevi | Bittiği tarih | Yeniden koşma riski |
|---|---|---|---|
| `migrate-redis-to-sql.mjs` | Redis KV → PostgreSQL ilk veri göçü | 2026-06-27 | Çift kayıt + bayat `etutSablonlari` JSON'unu geri getirir |
| `migrate-slot-ids.mjs` | Slot id formatı `w{n}` → `d{gün}s{n}` | 2026-07 | İkinci koşum slotId'leri bozar (default YAZAR) |

Arşivleme gerekçesi ve tam envanter: `docs/superpowers/specs/2026-07-22-buyuk-temizlik-faz1-harita.md` (bulgu B8).

Arşive TAŞINMAYANLAR (bilinçli):
- `scripts/migrate-etut-to-tables.mjs` + `scripts/rollback-etut-json.mjs` + `scripts/cleanup-etut-json.mjs`
  — etüt cutover rollback penceresi (2026-08-21'e kadar) boyunca elde tutuluyor; migrate'e
  cleanup-sonrası koşum guard'ı eklendi (aynı B8 dalgası). Pencere kapanınca buraya taşınacaklar.
- `scripts/restore-redis.mjs` — felaket kurtarma aracı (bayat slot:/program: anahtarlarını geri
  getirebilir ama canlı kod onları okumuyor — düşük risk).
