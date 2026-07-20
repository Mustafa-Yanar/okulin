# Etüt Hafta-Bazlı Rezervasyon — Faz 2a: Kural Çekirdeği + Veri Katmanı — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Birleşik rezervasyon servisinin (Faz 2b `bookEtut`) ihtiyaç duyduğu saf kural yardımcılarını (hafta penceresi, interval çakışma, düzey havuzu) ve EtutReservation veri katmanını (effective çözümü, tek-satır upsert, tombstone, advisory lock) birim testli olarak kur. **Route/davranış değişikliği YOK** — bu faz lib-only; uygulama aynen çalışmaya devam eder.

**Architecture:** Her kural ayrı, odaklı bir `lib/etut/*.ts` dosyasında; saf fonksiyonlar `now`/veri parametreli (test edilebilir), DB erişimi ince sarmalayıcılarda. TSİ (+03) hesapları sunucu-UTC'den bağımsız (mevcut `getWeekKey` sunucu-yerel çalışır ve Vercel'de Pzt 00:00-03:00 TSİ arası yanlış hafta verir — bu fazda TSİ-doğru varyant eklenir, mevcut fonksiyona DOKUNULMAZ).

**Tech Stack:** TypeScript strict (lib/ %100 TS), vitest, Prisma client (Faz 1 şeması: EtutSablon/EtutReservation/EtutScope/EtutStatus).

**Spec:** `docs/superpowers/specs/2026-07-19-etut-hafta-bazli-rezervasyon-design.md` §3.3 (upsert stratejisi), §4a (düzey havuzu), §5 (Pazar 11:00 penceresi)

## Global Constraints

- Dal: `etut-hafta-bazli`; main'e push YOK.
- **Route dosyalarına ve mevcut lib fonksiyonlarına dokunma** (getWeekKey/slotStartTime/etutAktifThisWeek aynen kalır) — yalnız YENİ dosyalar + `scripts/etut-migration-lib.mjs`'de tek regex sıkılaştırması.
- Pencere kuralı: student/teacher = `{cur} + {next EĞER TSİ Pazar ≥ 11:00}`; director/counselor = `{cur, +1, +2}`. Pazar açılma saati **11:00 TSİ** (Mustafa kararı, haftalık cron ile hizalı).
- Tek-satır upsert: `(sablonId, weekKey)` başına EN FAZLA 1 satır; yeniden rezervasyon = UPDATE (status→ACTIVE, cancelled* temizlenir). RECURRING: `weekKey='*'` + `effectiveFromWeek`.
- TDD: her task test-önce. Commit öncesi `npm run build` + `npm test` yeşil. Commit mesajları Türkçe.
- Tenant: veri katmanı fonksiyonları `orgSlug`/`branch`'i AÇIK parametre alır (compound-unique where'lerde `tdb()` $extends enjeksiyonuna GÜVENİLMEZ — Task 4 Step 0'da doğrulanır).

---

### Task 1: `lib/etut/weeks.ts` — TSİ hafta penceresi

**Files:**
- Create: `lib/etut/weeks.ts`
- Test: `lib/etut/weeks.test.ts`

**Interfaces:**
- Produces (Faz 2b kullanır): `currentWeekKeyTSI(now?: Date): string`, `shiftWeekKey(weekKey: string, delta: number): string`, `allowedBookingWeeks(role: BookingRole, now?: Date): string[]`, `type BookingRole = 'student' | 'teacher' | 'director' | 'counselor'`, `SUNDAY_OPEN_MINUTES = 660`.

- [ ] **Step 1: Failing testleri yaz** (`lib/etut/weeks.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { currentWeekKeyTSI, shiftWeekKey, allowedBookingWeeks } from './weeks';

// Referans: Pzt 20 Tem 2026 = 2026-W30 başlangıcı; Pazar 19 Tem = W29'un son günü.
describe('currentWeekKeyTSI — sunucu-UTC bağımsız TSİ haftası', () => {
  it('Çarşamba 22 Tem 10:00 TSİ → W30', () => {
    expect(currentWeekKeyTSI(new Date('2026-07-22T10:00:00+03:00'))).toBe('2026-W30');
  });
  it('Pazar 19 Tem 16:00 TSİ → W29 (Pazar haftanın SON günü)', () => {
    expect(currentWeekKeyTSI(new Date('2026-07-19T16:00:00+03:00'))).toBe('2026-W29');
  });
  it('KRİTİK sınır: Pzt 00:30 TSİ = Pazar 21:30 UTC → YENİ hafta W30 (sunucu-yerel getWeekKey burada yanılır)', () => {
    expect(currentWeekKeyTSI(new Date('2026-07-20T00:30:00+03:00'))).toBe('2026-W30');
  });
});

describe('shiftWeekKey', () => {
  it('W30 +1 → W31; W30 -1 → W29', () => {
    expect(shiftWeekKey('2026-W30', 1)).toBe('2026-W31');
    expect(shiftWeekKey('2026-W30', -1)).toBe('2026-W29');
  });
  it('yıl sınırı: 2026-W53 +1 → 2027-W01', () => {
    expect(shiftWeekKey('2026-W53', 1)).toBe('2027-W01');
  });
});

describe('allowedBookingWeeks — Pazar 11:00 TSİ açılma kuralı', () => {
  it('öğrenci, Çarşamba → sadece bu hafta', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-22T10:00:00+03:00'))).toEqual(['2026-W30']);
  });
  it('öğrenci, Pazar 10:59 TSİ → sonraki hafta HENÜZ KAPALI', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-19T10:59:00+03:00'))).toEqual(['2026-W29']);
  });
  it('öğrenci, Pazar 11:00 TSİ → sonraki hafta AÇILDI', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-19T11:00:00+03:00'))).toEqual(['2026-W29', '2026-W30']);
  });
  it('öğrenci, Pazar 23:30 → hâlâ açık', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-19T23:30:00+03:00'))).toEqual(['2026-W29', '2026-W30']);
  });
  it('öğrenci, Pzt 00:30 TSİ → pencere yeni haftaya SIFIRLANDI (tek hafta)', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-20T00:30:00+03:00'))).toEqual(['2026-W30']);
  });
  it('öğretmen = öğrenciyle aynı pencere', () => {
    expect(allowedBookingWeeks('teacher', new Date('2026-07-19T11:00:00+03:00'))).toEqual(['2026-W29', '2026-W30']);
  });
  it('müdür/rehber → cur..+2 (saatten bağımsız)', () => {
    expect(allowedBookingWeeks('director', new Date('2026-07-22T10:00:00+03:00'))).toEqual(['2026-W30', '2026-W31', '2026-W32']);
    expect(allowedBookingWeeks('counselor', new Date('2026-07-22T10:00:00+03:00'))).toEqual(['2026-W30', '2026-W31', '2026-W32']);
  });
});
```

- [ ] **Step 2: FAIL doğrula** — Run: `npx vitest run lib/etut/weeks.test.ts` → Expected: FAIL (module not found)

- [ ] **Step 3: Implementasyon** (`lib/etut/weeks.ts`)

```ts
// TSİ (+03) hafta penceresi — birleşik rezervasyon servisi (Faz 2b bookEtut) için.
// DİKKAT: lib/constants getWeekKey SUNUCU-YEREL saat kullanır (Vercel=UTC) →
// Pzt 00:00-03:00 TSİ arasında YANLIŞ (önceki) hafta döndürür. Rezervasyon pencere
// kuralı bu yüzden buradaki TSİ-doğru hesabı kullanır; getWeekKey'e DOKUNULMAZ
// (mevcut çağıranların davranışı korunur — onların göçü ayrı iş).

const TSI_OFFSET_MS = 3 * 60 * 60 * 1000;

export type BookingRole = 'student' | 'teacher' | 'director' | 'counselor';

// Sonraki haftanın öğrenci/öğretmene açıldığı an: Pazar 11:00 TSİ
// (Mustafa kararı 2026-07-20 — haftalık cron "0 8 * * 0" UTC = Pazar 11:00 TSİ ile hizalı).
export const SUNDAY_OPEN_MINUTES = 11 * 60;

// TSİ duvar-saati parçaları (UTC alanlarında okunur — sunucu saat diliminden bağımsız).
function tsiParts(now: Date): { dow: number; minutes: number } {
  const t = new Date(now.getTime() + TSI_OFFSET_MS);
  return { dow: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() }; // dow: 0=Pazar
}

// TSİ'ye göre ISO-8601 hafta anahtarı ("YYYY-Www").
export function currentWeekKeyTSI(now: Date = new Date()): string {
  const t = new Date(now.getTime() + TSI_OFFSET_MS);
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// weekKey'i delta hafta kaydır (ISO-doğru, yıl sınırı dahil).
export function shiftWeekKey(weekKey: string, delta: number): string {
  const [y, wStr] = weekKey.split('-W');
  const jan4 = new Date(Date.UTC(parseInt(y), 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (parseInt(wStr) - 1 + delta) * 7);
  // Pazartesi 12:00 TSİ anı üzerinden anahtar üret (gün kayması riski yok)
  return currentWeekKeyTSI(new Date(mon.getTime() + 12 * 60 * 60 * 1000 - TSI_OFFSET_MS));
}

// Rolün REZERVASYON YAZABİLECEĞİ haftalar (spec §5). Görüntüleme serbest — bu yazma kapısı.
export function allowedBookingWeeks(role: BookingRole, now: Date = new Date()): string[] {
  const cur = currentWeekKeyTSI(now);
  if (role === 'director' || role === 'counselor') {
    return [cur, shiftWeekKey(cur, 1), shiftWeekKey(cur, 2)];
  }
  const { dow, minutes } = tsiParts(now);
  const nextOpen = dow === 0 && minutes >= SUNDAY_OPEN_MINUTES;
  return nextOpen ? [cur, shiftWeekKey(cur, 1)] : [cur];
}
```

- [ ] **Step 4: PASS doğrula** — Run: `npx vitest run lib/etut/weeks.test.ts` → Expected: 11 test PASS
- [ ] **Step 5: Commit**

```bash
git add lib/etut/weeks.ts lib/etut/weeks.test.ts
git commit -m "feat(etüt-faz2a): TSİ hafta penceresi — allowedBookingWeeks (Pazar 11:00 açılma kuralı) + 11 test"
```

---

### Task 2: `lib/etut/overlap.ts` — interval çakışma matematiği

**Files:**
- Create: `lib/etut/overlap.ts`
- Test: `lib/etut/overlap.test.ts`

**Interfaces:**
- Produces (Faz 2b): `toMin(hhmm: string): number`, `intervalsOverlap(aStart, aEnd, bStart, bEnd: number): boolean`, `interface NormalizedBooking { dayIndex: number; startMin: number; endMin: number; dersBranch: string | null; source: 'slot' | 'etut' }`, `findTimeConflict(list: NormalizedBooking[], cand: Pick<NormalizedBooking,'dayIndex'|'startMin'|'endMin'>): NormalizedBooking | null`.

- [ ] **Step 1: Failing testleri yaz** (`lib/etut/overlap.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { toMin, intervalsOverlap, findTimeConflict, type NormalizedBooking } from './overlap';

describe('toMin', () => {
  it('"15:30" → 930; "00:00" → 0', () => {
    expect(toMin('15:30')).toBe(930);
    expect(toMin('00:00')).toBe(0);
  });
});

describe('intervalsOverlap — yarı-açık [start, end)', () => {
  it('kısmi örtüşme → true (14:00-15:00 vs 14:30-15:30)', () => {
    expect(intervalsOverlap(840, 900, 870, 930)).toBe(true);
  });
  it('bitişik → false (14:00-15:00 vs 15:00-16:00)', () => {
    expect(intervalsOverlap(840, 900, 900, 960)).toBe(false);
  });
  it('içerme → true (14:00-16:00 vs 14:30-15:00)', () => {
    expect(intervalsOverlap(840, 960, 870, 900)).toBe(true);
  });
  it('ayrık → false', () => {
    expect(intervalsOverlap(840, 900, 960, 1020)).toBe(false);
  });
});

describe('findTimeConflict', () => {
  const mk = (d: number, s: string, e: string, src: 'slot' | 'etut' = 'etut'): NormalizedBooking =>
    ({ dayIndex: d, startMin: toMin(s), endMin: toMin(e), dersBranch: 'Fizik', source: src });
  it('aynı gün örtüşen → çakışan kaydı döner', () => {
    const hit = findTimeConflict([mk(2, '14:00', '15:00', 'slot')], { dayIndex: 2, startMin: toMin('14:30'), endMin: toMin('15:30') });
    expect(hit?.source).toBe('slot');
  });
  it('farklı gün → null', () => {
    expect(findTimeConflict([mk(3, '14:00', '15:00')], { dayIndex: 2, startMin: 870, endMin: 930 })).toBeNull();
  });
  it('aynı gün bitişik → null', () => {
    expect(findTimeConflict([mk(2, '14:00', '15:00')], { dayIndex: 2, startMin: toMin('15:00'), endMin: toMin('16:00') })).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL doğrula** — `npx vitest run lib/etut/overlap.test.ts` → module not found
- [ ] **Step 3: Implementasyon** (`lib/etut/overlap.ts`)

```ts
// Interval çakışma matematiği — çapraz-sistem (SlotBooking + EtutReservation) denetimi
// için ORTAK normalizasyon (spec §4). String saat eşitliği YETMEZ (Gemini/Codex denetimi):
// "9:00" vs "09:00" ve kısmi örtüşme ancak dakikaya çevirip yarı-açık aralıkla yakalanır.

export interface NormalizedBooking {
  dayIndex: number;
  startMin: number;
  endMin: number;
  dersBranch: string | null;
  source: 'slot' | 'etut';
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Yarı-açık [start, end): 14:00-15:00 ile 15:00-16:00 ÇAKIŞMAZ.
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Adayla aynı GÜN + saat örtüşmesi olan ilk kaydı döner (hata mesajında kaynak gösterilir).
export function findTimeConflict(
  list: NormalizedBooking[],
  cand: Pick<NormalizedBooking, 'dayIndex' | 'startMin' | 'endMin'>,
): NormalizedBooking | null {
  for (const b of list) {
    if (b.dayIndex === cand.dayIndex && intervalsOverlap(b.startMin, b.endMin, cand.startMin, cand.endMin)) return b;
  }
  return null;
}
```

- [ ] **Step 4: PASS doğrula** — 9 test PASS
- [ ] **Step 5: Commit**

```bash
git add lib/etut/overlap.ts lib/etut/overlap.test.ts
git commit -m "feat(etüt-faz2a): interval çakışma matematiği — yarı-açık aralık + normalize kayıt tipi + 9 test"
```

---

### Task 3: `lib/etut/level-pool.ts` — düzey ders havuzu (§4a) + HH:MM sıkılaştırma

**Files:**
- Create: `lib/etut/level-pool.ts`
- Test: `lib/etut/level-pool.test.ts`
- Modify: `scripts/etut-migration-lib.mjs` (yalnız HHMM regex) + `scripts/etut-migration-lib.test.mjs` (1 test)

**Interfaces:**
- Produces (Faz 2b): `levelPoolFrom(classes: LevelClass[], group: string): string[]` (saf), `levelPoolForGroup(group: string): Promise<string[]>` (getClasses sarmalayıcı), `interface LevelClass { group: string; dersler: string[] }`.

- [ ] **Step 1: Failing testleri yaz** (`lib/etut/level-pool.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { levelPoolFrom } from './level-pool';

const REG = [
  { group: 'lise', dersler: ['TYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji', 'AYT Matematik', 'paragraf'] }, // 401
  { group: 'lise', dersler: ['Türkçe', 'TYT Matematik', 'Geometri', 'Tarih', 'Coğrafya', 'AYT Matematik', 'paragraf'] }, // 406
  { group: 'ortaokul', dersler: ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'] }, // 801
];

describe('levelPoolFrom — düzey havuzu (§4a)', () => {
  it('lise havuzu = lise sınıflarının BİRLEŞİMİ (sınıf-dışı ders dahil: 401 öğrencisi Tarih alabilir)', () => {
    const pool = levelPoolFrom(REG, 'lise');
    expect(pool).toContain('Fizik');
    expect(pool).toContain('Tarih'); // 401'in listesinde yok ama 406'da var → havuzda
    expect(pool).not.toContain('İnkılap Tarihi'); // yalnız ortaokul → lise ALAMAZ
  });
  it('ortaokul havuzunda Fizik YOK (yalnız lise dersi)', () => {
    expect(levelPoolFrom(REG, 'ortaokul')).not.toContain('Fizik');
    expect(levelPoolFrom(REG, 'ortaokul')).toContain('İnkılap Tarihi');
  });
  it('registry o grupta boşsa → COL_COURSES fallback birleşimi', () => {
    const pool = levelPoolFrom([], 'lise');
    expect(pool).toContain('Fizik'); // Lise Ortak_9
    expect(pool).toContain('TYT Matematik'); // Lise Sayısal_12
    expect(pool).not.toContain('İnkılap Tarihi');
  });
  it('mezun fallback → Mezun sütunları', () => {
    expect(levelPoolFrom([], 'mezun').length).toBeGreaterThan(0);
  });
  it('grup sınıfları var ama hepsinin dersler listesi boş → fallback', () => {
    expect(levelPoolFrom([{ group: 'lise', dersler: [] }], 'lise')).toContain('Fizik');
  });
  it('tekrarlar tekilleştirilir', () => {
    const pool = levelPoolFrom(REG, 'lise');
    expect(pool.filter((d) => d === 'TYT Matematik').length).toBe(1);
  });
});
```

- [ ] **Step 2: FAIL doğrula**
- [ ] **Step 3: Implementasyon** (`lib/etut/level-pool.ts`)

```ts
// Düzey (grup) ders havuzu — spec §4a: öğrenci kendi SINIF listesiyle sınırlı değil,
// kendi DÜZEYİNDEKİ (ortaokul/lise/mezun) tüm derslerden etüt alabilir (Mustafa kararı
// 2026-07-20: lise öğrencisi İnkılap alamaz, ortaokul Fizik alamaz; sınıf-dışı düzey
// dersi ALABİLİR). Grup-bazlı olduğu için s_UUID sınıf-kodu tuzağı burada YOKTUR
// (cls hiç parse edilmez — rehberlik-konu-takibi-fix kuralı).
import { COL_COURSES } from '@/lib/constants';
import { getClasses } from '@/lib/classes';

export interface LevelClass { group: string; dersler: string[] }

// Registry yoksa/boşsa kullanılacak COL_COURSES sütun grupları.
const FALLBACK_KEYS: Record<string, string[]> = {
  ortaokul: ['Ortaokul_7', 'Ortaokul_8'],
  lise: ['Lise Ortak_9', 'Lise Ortak_10', 'Lise Sayısal_11', 'Lise Eşit Ağırlık_11', 'Lise Sayısal_12', 'Lise Eşit Ağırlık_12'],
  mezun: ['Mezun Sayısal', 'Mezun Eşit Ağırlık'],
};

// Saf çekirdek: o gruptaki sınıfların dersler birleşimi; hiç ders çıkmazsa constants fallback.
export function levelPoolFrom(classes: LevelClass[], group: string): string[] {
  const set = new Set<string>();
  for (const c of classes) {
    if (c.group !== group) continue;
    for (const d of c.dersler || []) set.add(d);
  }
  if (set.size === 0) {
    for (const key of FALLBACK_KEYS[group] || []) {
      for (const d of COL_COURSES[key] || []) set.add(d);
    }
  }
  return Array.from(set);
}

// DB sarmalayıcı (tenant-scoped getClasses üzerinden).
export async function levelPoolForGroup(group: string): Promise<string[]> {
  const classes = await getClasses();
  return levelPoolFrom(classes.map((c) => ({ group: c.group, dersler: c.dersler })), group);
}
```

- [ ] **Step 4: HH:MM regex sıkılaştırma** — `scripts/etut-migration-lib.mjs` içindeki `validateSablon`'da `const HHMM = /^\d{2}:\d{2}$/;` satırını `const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;` yap. `scripts/etut-migration-lib.test.mjs`'e 1 test ekle: `validateSablon({...valid, start: '25:99'})` → `ok: false`.
- [ ] **Step 5: PASS doğrula** — Run: `npx vitest run lib/etut/level-pool.test.ts scripts/etut-migration-lib.test.mjs` → 6 + 20 PASS
- [ ] **Step 6: Commit**

```bash
git add lib/etut/level-pool.ts lib/etut/level-pool.test.ts scripts/etut-migration-lib.mjs scripts/etut-migration-lib.test.mjs
git commit -m "feat(etüt-faz2a): düzey ders havuzu (§4a levelPool) + HH:MM saat-aralığı sıkılaştırması + 7 test"
```

---

### Task 4: `lib/etut/reservations.ts` — veri katmanı (effective + upsert + tombstone + lock)

**Files:**
- Create: `lib/etut/reservations.ts`
- Test: `lib/etut/reservations.test.ts` (yalnız saf `resolveEffective`)

**Interfaces:**
- Produces (Faz 2b): `RECURRING_WEEKKEY = '*'`, `resolveEffective(rows, weekKey): Map<string, EtutReservation>` (saf), `getWeekReservations(db, weekKey)`, `upsertWeekReservation(db, input)`, `upsertRecurring(db, input)`, `cancelToTombstone(db, input)`, `lockStudentWeek(tx, orgSlug, studentId, weekKey)`.
- Consumes: Prisma client tipleri (`EtutReservation`, `$Enums.EtutScope/EtutStatus`).

- [ ] **Step 0: Tenant deseni doğrula (kod yazmadan)** — `lib/sqldb.ts`'i OKU: `tdb()` $extends'i compound-unique `where` içine orgSlug/branch enjekte EDİYOR MU? (Büyük olasılıkla yalnız üst-düzey filter/data enjeksiyonu.) Ayrıca aktif tenant'ın koddan nasıl okunduğunu bul (`lib/tenant` içinde `getTenant()`/eşdeğeri). Bulguyu rapora yaz; aşağıdaki fonksiyonlar orgSlug/branch'i AÇIK parametre aldığından tasarım her iki durumda da güvenli — ama upsert `where`'inde tenant alanlarını SEN açık geçeceksin. Belirsizlik çözülemezse NEEDS_CONTEXT raporla.

- [ ] **Step 1: Failing testleri yaz** (`lib/etut/reservations.test.ts` — saf çözümleyici)

```ts
import { describe, it, expect } from 'vitest';
import { resolveEffective, RECURRING_WEEKKEY } from './reservations';
import type { EtutReservation } from '@prisma/client';

// Test satırı üreticisi — yalnız çözümleyicinin okuduğu alanlar anlamlı.
const row = (over: Partial<EtutReservation>): EtutReservation => ({
  id: 'r1', orgSlug: 'o', branch: 'main', sablonId: 's1', teacherId: 't1',
  scope: 'WEEK', status: 'ACTIVE', weekKey: '2026-W30', effectiveFromWeek: null,
  studentId: 'st1', studentName: 'Öğrenci', studentCls: 'c1', dersBranch: 'Fizik',
  bookedByRole: 'student', bookedById: 'st1', bookedAt: new Date(0),
  cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  dayIndex: 0, startsAt: '15:30', endsAt: '16:00', createdAt: new Date(0), updatedAt: new Date(0),
  ...over,
} as EtutReservation);

describe('resolveEffective — WEEK önceliği + tombstone + recurring (spec §3.3)', () => {
  it('yalnız WEEK ACTIVE → o satır', () => {
    const m = resolveEffective([row({})], '2026-W30');
    expect(m.get('s1')?.studentId).toBe('st1');
  });
  it('WEEK CANCELLED (tombstone) → hafta BOŞ (recurring olsa bile)', () => {
    const rec = row({ id: 'r2', scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', studentId: 'st2' });
    const tomb = row({ status: 'CANCELLED' });
    expect(resolveEffective([rec, tomb], '2026-W30').has('s1')).toBe(false);
  });
  it('WEEK ACTIVE recurring\'i EZER (override)', () => {
    const rec = row({ id: 'r2', scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', studentId: 'st2' });
    const wk = row({ studentId: 'st3' });
    expect(resolveEffective([rec, wk], '2026-W30').get('s1')?.studentId).toBe('st3');
  });
  it('yalnız RECURRING ACTIVE + effectiveFromWeek <= hafta → recurring', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', studentId: 'st2' });
    expect(resolveEffective([rec], '2026-W30').get('s1')?.studentId).toBe('st2');
  });
  it('RECURRING effectiveFromWeek İLERİDE → henüz görünmez', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W32' });
    expect(resolveEffective([rec], '2026-W30').has('s1')).toBe(false);
  });
  it('RECURRING CANCELLED → görünmez', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', status: 'CANCELLED' });
    expect(resolveEffective([rec], '2026-W30').has('s1')).toBe(false);
  });
  it('farklı sablonlar bağımsız çözülür', () => {
    const a = row({}); const b = row({ id: 'r2', sablonId: 's2', studentId: 'st9' });
    const m = resolveEffective([a, b], '2026-W30');
    expect(m.get('s2')?.studentId).toBe('st9');
  });
  it('hafta anahtarı string karşılaştırması ISO formatta güvenli (W09 < W10)', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W09' });
    expect(resolveEffective([rec], '2026-W10').has('s1')).toBe(true);
  });
});
```

- [ ] **Step 2: FAIL doğrula**
- [ ] **Step 3: Implementasyon** (`lib/etut/reservations.ts`)

```ts
// EtutReservation veri katmanı (spec §3.2/§3.3). İş kuralları BURADA DEĞİL —
// Faz 2b bookEtut komut servisi kuralları uygular, buradaki fonksiyonlar yalnız
// tutarlı okuma/yazma sağlar. Tek-satır upsert stratejisi: (sablonId, weekKey)
// başına en fazla 1 satır; yeniden rezervasyon UPDATE'tir (unique ihlali imkansız);
// tam tarihçe AuditLog'a yazılır (Faz 2b).
import { tdb } from '@/lib/sqldb';
import type { EtutReservation, Prisma } from '@prisma/client';

export const RECURRING_WEEKKEY = '*';

type Db = ReturnType<typeof tdb> | Prisma.TransactionClient;

// Saf çözümleyici: sablonId → o haftanın EFEKTİF rezervasyonu.
// WEEK satırı recurring'i EZER; CANCELLED WEEK = tombstone (hafta boş);
// RECURRING yalnız ACTIVE + effectiveFromWeek <= weekKey iken görünür.
// ISO "YYYY-Www" (W her zaman 2 hane) string sıralaması kronolojiyle uyumludur.
export function resolveEffective(rows: EtutReservation[], weekKey: string): Map<string, EtutReservation> {
  const out = new Map<string, EtutReservation>();
  const tombstoned = new Set<string>();
  for (const r of rows) {
    if (r.weekKey !== weekKey) continue; // önce gerçek-hafta satırları
    if (r.status === 'ACTIVE') out.set(r.sablonId, r);
    else tombstoned.add(r.sablonId);
  }
  for (const r of rows) {
    if (r.weekKey !== RECURRING_WEEKKEY || r.scope !== 'RECURRING') continue;
    if (out.has(r.sablonId) || tombstoned.has(r.sablonId)) continue;
    if (r.status !== 'ACTIVE') continue;
    if (!r.effectiveFromWeek || r.effectiveFromWeek > weekKey) continue;
    out.set(r.sablonId, r);
  }
  return out;
}

// Bir haftanın TÜM ilgili satırları (o hafta + recurring) — tek sorgu (N+1 yok).
export async function getWeekReservations(db: Db, weekKey: string): Promise<EtutReservation[]> {
  return (db as ReturnType<typeof tdb>).etutReservation.findMany({
    where: { OR: [{ weekKey }, { weekKey: RECURRING_WEEKKEY }] },
  });
}

export interface ReservationWrite {
  orgSlug: string; branch: string;
  sablonId: string; teacherId: string;
  studentId: string; studentName: string; studentCls: string; dersBranch: string;
  bookedByRole: string; bookedById: string;
  dayIndex: number; startsAt: string; endsAt: string;
}

// Tek-haftalık rezervasyon — UPSERT: mevcut satır (ACTIVE veya CANCELLED tombstone)
// yeni öğrenciyle ACTIVE'e çevrilir; cancelled* alanları temizlenir.
export async function upsertWeekReservation(db: Db, weekKey: string, w: ReservationWrite): Promise<EtutReservation> {
  const data = {
    ...w, scope: 'WEEK' as const, status: 'ACTIVE' as const, weekKey,
    effectiveFromWeek: null, bookedAt: new Date(),
    cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  };
  return (db as ReturnType<typeof tdb>).etutReservation.upsert({
    where: { orgSlug_branch_sablonId_weekKey: { orgSlug: w.orgSlug, branch: w.branch, sablonId: w.sablonId, weekKey } },
    create: data,
    update: data,
  });
}

// Tekrarlayan rezervasyon (yalnız müdür/rehber — yetki Faz 2b'de) — '*' satırı upsert.
export async function upsertRecurring(db: Db, effectiveFromWeek: string, w: ReservationWrite): Promise<EtutReservation> {
  const data = {
    ...w, scope: 'RECURRING' as const, status: 'ACTIVE' as const, weekKey: RECURRING_WEEKKEY,
    effectiveFromWeek, bookedAt: new Date(),
    cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  };
  return (db as ReturnType<typeof tdb>).etutReservation.upsert({
    where: { orgSlug_branch_sablonId_weekKey: { orgSlug: w.orgSlug, branch: w.branch, sablonId: w.sablonId, weekKey: RECURRING_WEEKKEY } },
    create: data,
    update: data,
  });
}

export interface CancelInput {
  orgSlug: string; branch: string; sablonId: string; teacherId: string;
  weekKey: string; // iptal edilen HAFTA ('*' değil — recurring'in tümden iptali ayrı: cancelRecurring)
  cancelledByRole: string; cancelledById: string; cancelReason?: string;
  // Tombstone YARATILACAKSA (recurring'in tek haftası iptal ediliyorsa) zorunlu snapshot:
  snapshot: { studentId: string; studentName: string; studentCls: string; dersBranch: string; dayIndex: number; startsAt: string; endsAt: string };
}

// Haftayı iptal et: WEEK satır varsa CANCELLED'a çevir; yoksa (efektif kaynak recurring'di)
// CANCELLED WEEK tombstone YARAT — o hafta boş görünür, diğer haftalar etkilenmez.
export async function cancelToTombstone(db: Db, c: CancelInput): Promise<EtutReservation> {
  const cancelFields = {
    status: 'CANCELLED' as const,
    cancelledByRole: c.cancelledByRole, cancelledById: c.cancelledById,
    cancelledAt: new Date(), cancelReason: c.cancelReason ?? null,
  };
  return (db as ReturnType<typeof tdb>).etutReservation.upsert({
    where: { orgSlug_branch_sablonId_weekKey: { orgSlug: c.orgSlug, branch: c.branch, sablonId: c.sablonId, weekKey: c.weekKey } },
    create: {
      orgSlug: c.orgSlug, branch: c.branch, sablonId: c.sablonId, teacherId: c.teacherId,
      scope: 'WEEK', weekKey: c.weekKey, effectiveFromWeek: null,
      ...c.snapshot, bookedByRole: c.cancelledByRole, bookedById: c.cancelledById,
      ...cancelFields,
    },
    update: cancelFields,
  });
}

// Recurring'i TÜMDEN iptal et ('*' satırı CANCELLED) — yalnız müdür/rehber (Faz 2b).
export async function cancelRecurring(db: Db, orgSlug: string, branch: string, sablonId: string, by: { role: string; id: string; reason?: string }): Promise<void> {
  await (db as ReturnType<typeof tdb>).etutReservation.updateMany({
    where: { orgSlug, branch, sablonId, weekKey: RECURRING_WEEKKEY },
    data: { status: 'CANCELLED', cancelledByRole: by.role, cancelledById: by.id, cancelledAt: new Date(), cancelReason: by.reason ?? null },
  });
}

// Öğrenci+hafta advisory lock — çapraz-sistem (SlotBooking+EtutReservation) limit/çakışma
// yarışını önler (Gemini denetimi). Transaction içinde çağrılır; tx bitince otomatik bırakılır.
export async function lockStudentWeek(tx: Prisma.TransactionClient, orgSlug: string, studentId: string, weekKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgSlug}:${studentId}:${weekKey}`}, 0))`;
}
```

- [ ] **Step 4: PASS doğrula** — Run: `npx vitest run lib/etut/reservations.test.ts` → 8 test PASS
- [ ] **Step 5: Tip kontrolü** — Run: `npm run build` → Expected: `✓ Compiled successfully` (Prisma tipleriyle strict uyum; upsert where accessor `orgSlug_branch_sablonId_weekKey` Faz 1'de doğrulanmıştı)
- [ ] **Step 6: Commit**

```bash
git add lib/etut/reservations.ts lib/etut/reservations.test.ts
git commit -m "feat(etüt-faz2a): EtutReservation veri katmanı — resolveEffective + tek-satır upsert + tombstone + advisory lock + 8 test"
```

---

### Task 5: Faz 2a kapanışı

**Files:** (doğrulama + docs)

- [ ] **Step 1: Tam paket** — Run: `npm run build && npm test` → build yeşil; test toplamı 224 + 11 + 9 + 7 + 8 = **259 PASS** (sayı farklıysa nedenini raporla).
- [ ] **Step 2: Plan checkboxlarını işaretle + commit**

```bash
git add docs/superpowers/plans/2026-07-20-etut-hafta-bazli-faz2a.md
git commit -m "docs(etüt-faz2a): Faz 2a tamamlandı — kural çekirdeği + veri katmanı (35 yeni birim test)"
```

## Faz 2a Bitiş Kriterleri
1. 4 yeni lib dosyası + testleri; route/mevcut-lib DEĞİŞMEDİ (`git diff --stat` yalnız yeni dosyalar + migration-lib regex + plan docs göstermeli).
2. Tüm suite yeşil (≈259); build yeşil.
3. Tenant deseni bulgusu (Task 4 Step 0) rapora yazıldı — Faz 2b bookEtut bunu kullanacak.
4. Çok-model denetim Faz 2 BÜTÜNÜNDE (2b sonunda) — 2a lib-only olduğundan ayrı denetim yapılmaz (ledger'a not).
