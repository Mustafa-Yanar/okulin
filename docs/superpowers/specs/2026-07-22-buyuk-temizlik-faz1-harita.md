# Büyük Temizlik — Faz 1: Veri Otoritesi & Tek-Yazıcı HARİTASI

> Tarih: 2026-07-22 · Dal: `audit/buyuk-temizlik` · Durum: Faz 1 tamamlandı, Faz 2 onay bekliyor.
> Yöntem: canlı DB reconcile diff (salt-okunur, 2 org) + Redis tam envanter (140 anahtar) +
> 2 bağımsız Explore ajanı (yazıcı/okuyucu envanteri) + kritik iddiaların elle spot-check'i.
> Konsey çerçevesi: bu bir bug listesi değil, OTORİTE + YAZICI + OKUYUCU + eski/yeni yol haritası.

## 0. Yönetici Özeti

**İyi haber:** Etüt cutover'ı sağlam. Canlı DB'de sıfır hayalet kayıt, sıfır tutarsızlık;
yeni sistem (EtutSablon/EtutReservation) aktif kullanımda (W30'da 12 WEEK + 1 RECURRING,
cutover sonrası öğrenciler kendileri rezervasyon almış). Etüt yazma yolu tek orkestratörde
(bookEtut/cancelEtutV2) toplanmış — burada çift-yazıcı YOK.

**Asıl bulgular:** (1) SlotBooking'in "rezervasyon" yüzeyi hâlâ CANLI kod ama fiilen terk
edilmiş — grid üzerinden POST /api/slots ile bugün bile SlotBooking'e "etüt" yazılabilir;
(2) haftalık Redis arşivi write-only — cron yazıyor, HİÇBİR kod okumuyor; (3) guard'sız
`scratch/wipe-etut-tables.mjs` tüm etüt verisini tek komutla silebilir; (4) ölü dosya +
Redis fosilleri birikmiş.

## 1. Otorite Tablosu (kavram → nihai gerçeklik kaynağı)

| Kavram | Otorite (tablo) | Canlı yazıcılar | Tek-yazıcı? |
|---|---|---|---|
| Etüt şablonu | `EtutSablon` | `lib/etut/sablon-service.ts` (save/toggle/softDelete) + `admin/week reset-all` | ✅ tek servis |
| Etüt rezervasyonu | `EtutReservation` | `lib/etut/booking.ts` bookEtut/cancelEtutV2 (web+mobil+müdür hepsi buradan) + cron freeze (`lib/etut/history.ts`) | ✅ tek orkestratör — AMA aynı KAVRAMA ikinci yüzey: aşağıda B3 |
| Ders programı şablonu | `Teacher.programTemplate` JSON (yalnız grid; etutSablonlari artık YOK) | `lib/slots.ts` setProgramTemplate/deleteProgramTemplate + toggleTeacherOffDay + reset-all | ✅ |
| Haftalık grid (materyalize) | `SlotBooking` | initWeekForTeacher (cron/program/admin/teacher-create) + POST/DELETE `/api/slots` + program/route geçici-ders | ✅ zincir net; booked yüzeyi = B3 kararı |
| Cari hafta | `TenantConfig.currentWeek` | setCurrentWeek (cron/weekly + admin/week) | ✅ |
| Geçmiş/arşiv (OKUMA) | SQL: `SlotBooking`(ders) + `EtutReservation`(etüt) — `/api/archive` | — | ✅ okuma tek yol |
| Geçmiş/arşiv (YAZMA) | ⚠️ Redis `archive:*` — OKUYANI YOK | cron/weekly:88,92 | ❌ write-only ölü yazıcı (B2) |
| Yoklama | `Attendance` | attendance route | ✅ |
| Login kimlik çözümü | SQL kullanıcı tabloları | — | ✅; Redis `uidx:*` indeksi ÖLÜ (B6) |

**Kimlik kuralı (yapısal tuzak, şemada belgeli):** `SlotBooking.teacherId` = Teacher.id (cuid),
`EtutSablon/EtutReservation.teacherId` = legacyId. Sınırlar normalize ediyor (getTeacherWeekSlots
legacyId→cuid çevirir; çıktılar hep legacyId) — bugün tutarlı, ama iki tabloyu teacherId ile
doğrudan JOIN edecek GELECEK kod sessizce boş döner. (schema.prisma:751 uyarı yorumu mevcut.)

## 2. Kanıtlı Bulgular (önem sıralı)

### B1 — KRİTİK RİSK: guard'sız toplu silme scripti
`scratch/wipe-etut-tables.mjs` (4 satır): koşulsuz `etutReservation.deleteMany({})` +
`etutSablon.deleteMany({})`. Dry-run yok, onay yok, tenant filtresi yok. `.env.local` ile
çalıştırılırsa TÜM kurumların TÜM etüt verisi anında silinir. **Öneri: derhal sil** (git
geçmişinde zaten duruyor).

### B2 — Redis haftalık arşiv: yazılıyor ama HİÇ okunmuyor
- Yazan: `app/api/cron/weekly/route.ts:88,92` (`archive:teacher/student:*`).
- Okuyan: **sıfır** (rg taraması: yalnız 2 `.set`, hiç `.get`). Gerçek geçmiş okuyucusu
  `/api/archive` doğrudan SQL okuyor (SlotBooking + listEtutHistory).
- Canlı Redis'te 0 adet `archive:*` anahtarı var (140 anahtarlık tam SCAN) — sezon boyunca
  hiç birikmemiş bile.
- cron'daki yorum ("okuyan /api/archive de Redis") BAYAT/YANLIŞ.
- **Öneri:** arşiv yazma bloğunu cron'dan sök (davranış değişmez — okuyucu yok), yorumu düzelt.

### B3 — TASARIM KARARI: SlotBooking "rezervasyon" yüzeyi emekli mi?
Etüt yeni sisteme göçtü ama grid tarafında aynı kavrama yazan CANLI yol duruyor:
- `POST /api/slots` (app/api/slots/route.ts:350 upsert) — SlotGrid'den öğrenci atama;
  hata mesajları bile "etüt" diyor; student/teacher/director/counselor tetikleyebilir.
- `combineBookings` (lib/etut/student-week.ts) iki sistemi haftalık limitte BİRLEŞİK sayıyor
  (bilinçli çapraz koruma — iyi), ama grid'den yazılan "etüt" yeni etüt görünümlerinde ÇIKMAZ.
- Canlı DB kanıtı: SlotBooking'de booked=0 (tüm haftalar) — bu yüzey fiilen kullanılmıyor.
İlgili okuyucu artıkları (aynı kararın parçaları):
- TeacherPanel > Rezervasyon > **Liste** görünümü (TeacherPanel.tsx:907) — hep boş (bilinen bulgu).
- ParentPanel:70 hâlâ `/api/slots?studentId` çağırıp sonucu etütlerle merge ediyor (hep boş dönüyor).
- DirectorPanel allSlots/teacherSlots (147/161/185) yalnız HistoryModal beslemesi.
- Mobil öğretmen today/week: grid'den `!isDers && booked` hücreleri "etüt" sayan dallar
  (lib/mobile/week.ts:90-91, today.ts:242-243) — cutover artığı.
**Karar seçenekleri:** (a) Grid'i salt ders-görüntüleme yap, booked yüzeyini tamamen kapat
(POST/DELETE /api/slots daralt veya kaldır, Liste görünümünü sil, eski okuma dallarını sök);
(b) grid rezervasyonunu "ders rezervasyonu" olarak bilinçli yaşat (o zaman UI/isimlendirme
netleşmeli). Kanıt (a)'yı destekliyor; workflow etkisi olduğundan Mustafa (+gerekirse öğretmen)
kararı gerekli.

### B4 — Latent etüt-materyalizasyon dalları (güvenle sökülebilir durumda)
- `lib/slots.ts:206-216` computeCellFromEntry `type:'etut'` dalı + :221-224 "geçici etüt koru";
  `app/api/slots/route.ts:435-437` DELETE savunmacı dalı.
- Bunları canlı tutabilecek TEK şey: programTemplate JSON'da kalıntı `type:'etut'` girişi.
- Canlı DB kanıtı: her iki org'da grid JSON'larında etüt girişi sıfır; `etutSablonlari`
  anahtarı akyazicozum'da hiç yok, testkurs'ta 2 öğretmende BOŞ dizi `[]` (B10).
- **Öneri:** Faz 2'de testle mühürleyerek sök (grid davranış testi eşliğinde) — T6'da bilinçli
  ertelenen iş, artık kanıt tabanı hazır.

### B5 — Geçmiş görünümleri çift-kaynak (çalışıyor ama karışık)
`/api/archive` = SlotBooking(ders) + EtutReservation(etüt) merge; HistoryModal ayrıca
cari haftayı `currentEntries`(SlotBooking) ile istemcide birleştiriyor. Çalışır durumda;
B3 kararına göre sadeleşir. Ders arşivi tarihsel olarak boş (arşiv hiç birikmedi — B2 ile
aynı kök: çok-org cron kapsamı 2026-07-12'de geldi, sezon verisi yazılmamış).

### B6 — Ölü dosya: `lib/userIndex.ts`
addToIndex/removeFromIndex/updateIndexUsername/lookupIndex — çağıran SIFIR satır.
Redis'teki `uidx:*` (testkurs, 13 adet) fosil. **Öneri:** dosyayı sil.

### B7 — Redis fosil envanteri
- akyazicozum: yalnız 2 `device:*` (OTP cihaz tanıma — bilinçli, kalacak). TEMİZ.
- testkurs: ~135 eski-şema anahtarı (audit 41, sinif 34, ders 15, uidx 13, teacher 12,
  program/finance/current_week/students/slot_times... 1'er) — SQL göçü öncesi fosil.
- GLOBAL: `superadmin, orgs, org, orgcode, demo` — 5 fosil aday (kod okumuyor).
- **Öneri:** dump al → sil. (Bilinçli kalanlar: ratelimit TTL'li, OTP device, backup akışı.)

### B8 — Göç scriptleri güvenlik sertleştirmesi
| Script | Risk | Öneri |
|---|---|---|
| `scripts/migrate-etut-to-tables.mjs` | cleanup-SONRASI `--reconcile --apply` koşulursa JSON-boş → tüm tablo şablonlarını soft-delete + migration rezervasyonlarını iptal eder (runbook yasağı var ama script içi hard-guard yok) | Arşive taşı veya "JSON'da hiç etutSablonlari yokken tabloda şablon varsa DUR" guard'ı ekle |
| `scripts/rollback-etut-json.mjs` | Eski şemaya (JSON etutSablonlari) yazan TEK kalan yol | 30 gün rollback penceresi (21 Ağustos) sonrası arşive taşı |
| `scripts/migrate-redis-to-sql.mjs` | Yeniden koşarsa çift kayıt + etutSablonlari'yı JSON'a geri getirir; guard yok | Arşive taşı (görevi bitti) |
| `scripts/migrate-slot-ids.mjs` | Default YAZAR (`--dry` opsiyonel) | Arşive taşı |
| `scripts/restore-redis.mjs` | Bayat slot:/program: anahtarlarını geri getirebilir | Not düş (app okumadığı için düşük risk) |

### B9 — Veri kalitesi: `dersBranch: ""` (3 kayıt)
Müdür/rehber atamalı 3 ACTIVE rezervasyonda branş boş (öğrenci atamalarının hepsinde dolu).
Kural analizi Faz 2'de: PATCH /api/etut-sablon branş seçimini zorunlu kılmalı mı, yoklama
etiketi boş branşı nasıl gösteriyor?

### B10 — testkurs JSON kalıntısı
2 öğretmende (GÜLHANIM, BURÇİN) `programTemplate.etutSablonlari: []` boş dizi kalmış
(cleanup akyazicozum'a org-scoped koşulmuştu). Zararsız; B4 sökümüyle birlikte temizlenir.

### B11 — SlotBooking retention (bilinen açık iş)
Rollover eski haftaları SİLMİYOR; tablo sınırsız büyür (şu an küçük: 3 hafta × ~700 satır,
çünkü çok-org cron 2026-07-12'de geldi). Yol haritasındaki "14 ay retention" kararı bekliyor.

### B12 — Bilgi: SlotBooking neden sadece 3 hafta?
W28 kısmi (72), W29-W30 tam (336+360). Öncesi yok çünkü cron çok-org kapsamı 12 Temmuz'da
eklendi; öncesinde gridler ancak panel açılınca lazy-init oluyordu. Anomali değil, tarihçe.

## 3. Faz 2 Önerilen Sıra (onay bekliyor)

1. **Güvenlik acili (kod davranışı değişmez):** B1 wipe-script sil + B8 script arşivleme/guard.
2. **B2:** cron'dan Redis arşiv yazımını sök + bayat yorumu düzelt (okuyucu yok — kanıtlı no-op).
3. **B3 KARARI** (Mustafa): grid booked yüzeyi kapansın mı? → Evet ise tek dalga halinde:
   route daraltma + Liste görünümü kaldırma + ParentPanel/mobil eski dallar + B4 savunmacı
   dallar + B10 kalıntı — hepsi testle mühürlenerek.
4. **B6 + B7:** ölü dosya + Redis fosilleri (dump alıp).
5. **Damar 2-3:** multi-tenant raw SQL kaçakları + finansal invariant — üçlü-model denetimle.
6. B9/B11 kural/retention işleri sıraya.

## 4. Ekler
- Yazıcı envanteri (ajan 1): SlotBooking 11 yol, EtutSablon 10, EtutReservation 12,
  programTemplate 8, Redis canlı yalnız archive:* — tam liste ajan raporunda (oturum kaydı).
- Okuyucu matrisi (ajan 2): panel×sekme×endpoint×tablo — tam liste ajan raporunda.
- Canlı DB sorgu çıktıları: reconcile-diff.mjs (scratchpad, salt-okunur) — hayalet 0,
  tutarsızlık 0, JSON kalıntı yalnız testkurs boş-dizi.
