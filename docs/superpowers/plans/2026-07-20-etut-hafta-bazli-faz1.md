# Etüt Hafta-Bazlı Rezervasyon — Faz 1: Şema + Göç — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EtutSablon + EtutReservation tablolarını oluştur, JSON'daki etüt şablonlarını ve mevcut rezervasyonları güvenli/idempotent göç scriptleriyle tablolara kopyala (JSON kaynak-doğruluğu cutover'a kadar korunur).

**Architecture:** Additive şema değişikliği (eski kod etkilenmez — yeni tablolar + SlotBooking'e nullable snapshot kolonları). Göç scriptleri dry-run varsayılanlı, idempotent, raporlu; JSON temizliği Faz 5 cutover'ına ertelenir. Saf göç mantığı ayrı .mjs kütüphanesinde, vitest ile birim testli.

**Tech Stack:** Prisma (`npm run db:push` — migrations dizini YOK, bu repo db push kullanır), vitest (`npm test`), Node .mjs scriptler (`scripts/` konvansiyonu), Neon Postgres.

**Spec:** `docs/superpowers/specs/2026-07-19-etut-hafta-bazli-rezervasyon-design.md` (bölüm 3, 7, 11)

## Global Constraints

- Çalışma dalı: `etut-hafta-bazli` (main'e push YOK — Vercel prod auto-deploy'u tetiklenmemeli; branch push = yalnız preview). CLAUDE.md'nin "otomatik push" kuralı bu refactor'da main-merge Faz 5'e ertelenir.
- JSON (`Teacher.programTemplate.etutSablonlari`) **kaynak-doğruluk olarak kalır** — Faz 1 yalnız KOPYALAR, silmez/temizlemez. Temizlik scripti yazılır ama ÇALIŞTIRILMAZ (Faz 5).
- Tüm tarih/saat hesapları TSİ (+03) — spec §5; `Date.now()` yerine parametre `now` (test edilebilirlik).
- Tenant: her satırda `orgSlug` + `branch` açık taşınır; script TÜM org'ları gezer, `--org <slug>` filtresi opsiyonel.
- `cls` ASLA parseInt edilmez (rehberlik-konu-takibi-fix kuralı) — göçte cls yalnız kopyalanan metin.
- Rapor: hiçbir satır sessiz atlanmaz — skip/unresolved/duplicate hepsi rapora yazılır (spec §7).
- Göç sınıflandırması: TÜM rezervasyonlar tek-hafta (`scope=WEEK`); `bookedBy=director/counselor` dahi otomatik RECURRING yapılmaz (Codex uyarısı — spec §7). Gelecekte aktif hafta bulunamayanlar `migration_unresolved` raporuna.
- Commit mesajları Türkçe; her commit öncesi `npm run build` + `npm test` yeşil.

---

### Task 0: Çalışma dalı

**Files:** (yok — git)

- [ ] **Step 1: Dalı oluştur**

```bash
cd /Users/mustafa/Workspace/active/okulin
git checkout -b etut-hafta-bazli
```

- [ ] **Step 2: Doğrula**

Run: `git branch --show-current`
Expected: `etut-hafta-bazli`

---

### Task 1: Prisma şeması — EtutSablon + EtutReservation + SlotBooking snapshot

**Files:**
- Modify: `prisma/schema.prisma` (Teacher modeli ~satır 157-177; SlotBooking modeli satır 256+; dosya sonuna 2 yeni model)

**Interfaces:**
- Produces: Prisma client'ta `tdb().etutSablon`, `tdb().etutReservation` modelleri; `SlotBooking.startsAt/endsAt` nullable kolonları. Faz 2+ servis katmanı bunları kullanır. Göç scriptleri (Task 3) raw `PrismaClient` ile aynı modellere yazar.

- [ ] **Step 1: Teacher modeline back-relation ekle**

`prisma/schema.prisma` içinde `model Teacher` bloğunda `slotBookings SlotBooking[]` satırının hemen altına ekle:

```prisma
  etutSablonlarRel   EtutSablon[]
```

- [ ] **Step 2: SlotBooking'e snapshot kolonları ekle**

`model SlotBooking` bloğunda `data Json` (veya son alan) satırının altına ekle:

```prisma
  // Saat snapshot'ı (spec §4): slot saat config'i sonradan değişirse eski kayıt kaymasın.
  // Nullable — mevcut satırlar için boş; Faz 2 birleşik servis yazarken doldurur.
  startsAt  String?
  endsAt    String?
```

- [ ] **Step 3: Dosya sonuna iki yeni model ekle**

```prisma
// ── Etüt şablonu (Faz 1 göçü: Teacher.programTemplate.etutSablonlari JSON → tablo) ──
// id JSON'daki mevcut kimlik KORUNARAK taşınır (EtutReservation FK'sı için).
// Rezervasyon alanları BURADA DEĞİL — EtutReservation'da (hafta-bazlı).
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
  pasifHaftalar String[] @default([])
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  reservations  EtutReservation[]
  @@index([orgSlug, branch, teacherId])
  @@index([orgSlug, branch])
}

// ── Hafta-bazlı etüt rezervasyonu (spec §3.2) ──
// scope=WEEK: weekKey gerçek hafta ("2026-W30"). scope=RECURRING: weekKey='*'
// (yalnız unique-marker) + effectiveFromWeek. WEEK satır recurring'i EZER;
// status=CANCELLED WEEK satırı = tombstone (o hafta boş). Soft-delete: fiziksel silme YOK.
model EtutReservation {
  id                String     @id @default(cuid())
  orgSlug           String
  branch            String     @default("main")
  sablonId          String
  sablon            EtutSablon @relation(fields: [sablonId], references: [id], onDelete: Cascade)
  teacherId         String     // legacyId — sorgu kolaylığı (denormalize)
  scope             String     // 'WEEK' | 'RECURRING'
  status            String     @default("ACTIVE") // 'ACTIVE' | 'CANCELLED'
  weekKey           String     // WEEK: "YYYY-Www" | RECURRING: "*"
  effectiveFromWeek String?    // yalnız RECURRING: bu haftadan itibaren
  studentId         String
  studentName       String
  studentCls        String
  dersBranch        String
  bookedByRole      String
  bookedById        String
  bookedAt          DateTime   @default(now())
  cancelledByRole   String?
  cancelledById     String?
  cancelledAt       DateTime?
  cancelReason      String?
  // Snapshot (geçmiş etiketi + interval çakışma; aktif doluluk sablonId+weekKey ile)
  dayIndex          Int
  startsAt          String     // "HH:MM"
  endsAt            String
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
  @@unique([orgSlug, branch, sablonId, weekKey])
  @@index([orgSlug, branch, weekKey])
  @@index([orgSlug, branch, studentId, weekKey])
  @@index([orgSlug, branch, teacherId, weekKey])
}
```

- [ ] **Step 4: Şemayı doğrula**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀` (bileşik FK — orgSlug+branch+legacyId — Teacher'daki `@@unique([orgSlug, branch, legacyId])` satır 175'e bağlanır; hata verirse relation fields/references sırasını kontrol et)

- [ ] **Step 5: DB'ye uygula (additive — eski kod etkilenmez)**

Run: `set -a; source .env.local; set +a; npm run db:push`
Expected: `Your database is now in sync with your Prisma schema.` — yeni 2 tablo + 2 nullable kolon; mevcut veriye dokunmaz.

- [ ] **Step 6: Build + mevcut testler yeşil**

Run: `npm run build && npm test`
Expected: build `✓ Compiled successfully`, vitest tümü PASS (mevcut 13 etüt testi dahil).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(etüt-faz1): EtutSablon + EtutReservation tabloları + SlotBooking saat snapshot kolonları

Hafta-bazlı rezervasyon şeması (spec §3). Additive — mevcut kod JSON'dan okumaya
devam eder; cutover Faz 5'te."
```

---

### Task 2: Saf göç yardımcıları + birim testleri (TDD)

**Files:**
- Create: `scripts/etut-migration-lib.mjs`
- Test: `scripts/etut-migration-lib.test.mjs`

**Interfaces:**
- Produces (Task 3 kullanır):
  - `isoWeekKeyTSI(date: Date): string` — TSİ'ye göre ISO hafta ("2026-W30")
  - `slotStartTSI(weekKey: string, dayIndex: number, hhmm: string): Date` — slotun mutlak başlangıç anı (TSİ +03)
  - `etutAktifThisWeek(sb, weekKey): boolean` — lib/slots.ts:68-72 ile AYNI mantık
  - `nearestFutureActiveWeek(sb, now: Date, horizon=8): string|null`
  - `classifyReservation(sb, now: Date): {action:'none'} | {action:'unresolved', reason:string} | {action:'migrate', weekKey:string}`

- [ ] **Step 1: Failing testleri yaz**

`scripts/etut-migration-lib.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  isoWeekKeyTSI, slotStartTSI, nearestFutureActiveWeek, classifyReservation,
} from './etut-migration-lib.mjs';

// Sabit "şimdi": Çarşamba 2026-07-22 10:00 TSİ (W30 içi; Pzt 20 Tem geçmiş)
const NOW = new Date('2026-07-22T10:00:00+03:00');
const sb = (over = {}) => ({ id: 'x', dayIndex: 0, start: '15:30', end: '16:00', ...over });

describe('isoWeekKeyTSI', () => {
  it('Çarşamba 22 Tem 2026 → 2026-W30', () => {
    expect(isoWeekKeyTSI(NOW)).toBe('2026-W30');
  });
  it('Pazar 19 Tem 2026 → 2026-W29 (Pazar haftanın SON günü)', () => {
    expect(isoWeekKeyTSI(new Date('2026-07-19T16:00:00+03:00'))).toBe('2026-W29');
  });
  it('TSİ gece yarısı sınırı: Pzt 00:30 TSİ (UTC hâlâ Pazar) → YENİ hafta', () => {
    expect(isoWeekKeyTSI(new Date('2026-07-20T00:30:00+03:00'))).toBe('2026-W30');
  });
});

describe('slotStartTSI', () => {
  it('W30 Pzt 15:30 = 2026-07-20T15:30+03', () => {
    expect(slotStartTSI('2026-W30', 0, '15:30').toISOString()).toBe('2026-07-20T12:30:00.000Z');
  });
  it('W30 Pazar 10:00 = 2026-07-26T10:00+03', () => {
    expect(slotStartTSI('2026-W30', 6, '10:00').toISOString()).toBe('2026-07-26T07:00:00.000Z');
  });
});

describe('nearestFutureActiveWeek', () => {
  it('bu haftanın günü GEÇMİŞSE → sonraki hafta (Pzt slotu, Çarşamba günü) → W31', () => {
    expect(nearestFutureActiveWeek(sb(), NOW)).toBe('2026-W31');
  });
  it('bu haftanın günü GELECEKSE → bu hafta (Cuma slotu) → W30', () => {
    expect(nearestFutureActiveWeek(sb({ dayIndex: 4 }), NOW)).toBe('2026-W30');
  });
  it('pasifHaftalar atlanır: Cuma slotu W30 pasif → W31', () => {
    expect(nearestFutureActiveWeek(sb({ dayIndex: 4, pasifHaftalar: ['2026-W30'] }), NOW)).toBe('2026-W31');
  });
  it('kalıcı pasif (aktif=false) → null', () => {
    expect(nearestFutureActiveWeek(sb({ aktif: false }), NOW)).toBeNull();
  });
  it('horizon içindeki tüm haftalar pasifse → null', () => {
    const pasif = ['2026-W30','2026-W31','2026-W32','2026-W33','2026-W34','2026-W35','2026-W36','2026-W37','2026-W38'];
    expect(nearestFutureActiveWeek(sb({ dayIndex: 4, pasifHaftalar: pasif }), NOW)).toBeNull();
  });
});

describe('classifyReservation', () => {
  it('studentId yok → none', () => {
    expect(classifyReservation(sb(), NOW)).toEqual({ action: 'none' });
  });
  it('studentId var + gelecek hafta bulunur → migrate (TEK-HAFTA; bookedBy=director bile RECURRING YAPMAZ)', () => {
    expect(classifyReservation(sb({ studentId: 's1', bookedBy: 'director' }), NOW))
      .toEqual({ action: 'migrate', weekKey: '2026-W31' });
  });
  it('studentId var + aktif hafta yok → unresolved', () => {
    const r = classifyReservation(sb({ studentId: 's1', aktif: false }), NOW);
    expect(r.action).toBe('unresolved');
    expect(r.reason).toContain('aktif');
  });
});
```

- [ ] **Step 2: Testlerin FAIL ettiğini doğrula**

Run: `npx vitest run scripts/etut-migration-lib.test.mjs`
Expected: FAIL — `Cannot find module './etut-migration-lib.mjs'`

- [ ] **Step 3: Kütüphaneyi yaz**

`scripts/etut-migration-lib.mjs`:

```js
// Etüt göçü saf yardımcıları (Faz 1). TSİ (+03) merkezli — spec §5/§7.
// lib/slots.ts slotStartTime + lib/constants.ts getWeekKey mantığının
// script-uyumlu (bağımsız .mjs) kopyası; birim testli (etut-migration-lib.test.mjs).

const TSI_OFFSET_MS = 3 * 60 * 60 * 1000;

// Verilen andaki TSİ tarihine göre ISO-8601 hafta anahtarı ("YYYY-Www").
export function isoWeekKeyTSI(date) {
  const t = new Date(date.getTime() + TSI_OFFSET_MS); // TSİ duvar saati, UTC alanlarında
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// weekKey'in Pazartesi'sinin TSİ takvim tarihi (UTC alanlarında gün/ay/yıl).
function mondayOfWeek(weekKey) {
  const [y, wStr] = weekKey.split('-W');
  const jan4 = new Date(Date.UTC(parseInt(y), 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (parseInt(wStr) - 1) * 7);
  return mon;
}

// Slotun mutlak başlangıç anı: weekKey + gün + "HH:MM" (TSİ) → Date (UTC instant).
export function slotStartTSI(weekKey, dayIndex, hhmm) {
  const mon = mondayOfWeek(weekKey);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(
    mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + dayIndex, hh, mm,
  ) - TSI_OFFSET_MS);
}

// lib/slots.ts:68-72 ile birebir aynı kural.
export function etutAktifThisWeek(sb, weekKey) {
  if (sb.aktif === false) return false;
  if (Array.isArray(sb.pasifHaftalar) && sb.pasifHaftalar.includes(weekKey)) return false;
  return true;
}

// Şablonun, başlangıcı now'dan SONRA olan en yakın AKTİF haftası (horizon hafta içinde).
export function nearestFutureActiveWeek(sb, now, horizon = 8) {
  const startWeek = isoWeekKeyTSI(now);
  let mon = mondayOfWeek(startWeek);
  for (let i = 0; i <= horizon; i++) {
    const wk = isoWeekKeyTSI(new Date(Date.UTC(
      mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + i * 7, 12, 0,
    ) - TSI_OFFSET_MS));
    if (etutAktifThisWeek(sb, wk) && slotStartTSI(wk, sb.dayIndex, sb.start).getTime() > now.getTime()) {
      return wk;
    }
  }
  return null;
}

// Göç kararı (spec §7): HERKES tek-hafta; gelecekte aktif hafta yoksa unresolved.
export function classifyReservation(sb, now) {
  if (!sb.studentId) return { action: 'none' };
  const weekKey = nearestFutureActiveWeek(sb, now);
  if (!weekKey) {
    return {
      action: 'unresolved',
      reason: `gelecekte aktif hafta bulunamadı (horizon 8; aktif=${sb.aktif !== false}, pasifHaftalar=${JSON.stringify(sb.pasifHaftalar || [])})`,
    };
  }
  return { action: 'migrate', weekKey };
}
```

- [ ] **Step 4: Testlerin PASS ettiğini doğrula**

Run: `npx vitest run scripts/etut-migration-lib.test.mjs`
Expected: 13 test PASS.

- [ ] **Step 5: Tüm test paketi hâlâ yeşil**

Run: `npm test`
Expected: tümü PASS (vitest scripts/*.test.mjs'i de toplar — toplamaya girmezse `npx vitest run scripts/` ile ayrıca koş; vitest config include'una `scripts/**/*.test.mjs` eklemek gerekirse ekle ve commit'e dahil et).

- [ ] **Step 6: Commit**

```bash
git add scripts/etut-migration-lib.mjs scripts/etut-migration-lib.test.mjs
git commit -m "feat(etüt-faz1): göç saf yardımcıları (TSİ hafta/slot hesabı + sınıflandırma) + 13 birim test"
```

---

### Task 3: Göç scripti (dry-run varsayılan, idempotent, raporlu)

**Files:**
- Create: `scripts/migrate-etut-to-tables.mjs`

**Interfaces:**
- Consumes: Task 2'nin 5 fonksiyonu; Task 1 Prisma modelleri.
- Produces: Çalıştırılabilir göç. `node scripts/migrate-etut-to-tables.mjs [--apply] [--org <slug>]`. Dry-run çıktısı: plan satırları + özet sayaçlar + unresolved listesi. Rapor JSON'u `scripts/backups/etut-migration-report-<ISO>.json`.

- [ ] **Step 1: Scripti yaz**

`scripts/migrate-etut-to-tables.mjs`:

```js
// Etüt göçü (Faz 1, spec §7): JSON etutSablonlari → EtutSablon + EtutReservation.
// - DRY-RUN varsayılan; yazmak için --apply. --org <slug> tek kuruma sınırlar.
// - İdempotent: EtutSablon upsert (id korunur); EtutReservation varsa ATLANIR + raporlanır.
// - JSON'A DOKUNMAZ (temizlik Faz 5 — cleanup-etut-json.mjs).
// Kullanım: set -a; source .env.local; set +a; node scripts/migrate-etut-to-tables.mjs [--apply] [--org akyazicozum]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';
import { classifyReservation } from './etut-migration-lib.mjs';

const APPLY = process.argv.includes('--apply');
const orgArg = process.argv.indexOf('--org');
const ORG = orgArg !== -1 ? process.argv[orgArg + 1] : null;
const p = new PrismaClient();
const now = new Date();

const report = {
  mode: APPLY ? 'APPLY' : 'DRY-RUN', startedAt: now.toISOString(), org: ORG || 'ALL',
  sablonUpserted: [], reservationCreated: [], reservationSkippedExisting: [],
  unresolved: [], teachersScanned: 0, invalidSablon: [],
};

const teachers = await p.teacher.findMany(ORG ? { where: { orgSlug: ORG } } : undefined);
for (const t of teachers) {
  report.teachersScanned++;
  const tpl = t.programTemplate;
  const list = Array.isArray(tpl?.etutSablonlari) ? tpl.etutSablonlari : [];
  for (const sb of list) {
    // Şablon doğrulaması — bozuk kayıt sessiz geçilmez.
    if (!sb.id || typeof sb.dayIndex !== 'number' || !sb.start || !sb.end) {
      report.invalidSablon.push({ org: t.orgSlug, teacher: t.name, sb });
      continue;
    }
    const sablonRow = {
      id: sb.id, orgSlug: t.orgSlug, branch: t.branch, teacherId: t.legacyId,
      dayIndex: sb.dayIndex, start: sb.start, end: sb.end,
      aktif: sb.aktif !== false,
      pasifHaftalar: Array.isArray(sb.pasifHaftalar) ? sb.pasifHaftalar : [],
    };
    report.sablonUpserted.push({ org: t.orgSlug, teacher: t.name, id: sb.id, gun: sb.dayIndex, saat: `${sb.start}-${sb.end}` });
    if (APPLY) {
      const { id, ...rest } = sablonRow;
      await p.etutSablon.upsert({ where: { id }, create: sablonRow, update: rest });
    }

    const cls = classifyReservation(sb, now);
    if (cls.action === 'none') continue;
    if (cls.action === 'unresolved') {
      report.unresolved.push({ org: t.orgSlug, teacher: t.name, sablonId: sb.id, student: sb.studentName || sb.studentId, reason: cls.reason });
      continue;
    }
    // migrate → tek-haftalık ACTIVE rezervasyon
    const resRow = {
      orgSlug: t.orgSlug, branch: t.branch, sablonId: sb.id, teacherId: t.legacyId,
      scope: 'WEEK', status: 'ACTIVE', weekKey: cls.weekKey,
      studentId: sb.studentId, studentName: sb.studentName || '',
      studentCls: sb.studentCls || '', dersBranch: sb.branch || '',
      bookedByRole: sb.bookedBy || 'unknown', bookedById: 'migration',
      bookedAt: sb.bookedAt ? new Date(sb.bookedAt) : now,
      dayIndex: sb.dayIndex, startsAt: sb.start, endsAt: sb.end,
    };
    const existing = await p.etutReservation.findFirst({
      where: { orgSlug: t.orgSlug, branch: t.branch, sablonId: sb.id, weekKey: cls.weekKey },
    });
    if (existing) {
      report.reservationSkippedExisting.push({ org: t.orgSlug, sablonId: sb.id, weekKey: cls.weekKey, existingStudent: existing.studentName });
      continue;
    }
    report.reservationCreated.push({ org: t.orgSlug, teacher: t.name, sablonId: sb.id, weekKey: cls.weekKey, student: resRow.studentName, ders: resRow.dersBranch, bookedBy: resRow.bookedByRole });
    if (APPLY) await p.etutReservation.create({ data: resRow });
  }
}

mkdirSync('scripts/backups', { recursive: true });
const reportPath = `scripts/backups/etut-migration-report-${now.toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n=== ETÜT GÖÇÜ ${report.mode} ===`);
console.log(`Öğretmen tarandı: ${report.teachersScanned}`);
console.log(`Şablon upsert: ${report.sablonUpserted.length}`);
console.log(`Rezervasyon oluşturuldu: ${report.reservationCreated.length}`);
for (const r of report.reservationCreated) console.log(`  → ${r.org} / ${r.teacher} / ${r.weekKey} / ${r.student} (${r.ders}) [bookedBy=${r.bookedBy}]`);
console.log(`Var olduğu için atlanan: ${report.reservationSkippedExisting.length}`);
console.log(`UNRESOLVED: ${report.unresolved.length}`);
for (const u of report.unresolved) console.log(`  !! ${u.org} / ${u.teacher} / ${u.student}: ${u.reason}`);
console.log(`Bozuk şablon: ${report.invalidSablon.length}`);
console.log(`Rapor: ${reportPath}`);
await p.$disconnect();
```

- [ ] **Step 2: Dry-run çalıştır (canlı DB, salt-okuma)**

Run: `set -a; source .env.local; set +a; node scripts/migrate-etut-to-tables.mjs`
Expected: `DRY-RUN` modu; akyazicozum için 57 şablon upsert planı (canlı sayım 2026-07-19: 13 öğretmen, 4+2+4+4+4+6+5+4+4+4+8+4+4); **2 rezervasyon** planı (İREM AĞIRMAN → MUSTAFA YANAR TYT Matematik; AHMET CEMAL BABİLOĞLU → NESLİHAN CEYLAN Biyoloji) — weekKey çalıştırma anına göre en yakın gelecek hafta; unresolved 0 beklenir. testkurs dahil diğer org'lar da listelenir.

- [ ] **Step 3: Çıktıyı canlı DB gerçeğiyle karşılaştır**

Şu tek seferlik kontrol scriptiyle (scratchpad'e yaz, commit ETME) JSON'daki studentId'li şablon sayısını say ve dry-run rapor sayılarıyla karşılaştır:

```js
// scratchpad/verify-migration-counts.mjs
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
let sablon = 0, rez = 0;
for (const t of await p.teacher.findMany()) {
  const list = Array.isArray(t.programTemplate?.etutSablonlari) ? t.programTemplate.etutSablonlari : [];
  sablon += list.length;
  rez += list.filter(s => s.studentId).length;
}
console.log({ sablonJSON: sablon, rezervasyonJSON: rez });
await p.$disconnect();
```

Expected: `sablonJSON` = rapor `sablonUpserted.length`; `rezervasyonJSON` = `reservationCreated + unresolved` toplamı.

- [ ] **Step 4: Commit (rapor/backup dizini hariç)**

```bash
echo "scripts/backups/" >> .gitignore
git add scripts/migrate-etut-to-tables.mjs .gitignore
git commit -m "feat(etüt-faz1): göç scripti — dry-run varsayılan, idempotent, unresolved raporlu

JSON'a dokunmaz (temizlik Faz 5). Dry-run canlıda doğrulandı: sayılar JSON ile birebir."
```

---

### Task 4: Yedek + temizlik + rollback scriptleri (YAZILIR, ÇALIŞTIRILMAZ)

**Files:**
- Create: `scripts/cleanup-etut-json.mjs`
- Create: `scripts/rollback-etut-json.mjs`

**Interfaces:**
- Produces: Faz 5 cutover'da kullanılacak: `cleanup-etut-json.mjs --apply` (önce tam yedek dosyası yazar, sonra JSON'dan `etutSablonlari` anahtarını siler), `rollback-etut-json.mjs <backupPath> --apply` (yedeği geri yükler). Faz 1'de YALNIZ dry-run test edilir.

- [ ] **Step 1: Temizlik scriptini yaz**

`scripts/cleanup-etut-json.mjs`:

```js
// FAZ 5 CUTOVER SONRASI çalıştırılır — Faz 1-4'te ASLA --apply ile ÇALIŞTIRMA.
// Önce TÜM programTemplate.etutSablonlari içeriğini yedek dosyasına yazar,
// sonra JSON'dan etutSablonlari anahtarını siler (grid şablonu programTemplate'te kalır).
// Kullanım: node scripts/cleanup-etut-json.mjs [--apply] [--org <slug>]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const orgArg = process.argv.indexOf('--org');
const ORG = orgArg !== -1 ? process.argv[orgArg + 1] : null;
const p = new PrismaClient();

const backup = [];
const teachers = await p.teacher.findMany(ORG ? { where: { orgSlug: ORG } } : undefined);
for (const t of teachers) {
  const tpl = t.programTemplate;
  if (!Array.isArray(tpl?.etutSablonlari) || tpl.etutSablonlari.length === 0) continue;
  backup.push({ teacherDbId: t.id, orgSlug: t.orgSlug, branch: t.branch, legacyId: t.legacyId, name: t.name, etutSablonlari: tpl.etutSablonlari });
}

mkdirSync('scripts/backups', { recursive: true });
const path = `scripts/backups/etut-json-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(path, JSON.stringify(backup, null, 2));
console.log(`Yedek: ${path} (${backup.length} öğretmen)`);

if (!APPLY) { console.log('DRY-RUN — JSON temizlenmedi. Temizlik için --apply.'); await p.$disconnect(); process.exit(0); }

for (const b of backup) {
  const t = await p.teacher.findUnique({ where: { id: b.teacherDbId } });
  const tpl = { ...t.programTemplate };
  delete tpl.etutSablonlari;
  await p.teacher.update({ where: { id: b.teacherDbId }, data: { programTemplate: tpl } });
  console.log(`Temizlendi: ${b.orgSlug} / ${b.name}`);
}
await p.$disconnect();
```

- [ ] **Step 2: Rollback scriptini yaz**

`scripts/rollback-etut-json.mjs`:

```js
// Cleanup yedeğini geri yükler: etutSablonlari anahtarını JSON'a geri yazar.
// Kullanım: node scripts/rollback-etut-json.mjs scripts/backups/etut-json-backup-<...>.json --apply
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const backupPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!backupPath) { console.error('Kullanım: node scripts/rollback-etut-json.mjs <backupPath> [--apply]'); process.exit(1); }
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const p = new PrismaClient();

for (const b of backup) {
  console.log(`${APPLY ? 'GERİ YÜKLENİYOR' : 'DRY-RUN'}: ${b.orgSlug} / ${b.name} (${b.etutSablonlari.length} şablon)`);
  if (!APPLY) continue;
  const t = await p.teacher.findUnique({ where: { id: b.teacherDbId } });
  await p.teacher.update({
    where: { id: b.teacherDbId },
    data: { programTemplate: { ...t.programTemplate, etutSablonlari: b.etutSablonlari } },
  });
}
console.log(`${backup.length} öğretmen işlendi (${APPLY ? 'APPLY' : 'dry-run'}).`);
await p.$disconnect();
```

- [ ] **Step 3: İkisini de dry-run test et (canlıya yazmadan)**

Run:
```bash
set -a; source .env.local; set +a
node scripts/cleanup-etut-json.mjs            # dry-run: yedek dosyası yazar, JSON'a dokunmaz
node scripts/rollback-etut-json.mjs scripts/backups/etut-json-backup-*.json  # dry-run: geri yükleme planını basar
```
Expected: cleanup → `Yedek: ... (N öğretmen)` + `DRY-RUN — JSON temizlenmedi`; rollback → her öğretmen için `DRY-RUN: ...` satırı, DB'ye yazma yok.

- [ ] **Step 4: Commit**

```bash
git add scripts/cleanup-etut-json.mjs scripts/rollback-etut-json.mjs
git commit -m "feat(etüt-faz1): JSON temizlik + rollback scriptleri (Faz 5 cutover için; dry-run doğrulandı)"
```

---

### Task 5: Göçü UYGULA (tablolara yaz — JSON hâlâ kaynak) + canlı doğrulama

**Files:** (yok — operasyon + doğrulama)

**Interfaces:**
- Produces: EtutSablon + EtutReservation tabloları DOLU (Faz 2 servis geliştirmesi gerçek veriye karşı test edilebilir). JSON değişmedi → prod davranışı aynen sürüyor; tablo-JSON arası tazelik Faz 5 cutover'ında final göç tekrarıyla (idempotent) kapatılır.

- [ ] **Step 1: Göçü uygula**

Run: `set -a; source .env.local; set +a; node scripts/migrate-etut-to-tables.mjs --apply`
Expected: dry-run'daki sayıların aynısı `APPLY` modunda; hata yok.

- [ ] **Step 2: Tabloları canlı sorguyla doğrula**

Scratchpad'e tek seferlik script (commit ETME):

```js
// scratchpad/verify-tables.mjs
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
console.log('EtutSablon:', await p.etutSablon.count());
console.log('EtutReservation:', await p.etutReservation.count());
const rez = await p.etutReservation.findMany({ include: { sablon: true } });
for (const r of rez) console.log(`  ${r.orgSlug} ${r.weekKey} ${r.studentName} (${r.dersBranch}) → sablon gün${r.sablon.dayIndex} ${r.sablon.start}`);
await p.$disconnect();
```

Expected: EtutSablon sayısı = dry-run raporu; EtutReservation = 2 (İrem + Ahmet, en yakın gelecek hafta); her rezervasyonun `sablon` ilişkisi çözülüyor (FK sağlam).

- [ ] **Step 3: İdempotency provası — scripti İKİNCİ kez apply ile koş**

Run: `node scripts/migrate-etut-to-tables.mjs --apply`
Expected: `Rezervasyon oluşturuldu: 0`, `Var olduğu için atlanan: 2` — çift kayıt YOK.

- [ ] **Step 4: Build + tüm testler son kontrol**

Run: `npm run build && npm test`
Expected: yeşil.

- [ ] **Step 5: Faz 1 kapanış commit'i (dokümantasyon)**

`docs/superpowers/plans/2026-07-20-etut-hafta-bazli-faz1.md` içindeki tüm checkbox'ları işaretle, sonra:

```bash
git add docs/superpowers/plans/2026-07-20-etut-hafta-bazli-faz1.md
git commit -m "docs(etüt-faz1): Faz 1 tamamlandı — şema + göç canlıda doğrulandı (idempotency provası dahil)"
```

---

## Faz 1 Bitiş Kriterleri (hepsi sağlanmalı)

1. `etut-hafta-bazli` dalında; main'e push YOK.
2. İki yeni tablo + SlotBooking snapshot kolonları canlı DB'de; `npx prisma validate` + build + testler yeşil.
3. Göç saf mantığı 12 birim testle yeşil; script dry-run sayıları JSON gerçeğiyle birebir.
4. `--apply` sonrası tablolar dolu; FK ilişkileri çözülüyor; ikinci apply 0 yeni satır (idempotent).
5. JSON'a hiç dokunulmadı (cleanup/rollback yalnız dry-run test edildi).
6. Unresolved listesi boş VEYA raporlanıp Mustafa'ya sunuldu.
7. Spec §11 kontrolü: `app/api/cron/weekly/route.ts` + `app/api/admin/week/route.ts` OKUNDU, `currentWeek` ilerletme semantiği not edildi — Faz 2 `allowedBookingWeeks` tasarımı cron'a değil TSİ tarih hesabına dayanacak; cron'un Pazar davranışıyla çelişki var mı raporlandı.
8. Faz 1 sonu çok-model doğrulaması: Codex + Gemini'ye "Faz 1 diff'ini denetle" (şema + scriptler) — bulgular temizlenmeden Faz 2'ye geçilmez.

## Sonraki Fazlar (ayrı plan dosyaları — bu planda DEĞİL)

- Faz 2: `lib/etut/booking.ts` birleşik servis (plan: Faz 1 bitince yazılır — gerçek tablo durumuna göre)
- Faz 3: okuma yolları effectiveReservation'a
- Faz 4: görünürlük + geçmiş + attendance + sessiz-hata
- Faz 5: cutover (final göç tekrarı + JSON cleanup + main merge + canlı doğrulama)
