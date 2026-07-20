# Etüt Hafta-Bazlı Rezervasyon — Faz 2b: Birleşik Komut Servisi + Kablolama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tüm etüt yazma yolları (web öğrenci/öğretmen/müdür + mobil + eski /api/slots) TEK komut servisinden (`bookEtut`/`cancelEtut`) geçsin; rezervasyonlar hafta-bazlı EtutReservation tablosuna, şablon CRUD EtutSablon tablosuna taşınsın. Kurallar: rol+hafta penceresi (Pazar 11:00), düzey-ders havuzu (§4a), çapraz-sistem interval çakışması + birleşik haftalık limit, soft-delete/tombstone, audit.

**Architecture:** Saf karar çekirdeği (`decideBooking` — tüm girdiler parametre, ~%100 birim testli) + ince orkestratör (I/O: `tdb().$transaction` + advisory lock + Faz 2a veri katmanı). Route'lar yalnız parse+yetki+servis çağrısı. API dış sözleşmesi KORUNUR (etutId=legacyId; mobil cancel weekKey OPTIONAL).

**Tech Stack:** TS strict, vitest, Faz 2a lib'leri (weeks/overlap/level-pool/reservations), Prisma (EtutSablon/EtutReservation).

**Spec:** `docs/superpowers/specs/2026-07-19-etut-hafta-bazli-rezervasyon-design.md` §4, §4a, §5, §6

## Global Constraints

- Dal `etut-hafta-bazli`; main'e push YOK. Prod'a deploy YOK (cutover Faz 5).
- **Transaction'lar YALNIZ `tdb().$transaction(...)` ile açılır** — çıplak `prisma.$transaction` tenant sızdırır (Faz 2a T4 Step 0 bulgusu). Compound-unique where'lerde orgSlug/branch AÇIK geçilir.
- **Hata metinleri birebir korunur:** eski `reserveEtut`/`cancelEtut`/`/api/slots` kullanıcıya dönen Türkçe mesajlar aynen taşınır (UI/testler bunlara bağlı). Yeni kurallara (pencere/scope/düzey) yeni metinler eklenir.
- **API sözleşmesi:** dışa dönük `etutId` = EtutSablon.**legacyId** (route'lar legacyId alır/döner; DB cuid'i sızmaz). Mobil `CancelEtutSchema`'ya weekKey OPTIONAL eklenir (eski binary kırılmaz; yokken currentWeekKeyTSI varsayılır).
- **Tombstone-create orijinal sahibi taşır:** recurring'in tek-hafta iptalinde snapshot, iptal edenin değil EFEKTİF rezervasyon sahibinin bilgileriyle doldurulur (Faz 2a T4 Minor'ının kapanışı).
- Audit: her book/cancel/override, repo'daki mevcut audit-log desenine (lib/audit) bir kayıt yazar; müdür/rehber bypass'ı `force+reason` ile audit'e geçer.
- TDD; her commit öncesi `npm run build` + `npm test` yeşil; Türkçe commit'ler.
- JSON (programTemplate.etutSablonlari) bu fazda da OKUNMAZ-YAZILMAZ hale gelen yollar: şablon CRUD + rezervasyon. (Prod main hâlâ JSON'da; senkron Faz 5 reconcile'da.)

---

### Task 1: `lib/etut/sablon-service.ts` + `/api/etut-sablon` route'ları tabloya

**Files:**
- Create: `lib/etut/sablon-service.ts`, `lib/etut/sablon-service.test.ts`
- Modify: `app/api/etut-sablon/route.ts` (GET/POST/PUT/DELETE — PATCH'e DOKUNMA, Task 5'te)

**Interfaces (Produces):**
```ts
export interface SablonDTO { id: string; dayIndex: number; start: string; end: string; aktif: boolean; pasifHaftalar: string[] } // id = legacyId (dış sözleşme)
listSablonlar(teacherLegacyId: string): Promise<SablonDTO[]>            // deletedAt:null, tablo
saveSablon(teacherLegacyId, s: { id?: string; dayIndex; start; end; aktif? }): Promise<SablonDTO[]>  // id yoksa create (legacyId=newId()), varsa update
toggleSablon(teacherLegacyId, legacyId, scope: 'all'|'week', weekKey: string|undefined, aktif: boolean): Promise<SablonDTO[]>
softDeleteSablon(teacherLegacyId, legacyId): Promise<SablonDTO[]>       // deletedAt=now; REZERVASYONLAR SİLİNMEZ
getSablonForBooking(teacherLegacyId, legacyId): Promise<EtutSablon | null> // deletedAt:null — DB satırı (cuid id dahil, orkestratör kullanır)
```

- [ ] **Step 1: Saf mantık testleri** — `sablon-service.test.ts`: `toSablonDTO` (DB satırı→DTO, id=legacyId), toggle mantığı saf yardımcı `applyToggle(row, scope, weekKey, aktif)` → { aktif, pasifHaftalar } (mevcut `app/api/etut-sablon/route.ts` PUT davranışıyla BİREBİR: scope=all→aktif set + aktifse pasifHaftalar sıfırla; scope=week→set add/delete). 5 test: all-aktif-true pasifleri temizler; all-false; week-false ekler; week-true çıkarır; tekrarlı week-false idempotent.
- [ ] **Step 2: FAIL → implementasyon → PASS.** DB fonksiyonları ince: `tdb().etutSablon.*`, where'lerde `teacherId: teacherLegacyId` + `deletedAt: null` (+`orgSlug/branch` findMany'de $extends'ten gelir ama upsert/update'te AÇIK — org bilgisi `lib/tenant`'tan mevcut desenle alınır; Faz 2a T4 raporundaki `currentOrg()/currentBranch()` kullanımına bak). saveSablon zaman doğrulaması: mevcut route'taki `toMin(end) <= toMin(start)` reddi + `slotStartTime` geçmiş-gün reddi AYNEN (metinler dahil) servise taşınır.
- [ ] **Step 3: Route'ları bağla** — `app/api/etut-sablon/route.ts` GET/POST/PUT/DELETE gövdeleri servisi çağırır; istek/yanıt şekilleri DEĞİŞMEZ (`{ sablonlar }`, `{ ok, sablonlar }`); Zod şemaları aynı kalır. `updateSablonlar`/`getProgramTemplate` importları bu route'tan kalkar. NOT: GET artık rezervasyon alanları (studentId vb.) DÖNDÜRMEZ — ProgramEditor takvimi Faz 3'e kadar rezervasyon adlarını göstermez (branch-içi bilinen eksik; kırılma değil).
- [ ] **Step 4:** `npm run build && npm test` yeşil (260 + 5 = 265). **Step 5: Commit** — `feat(etüt-faz2b): şablon CRUD EtutSablon tablosuna — sablon-service + route kablolaması (JSON şablon yolu kapandı)`

---

### Task 2: `lib/etut/booking-rules.ts` — saf karar çekirdeği (decideBooking)

**Files:** Create: `lib/etut/booking-rules.ts`, `lib/etut/booking-rules.test.ts`

**Interfaces (Produces — Task 3 orkestratörü kullanır):**
```ts
export interface BookingDeny { error: string; status: number }
export interface BookingContext {
  actor: { role: BookingRole | string; id: string; isManager: boolean; readOnlyCounselor: boolean };
  scope: 'WEEK' | 'RECURRING';
  weekKey: string; allowedWeeks: string[];           // allowedBookingWeeks(actor.role, now) çıktısı
  slotStartsAt: Date; now: Date;                     // geçmiş-slot reddi
  sablon: { aktif: boolean; pasifHaftalar: string[]; deletedAt: Date | null } | null;
  teacher: { legacyId: string; branches: string[]; allowedGroups: string[] } | null;
  student: { id: string; group: string } | null;
  levelPool: string[];                                // levelPoolForGroup(student.group)
  dersBranch: string | undefined;                     // istenen ders (yoksa tek-aday otomatiği orkestratörde)
  currentEffective: { studentId: string } | null;     // o sablon+haftanın efektif rezervasyonu
  otherBookings: NormalizedBooking[];                 // öğrencinin o haftaki DİĞER kayıtları (etut+slot, bu sablon hariç)
  candidate: { dayIndex: number; startMin: number; endMin: number };
  weeklyCount: number; maxWeeklyPerStudent: number | null;  // null = limitsiz; yalnız öğrenci self-booking'e uygulanır
  studentSelfBookingEnabled: boolean;
  force?: boolean;                                    // yalnız isManager; bypass audit'i orkestratörde
}
export function decideBooking(ctx: BookingContext): BookingDeny | { ok: true }
```

- [ ] **Step 1: Failing testler** — kural başına en az 1 test (~22): sıra ve METİNLER aşağıdaki implementasyonla birebir. Örnek çekirdek testler:

```ts
// (test dosyasında ctx üretici bir mk() helper ile — tüm alanlar geçerli varsayılanlı, override'lı)
it('readOnly rehber → 403 Salt-okunur', ...)
it('öğrenci RECURRING isteyemez → 403', ...)
it('öğretmen RECURRING isteyemez → 403; müdür isteyebilir → ok', ...)
it('öğrenci self-booking kapalıysa → 403 (metin /api/slots ile aynı)', ...)
it('pencere dışı hafta (öğrenci, W31 kapalıyken) → 403 "Bu hafta için rezervasyon henüz açık değil"', ...)
it('müdür pencere: cur..+2 içinde ok, dışında 403', ...)
it('geçmiş slot → 400 "Geçmiş bir etüde rezervasyon yapılamaz" (eski metin)', ...)
it('sablon yok/silinmiş → 404 "Etüt bulunamadı"', ...)
it('sablon o hafta pasif → 400 "Bu etüt bu hafta aktif değil"', ...)
it('grup dışı öğrenci → 400 "Bu öğrenci bu öğretmenin etütlerine kayıt olamaz"', ...)
it('ders öğretmen branşında yok → 400 "Geçersiz veya seçilmemiş ders. Uygun bir ders seçin."', ...)
it('ders düzey havuzunda yok (lise→İnkılap) → aynı 400 metni', ...)
it('düzey havuzunda olan sınıf-dışı ders → ok (§4a)', ...)
it('dolu (başka öğrenci) → 400 "Bu etüt zaten dolu"; aynı öğrenci → 400 "zaten bu etüde kayıtlı"', ...)
it('saat çakışması (slot kaynaklı) → 400 "Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı"', ...)
it('aynı ders bu hafta → 400 "...zaten etüt almış" (öğrenci); müdür muaf; müdür force ile herşeyi geçer AMA saat çakışmasını force olmadan GEÇEMEZ', ...)
it('matematik ailesi → 400 (öğrenci); müdür muaf', ...)
it('haftalık limit: öğrenci self weeklyCount>=max → 400; öğretmen/müdür muaf', ...)
```

- [ ] **Step 2: FAIL doğrula.**
- [ ] **Step 3: Implementasyon** — kural SIRASI (erken çıkış; eski `reserveEtut` sırasına sadık, yeniler işaretli):

```ts
// Birleşik rezervasyon karar çekirdeği — SAF (I/O yok). Tüm yazma yolları (web/mobil/slots)
// Task 3 orkestratörü üzerinden BURADAN geçer; kural tek yerde yaşar (spec §4).
import { MATH_FAMILY } from '@/lib/constants';
import { findTimeConflict, type NormalizedBooking } from './overlap';

export function decideBooking(ctx: BookingContext): BookingDeny | { ok: true } {
  const { actor } = ctx;
  // 1) Salt-okunur rehber (mevcut /api/slots kuralı — metin oradan)
  if (actor.readOnlyCounselor) return { error: 'Salt-okunur rehber etüt rezervasyonu yapamaz', status: 403 };
  // 2) RECURRING yalnız müdür/rehber (YENİ)
  if (ctx.scope === 'RECURRING' && !actor.isManager) return { error: 'Tekrarlayan atama yalnız müdür/rehber tarafından yapılabilir', status: 403 };
  // 3) Öğrenci self-booking kapalı (mevcut /api/slots kuralı — metni route'tan BİREBİR kopyala)
  if (actor.role === 'student' && !ctx.studentSelfBookingEnabled) return { error: 'Öğrenci etüt rezervasyonu bu kurumda kapalı', status: 403 };
  // 4) Hafta penceresi (YENİ — spec §5; RECURRING'te haftadan bağımsız, effectiveFrom orkestratörde)
  if (ctx.scope === 'WEEK' && !ctx.allowedWeeks.includes(ctx.weekKey)) {
    return { error: 'Bu hafta için rezervasyon henüz açık değil', status: 403 };
  }
  // 5) Şablon varlık/aktiflik (eski metinler)
  if (!ctx.sablon || ctx.sablon.deletedAt) return { error: 'Etüt bulunamadı', status: 404 };
  if (ctx.sablon.aktif === false || ctx.sablon.pasifHaftalar.includes(ctx.weekKey)) {
    return { error: 'Bu etüt bu hafta aktif değil', status: 400 };
  }
  if (!ctx.teacher) return { error: 'Öğretmen bulunamadı', status: 404 };
  if (!ctx.student) return { error: 'Öğrenci bulunamadı', status: 404 };
  // 6) Geçmiş slot (eski metin; WEEK için — RECURRING geleceğe akar)
  if (ctx.scope === 'WEEK' && ctx.slotStartsAt.getTime() <= ctx.now.getTime()) {
    return { error: 'Geçmiş bir etüde rezervasyon yapılamaz', status: 400 };
  }
  // 7) Grup (eski)
  const groups = ctx.teacher.allowedGroups;
  if (groups.length === 0) return { error: 'Bu öğretmenin grup etiketi tanımlanmamış', status: 400 };
  if (!groups.includes(ctx.student.group)) return { error: 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz', status: 400 };
  // 8) Ders: öğretmen branşı ∩ DÜZEY havuzu (§4a — sınıf listesi DEĞİL)
  if (!ctx.dersBranch || !ctx.teacher.branches.includes(ctx.dersBranch) || !ctx.levelPool.includes(ctx.dersBranch)) {
    return { error: 'Geçersiz veya seçilmemiş ders. Uygun bir ders seçin.', status: 400 };
  }
  // 9) Doluluk (eski metinler; efektif = hafta-bazlı)
  if (ctx.currentEffective) {
    if (ctx.currentEffective.studentId !== ctx.student.id) return { error: 'Bu etüt zaten dolu', status: 400 };
    return { error: 'Bu öğrenci zaten bu etüde kayıtlı', status: 400 };
  }
  // 10) Saat çakışması — İKİ SİSTEM birleşik, interval bazlı (YENİ mekanik, eski metin). force'la BİLE geçilmez... müdür force → audit'li bypass (spec: saat çakışması yalnız force+reason ile).
  const clash = findTimeConflict(ctx.otherBookings, ctx.candidate);
  if (clash && !(actor.isManager && ctx.force)) {
    return { error: 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı', status: 400 };
  }
  // 11) Aynı ders + matematik ailesi (eski: yalnız yönetici-olmayan)
  if (!actor.isManager) {
    if (ctx.otherBookings.some((b) => b.dersBranch === ctx.dersBranch)) {
      return { error: `Bu öğrenci bu hafta ${ctx.dersBranch} dersinden zaten etüt almış`, status: 400 };
    }
    if (MATH_FAMILY.includes(ctx.dersBranch) && ctx.otherBookings.some((b) => b.dersBranch && MATH_FAMILY.includes(b.dersBranch))) {
      return { error: 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış', status: 400 };
    }
  }
  // 12) Haftalık limit (mevcut /api/slots kuralı: yalnız öğrenci self-booking; metni route'tan al)
  if (actor.role === 'student' && ctx.maxWeeklyPerStudent != null && ctx.weeklyCount >= ctx.maxWeeklyPerStudent) {
    return { error: 'Haftalık etüt limitinize ulaştınız', status: 400 };
  }
  return { ok: true };
}
```
**DİKKAT (implementer):** 3/12'deki metinler için ÖNCE `app/api/slots/route.ts` POST'taki gerçek metinleri oku ve buradakilerin yerine BİREBİR onları koy (plan metinleri yaklaşık olabilir); testleri de gerçek metinlerle yaz. Kural 10'da müdür+force bypass'ı orkestratörde audit'lenir.

- [ ] **Step 4: PASS (≈22 test).** **Step 5:** build+test yeşil. **Step 6: Commit** — `feat(etüt-faz2b): saf rezervasyon karar çekirdeği decideBooking — 12 kural, eski metinler birebir + pencere/scope/düzey kuralları`

---

### Task 3: `lib/etut/student-week.ts` — çapraz-sistem toplayıcı

**Files:** Create: `lib/etut/student-week.ts`, `lib/etut/student-week.test.ts`

**Interfaces (Produces):**
```ts
combineBookings(etutRows: EtutReservation[], slotRows: { dayIndex: number; slotId: string; startsAt: string | null; endsAt: string | null; branchField: string | null }[], slotTimes: DaySlotTimes): { list: NormalizedBooking[]; weeklyCount: number }  // SAF (tipleri gerçek şemadan uyarla; slotRows alan adlarını SlotBooking modelinden al)
studentWeekBookings(orgSlug, branch, studentId, weekKey, opts?: { excludeSablonId?: string }): Promise<{ list; weeklyCount }>   // DB
```
- Etüt tarafı: `getWeekReservations` + `resolveEffective` → öğrencinin satırları (excludeSablonId hariç) → NormalizedBooking (startsAt/endsAt→dakika, source:'etut').
- Slot tarafı: `tdb().slotBooking.findMany({ where: { weekKey, booked: true, studentId } })` → saatler `getDaySlotTimes()` üzerinden `daySlots(dayIndex, ...)` slot tanımından (start/end); satırda `startsAt/endsAt` snapshot varsa ONU tercih et; ikisi de yoksa kaydı `dayIndex`-only çakışmasına DEĞİL, atla + `console.warn` (sessiz-yanlış yerine görünür-eksik). source:'slot', dersBranch = satırdaki branş alanı (SlotBooking data/branch alanını incele — mevcut çakışma kodu `app/api/slots/route.ts:217-241` hangi alandan okuyorsa onu kullan).
- `weeklyCount` = iki listenin toplam sayısı (mevcut /api/slots limiti yalnız SlotBooking sayıyordu — artık birleşik; spec §4).

- [ ] **Step 1:** saf `combineBookings` testleri (5+): etut+slot birleşimi, exclude, snapshot-öncelik, saat-bilinmeyen slot atlanır+sayılır MI (karar: sayILIR — limit için; sadece interval listesine girmez), dakika dönüşümü.
- [ ] **Step 2-4:** RED→GREEN→build. **Step 5: Commit** — `feat(etüt-faz2b): çapraz-sistem öğrenci-hafta toplayıcı (etüt+slot birleşik çakışma/limit girdisi)`

---

### Task 4: `lib/etut/booking.ts` — orkestratör (bookEtut/cancelEtut)

**Files:** Create: `lib/etut/booking.ts` (+ `lib/etut/booking.test.ts` — yalnız saf yardımcılar: input doğrulama, tek-aday ders otomatiği)
- Modify: YOK (route'lar Task 5-6'da)

**Interfaces (Produces):**
```ts
bookEtut(session: Session, input: { teacherId: string; etutId: string; weekKey?: string; branch?: string; studentId?: string; scope?: 'WEEK'|'RECURRING'; force?: boolean; reason?: string }): Promise<EtutReservation>
cancelEtut(session: Session, input: { teacherId: string; etutId: string; weekKey?: string; scope?: 'week'|'recurring'; reason?: string }): Promise<void>
```
Akış (bookEtut): hedef öğrenci çözümü (eski reserveEtut rol mantığı BİREBİR: öğrenci=kendisi; öğretmen=kendi etüdü + "Sadece kendi etütlerinize öğrenci yazabilirsiniz"; yönetici=studentId) → weekKey default `currentWeekKeyTSI()` + format regex → veri toplama (sablon `getSablonForBooking` [legacyId], teacher/student `getAllTeachers/getAllStudents` mevcut yardımcılarla, levelPool, config: `/api/slots`'un okuduğu `getOrgConfig('etut')` alan adlarıyla studentSelfBooking/maxWeekly, readOnly rehber: `getOrgConfig('permissions')` aynı desen) → tek-aday ders otomatiği (eski: `teacher.branches ∩ havuz` tek elemansa otomatik) → `tdb().$transaction(async (tx) => { lockStudentWeek(tx, org, studentId, weekKey); effective+otherBookings tx İÇİNDE yeniden oku (yarış penceresi kapanır); decideBooking; deny→HttpError(status,error); WEEK→upsertWeekReservation(tx,...) | RECURRING→upsertRecurring(tx, effectiveFromWeek=weekKey,...) })` → audit kaydı (mevcut lib/audit deseni; force bypass'ta reason zorunlu + audit'e yazılır) → dönüş.
Akış (cancelEtut): scope default 'week'; weekKey default current; efektif rezervasyonu bul (yoksa eski metin "Bu etütte rezervasyon yok" 404) → sahiplik (eski: öğrenci kendi; öğretmen kendi etüdü; yönetici hepsi — metinler birebir) → cancelLockHours: `/api/slots` DELETE'te varsa AYNI config anahtarı+metniyle uygula (yoksa uygulama — implementer route'u okuyup karar verir, raporlar) → scope='recurring'→ yalnız isManager, `cancelRecurring`; 'week'→ `cancelToTombstone` (snapshot=EFEKTİF sahibin bilgileri) → audit.

- [ ] **Step 1:** saf yardımcı testleri (hedef-öğrenci çözümü + tek-aday otomatiği, 5 test — fonksiyonları saf export et).
- [ ] **Step 2-3:** RED→GREEN; orkestratör implementasyonu (yukarıdaki akış; HttpError `@/lib/errors`).
- [ ] **Step 4:** build+test yeşil. **Step 5: Commit** — `feat(etüt-faz2b): bookEtut/cancelEtut orkestratörü — tx+lock, decideBooking, upsert/tombstone, audit`

---

### Task 5: Web kablolama — rezervasyon route + PATCH delegasyonu + eski servis adaptörü

**Files:**
- Modify: `app/api/etut-sablon/rezervasyon/route.ts` (POST: +scope/force/reason opsiyonel şema; DELETE: +weekKey/scope/reason opsiyonel; her ikisi `bookEtut`/`cancelEtut` çağırır)
- Modify: `app/api/etut-sablon/route.ts` PATCH → gövdesi `bookEtut(session, { ..., scope: 'RECURRING' })` / kaldırma → `cancelEtut(..., scope:'recurring')` delegasyonu (eski AssignSchema korunur; student:null=kaldırma). Eski `updateSablonlar`-tabanlı gövde SİLİNİR.
- Modify: `lib/etut/rezervasyon.ts` — `reserveEtut`/`cancelEtut`(eski imza)/`studentBookedEtuts` GÖVDELERİ yeni servise/tabloya delege eden ince adaptörlere döner; `listBookableEtuts` tablo-tabanlı yeniden yazılır (EtutSablon deletedAt:null + effective doluluk + düzey havuzu branş adayları; dönüş tipi `BookableEtut` AYNEN). `pickAllowedBranches`/saf yardımcılar ve testleri KALIR (slots route hâlâ kullanıyor — Task 6'da ele alınır).

- [ ] **Step 1:** Şema genişletmeleri (zod: scope enum optional, weekKey optional, force boolean optional, reason max200 optional) + route gövdeleri.
- [ ] **Step 2:** `lib/etut/rezervasyon.test.ts` mevcut 13 test GEÇMELİ (saf fonksiyonlar değişmiyor) — koş, doğrula.
- [ ] **Step 3:** build+test yeşil (route seviyesi davranış Faz sonu canlı smoke'ta). **Step 4: Commit** — `feat(etüt-faz2b): web rezervasyon+PATCH tek servise bağlandı; listBookableEtuts tablo-tabanlı`

---

### Task 6: `/api/slots` POST/DELETE → servis (source='slot')

**Files:** Modify: `app/api/slots/route.ts`, `lib/etut/booking.ts` (+`bookSlot`/`cancelSlot` veya `source` parametresi)

Davranış BİREBİR korunur; değişen yalnız: (a) çakışma/limit artık `studentWeekBookings` birleşik listeden (etüt tarafını da görür), (b) SlotBooking upsert'üne `startsAt/endsAt` snapshot yazılır (slot tanımından), (c) kurallar decideBooking'ten geçer (slot'a uygulanmayanlar — şablon aktifliği — sablon:null-değil sahte geçerli girdiyle DEĞİL, `source`'a göre atlanan açık bir varyantla: `decideSlotBooking` ayrı ince fonksiyon YAZMA; ctx'i slot gerçekleriyle doldur: sablon={aktif:true,pasifHaftalar:[],deletedAt:null}). Mezun-w9, etkinlik-engeli, forceOpen, kilit (mevcut route'a özgü kurallar) ROUTE'ta kalır (slot'a özgü — servise taşınmaz, sıraları korunur). DELETE yolundaki kilit/sahiplik aynen.

- [ ] **Step 1:** Route'u satır satır oku; taşınan (grup/ders/doluluk/çakışma/limit/self-booking) ve kalan (mezun-w9/etkinlik/forceOpen/kilit) kuralları rapora listele.
- [ ] **Step 2:** Kablola; `pickAllowedBranches` kullanımını `levelPool` tabanlı karara devret (§4a artık slot yolunda da geçerli).
- [ ] **Step 3:** build + TÜM testler yeşil. **Step 4: Commit** — `feat(etüt-faz2b): /api/slots rezervasyonu birleşik servise bağlandı — çapraz-sistem çakışma + düzey kuralı + saat snapshot`

---

### Task 7: Mobil + canlı smoke + Faz 2 kapanışı

**Files:**
- Modify: `lib/mobile/contracts.ts` (`CancelEtutSchema` + weekKey optional; `ReserveEtutSchema` zaten weekKey'li — scope MOBİLDE YOK), `app/api/mobile/v1/etut/reserve/route.ts` (yeni servise), `app/api/mobile/v1/etut/route.ts` GET (listBookableEtuts zaten Task 5'te tablo-tabanlı — dokunma, doğrula).

- [ ] **Step 1:** Mobil kablolama + `npm run mobile:types` (tip senkronu — script mevcut).
- [ ] **Step 2: Canlı smoke (testkurs org — güvenli):** scratchpad'e tek seferlik script: testkurs'ta bir öğretmen+şablon+öğrenci seç → `bookEtut` (WEEK, current) → effective doğrula → `cancelEtut` → tombstone doğrula → recurring book (müdür aktörüyle) → tek-hafta tombstone → `cancelRecurring` → satırları `deleteMany` ile TEMİZLE (testkurs verisi kirlenmez). Çıktılar rapora. (Route üzerinden değil servis üzerinden — runWithTenant ile testkurs bağlamında.)
- [ ] **Step 3:** Tam gate: build + tüm suite. Plan checkboxları + kapanış commit — `docs(etüt-faz2b): Faz 2b tamamlandı — tüm yazma yolları birleşik serviste`
- [ ] **Step 4 (controller):** Faz 2 BÜTÜNÜ çok-model denetimi (Codex+Gemini: 2a+2b diff'i) — bulgular temizlenmeden Faz 3'e geçilmez.

## Faz 2b Bitiş Kriterleri
1. Rezervasyon+şablon yazma/okuma yolları JSON'a DOKUNMUYOR (grep: `etutSablonlari` yalnız Faz-3-bekleyen okuyucularda + göç scriptlerinde).
2. Tüm suite yeşil; canlı smoke 6 senaryosu geçti + testkurs temizlendi.
3. Metin-birebirlik: eski hata mesajları korunmuş (Task 2 Step 3 DİKKAT notu uygulanmış).
4. Çok-model denetim bulguları kapatıldı.
