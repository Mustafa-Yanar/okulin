# Etüt Hafta-Bazlı Rezervasyon — Faz 5 CUTOVER Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JSON-authoritative reconcile senkronu + main merge + prod deploy + JSON cleanup ile etüt sistemini kalıcı olarak tablo-tabanlı hale getirmek.

**Architecture:** Prod (main) hâlâ eski JSON yoluna yazıyor; tablo Faz 1 snapshot'ında donmuş. Cutover: (1) reconcile scripti JSON→tablo farkını kapatır (skip-existing YETMEZ — Codex kritik bulgusu; güncelle/iptal/soft-delete dahil), (2) bakım penceresinde reconcile→merge→deploy→ikinci-reconcile zinciri veri-kaybı penceresini ~0'a indirir, (3) canlı doğrulama sonrası JSON temizlenir (yedekli). Rollback: Vercel instant rollback + rollback-etut-json.mjs; tablo→JSON otomatik dönüş YOK, pencere kısa.

**Tech Stack:** Node .mjs scriptleri (PrismaClient doğrudan), vitest, Prisma schema (`db push`), Vercel deploy (main push tetikler).

## Global Constraints

- Dal `etut-hafta-bazli` — main merge YALNIZ Task 5 runbook'unda, **Mustafa'nın son onayından sonra** (karar 2026-07-21: "Son onayla deploy").
- `npm run build` + `npm run test` yeşil olmadan commit YOK. `git add -A` YASAK — dosya seçerek stage.
- Reconcile **JSON-authoritative**: prod JSON'u gerçek kaynak, tablo ona uydurulur. İSTİSNA: `bookedById !== 'migration'` tablo satırlarına ASLA dokunulmaz (post-deploy/smoke yazımları) — yalnız raporlanır.
- **Geçmiş haftalara (weekKey < currentWeek) ASLA dokunulmaz** — tarihçe.
- Scriptlerde tenant scope her satırda açık (`orgSlug` + `branch`) — script PrismaClient'i $extends'siz, otomatik enjeksiyon YOK.
- Dry-run varsayılan; yazma yalnız `--apply`. Rapor dosyası her koşuda `scripts/backups/`e yazılır.
- weekKey kıyasları zero-padded string (`2026-W05` < `2026-W30` lexicographic doğru); yıl sınırı yorumla işaretlenir.
- Implementer'lar CANLI DB'YE DOKUNMAZ — canlı dry-run/apply yalnız controller (Task 5).

---

### Task 1: Reconcile karar çekirdeği (saf fonksiyonlar + testler)

**Files:**
- Modify: `scripts/etut-migration-lib.mjs` (sona ekle)
- Test: `scripts/etut-migration-lib.test.mjs` (sona ekle)

**Interfaces:**
- Consumes: `classifyReservation(sb, now)`, `isoWeekKeyTSI(now)` (mevcut lib).
- Produces: `reconcileSablonDeletes(jsonIds, tableSablonlar)` ve `reconcileReservationOps(sb, futureRes, now)` — Task 2 script kablolaması bunları çağırır.

- [ ] **Step 1: Failing testleri yaz** — `scripts/etut-migration-lib.test.mjs` sonuna:

```js
// ---- Faz 5 reconcile karar çekirdeği ----
import { reconcileSablonDeletes, reconcileReservationOps } from './etut-migration-lib.mjs';

describe('reconcileSablonDeletes', () => {
  const tRow = (legacyId, deletedAt = null) => ({ legacyId, deletedAt });
  it('JSON\'da olmayan ACTIVE tablo şablonu → soft-delete adayı', () => {
    expect(reconcileSablonDeletes(['a'], [tRow('a'), tRow('b')])).toEqual(['b']);
  });
  it('zaten soft-deleted satır tekrar aday OLMAZ (idempotent)', () => {
    expect(reconcileSablonDeletes(['a'], [tRow('b', new Date())])).toEqual([]);
  });
  it('JSON boşsa tüm ACTIVE şablonlar aday', () => {
    expect(reconcileSablonDeletes([], [tRow('a'), tRow('b')])).toEqual(['a', 'b']);
  });
});

describe('reconcileReservationOps', () => {
  // NOW: Çarşamba 2026-07-22 10:00 TSİ → currentWeek 2026-W30 (dosya başındaki NOW ile aynı)
  const res = (over = {}) => ({
    weekKey: '2026-W30', status: 'ACTIVE', scope: 'WEEK',
    studentId: 's1', bookedById: 'migration', ...over,
  });
  const sbJson = (over = {}) => ({
    id: 'x', dayIndex: 4, start: '15:30', end: '16:00', // Cuma — NOW'dan ileride
    studentId: 's1', studentName: 'Ali', studentCls: '11', branch: 'Matematik', bookedBy: 'student',
    ...over,
  });

  it('1a: aynı öğrenci ACTIVE gelecek satırda → synced', () => {
    expect(reconcileReservationOps(sbJson(), [res()], NOW)).toEqual([{ op: 'synced', weekKey: '2026-W30' }]);
  });
  it('1b: farklı öğrenci, migration satırı → update (aynı hafta, çift üretme yok)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: 's2', studentName: 'Veli' }), [res()], NOW);
    expect(out).toEqual([{ op: 'update', weekKey: '2026-W30', studentId: 's2', studentName: 'Veli', studentCls: '11', dersBranch: 'Matematik', bookedByRole: 'student' }]);
  });
  it('1c: farklı öğrenci, migration-OLMAYAN satır → conflict (dokunma)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: 's2' }), [res({ bookedById: 'u_99' })], NOW);
    expect(out).toEqual([{ op: 'conflict', weekKey: '2026-W30', tableStudentId: 's1' }]);
  });
  it('1d: hiç gelecek satır yok → create (classifyReservation hedefi)', () => {
    const out = reconcileReservationOps(sbJson(), [], NOW);
    expect(out).toEqual([{ op: 'create', weekKey: '2026-W30' }]); // Cuma slotu NOW'dan ileride → W30
  });
  it('1d-unresolved: tüm hedefler geçmişte → unresolved', () => {
    const out = reconcileReservationOps(sbJson({ aktif: false }), [], NOW);
    expect(out).toEqual([{ op: 'unresolved', reason: expect.stringContaining('aktif=false') }]);
  });
  it('1e: hedef haftada CANCELLED satır → conflict-cancelled (post-deploy iptali ezme)', () => {
    const out = reconcileReservationOps(sbJson(), [res({ status: 'CANCELLED', bookedById: 'u_5' })], NOW);
    expect(out).toEqual([{ op: 'conflict-cancelled', weekKey: '2026-W30' }]);
  });
  it('2a: JSON öğrencisiz, migration ACTIVE gelecek satırlar → cancel', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res(), res({ weekKey: '2026-W31' })], NOW);
    expect(out).toEqual([{ op: 'cancel', weekKeys: ['2026-W30', '2026-W31'] }]);
  });
  it('2b: JSON öğrencisiz, migration-olmayan ACTIVE satır → tableOnly (dokunma)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ bookedById: 'u_7' })], NOW);
    expect(out).toEqual([{ op: 'tableOnly', weekKeys: ['2026-W30'] }]);
  });
  it('2c: JSON öğrencisiz, tablo da boş → none', () => {
    expect(reconcileReservationOps(sbJson({ studentId: null }), [], NOW)).toEqual([{ op: 'none' }]);
  });
  it('RECURRING satırlar karara girmez, recurring raporu döner', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ scope: 'RECURRING', weekKey: '*', bookedById: 'u_1' })], NOW);
    expect(out).toEqual([{ op: 'recurringPresent', count: 1 }, { op: 'none' }]);
  });
  it('geçmiş hafta satırı (W29) karara girmez', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ weekKey: '2026-W29' })], NOW);
    expect(out).toEqual([{ op: 'none' }]);
  });
  it('CANCELLED gelecek satır 2a cancel listesine GİRMEZ (idempotent ikinci koşu)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ status: 'CANCELLED' })], NOW);
    expect(out).toEqual([{ op: 'none' }]);
  });
});
```

- [ ] **Step 2: Testlerin FAIL ettiğini gör** — `npx vitest run scripts/etut-migration-lib.test.mjs` → "reconcileSablonDeletes is not exported" tarzı hata bekle.

- [ ] **Step 3: Implementasyon** — `scripts/etut-migration-lib.mjs` sonuna:

```js
// ---- Faz 5 reconcile karar çekirdeği (saf — DB'ye dokunmaz) ----
// JSON-authoritative: prod JSON gerçek kaynak. bookedById==='migration' OLMAYAN
// tablo satırları KORUNUR (post-deploy/smoke yazımı) — yalnız raporlanır.

// JSON'da olmayan ACTIVE (deletedAt:null) tablo şablonları → soft-delete adayları.
export function reconcileSablonDeletes(jsonIds, tableSablonlar) {
  const jsonSet = new Set(jsonIds);
  return tableSablonlar
    .filter((ts) => ts.deletedAt === null && !jsonSet.has(ts.legacyId))
    .map((ts) => ts.legacyId);
}

// Şablon başına rezervasyon senkron kararları. futureRes: tablodaki bu şablona ait
// TÜM satırlar (script weekKey>=currentWeek daraltmadan verir; süzme burada —
// karar mantığı tek yerde test edilsin). Dönen: op listesi (sıra: rapor-önce).
export function reconcileReservationOps(sb, futureRes, now) {
  const currentWeek = isoWeekKeyTSI(now);
  const ops = [];
  const recurring = futureRes.filter((r) => r.scope === 'RECURRING');
  if (recurring.length) ops.push({ op: 'recurringPresent', count: recurring.length });
  // Geçmiş haftalar tarihçe — karara girmez. Zero-padded lexicographic kıyas
  // (yıl sınırında da doğru: '2026-W52' < '2027-W01').
  const future = futureRes.filter((r) => r.scope === 'WEEK' && r.weekKey >= currentWeek);
  const active = future.filter((r) => r.status === 'ACTIVE');

  if (sb.studentId) {
    const same = active.find((r) => r.studentId === String(sb.studentId));
    if (same) { ops.push({ op: 'synced', weekKey: same.weekKey }); return ops; }
    const other = active[0];
    if (other) {
      if (other.bookedById === 'migration') {
        ops.push({
          op: 'update', weekKey: other.weekKey,
          studentId: String(sb.studentId), studentName: sb.studentName || '',
          studentCls: sb.studentCls || '', dersBranch: sb.branch || '',
          bookedByRole: sb.bookedBy || 'unknown',
        });
      } else {
        ops.push({ op: 'conflict', weekKey: other.weekKey, tableStudentId: other.studentId });
      }
      return ops;
    }
    const cls = classifyReservation(sb, now);
    if (cls.action === 'unresolved') { ops.push({ op: 'unresolved', reason: cls.reason }); return ops; }
    // Hedef haftada CANCELLED satır: cutover penceresinde tabloya düşmüş taze iptal —
    // tablo yazımı daha yeni, JSON'la EZME.
    const cancelledAtTarget = future.find((r) => r.status === 'CANCELLED' && r.weekKey === cls.weekKey);
    if (cancelledAtTarget) { ops.push({ op: 'conflict-cancelled', weekKey: cls.weekKey }); return ops; }
    ops.push({ op: 'create', weekKey: cls.weekKey });
    return ops;
  }

  // JSON öğrencisiz: migration-kökenli gelecek ACTIVE satırlar iptal edilir.
  const migRows = active.filter((r) => r.bookedById === 'migration');
  const otherRows = active.filter((r) => r.bookedById !== 'migration');
  if (migRows.length) ops.push({ op: 'cancel', weekKeys: migRows.map((r) => r.weekKey) });
  if (otherRows.length) ops.push({ op: 'tableOnly', weekKeys: otherRows.map((r) => r.weekKey) });
  if (!migRows.length && !otherRows.length) ops.push({ op: 'none' });
  return ops;
}
```

- [ ] **Step 4: Testler geçsin** — `npx vitest run scripts/etut-migration-lib.test.mjs` → tümü PASS. Ayrıca `npm run test` (tam süit) yeşil.

- [ ] **Step 5: Commit**

```bash
git add scripts/etut-migration-lib.mjs scripts/etut-migration-lib.test.mjs
git commit -m "feat(etüt-faz5): reconcile karar çekirdeği — JSON-authoritative senkron kuralları (saf + 14 test)"
```

---

### Task 2: `--reconcile` modu + hayalet-satır taraması (script kablolaması)

**Files:**
- Modify: `scripts/migrate-etut-to-tables.mjs`

**Interfaces:**
- Consumes: `reconcileSablonDeletes`, `reconcileReservationOps`, `validateSablon`, `isoWeekKeyTSI` (Task 1 + mevcut lib).
- Produces: `node scripts/migrate-etut-to-tables.mjs --reconcile [--apply] [--org <slug>]` CLI — Task 5 runbook bunu çağırır.

**Davranış sözleşmesi (spec §7 + Faz 4 denetim carry):**
1. `--reconcile` VERİLMEDİĞİNDE mevcut Faz 1 akışı BAYT-BAYT aynı kalır (regresyon yok).
2. Reconcile akışı, öğretmen başına:
   - JSON şablonlarını `validateSablon` ile süz (bozuk → rapor, mevcut davranış).
   - Şablon upsert — Faz 1 satır şekli + **update payload'a `deletedAt: null` eklenir** (JSON'da yaşayan şablon tabloda soft-deleted ise diriltilir; raporda `sablonRevived` ayrı sayılır: upsert öncesi mevcut satır `deletedAt !== null` ise).
   - `reconcileSablonDeletes(jsonIds, tabloŞablonları)` → soft-delete (`deletedAt: now`) + o şablonların gelecek (`weekKey >= currentWeek`) ACTIVE `bookedById='migration'` rezervasyonları CANCELLED (`cancelledByRole: 'migration'`, `cancelledById: 'reconcile'`, `cancelledAt: now`, `cancelReason: 'cutover-reconcile: şablon JSON kaynağından silinmiş'`). Migration-olmayan satırlar `tableOnly` raporuna.
   - Her JSON şablonu için tablo rezervasyonlarını çek (`etutReservation.findMany({ where: { orgSlug, branch, sablonId } })`) ve `reconcileReservationOps(sb, rows, now)` uygula:
     - `create` → Faz 1 `resRow` şekliyle create (`bookedById: 'migration'`).
     - `update` → op'taki alanlar + `bookedAt: now` DEĞİL (bookedAt korunur — satırın tarihçesi).
     - `cancel` → yukarıdaki cancel alanları, `cancelReason: 'cutover-reconcile: JSON kaynağında rezervasyon yok'`.
     - `synced`/`none`/`conflict`/`conflict-cancelled`/`tableOnly`/`recurringPresent`/`unresolved` → yalnız rapor.
   - JSON'da etutSablonlari ANAHTARI OLMAYAN öğretmen: tablodaki tüm ACTIVE şablonları soft-delete adayı (JSON-authoritative; testkurs tablo-first kalıntıları raporda görünür, cutover'da değerlendirilir).
3. Hayalet tarama (Codex O6 + Faz4 T5 notu — RAPOR-ONLY, temizlik YOK): `slotBooking.findMany({ where: { booked: true, fixed: false, weekKey: { gte: currentWeek } }, select: { orgSlug: true, branch: true, weekKey: true, slotId: true, dayIndex: true, teacherId: true, studentName: true, bookedBy: true } })` — bunlar meşru /api/slots ders-slot rezervasyonları OLABİLİR; implementer `git log -S "type:'etut'" -- app/api/program` arkeolojisiyle eski "geçici etüt" yazımının ayırt edici alanını arar (bulunursa filtre daraltılır, bulunamazsa tümü listelenir ve rapor başlığı "elle incele" der). Ayrıca all-time sayım: `slotBooking.count({ where: { booked: true, fixed: false } })`.
4. Rapor: mevcut `report` objesine reconcile alanları eklenir (`mode: 'RECONCILE-DRY-RUN' | 'RECONCILE-APPLY'`, `sablonSoftDeleted`, `sablonRevived`, `resUpdated`, `resCancelled`, `resSynced`, `conflicts`, `tableOnly`, `recurringPresent`, `ghostRows`, `ghostAllTimeCount`); konsol özeti her listeyi sayı + satır döker. `--apply`'da conflict/unresolved/writeFailed varsa `process.exitCode = 1`.
5. İdempotency: reconcile ikinci koşuda 0 yazma üretmeli (synced/none'a düşer) — Task 1 testlerindeki 2a-CANCELLED ve 1a kuralları bunu garanti eder.

- [ ] **Step 1: Reconcile akışını yaz** — yukarıdaki sözleşme birebir; mevcut Faz 1 akışı `if (!RECONCILE)` altında değişmeden kalır, reconcile ayrı fonksiyon (`runReconcile(p, teachers, now, report, APPLY)`).
- [ ] **Step 2: Kuru sözdizim + tip kontrolü** — `node --check scripts/migrate-etut-to-tables.mjs` PASS; `npm run test` yeşil (script test edilmez, lib testleri korunur).
- [ ] **Step 3: Yerel işlevsel duman (CANLI DB'YE KARŞI DEĞİL)** — implementer DB'siz doğrulayamıyorsa bu adımı controller'a bırakır ve raporunda belirtir (controller Task 5 öncesi canlı **dry-run** koşacak).
- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-etut-to-tables.mjs
git commit -m "feat(etüt-faz5): göç scriptine --reconcile modu — JSON-authoritative senkron + hayalet SlotBooking taraması (rapor-only)"
```

---

### Task 3: SlotBooking arşiv indeksleri + `/all` studentId sunucu filtresi

**Files:**
- Modify: `prisma/schema.prisma` (SlotBooking modeli, mevcut `@@index([orgSlug, branch, weekKey])` yanına)
- Modify: `app/api/etut-sablon/all/route.ts`
- Modify: `app/_components/director/StudentEtutTab.tsx`

**Interfaces:**
- Consumes: `listEtutlerForWeek(weekKey)` (lib/etut/rezervasyon.ts — değişmez); `EtutAllRow.studentId`.
- Produces: `GET /api/etut-sablon/all?week=..&studentId=..` — additive param; StudentEtutTab tüketir.

- [ ] **Step 1: Schema — iki indeks** (Codex O8; arşiv all-weeks sorguları `{teacherId|studentId, booked:true}` indekssiz taranıyordu):

```prisma
  @@index([orgSlug, branch, teacherId, weekKey])
  @@index([orgSlug, branch, studentId, weekKey])
```

`npx prisma format` + `npx prisma validate` PASS. **`db push` YOK** — canlıya uygulama Task 5 runbook adımı (controller).

- [ ] **Step 2: `/all` route — opsiyonel studentId filtresi.** Mevcut parent-filtre bloğunun (veli kendi çocuğuna daraltılır) YANINA: `studentId` query paramı verilmişse `etutler = etutler.filter(e => e.studentId === studentId)` — parent rolünde parent-filtre ÖNCE uygulanır (veli başka öğrenciyi sorgulayamaz; parent-filtre sonrası studentId farklıysa sonuç boş kalır, 403 gerekmez). Yanıt şekli değişmez (additive).

- [ ] **Step 3: StudentEtutTab — sunucu filtresi kullan.** Fetch URL'ine `&studentId=${encodeURIComponent(student.id)}` ekle; istemcideki `.filter(e => e.studentId === student.id)` GÜVENCE olarak kalır (davranış aynı, transfer küçülür).

- [ ] **Step 4: Build + test** — `npm run build` + `npm run test` yeşil.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma app/api/etut-sablon/all/route.ts app/_components/director/StudentEtutTab.tsx
git commit -m "perf(etüt-faz5): SlotBooking arşiv indeksleri (şema) + /all opsiyonel studentId sunucu filtresi"
```

---

### Task 4: Çok-model final review (tüm dal) — CONTROLLER YÜRÜTÜR

Kapsam: `git merge-base main HEAD`..HEAD (f62baec'ten itibaren tüm Faz 1-5 dalı). Süreç Faz 3/4 denetimleriyle aynı:

- [ ] Review package üret (`scripts/review-package f62baec HEAD` — subagent-driven skill scripti) + tam diff dosyası scratchpad'e.
- [ ] **Opus whole-branch reviewer** (subagent-driven final reviewer şablonu) — spec + plan uyumu, Faz 5 kod görevleri dahil.
- [ ] **Codex** (`codex exec --sandbox read-only "..." < /dev/null`) — cutover riskleri odaklı: reconcile kuralları, kilit/yarış, deploy penceresi.
- [ ] **Gemini** (`agy --sandbox --dangerously-skip-permissions --print-timeout 15m -p` + diff dosyası) — bağımsız tarama.
- [ ] **Explore agent** (very thorough) — bayat JSON okuyucu/yazıcı kalmadı mı (cutover sonrası ölü kod envanteri), kör nokta taraması.
- [ ] Bulgular çapraz-doğrulanır; Critical/Important fix dalgası + re-review; audit raporu `docs/superpowers/specs/2026-07-21-faz5-audit.md` commit edilir. **Tüm kapılar kapanmadan Task 5'e geçilmez.**

---

### Task 5: CUTOVER RUNBOOK — CONTROLLER YÜRÜTÜR, MUSTAFA ONAYI GATE'İ

> Karar (2026-07-21): hazırlık + final denetim bitince Mustafa'ya "kapılar yeşil, deploy ediyorum" son onayı sorulur; onay gelmeden 5.4'ten ileri GİDİLMEZ.
> **FINAL DENETİM HARDENING (2026-07-21 audit — Codex/opus):** aşağıdaki güvenlik kuralları ZORUNLU:
> - **Org-scope tutarlılığı:** reconcile ve cleanup AYNI `--org` ile koşulur. Canlı kurum = `akyazicozum`. testkurs (test org) tablo-first smoke kalıntıları taşıdığından org-genelinde reconcile onu churn'ler — bu yüzden **gerçek apply `--org akyazicozum`**; testkurs ayrı ve bilinçli (aşağıda 5.7b). cleanup gate'i (FIX-E) rapor kapsamı cleanup kapsamını kapsamıyorsa REDDEDER.
> - **Sakin pencere:** tüm 5.5–5.9 tek oturumda, düşük-trafik saatte; cleanup/rollback `programTemplate` read-modify-write yaptığından eşzamanlı grid düzenlemesi lost-update riski (küçük ölçek, pencere dakikalar).
> - **reconcile#2 zamanı:** deploy READY'den DAKİKALAR içinde (60dk createdAt guard'ı bu pencereyi korur); ASLA saatler sonra, ASLA cleanup SONRASI.
> - **Vercel CLI:** `npm i -g vercel@latest` (mevcut 56.2.1 eski — rollback/deploy öncesi güncelle).

- [ ] **5.1 Canlı DRY-RUN (akyazicozum):** `set -a; source .env.local; set +a; node scripts/migrate-etut-to-tables.mjs --reconcile --org akyazicozum` → rapor incele. Hedef: `unresolved/invalidSablon/studentIdMissing/writeFailed/conflicts` kovaları BOŞ (dolu ise cleanup gate cutover'ı durdurur — önce sebebi çöz). `sablonSoftDeleted/resUpdated/resCancelled` beklenen küçük değerler mi (JSON≈tablo). Ghost listesi bilinçli kabul.
- [ ] **5.1b Canlı DRY-RUN (testkurs, ayrı):** `--reconcile --org testkurs` → churn (tablo-first smoke kalıntısı soft-delete) BEKLENİR; raporu bilinçli kabul et VEYA testkurs'u cutover kapsamı dışında bırak (canlı veri akyazicozum'da).
- [ ] **5.2 Ön kontroller:** `npm run build` + `npm run test` yeşil; Vercel env'ler tam; `git status` temiz; Vercel CLI güncel.
- [ ] **5.3 MUSTAFA ONAYI:** dry-run özeti + kapı durumu sunulur → açık onay beklenir. (Onaysız 5.4+ YASAK.)
- [ ] **5.4 İndeksler:** `npx prisma db push` (yalnız 2 yeni indeks — eski kod etkilenmez, her an güvenli).
- [ ] **5.5 Reconcile #1 (akyazicozum):** `node scripts/migrate-etut-to-tables.mjs --reconcile --apply --org akyazicozum` → **exit code 0 KONTROL ET** (gate kovaları dolu ise exit 1 — DUR). Rapor `mode=RECONCILE-APPLY` + kayıp-riskli kova boş.
- [ ] **5.6 Merge + deploy:** `git checkout main && git merge --no-ff etut-hafta-bazli -m "feat(etüt): hafta-bazlı rezervasyon sistemi — Faz 1-5 cutover (SlotBooking'den bağımsız EtutSablon/EtutReservation tabloları)"` → `git push` → Vercel build'i izle (deployment READY olana dek). (Fast-forward mümkün — main==merge-base, çakışma yok; `--no-ff` merge commit'i rollback için tercih.)
- [ ] **5.7 Reconcile #2 (akyazicozum, DAKİKALAR içinde):** deploy READY olur olmaz `--reconcile --apply --org akyazicozum` tekrar — build penceresindeki (~2-5 dk) eski-kod JSON yazımlarını yakalar. Kural gereği post-deploy tablo yazımları (bookedById≠migration) `conflict`/`tableOnly`'e düşer, EZİLMEZ; migrated şablon JSON'da (henüz cleanup yok) → soft-delete olmaz. **exit code 0 KONTROL** (conflict çıkarsa canlı yeni-booking'tir, incele — kayıp değil).
- [ ] **5.8 Canlı doğrulama:**
  - testkurs: müdür login → `GET /api/etut-sablon/all` (weekKey/bookableWeeks/baseline şablonlar) → kısa aç-ata-gör-iptal döngüsü → temizlik (baseline'a dönüş).
  - akyazicozum: DB'den İrem + diğer göç rezervasyonları ACTIVE ve doğru haftada; şablon sayısı JSON yedeğiyle eşit.
  - Mobil: `GET /api/mobile/v1/etut` (testkurs öğrenci token'ı) — hafta seçici alanları dolu.
  - Vercel runtime errors temiz (ilk 10 dk).
- [ ] **5.9 JSON cleanup (akyazicozum, GATE'Lİ):** `node scripts/cleanup-etut-json.mjs --apply --org akyazicozum` — cleanup gate (FIX-A/E/F) 5.7'nin RECONCILE-APPLY raporunu okur, kapsam eşleşir, kayıp-riskli kova boşsa devam eder; DEĞİLSE exit 1 (bilinçli geçiş gerekiyorsa `--force` + gerekçe). Yedek yolu kaydedilir (30 gün). Doğrulama: rastgele 2 öğretmenin programTemplate'inde `etutSablonlari` YOK, grid alanları DURUYOR. **cleanup SONRASI reconcile ASLA koşulmaz** (JSON boş → tablo-first şablonları silme adayı olur).
- [ ] **5.10 Kapanış:** ledger + memory + Mustafa'ya rapor. Dal silinmez (referans), `etut-hafta-bazli` GitHub'da kalır.

**ROLLBACK PROSEDÜRÜ (pencere: cleanup sonrası ilk saatler — SAKİN pencerede kısa tutulur):**
1. **Veri ÖNCE:** `node scripts/rollback-etut-json.mjs scripts/backups/etut-json-backup-<ts>.json --apply` — JSON geri gelir. (Eski deployment'ı JSON restore'dan ÖNCE aktive etme — eski kod boş JSON görür.)
2. **Kod SONRA:** Vercel'de önceki production deployment'a instant rollback (dashboard → Promote); ardından `git revert -m 1 <merge-commit>` + push.
3. **Kabul edilen kayıp:** cutover-sonrası tablo yazımları (yeni booking/iptal/recurring) JSON'a DÖNMEZ — pencere bu yüzden kısa + sakin saatte. İndeksler/tablolar geri alınmaz (eski kod okumaz — zararsız).
4. **İSTEĞE BAĞLI tam-kayıpsız rollback:** cutover boyunca etüt-yazma bakım-freeze bayrağı (Redis key + write-path gate) devrede olsaydı post-cutover yazım olmaz, rollback tümüyle kayıpsız olurdu — Mustafa'ya sunuldu, bu ölçek+pencere için ZORUNLU görülmedi (bkz audit "İSTEĞE BAĞLI").

---

### Task 6: Post-cutover temizlik notları (BU FAZDA YAPILMAZ — kayıt)

- `app/api/program/route.ts` JSON `etutSablonlari` pass-through'ları (satır ~44/98/156-178/231-238) cleanup sonrası ÖLÜ KOD olur — cutover deploy'una DAHİL EDİLMEZ (reconcile #2 penceresi pass-through'un JSON'u korumasına dayanır). Birkaç gün sorunsuz izlendikten sonra ayrı temizlik commit'i.
- Hayalet SlotBooking satırları (5.1 raporu doluysa): temizlik kararı rapora göre ayrı iş.
- Rollover ms-içi çifte-tetik marker tablosu: yalnız cron kaynağı çoğalırsa (Faz 4 kararı — şimdilik YOK).
- İleri-hafta iptal kurum istişaresi: sonuç "kapat" çıkarsa tek satır sunucu kapısı (`cancelEtutV2` yorumunda hazır).
- reset-all artık etüt şablon+rezervasyonlarını da siler (spec §8, bilinçli) — canlıda ilk kullanım öncesi hatırla.
