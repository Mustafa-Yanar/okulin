# Etüttakip → Çok-Kurumlu (Multi-Tenant) Sistem

> Planlama dokümanı. Henüz uygulanmadı — Mustafa soracakları olduğu için bekletiliyor.

## Context (Neden)

Etüttakip bugün **tek kurum** (Akyazı Çözüm) için yazılmış: Redis'te düz anahtarlar
(`teacher:x`, `students`, `director`), tek JWT, sabit "Akyazı Çözüm" adı/logosu/teması.

Mustafa bunu bir **ürüne** dönüştürmek istiyor — iki satış modeli:
1. **Bağımsız dershane/özel okul** — tek şube, kendi adresi + markası.
2. **Merkezi zincir** (Final, Sınav, Çözüm gibi) — bir merkez, çok **şube**, merkezden yönetim.

Bu yüzden model iki seviyeli: **Kurum (org) → Şube (branch)**.
- Bağımsız dershane = 1 kurum + 1 (varsayılan) şube.
- Zincir = 1 kurum + N şube + merkez yöneticisi.

Hedef sonuç: tek Vercel + tek Upstash üzerinde, her kurumun verisi izole, her kurumun
kendi adresi (subdomain ve/veya özel domain) ve kendi markası (logo/ad/renk). Mustafa
süper-admin olarak kurumları elle açar. Üçüncü-taraf servis yok, ek maliyet ~1 domain.

## Temel Mimari Kararlar

- **Hiyerarşi**: her veri anahtarı `t:<org>:<branch>:` ön ekiyle scope'lanır.
  Tek şubeli kurumda branch = `main`. Zincirde her şube ayrı.
- **Kurum çözümleme (org)**: `middleware.js` `host`'tan org'u bulur:
  - subdomain → ilk etiket (`cozum.etuttakip.app` → `cozum`)
  - özel domain → Redis `domain:<host>` → org ters eşlemesi
  - bulunan org `x-org` request header'ına yazılır (downstream route'lar okur).
- **Şube çözümleme (branch)**: giriş yapan kullanıcının kaydından gelir (her kullanıcı
  bir org+branch'e ait). Merkez yöneticisi aktif şubeyi değiştirebilir (session/seçim).
  → Çok-seviyeli subdomain GEREKMEZ; tek wildcard her şeyi karşılar.
- **Scoped Redis**: kod yüzeyini küçük tutmak için `lib/redis.js`'i kurum-kapsamlı bir
  **proxy** ile sar — tüm anahtar argümanlarını otomatik `t:<org>:<branch>:` ön ekler.
  Route'lar `import redis` yerine `const redis = await tenantRedis()` çağırır; anahtar
  string'leri AYNI kalır. scan/keys match desenleri ve pipeline da prefix'lenir.
- **Auth**: JWT payload'a `org` + `branch` eklenir. `getSession()` JWT.org'u istek
  host'unun org'uyla karşılaştırır → çapraz-kurum cookie kullanımı reddedilir (cookie
  zaten host-only, bu ikinci savunma).
- **Roller**: mevcut `director/teacher/student/accountant` + iki yeni:
  `super` (Mustafa, kurumları yönetir) ve `org_admin` (zincir merkezi, şubeleri yönetir).
  Tek dershanede `org_admin` = `director` (çakışmaz, opsiyonel).
- **Markalama**: `org:<slug>` = `{name, logoUrl, themeColor, customDomain?, plan, active}`.
  Sunucuda yüklenip layout/page'e enjekte edilir (sabit "Akyazı Çözüm" + `/logo.png` +
  indigo → dinamik; tema rengi CSS değişkeni).

## Faz Planı (her faz ayrı, deploy edilebilir)

### Faz A — Çok-kurum temeli (EN KRİTİK, canlı veriye dokunur)
- `lib/tenant.js`: host→org çözümleme + `tenantRedis(org, branch)` scoped proxy factory.
- `middleware.js`: org çözümle, `x-org` header set et, bilinmeyen host → 404/landing.
- 35 route + lib (`slots.js`, `userIndex.js`, `audit.js`, `errlog.js`, `push.js`) →
  global `redis` yerine `tenantRedis()`. Anahtar string'leri değişmez.
- `lib/auth.js`: JWT'ye org+branch; `getSession` org doğrulaması.
- `app/api/auth/route.js`: `director` → org+branch scoped; setup org bazlı.
- **Migration script**: Çözüm'ün tüm düz anahtarları → `t:cozum:main:*`. Yedek + doğrulama.
- Sonuç: bağımsız dershaneler subdomain'de izole çalışır (tek şube).

### Faz B — Markalama
- `org:<slug>` tema verisi; `app/layout.js` + `app/page.js` header dinamikleşir
  (kurs adı, logo, tema rengi CSS var). Sabit "Akyazı Çözüm" kaldırılır.

### Faz C — Süper-admin paneli
- `super` rolü + `super.etuttakip.app` (veya korumalı alan): kurum oluştur, ilk müdür
  hesabı + markalama ayarla. Başlangıçta script ile de yapılabilir.

### Faz D — Şube (zincir) desteği
- `org_admin` rolü; `branch:<org>:<id>` kayıtları; merkez panelinde şube oluştur +
  şube müdürü ata; şube değiştirici; merkez için şubeler-arası özet panel.

### Faz E — Özel domain
- `domain:<host>` → org bağlama; Vercel Domains API ile otomasyon; kuruma DNS talimatı.

## Kritik Dosyalar
- Yeni: `lib/tenant.js` (çözümleme + scoped redis), migration script `scripts/`.
- Değişecek: `middleware.js`, `lib/auth.js`, `lib/redis.js` kullanan ~35 dosya
  (route'lar + `lib/slots.js`, `lib/userIndex.js`, `lib/audit.js`, `lib/errlog.js`,
  `lib/push.js`), `app/api/auth/route.js`, `app/layout.js`, `app/page.js`.
- Tüm-anahtar tarayan 8 dosya (backup, cron, audit, archive, guidance, errlog…) scan
  desenleri org-prefix'li olmalı.

## Yeniden kullanılacak mevcut desenler
- Reverse-index deseni (`lib/userIndex.js`) → `domain:<host>`→org ve org listesi için.
- Audit/errlog Redis deseni (ts-prefix, TTL) → org olayları için.
- Ratelimit (`lib/ratelimit.js`), CSRF middleware → org-aware genişletilir.
- Backup script (Redis yedeği) → migration güvenliği için kullanılır.

## Doğrulama (uçtan uca)
1. `npm run build` + `npm test` her fazda yeşil.
2. Faz A sonrası lokal: iki sahte org (`cozum`, `test`) ile farklı subdomain'lerden
   giriş → veriler birbirini GÖRMEZ (izolasyon testi). Yanlış org cookie'si reddedilir.
3. **Migration provası**: önce Upstash yedeği al; script'i `--dry-run` ile çalıştır;
   anahtar sayıları eşleşmeli; sonra gerçek; Çözüm canlı veri bütünlüğü doğrulanır
   (öğretmen/öğrenci sayıları, bir öğrencinin programı/yoklaması).
4. Canlı smoke: `cozum.etuttakip.app` (taşınan Çözüm) + yeni boş `test.etuttakip.app`
   bağımsız çalışır; markalama (logo/ad/renk) org bazlı görünür.

## Riskler / Notlar
- **Canlı 267 kullanıcı**: Faz A migration en riskli adım — yedek + dry-run + doğrulama şart.
- Edge middleware Redis okur: Upstash REST edge'de çalışır (sorun yok).
- Cookie: `domain` set edilmediği için host-only → subdomain'ler doğal izole; JWT org
  doğrulaması ikinci kat.
- Scoped-redis proxy'de pipeline + scan match prefix'leme en çok dikkat isteyen kısım.
- Bu büyük bir iş; Faz A tek başına çok-kiracılığı (bağımsız dershaneler) açar —
  zincir/şube (Faz D) ve özel domain (Faz E) sonra eklenebilir.

## Önerilen başlangıç
Faz A'dan başla (temel + Çözüm migration). Diğer fazlar bunun üstüne kademeli biner.

## Kararlar (netleşti)
- URL: önce domain alınacak (`etuttakip.app` vb.) + Vercel wildcard; kurumlar subdomain'de.
  Domain gelene kadar `cozumetut.vercel.app` = cozum (DEFAULT_ORG).
- Veri: atılabilirdi → migration YOK, temiz kurulum yapıldı.
- Veli paneli: multi-tenant'tan SONRA (tenant-aware doğsun) — sıra: MT → routing → veli.
- SMS/WhatsApp: en son (kurum-başına ayar). Web Push zaten var.
- "Tek URL" = aslında app'te routing yokluğuydu (ayrı konu); landing kök domain'e düşer.

## DURUM: Faz A BİTTİ (2026-05-30, canlıda doğrulandı)
- A1 tenant çekirdeği · A2 auth org-aware · A3 lib'ler scoped · A4 route'lar scoped (lib/db proxy) · A5 reset+tohumla.
- Scoped redis çalışıyor: yeni veri `t:cozum:main:*`'e gidiyor, izolasyon kanıtlı. App boş (Mustafa öğrenci/öğretmen ekleyecek).
- Detay: hafıza `multi-tenant.md`.

## SIRADA
1. **Mustafa**: domain al + Vercel'e `*.etuttakip.app` wildcard bağla → bana söyle, `APP_DOMAIN` env'i ekleyip subdomain'i aktive edeyim.
2. Faz B (markalama), C (süper-admin), D (şube/zincir), E (özel domain) — yukarıdaki plana göre.
