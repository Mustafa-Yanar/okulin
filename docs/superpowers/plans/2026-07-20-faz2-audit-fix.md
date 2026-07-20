# Faz 2 Denetim Düzeltme Dalgası — Plan

> Codex + Explore (+ Gemini) çok-model denetiminin MUST-FIX bulguları. Faz 3'e geçmeden kapatılır. Dal: etut-hafta-bazli.

## Kapsam (2 bağımsız denetim mutabık — kapatılacak)

### FIX-A: Kaynak-bazlı advisory lock (lost-update / çift-rezervasyon) — KRİTİK
**Kök neden:** `lockStudentWeek` anahtarı `org:studentId:week`. Çekişme ise (sablonId,weekKey) satırında. İki FARKLI öğrenci aynı etüde eşzamanlı başvurunca farklı kilit alır → ikisi de boş görür → 2. upsert 1.'yi ezer (veya P2002→500). Aynı sınıf /api/slots POST (slot hücresi) ve DELETE'te.

**Çözüm — İKİ kilit, SABİT sırada (deadlock-free):**
- `lib/etut/reservations.ts`:
  - `lockStudentWeek` anahtarına **branch** ekle → `${orgSlug}:${branch}:${studentId}:${weekKey}` (imza: `lockStudentWeek(tx, orgSlug, branch, studentId, weekKey)`).
  - Yeni: `export async function lockResource(tx, key: string): Promise<void>` → `pg_advisory_xact_lock(hashtextextended(${key}, 0))`.
- **Sıra kuralı (TÜM yollar): önce KAYNAK kilidi, sonra ÖĞRENCİ-hafta kilidi.** İki txn iki kilidi de paylaşıyorsa (aynı öğrenci+aynı kaynak) anahtar çifti aynı → aynı sırada alınır → cycle yok. Farklı öğrenci-aynı kaynak yalnız kaynak-kilidinde, aynı öğrenci-farklı kaynak yalnız öğrenci-kilidinde çekişir → cycle imkânsız.
- `lib/etut/booking.ts` bookEtut tx başı:
  ```
  await lockResource(tx, `etut:${orgSlug}:${branch}:${sablonRow.id}:${weekKey}`);
  await lockStudentWeek(tx, orgSlug, branch, targetStudentId, weekKey);
  ```
  RECURRING'te weekKey='*' → kaynak kilidi `etut:org:branch:sablonId:*` (recurring satırı da serileşir). Sonra effective TAZE okunur (mevcut). decideBooking rule 9 doluluk kararı artık kilit ALTINDA → yarış kapanır.
- `lib/etut/booking.ts` cancelEtutV2 tx: aynı iki kilit (kaynak `etut:...:sablonId:weekKey` + öğrenci).
- `app/api/slots/route.ts` POST tx: kaynak = slot hücresi → `lockResource(tx, `slot:${orgSlug}:${branch}:${weekKey}:${teacher.id}:${day}:${slotId}`)` ÖNCE, sonra `lockStudentWeek(tx, orgSlug, branch, targetLegacyStudentId, weekKey)`. Doluluk (hücre booked mı) kararını tx İÇİNDE, kilit sonrası TAZE oku (`tx.slotBooking.findUnique` compound key) — şu an tx-öncesi okunuyorsa taşınmalı.
- `app/api/slots/route.ts` DELETE: şu an kilitsiz. `tdb().$transaction` + aynı iki kilit + satırı tx-içi taze oku + sahiplik yeniden doğrula + koşullu güncelle (stale-update kapanır).

### FIX-B: Recurring iptal bağımsızlığı — YÜKSEK
**Kök neden:** `cancelEtutV2` scope='recurring'te bile efektif-cari-hafta kaydını arar; tombstone/effektif-değilse 404, ACTIVE '*' satırı iptal edilemez. Reachable: ProgramEditor atama-kaldır PATCH (weekKey yok → current).
**Çözüm:** cancelEtutV2'de scope ayrımı:
- `scope==='recurring'`: (müdür/rehber zaten kontrollü) kaynak+öğrenci kilidi (weekKey='*') altında **ACTIVE '*' RECURRING satırını** doğrudan bul (`etutReservation.findFirst({ where:{orgSlug,branch,sablonId,weekKey:'*',scope:'RECURRING',status:'ACTIVE'} })`); yoksa 404 'Bu etütte tekrarlayan rezervasyon yok'; sahiplik/audit BU satırdan; `cancelRecurring(...)`.
- `scope==='week'` (default): mevcut efektif-cari-hafta mantığı (freshEffective) aynen.

### FIX-D: RECURRING karar-kapsamı (Gemini YÜKSEK-2) — YÜKSEK
**Kök neden:** Müdür ProgramEditor'dan RECURRING atarken bookEtut weekKey=current alır; decideBooking cari-haftaya özgü kuralları (9 doluluk, 10 saat-çakışma, 11 aynı-ders, ayrıca 5'in pasifHaftalar kısmı, 12 limit) uygular. Öğrencinin o haftaya özel tek-seferlik bir kaydı varsa RECURRING atama takılıp 400 döner (eski JSON koşulsuzdu). PATCH force:true göndermiyor.
**Çözüm (rule-scope-gating — force'tan daha doğru):** `decideBooking`'te `scope==='RECURRING'` iken cari-haftaya-özgü kuralları ATLA: rule 9 (doluluk), 10 (saat çakışma), 11 (aynı ders/mat), 12 (limit) ve rule 5'in `pasifHaftalar.includes(weekKey)` kısmı. RECURRING'te KALAN kurallar: readOnly, recurring-rol, sablon var+silinmemiş+`aktif!==false`, teacher/student var, grup, ders∈düzey-havuzu. Gerekçe: RECURRING duran bir seri; per-hafta istisnalar WEEK override/tombstone ile çözülür (spec: müdür recurring=tüm haftalar). Bu, Codex Y2'yi (recurring gelecek-hafta çakışması) da BİLİNÇLİ-KABUL'e çevirir — müdür güvenilir + her haftayı override edebilir. (Rule 4 pencere + rule 6 geçmiş-slot ZATEN RECURRING'te atlanıyor.)

### FIX-E: Kural 4/5 sırası (Gemini ORTA-1) — ORTA-kolay
`decideBooking`'te rule 5 (sablon varlık/aktiflik + teacher/student varlık) rule 4'ün (hafta penceresi) ÜSTÜNE taşınsın → geçersiz sablon + kapalı hafta artık '403 pencere' değil doğru '404 Etüt bulunamadı' döner. (WEEK penceresi yalnız geçerli sablon için anlamlı.)

### FIX-C (ek-kolay, denetimden):
- **Audit robustluğu:** `booking.ts`'te tx-SONRASI `await logAudit(...)` **try/catch** ile sarılı (best-effort) — audit hatası commit'lenmiş rezervasyonu 500'e çevirmesin. Ayrıca cancel audit hedefi **freshEffective**'den (stale effectiveRow değil).
- **force audit doğruluğu (Gemini DÜŞÜK-1):** audit'e `force:true` yalnız `isManagerActor && input.force` iken yazılsın (yetkisiz force yanıltıcı loglanmasın).
- **ISO-week doğrulayıcı:** `lib/etut/weeks.ts`'e `export function isValidWeekKey(wk: string): boolean` (`^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$`). `booking.ts` normalizeWeekKey + `app/api/etut-sablon/rezervasyon/route.ts` şeması bunu kullansın → RECURRING'te W00/W99 reddedilsin (mobil zaten sıkı).

## KAPSAM DIŞI (Faz 3/5 — audit doc'ta kayıtlı, şimdi düzeltilmez)
- Okuma-yolu göçü + JSON backfill = **Faz 3'ün kendisi** (yazma göçtü, okuma bekliyor; deploy yok, kasıtlı ara-durum).
- **Faz 3 okuma sorgularına `sablon.deletedAt IS NULL` süzgeci ZORUNLU** (Gemini ORTA-2: soft-deleted şablon rezervasyonları takvimde görünmesin) — Faz 3 planına taşındı.
- Recurring gelecek-hafta çakışması: FIX-D ile BİLİNÇLİ-KABUL (müdür güvenilir + override).
- ProgramEditor direct SlotBooking + initWeekForTeacher (ders-gridi materyalizasyonu; öğrenci-rezervasyonu değil) — legacy, düşük olasılık; Faz 3/5 SlotBooking konsolidasyonunda.
- Cutover dedup + fail-open slot backfill — **Faz 5 reconciliation** kapsamı.

## Test
Saf: isValidWeekKey birim testleri. Concurrency doğrulaması birim testle zor (advisory lock DB-seviye) → canlı smoke (testkurs): iki paralel bookEtut aynı sablon+hafta → tam BİRİ başarılı diğeri 'dolu'/red, tek satır; recurring iptal tombstone'lu haftada → seri iptal olur. Build + tüm suite yeşil.
