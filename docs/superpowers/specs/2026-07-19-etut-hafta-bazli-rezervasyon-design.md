# Etüt Hafta-Bazlı Rezervasyon — Tasarım (Spec)

Tarih: 2026-07-19 · Durum: onay bekliyor (Mustafa review sonrası writing-plans)
Denetim temeli: `docs/superpowers/specs/2026-07-19-etut-audit-codex.md` (Codex+Gemini+Explore, 3'lü çapraz-doğrulama)

## 1. Amaç

Etüt rezervasyonu şu an `Teacher.programTemplate.etutSablonlari` JSON'ında `studentId`'yi şablona düz yazıyor → rezervasyon **haftadan bağımsız**, bir kez alınınca tüm haftalarda dolu görünüyor (BUG). Ayrıca JSON read-modify-write yarış durumu, iki-sistem (SlotBooking vs etut-sablon) tutarsızlığı ve 17 denetim riski var.

**Hedef:** Rezervasyonu **hafta-bazlı** yap; öğrenci/öğretmen dar pencerede tek-hafta, müdür/rehber tekrarlayan yazabilsin; tüm okuma/yazma yolları tek tutarlı modele geçsin.

## 2. Kilitlenen kararlar (Mustafa)

1. **Öğrenci penceresi:** bu hafta (gelecek/boş slotlar) + Pazar "yenilenince" açılan sonraki hafta. Tek-hafta. İleri haftalar yasak.
2. **Öğretmen:** kendi etüdüne, aynı pencere, tek-hafta.
3. **Tekrarlayan (tüm haftalar):** yalnız müdür + rehber (readOnly değil).
4. **Mevcut veri:** öğrenci/öğretmen alınmışlar → tek-hafta (en yakın aktif hafta); belirsizler tek-hafta (asla otomatik recurring).
5. **Veri modeli:** ayrı Prisma tabloları.
6. **Etüt şablonu:** JSON'dan **ayrı EtutSablon tablosuna** taşınır (gerçek FK, cascade).
7. **Servis:** **tam birleşik command service** — SlotBooking + etüt tüm yazmaları tek `bookEtut()`'tan geçer.
8. **Kapsam:** her şey dahil (17 riskin tamamı + soft-delete + audit + kilit + interval + göç güvenliği).
9. **Ders uygunluğu = DÜZEY bazlı (2026-07-20 onayı):** Öğrenci kendi SINIF listesiyle sınırlı DEĞİL — kendi **düzeyindeki (grup: ortaokul/lise/mezun)** tüm derslerden etüt alabilir. Lise öğrencisi İnkılap Tarihi alamaz (yalnız ortaokul dersi); ortaokul öğrencisi Fizik alamaz (yalnız lise dersi). Bkz §4a.
10. **Bu hafta kuralı (netleştirme):** Öğrenci içinde bulunduğu haftanın **boş VE başlangıç saati geçmemiş** etütlerini alabilir; geçmişe dönük rezervasyon her koşulda reddedilir (`slotStartsAt > nowTSİ`).

## 3. Veri modeli

### 3.1 EtutSablon (yeni tablo — JSON'dan göç)
```prisma
model EtutSablon {
  id            String   @id @default(cuid())
  orgSlug       String
  branch        String   @default("main")
  teacherId     String   // legacyId (etutSablonlari JSON konvansiyonu — DİKKAT: SlotBooking.teacherId bundan FARKLI, Teacher.id kullanır)
  teacher       Teacher  @relation(fields: [orgSlug, branch, teacherId], references: [orgSlug, branch, legacyId], onDelete: Cascade)
  dayIndex      Int
  start         String   // "HH:MM"
  end           String
  aktif         Boolean  @default(true)
  pasifHaftalar String[] @default([])   // o hafta pasif (şablon aktifliği; rezervasyon DEĞİL)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  reservations  EtutReservation[]
  @@index([orgSlug, branch, teacherId])
  @@index([orgSlug, branch])
}
```
Not: `teacherId=legacyId` FK'sı bileşik (orgSlug,branch,legacyId) Teacher unique'ine bağlanır (schema.prisma:176 mevcut). Prisma bileşik FK destekler.

### 3.2 EtutReservation (yeni tablo)
```prisma
model EtutReservation {
  id              String   @id @default(cuid())
  orgSlug         String
  branch          String   @default("main")
  sablonId        String
  sablon          EtutSablon @relation(fields: [sablonId], references: [id], onDelete: Cascade)
  teacherId       String   // legacyId — sorgu kolaylığı (denormalize)
  scope           String   // 'WEEK' | 'RECURRING'
  status          String   @default("ACTIVE") // 'ACTIVE' | 'CANCELLED'
  weekKey         String   // WEEK: "2026-W30" | RECURRING: "*" (yalnız unique-marker)
  effectiveFromWeek String? // yalnız RECURRING: bu haftadan itibaren geçerli (geçmişe uygulanmaz)
  studentId       String
  studentName     String
  studentCls      String
  dersBranch      String   // rezerve edilen ders (branş)
  bookedByRole    String
  bookedById      String
  bookedAt        DateTime @default(now())
  cancelledByRole String?
  cancelledById   String?
  cancelledAt     DateTime?
  cancelReason    String?
  // snapshot (geçmiş etiketi + interval çakışma; aktif doluluk DEĞİL)
  dayIndex        Int
  startsAt        String   // "HH:MM" snapshot (rezervasyon anındaki)
  endsAt          String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([orgSlug, branch, sablonId, weekKey])   // hafta başına tek satır (tombstone dahil)
  @@index([orgSlug, branch, weekKey])              // bulk getWeekReservations (Gemini)
  @@index([orgSlug, branch, studentId, weekKey])   // öğrenci çakışma/geçmiş
  @@index([orgSlug, branch, teacherId, weekKey])
}
```

**RECURRING gösterimi:** `scope='RECURRING'`, `weekKey='*'` (sadece unique-marker; gerçek hafta değil), `effectiveFromWeek` = başladığı hafta. Sablon başına tek recurring satır. Unique `(sablonId, weekKey)` → bir `'*'` satır + N gerçek-hafta satır ÇAKIŞMADAN yaşar. ('*' burada YALNIZCA unique-key işareti; iptal/tombstone semantiği scope+status ile, weekKey ile değil — Gemini/Codex'in '*' itirazı tombstone içindi, o ayrı çözülüyor.)

**Tombstone/override:** Recurring aktifken bir haftayı iptal/değiştirmek = o haftaya `scope='WEEK'` satır (status=CANCELLED → o hafta boş; veya farklı öğrenci → override). WEEK satır her zaman recurring'i EZER.

### 3.3 effectiveReservation(sablonId, weekKey)
```
weekRow = row(sablonId, weekKey=W)             // gerçek hafta satırı — recurring'i EZER
if weekRow: return weekRow.status=='ACTIVE' ? weekRow : NONE  // CANCELLED tombstone → boş
rec = row(sablonId, weekKey='*', scope=RECURRING, status=ACTIVE, effectiveFromWeek <= W)
return rec ?? NONE
```
Bulk: `getWeekReservations(weekKey W)` = tek sorgu `WHERE weekKey=W OR weekKey='*'`; JS'te sablonId başına gerçek-hafta öncelikli çöz + recurring effectiveFromWeek filtre. (N+1 yok — route içinde öğretmen başına sorgu KALDIRILIR.)

**Yazma stratejisi (Faz 1 denetim kararı — UPSERT, tek-satır):** `(sablonId, weekKey)` başına EN FAZLA BİR satır yaşar. Yeniden rezervasyon (iptal sonrası aynı haftaya yeni öğrenci) = mevcut satırın UPSERT ile güncellenmesi (status→ACTIVE, yeni öğrenci alanları, cancelled* alanları temizlenir) — unique kısıt İHLAL EDİLMEZ (Gemini bulgusu bu stratejiyle çözülür; Codex "mevcut unique ile kurulabilir" onayı). Satır-içi audit alanları SON durumu tutar; TAM tarihçe okulin'in mevcut AuditLog disipliniyle loglanır (her book/cancel/override bir audit kaydı).

**Recurring sahip-değişim geçmişi (Faz 1 denetim kararı):** Sablon başına tek `'*'` satırı korunur; sahip değişince satır güncellenir (`effectiveFromWeek` = değişim haftası) + AuditLog. Geçmiş haftaların görünümü bozulmasın diye **freeze-on-rollover**: haftalık cron (Pazar 11:00) biten haftanın efektif recurring rezervasyonlarını o haftanın WEEK satırı olarak dondurur (yoksa yaratır) — geçmiş haftalar böylece kalıcı per-week satırlara sahip olur (Faz 4'te cron'a eklenir, cutover'dan önce).

**Doluluk `sablonId+weekKey` ile belirlenir; saat ŞABLONDAN canlı okunur.** startsAt/endsAt snapshot yalnız (a) interval çakışma matematiği, (b) şablon silinince geçmiş yoklama etiketi için.

## 4. Birleşik command service — `lib/etut/booking.ts`

Tek giriş noktası; SlotBooking + EtutReservation tüm yazmaları buradan.
```
bookEtut({ source: 'slot'|'etut', actor, studentId, teacherId, targetId, weekKey,
           interval, dersBranch, recurrenceScope: 'WEEK'|'RECURRING', force?, reason? })
cancelEtut({ source, actor, targetId, weekKey, scope, reason? })
```
Tüm iş kuralları TEK yerde (SlotBooking route'undan da taşınır):
- studentSelfBooking config, cancelLockHours (etut'e de uygulanır), readOnly rehber reddi
- kendi-etüdü (öğretmen), allowedGroups, **öğretmen branşı ∩ öğrencinin DÜZEY dersleri** (§4a — sınıf listesi DEĞİL)
- tatil/sınav/etkinlik engeli, mezun yasak slot politikası (etut için karar: uygulanır), pasif öğrenci
- **rol+hafta penceresi** (§5), **tekrarlayan yetkisi** (müdür/rehber), iptal sahipliği
- müdür/rehber bypass yalnız `force+reason` + **audit log**

**Eşzamanlılık:** `bookEtut` bir `prisma.$transaction` içinde; öğrenci+hafta bazlı **advisory lock** (`pg_advisory_xact_lock(hash(orgSlug:studentId:weekKey))`) → çapraz-sistem limit/çakışma yarışı önlenir. Aynı slot için unique constraint zaten atomik.

**Çakışma (birleşik, interval):** `studentWeekBookings(studentId, weekKey)` = EtutReservation(effective, o hafta) + SlotBooking(o hafta), hepsi `{startsAt,endsAt,dersBranch,dayIndex}`'e normalize. Çakışma: dakikaya çevir, `aStart<bEnd && bStart<aEnd`. Aynı ders / matematik ailesi / `maxWeeklyPerStudent` iki sistem TOPLAMI. Öğretmen tarafı çakışma da (kendi dersi/etüdü, izin günü, etkinlik) kontrol.
**SlotBooking'e de startsAt/endsAt snapshot** eklenir (config değişince eski kayıt kaymasın).

### 4a. Ders uygunluğu — düzey havuzu (`allowedBranchesForStudent`)

Öğrencinin alabileceği ders adayları = **öğretmen branşları ∩ düzey havuzu**. Düzey havuzu:
```
levelPool(group) = ⋃ Class.dersler  (org'un o GRUPTAKI tüm sınıfları, registry)
                   ∪ fallback: COL_COURSES'un o gruba ait sütunlarının birleşimi (registry boş/eksikse)
```
- Grup = `student.group` ('ortaokul' | 'lise' | 'mezun'). **cls ASLA parseInt edilmez** ([[rehberlik-konu-takibi-fix]] kuralı); havuz sınıf-bazlı değil grup-bazlıdır → s_UUID sorunu kökten yok.
- Örnekler: lise öğrencisi → İnkılap Tarihi YOK (yalnız ortaokul havuzunda); ortaokul öğrencisi → Fizik YOK (yalnız lise havuzunda); lise öğrencisi kendi sınıf listesinde olmayan bir lise dersinden etüt ALABİLİR.
- **Mezun notu (varsayım):** mezun havuzu = mezun sınıflarının birleşimi; org'da mezun sınıfı yoksa `COL_COURSES` Mezun sütunları. İçerik olarak lise düzeyiyle örtüşür — ayrı lise-birleşimi eklenmez (gerekirse ileride genişletilir).
- Bu kural **tüm etüt yollarına** uygulanır (birleşik servis sayesinde tek yerde): web öğrenci/öğretmen/müdür, mobil, eski /api/slots yolu. UI ders-adayı hesapları (StudentPanel `selectableBranchesFor`, TeacherEtutPanel `candidatesFor`, SlotGrid) aynı havuzu kullanır.
- Aynı-ders / matematik ailesi / haftalık limit kuralları DEĞİŞMEZ — yalnız aday kümesi genişler.

## 5. Rol + hafta pencere kuralları (sunucu, TSİ)

`allowedBookingWeeks(role, nowTSİ)`:
- **student/teacher:** `{ currentWeek } + { nextWeek EĞER nowTSİ >= Pazar 11:00 }`. **Açılma anı Pazar 11:00 TSİ** (Mustafa kararı 2026-07-20 — mevcut haftalık cron'un koşma anıyla hizalı; Pazar 00:00-10:59 arası sonraki hafta HENÜZ kapalı). Pzt 00:00'da pencere {yeniCur}'a sıfırlanır.
- **director/counselor:** düzenlenebilir pencere `current..+2` (isEditableWeek) tek-hafta; **RECURRING** her hafta.
- Her rezervasyon ayrıca **`slotStartsAt(weekKey,day,start) > nowTSİ`** (geçmiş slot reddi — pencere içinde bile geçmiş güne yazılamaz).
- weekKey format doğrulaması (regex `^\d{4}-W\d{2}$`) tüm yollarda (web POST + servis + mobil).
- TSİ merkezi: mevcut `+03` slot mantığı (lib/slots.ts) tek kaynak; istemci saatine güvenilmez.

## 6. İptal (cancel) semantiği
- **Soft-delete:** `status=CANCELLED` + cancelledByRole/ById/At/Reason. Fiziksel silme yok (geçmiş/audit korunur).
- **scope:** `week` (tek hafta) | `recurring` (tüm — yalnız müdür/rehber). Recurring aktif + tek hafta iptal → o haftaya CANCELLED WEEK-tombstone.
- **cancelLockHours** etut iptaline de uygulanır. Sahiplik: öğrenci yalnız kendi occurrence'ı; öğretmen kendi etüdü; müdür/rehber tümü.

## 7. Göç (tek seferlik, idempotent, geri-alınabilir)

**Faz A — EtutSablon:** her Teacher.programTemplate.etutSablonlari elemanı → EtutSablon satırı (id KORUNUR — rezervasyon FK'sı için). `programTemplate.etutSablonlari` JSON'ı YEDEK alındıktan sonra temizlenir (grid şablonu programTemplate'te kalır). Rollback script.
**Faz B — EtutReservation:** studentId'li her şablon →
- `bookedBy` yok/belirsiz **veya** student/teacher → `scope=WEEK`, en yakın **aktif + gelecek** hafta. Tümü geçmişse → `migration_unresolved` raporu (taşıma YOK).
- `bookedBy` director/counselor → **otomatik recurring YAPMA** (Codex: bug'ı kalıcılaştırır) → yine tek-hafta + raporla; recurring gerekiyorsa müdür UI'dan yeniden atar.
- Idempotent (aynı sablonId+weekKey varsa atla+raporla, sessiz skipDuplicates YOK). Önce yaz+doğrula, sonra JSON temizle. Tenant scope her satırda.

## 8. Etkilenen tüm tüketiciler (denetimden — hepsi güncellenecek)

**Backend:** lib/etut/rezervasyon.ts (→ booking.ts'e taşı), etut-sablon/all, etut-sablon (GET/POST/PUT/PATCH→servise/DELETE), etut-sablon/rezervasyon (+weekKey), /api/slots (POST/DELETE→servise), /api/program (type:'etut' SlotBooking yazımı kapat — SlotBooking=yalnız ders), attendance/student (snapshot+weekKey türet), archive + cron/weekly (etüt geçmişi tablodan), admin/week (reset cascade), lib/slots.ts (getProgramTemplate/etutSablonlari → EtutSablon okuma).
**Mobil:** mobile/v1/etut + reserve (+weekKey), lib/mobile/today.ts + week.ts (effectiveReservation), contracts (weekKey şemaları).
**Frontend:** StudentPanel (pencere UI + cancel weekKey), TeacherPanel (Etütler+yoklama), director/ProgramEditor (PATCH→servis, recurring toggle), director/TeachersTab, DirectorPanel+StudentList+StudentBookingsView+HistoryModal (etüt merge + öğrenci "Etüt Geçmişi" hafta nav — rezervasyon tablosundan doğrudan), ParentPanel.
**Sessiz hata (P2 #15):** tüm `.catch(()=>[])` → gerçek hata durumu.
**Bildirim/push:** rezervasyon kaynağı değişince etkilenen üretim yolları.

## 9. Test
- **Birim:** effectiveReservation (week vs recurring önceliği + CANCELLED tombstone), allowedBookingWeeks (Pazar/TSİ sınırı), rol-bazlı bookEtut kararları, interval çakışma (dakika + yarı-açık), çapraz-sistem birleşik çakışma/limit, göç dönüşümü (saf fonksiyon: en-yakın-hafta, unresolved), **düzey havuzu** (lise→İnkılap RED, ortaokul→Fizik RED, lise→sınıf-dışı lise dersi KABUL, s_UUID etkisiz).
- **Entegrasyon (Playwright `int`):** reserve/cancel/recurring/pencere-sınırı/çapraz-sistem/eşzamanlı-yarış (2 paralel istek).
- **Göç:** dry-run + canlı DB doğrulama (İrem W30, Ahmet W30) + rollback provası.
- Her fazda **Codex/Gemini destekli doğrulama** ([[feedback_coklu-model-hata-ayiklama]]).

## 10. Fazlar (Faz 1 sonrası revize — hepsi `etut-hafta-bazli` dalında, prod'a TEK deploy Faz 5'te)
1. **Şema+göç:** ✅ TAMAM (2026-07-20) — EtutSablon(+legacyId kimlik modeli, deletedAt, enum'lar) + EtutReservation tabloları canlıda, 61 şablon+2 rezervasyon göçtü (idempotent, JSON kaynak kaldı), çok-model denetim + düzeltmeler kapandı.
2. **Faz 2a — kural çekirdeği + veri katmanı (lib-only):** allowedBookingWeeks (Pazar 11:00), interval overlap, düzey havuzu (levelPool), reservations veri katmanı (effective çözümü + tek-satır upsert + tombstone + advisory lock), EtutSablon tablo-CRUD servisi. Route değişikliği YOK — davranış aynen, hepsi birim testli.
3. **Faz 2b — bookEtut/cancelEtut komut servisi + kablolama:** tüm iş kuralları tek serviste; etut-sablon route'ları (PATCH→servis), rezervasyon route +weekKey/scope, mobil, /api/slots POST/DELETE → servis; şablon CRUD table-first.
4. **Faz 3 — okuma yolları:** etut-sablon/all + mobil today/week + tüm paneller effectiveReservation'a; ProgramEditor recurring toggle; öğrenci pencere UI.
5. **Faz 4 — görünürlük+geçmiş:** müdür tarafı merge + öğrenci "Etüt Geçmişi" hafta nav (tablodan), attendance snapshot, archive/cron + **freeze-on-rollover**, sessiz-hata süpürmesi.
6. **Faz 5 — cutover:** **reconciliation modu ZORUNLU** (göç scriptine `--reconcile`: JSON-authoritative senkron — tabloda güncelle/iptal et, skip-existing YETMEZ — Codex kritik bulgusu) → bakım penceresinde final senkron + JSON cleanup + main merge + canlı doğrulama + çok-model final review. Rollback prosedürü: cutover-sonrası tablo yazmaları JSON'a otomatik dönmez — rollback penceresi kısa tutulur, prosedür planda açık yazılır.

## 11. Açık/riskli notlar
- EtutSablon FK'sı legacyId bileşik anahtara bağlı — Prisma bileşik FK doğrulanmalı (Faz 1 ilk adım).
- SlotBooking route'unun tam servise taşınması en büyük regresyon yüzeyi → Faz 2'de izole + int testleriyle korunur.
- "Pazar açılır" kuralı weekly cron/currentWeek ile hizalanmalı (Faz 1'de cron davranışı doğrulanır).
