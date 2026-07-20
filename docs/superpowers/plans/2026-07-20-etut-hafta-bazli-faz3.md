# Etüt Hafta-Bazlı Rezervasyon — Faz 3: Okuma Yolları — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tüm etüt OKUMA yolları bayat JSON'dan (Teacher.programTemplate.etutSablonlari) EtutSablon+EtutReservation tablolarına (effectiveReservation) geçsin; öğrenci pencere UI'ı (serbest gezinme + salt-okunur kapalı haftalar), müdür ProgramEditor'a WEEK/RECURRING atama seçimi, mobil etüt ekranına hafta seçici eklensin.

**Architecture:** Tek merkezî liste servisi `listEtutlerForWeek` (lib/etut/rezervasyon.ts — listBookableEtuts ile AYNI desen: EtutSablon findMany `deletedAt:null` + getWeekReservations + resolveEffective) hem `/api/etut-sablon/all`'ı hem mobil today/week builder'larını besler. ProgramEditor için `listSablonlarWithRez` (SablonDTO + efektif rez alanları). Pencere kuralı SUNUCUDA kalır — istemciler `bookableWeeks`'i response'tan okur, TSİ hesabı YAPMAZ.

**Tech Stack:** TS strict, vitest, Faz 2 lib'leri (reservations/weeks/sablon-service/booking), Prisma (EtutSablon/EtutReservation), React panelleri, Expo mobil.

**Spec:** `docs/superpowers/specs/2026-07-19-etut-hafta-bazli-rezervasyon-design.md` §3.3, §5, §10-Faz3
**Denetim taşınanları:** Gemini ORTA-2 (deletedAt süzgeci), Explore O1 (okuma ayrışması), T5/T7 Minor'ları (ProgramEditor öğrenci adı, mobil cancel weekKey, stale yorum).

## Mustafa kararları (2026-07-20 — AskUserQuestion)

1. **Hafta gezinme:** serbest (geçmiş+gelecek sınırsız), rezervasyon/iptal butonları yalnız `bookableWeeks` içinde aktif; kapalı gelecek haftada "Pazar 11:00'de açılır" notu.
2. **Müdür atama (ProgramEditor):** her atamada seçim — "Her hafta (kalıcı)" DEFAULT / "Sadece bu hafta"; kaldırırken kalıcıysa "bu haftayı mı / seriyi mi" sorulur.
3. **Mobil:** etüt ekranına "bu hafta / gelecek hafta" seçici + cancel'a weekKey.
4. **Kapsam:** müdür-tarafı öğrenci etüt görünümü/geçmiş (StudentList/StudentBookingsView-director/HistoryModal/arşiv/yoklama) + denetim Y2/Y3 → **Faz 4** (bu planda YOK).

## Global Constraints

- Dal `etut-hafta-bazli`; main'e push YOK; prod'a deploy YOK (cutover Faz 5).
- **Tüm yeni okuma yolları EtutSablon iterasyonuna `deletedAt: null` süzgeciyle girer** (Gemini ORTA-2) — silinen şablonun rezervasyonu HİÇBİR listede görünmez.
- **API dış sözleşmesi KORUNUR + yalnız EKLENİR:** `id`/`etutId` = EtutSablon.legacyId; `/api/etut-sablon/all` mevcut alan adları aynen (`studentId/studentName/studentCls/branch/bookedBy/booked`), YENİ alanlar: satırda `scope`, üst düzeyde `bookableWeeks`. Eski istemci kırılmaz.
- **`app/api/program/route.ts` etutSablonlari pass-through'una (satır ~183/~244) DOKUNULMAZ** — prod JSON'ı Faz 5 reconcile'a kadar canlı kalmalı (grid kaydı JSON etütlerini düşürürse cutover'da veri kaybı olur). `lib/slots.ts` getProgramTemplate/getAllProgramTemplates SİLİNMEZ (grid tüketicileri var); yalnız etüt-okuma çağrıları kalkar.
- **Pencere kuralı sunucuda:** `allowedBookingWeeks(role)` (lib/etut/weeks.ts) tek otorite. İstemci `bookableWeeks` listesini response'tan alır; Pazar-11:00/TSİ hesabını istemcide YENİDEN YAZMA.
- **`cls` ASLA parseInt edilmez** (rehberlik-konu-takibi-fix kuralı).
- Dokunulan satırlardaki `.catch(() => boş)` sessiz-hata desenleri gerçek hata durumuna çevrilir (yalnız bu fazda zaten değişen çağrılar; genel süpürme Faz 4).
- TDD; her commit öncesi `npm run build` + `npm test` yeşil (mevcut taban: 343 test); Türkçe commit mesajları.
- Client bileşenleri lib'den YALNIZ `import type` ile tip alabilir (sunucu kodu bundle'a sızmasın).

---

### Task 1: `listEtutlerForWeek` servisi + `/api/etut-sablon/all` tabloya + `bookableWeeks`

**Files:**
- Modify: `lib/etut/rezervasyon.ts` (yeni: `EtutAllRow`, `buildEtutAllList` saf, `listEtutlerForWeek` DB)
- Modify: `lib/etut/rezervasyon.test.ts` (buildEtutAllList testleri)
- Modify: `app/api/etut-sablon/all/route.ts` (JSON döngüsü → servis; + bookableWeeks)
- Modify: `app/_components/student-types.ts` (`EtutAllDTO` + `studentCls`/`scope`; `BookingSlotEntry` + `scope`)

**Interfaces (Produces — Task 3/5 kullanır):**
```ts
// lib/etut/rezervasyon.ts
export interface EtutAllRow {
  teacherId: string; teacherName: string; branches: string[]; allowedGroups: string[];
  id: string;               // EtutSablon.legacyId (dış sözleşme)
  dayIndex: number; dayLabel: string; start: string; end: string;
  studentId: string | null; studentName: string | null; studentCls: string | null;
  branch: string | null;    // efektif rezervasyonun dersBranch'i
  bookedBy: string | null;  // efektif rezervasyonun bookedByRole'ü
  booked: boolean;
  scope: 'WEEK' | 'RECURRING' | null; // YENİ — 'Kalıcı' rozeti için
}
export function buildEtutAllList(
  sablonRows: EtutSablon[],                       // deletedAt:null ÖN-süzülmüş
  teachers: { id: string; name: string; branches?: string[]; allowedGroups?: string[] }[],
  effectiveMap: Map<string, EtutReservation>,     // resolveEffective çıktısı (key = sablon CUID)
  weekKey: string,
): EtutAllRow[]                                    // SAF — efektif-aktif filtre + sıralama içeride
export async function listEtutlerForWeek(weekKey: string): Promise<EtutAllRow[]>
```

- [ ] **Step 1: Failing testler** — `lib/etut/rezervasyon.test.ts`'e `buildEtutAllList` bloğu (mevcut test dosyasının mk-helper idiomunu izle; `EtutSablon`/`EtutReservation` satırlarını düz obje olarak üret, tip için `as unknown as EtutSablon` cast'i kabul):

```ts
describe('buildEtutAllList', () => {
  const T = [{ id: 't1', name: 'Ali Hoca', branches: ['Fizik'], allowedGroups: ['lise'] }];
  const sb = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'cuid1', legacyId: 'e1', teacherId: 't1', dayIndex: 1, start: '14:00', end: '15:00',
    aktif: true, pasifHaftalar: [] as string[], deletedAt: null, ...over,
  }) as unknown as EtutSablon;
  const rez = (over: Partial<Record<string, unknown>> = {}) => ({
    sablonId: 'cuid1', scope: 'WEEK', status: 'ACTIVE', weekKey: '2026-W30',
    studentId: 's1', studentName: 'İrem', studentCls: '11A', dersBranch: 'Fizik', bookedByRole: 'student',
    ...over,
  }) as unknown as EtutReservation;

  it('boş rezervasyon → booked:false, studentName:null, scope:null', () => {
    const out = buildEtutAllList([sb()], T, new Map(), '2026-W30');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'e1', booked: false, studentId: null, scope: null, teacherName: 'Ali Hoca', dayLabel: 'Salı' });
  });
  it('efektif WEEK rezervasyon → alanlar dolu + scope:WEEK', () => {
    const out = buildEtutAllList([sb()], T, new Map([['cuid1', rez()]]), '2026-W30');
    expect(out[0]).toMatchObject({ booked: true, studentId: 's1', studentName: 'İrem', studentCls: '11A', branch: 'Fizik', bookedBy: 'student', scope: 'WEEK' });
  });
  it('RECURRING efektif → scope:RECURRING', () => {
    const out = buildEtutAllList([sb()], T, new Map([['cuid1', rez({ scope: 'RECURRING', weekKey: '*', bookedByRole: 'director' })]]), '2026-W30');
    expect(out[0]).toMatchObject({ scope: 'RECURRING', bookedBy: 'director' });
  });
  it('o hafta pasif şablon listelenmez (pasifHaftalar)', () => {
    expect(buildEtutAllList([sb({ pasifHaftalar: ['2026-W30'] })], T, new Map(), '2026-W30')).toHaveLength(0);
  });
  it('kalıcı pasif şablon listelenmez (aktif:false)', () => {
    expect(buildEtutAllList([sb({ aktif: false })], T, new Map(), '2026-W30')).toHaveLength(0);
  });
  it('öğretmeni silinmiş/yok şablon atlanır', () => {
    expect(buildEtutAllList([sb({ teacherId: 'yok' })], T, new Map(), '2026-W30')).toHaveLength(0);
  });
  it('gün+saat sıralı döner', () => {
    const rows = [sb({ id: 'c2', legacyId: 'e2', dayIndex: 0, start: '16:00' }), sb({ id: 'c3', legacyId: 'e3', dayIndex: 0, start: '09:00' }), sb()];
    const out = buildEtutAllList(rows, T, new Map(), '2026-W30');
    expect(out.map(r => r.id)).toEqual(['e3', 'e2', 'e1']);
  });
});
```

- [ ] **Step 2: FAIL doğrula** — `npx vitest run lib/etut/rezervasyon.test.ts` → "buildEtutAllList is not a function" benzeri.
- [ ] **Step 3: Implementasyon** — `lib/etut/rezervasyon.ts`'e (listBookableEtuts'un ALTINA):

```ts
// ── listEtutlerForWeek — /api/etut-sablon/all + mobil today/week ortak kaynağı (Faz 3) ──
// listBookableEtuts'un rol-bağımsız kardeşi: TÜM öğretmenlerin o hafta efektif-aktif
// şablonları + efektif rezervasyon sahipliği. JSON (programTemplate.etutSablonlari)
// OKUNMAZ. deletedAt:null süzgeci ZORUNLU (Gemini ORTA-2 — silinen şablonun rezervasyonu
// hiçbir listede görünmez). Alan adları eski /all sözleşmesiyle BİREBİR + yeni `scope`.
export interface EtutAllRow { /* yukarıdaki Interfaces bloğundaki gibi */ }

export function buildEtutAllList(
  sablonRows: EtutSablon[],
  teachers: { id: string; name: string; branches?: string[]; allowedGroups?: string[] }[],
  effectiveMap: Map<string, EtutReservation>,
  weekKey: string,
): EtutAllRow[] {
  const dayLabel = new Map(ALL_DAYS.map((d) => [d.index, d.label]));
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const out: EtutAllRow[] = [];
  for (const sb of sablonRows) {
    if (sb.aktif === false || sb.pasifHaftalar.includes(weekKey)) continue; // efektif-aktiflik (listBookableEtuts ile aynı ifade)
    const teacher = teacherById.get(sb.teacherId);
    if (!teacher) continue;
    const eff = effectiveMap.get(sb.id) ?? null;
    out.push({
      teacherId: teacher.id, teacherName: teacher.name,
      branches: teacher.branches || [], allowedGroups: teacher.allowedGroups || [],
      id: sb.legacyId, dayIndex: sb.dayIndex, dayLabel: dayLabel.get(sb.dayIndex) || '',
      start: sb.start, end: sb.end,
      studentId: eff?.studentId ?? null, studentName: eff?.studentName ?? null,
      studentCls: eff?.studentCls ?? null, branch: eff?.dersBranch ?? null,
      bookedBy: eff?.bookedByRole ?? null, booked: Boolean(eff),
      scope: eff ? (eff.scope as 'WEEK' | 'RECURRING') : null,
    });
  }
  out.sort((a, b) => (a.dayIndex - b.dayIndex) || a.start.localeCompare(b.start));
  return out;
}

export async function listEtutlerForWeek(weekKey: string): Promise<EtutAllRow[]> {
  const orgSlug = currentOrg();
  const branch = currentBranch();
  const [teachers, sablonRows, allReservations] = await Promise.all([
    getAllTeachers(),
    tdb().etutSablon.findMany({ where: { deletedAt: null } }),
    getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey),
  ]);
  return buildEtutAllList(sablonRows, teachers, resolveEffective(allReservations, weekKey), weekKey);
}
```
Import ekle: `ALL_DAYS` (`@/lib/constants`), `EtutSablon`/`EtutReservation` tipleri (`@prisma/client`, type-only).

- [ ] **Step 4: PASS** — 7 yeni test yeşil, mevcut 13 rezervasyon testi bozulmadı.
- [ ] **Step 5: Route'u bağla** — `app/api/etut-sablon/all/route.ts` TÜM gövde:

```ts
import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { listEtutlerForWeek } from '@/lib/etut/rezervasyon';
import { allowedBookingWeeks, type BookingRole } from '@/lib/etut/weeks';
import { getWeekKey } from '@/lib/constants';

// GET /api/etut-sablon/all?week=YYYY-Www — o haftanın EFEKTİF etüt listesi (Faz 3: EtutSablon+
// EtutReservation TABLOSUNDAN; bayat JSON yolu kapandı). Rezervasyon sahipliği artık HAFTA-BAZLI.
// bookableWeeks: rolün YAZABİLECEĞİ haftalar (sunucu-otoriter, istemci TSİ hesabı yapmaz).

const BOOKING_ROLES = new Set(['student', 'teacher', 'director', 'counselor']);

// Bilinçli inline rol dallanması: veli yalnız kendi çocuğunun etütlerini görür.
export const GET = withAuth('auth', 'etut', async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();

  const etutler = await listEtutlerForWeek(weekKey);
  const bookableWeeks = BOOKING_ROLES.has(session.role)
    ? allowedBookingWeeks(session.role as BookingRole)
    : [];

  if (session.role === 'parent') {
    const childId = searchParams.get('studentId');
    const allowed = childId && canReadStudent(session, childId);
    const mine = allowed ? etutler.filter(e => e.studentId === childId) : [];
    return NextResponse.json({ weekKey, etutler: mine, bookableWeeks });
  }
  return NextResponse.json({ weekKey, etutler, bookableWeeks });
});
```
(`getAllTeachers`/`getProgramTemplate`/`etutAktifThisWeek`/`EtutSablonu`/`ALL_DAYS` importları bu route'tan KALKAR.)

- [ ] **Step 6: İstemci tipleri** — `app/_components/student-types.ts`: `EtutAllDTO`'ya `studentCls?: string | null;` ve `scope?: 'WEEK' | 'RECURRING' | null;`; `BookingSlotEntry`'ye `scope?: string | null;` ekle (davranış değişikliği yok — Task 5 kullanacak).
- [ ] **Step 7:** `npm run build && npm test` yeşil. **Step 8: Commit** — `feat(etüt-faz3): /api/etut-sablon/all tablodan efektif okuma — listEtutlerForWeek + bookableWeeks (bayat JSON okuma yolu kapandı)`

---

### Task 2: `listSablonlarWithRez` + `/api/etut-sablon` yanıtları + PATCH scope/weekKey

**Files:**
- Modify: `lib/etut/sablon-service.ts` (`SablonRezDTO`, `mergeSablonRez` saf, `listSablonlarWithRez`)
- Modify: `lib/etut/sablon-service.test.ts` (merge testleri)
- Modify: `app/api/etut-sablon/route.ts` (GET +week; TÜM yanıtlar WithRez; DELETE +weekKey; PATCH +scope/weekKey)

**Interfaces (Produces — Task 4 kullanır):**
```ts
// lib/etut/sablon-service.ts
export interface SablonRezDTO extends SablonDTO {
  studentId: string | null; studentName: string | null; studentCls: string | null;
  branch: string | null; bookedBy: string | null;
  rezScope: 'WEEK' | 'RECURRING' | null;  // 'scope' adı PUT ToggleSchema'nın scope'uyla karışmasın diye rezScope
}
export function mergeSablonRez(rows: EtutSablon[], effectiveMap: Map<string, EtutReservation>): SablonRezDTO[]  // SAF
export async function listSablonlarWithRez(teacherLegacyId: string, weekKey: string): Promise<SablonRezDTO[]>
```

**Consumes:** `getWeekReservations`/`resolveEffective` (reservations.ts), `toSablonDTO`, `currentOrg`/`currentBranch` (`@/lib/tenant`), `currentWeekKeyTSI` (weeks.ts), `bookEtut`/`cancelEtutV2` (booking.ts — PATCH zaten kullanıyor).

- [ ] **Step 1: Failing testler** — `sablon-service.test.ts`'e:

```ts
describe('mergeSablonRez', () => {
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'cuid1', legacyId: 'e1', teacherId: 't1', dayIndex: 2, start: '10:00', end: '11:00',
    aktif: true, pasifHaftalar: [] as string[], deletedAt: null, ...over,
  }) as unknown as EtutSablon;
  const rez = (over: Partial<Record<string, unknown>> = {}) => ({
    sablonId: 'cuid1', scope: 'RECURRING', status: 'ACTIVE',
    studentId: 's1', studentName: 'Ahmet', studentCls: '8B', dersBranch: 'Matematik', bookedByRole: 'director',
    ...over,
  }) as unknown as EtutReservation;

  it('rezervasyonsuz şablon → rez alanları null (SablonDTO alanları aynen)', () => {
    const out = mergeSablonRez([row()], new Map());
    expect(out[0]).toMatchObject({ id: 'e1', dayIndex: 2, aktif: true, studentId: null, rezScope: null });
  });
  it('efektif rezervasyon → alanlar dolu + rezScope', () => {
    const out = mergeSablonRez([row()], new Map([['cuid1', rez()]]));
    expect(out[0]).toMatchObject({ studentId: 's1', studentName: 'Ahmet', studentCls: '8B', branch: 'Matematik', bookedBy: 'director', rezScope: 'RECURRING' });
  });
  it('pasif şablon da LİSTELENİR (ProgramEditor pasifleri gösterir; süzme YOK)', () => {
    expect(mergeSablonRez([row({ aktif: false })], new Map())).toHaveLength(1);
  });
});
```
(DİKKAT: Task 1'in `buildEtutAllList`'i pasifleri SÜZER, `mergeSablonRez` SÜZMEZ — ProgramEditor pasif şablonları gri gösterip aktifleştirebilmeli. Bilinçli asimetri.)

- [ ] **Step 2: FAIL doğrula.**
- [ ] **Step 3: Implementasyon** — `sablon-service.ts`'e (`listSablonlar`'ın altına):

```ts
// Faz 3: ProgramEditor için şablon + o haftanın EFEKTİF rezervasyonu (WEEK-ezer-RECURRING).
// listSablonlar'ın rez'li üstkümesi; pasif/pasifHaftalar şablonlar da DÖNER (editör gösterir).
// deletedAt:null süzgeci findMany where'inde (silinen şablon editörde de görünmez).
export function mergeSablonRez(rows: EtutSablon[], effectiveMap: Map<string, EtutReservation>): SablonRezDTO[] {
  return rows.map((r) => {
    const eff = effectiveMap.get(r.id) ?? null;
    return {
      ...toSablonDTO(r),
      studentId: eff?.studentId ?? null, studentName: eff?.studentName ?? null,
      studentCls: eff?.studentCls ?? null, branch: eff?.dersBranch ?? null,
      bookedBy: eff?.bookedByRole ?? null,
      rezScope: eff ? (eff.scope as 'WEEK' | 'RECURRING') : null,
    };
  });
}

export async function listSablonlarWithRez(teacherLegacyId: string, weekKey: string): Promise<SablonRezDTO[]> {
  const orgSlug = currentOrg();
  const branch = currentBranch();
  const [rows, allReservations] = await Promise.all([
    tdb().etutSablon.findMany({ where: { teacherId: teacherLegacyId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey),
  ]);
  return mergeSablonRez(rows, resolveEffective(allReservations, weekKey));
}
```
Import ekle: `currentOrg, currentBranch` (`@/lib/tenant`), `getWeekReservations, resolveEffective` (`./reservations`), `EtutReservation` type.

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Route güncelle** — `app/api/etut-sablon/route.ts`:
  - `GET`: `?week=` opsiyonel param oku; `const wk = week || currentWeekKeyTSI();` → `listSablonlarWithRez(teacherId, wk)` döndür (yanıt `{ sablonlar }` aynen — alanlar EKLENDİ).
  - `POST`/`PUT`: gövde sonunda `listSablonlar(...)` yerine `listSablonlarWithRez(teacherId, weekKey || currentWeekKeyTSI())` döndür (`saveSablon`/`toggleSablon` iç mantığı DEĞİŞMEZ; onların dönüşü yok sayılıp WithRez yeniden çekilebilir — basitlik için: servis fonksiyonlarını çağır, sonra `listSablonlarWithRez` ile yanıtla).
  - `DELETE`: `DeleteSchema`'ya `weekKey: z.string().max(40).optional()` ekle; yanıt WithRez.
  - `PATCH`: `AssignSchema`'ya ekle:
    ```ts
    scope: z.enum(['WEEK', 'RECURRING']).optional(),   // default RECURRING (geriye uyum — eski istemci scope göndermez)
    weekKey: z.string().max(40).optional().refine((wk) => wk === undefined || isValidWeekKey(wk), { message: 'Geçersiz hafta formatı' }),
    ```
    Gövde:
    ```ts
    const scope = parsed.data.scope ?? 'RECURRING';
    const weekKey = parsed.data.weekKey;
    if (student) {
      await bookEtut(session, { teacherId, etutId: id, studentId: student.id, scope, weekKey });
    } else {
      await cancelEtutV2(session, scope === 'WEEK'
        ? { teacherId, etutId: id, scope: 'week', weekKey }
        : { teacherId, etutId: id, scope: 'recurring' });
    }
    const sablonlar = await listSablonlarWithRez(teacherId, weekKey || currentWeekKeyTSI());
    ```
  - Import: `isValidWeekKey, currentWeekKeyTSI` (`@/lib/etut/weeks`), `listSablonlarWithRez`.
  - Route başı yorumundaki "rezervasyon alanları YOK — Faz 3'te" notunu güncelle (artık VAR).
- [ ] **Step 6:** `npm run build && npm test` yeşil. **Step 7: Commit** — `feat(etüt-faz3): sablon listesine efektif rezervasyon alanları (listSablonlarWithRez) + PATCH'e WEEK/RECURRING scope + weekKey`

---

### Task 3: Mobil today/week etüt okumaları tabloya

**Files:**
- Modify: `lib/mobile/today.ts` (`collectClassDay` etüt bölümü ~:131-146, `buildTeacherToday` etüt bölümü ~:258-270)
- Modify: `lib/mobile/week.ts` (`collectClassWeek` etüt bölümü ~:46-59)

**Consumes:** `listEtutlerForWeek` (Task 1). **Dönüş tipleri (`TodayEtut`) DEĞİŞMEZ** — yalnız kaynak değişir.

- [ ] **Step 1: `collectClassDay`** — etüt bloğunu değiştir:

```ts
const etuts: TodayEtut[] = [];
if (etutStudentId) {
  // Faz 3: EtutSablon+EtutReservation tablosundan efektif okuma (bayat JSON değil).
  // listEtutlerForWeek deletedAt:null + efektif-aktiflik + WEEK-ezer-RECURRING'i içerir.
  for (const r of await listEtutlerForWeek(weekKey)) {
    if (r.dayIndex !== dayIndex || r.studentId !== etutStudentId) continue; // yalnız KENDİ rezervasyonu (veri minimizasyonu)
    etuts.push({
      id: r.id, start: r.start, end: r.end,
      teacherName: r.teacherName, branch: r.branch,
      studentName: r.studentName, booked: true,
    });
  }
  etuts.sort((a, b) => a.start.localeCompare(b.start));
}
```
`getAllProgramTemplates`/`etutAktifThisWeek`/`EtutSablonu` importları today.ts'te başka kullanım kalmıyorsa kaldır (`getProgramTemplate` buildTeacherToday'den de kalkacak — Step 2 sonrası kontrol et).

- [ ] **Step 2: `buildTeacherToday`** — etüt bloğunu değiştir:

```ts
let etuts: TodayEtut[] | null = null;
if (mods.etut !== false) {
  // Faz 3: öğretmenin bugünkü şablonları + efektif doluluk tablodan.
  etuts = (await listEtutlerForWeek(t.weekKey))
    .filter((r) => r.teacherId === me && r.dayIndex === t.dayIndex)
    .map((r) => ({
      id: r.id, start: r.start, end: r.end,
      teacherName: String(session.name ?? ''), branch: r.branch,
      studentName: r.studentName, booked: r.booked,
    }));
  // listEtutlerForWeek zaten gün+saat sıralı — ek sort gerekmez.
}
```

- [ ] **Step 3: `collectClassWeek`** — hafta TEK weekKey; döngü DIŞINDA bir kez çek:

```ts
// collectClassWeek başında (Promise.all içindeki getAllProgramTemplates yerine):
const etutRows = etutStudentId ? await listEtutlerForWeek(weekKey) : [];
// ... gün döngüsünde:
let etuts: TodayEtut[] | null = null;
if (etutStudentId) {
  etuts = etutRows
    .filter((r) => r.dayIndex === dayIndex && r.studentId === etutStudentId)
    .map((r) => ({ id: r.id, start: r.start, end: r.end, teacherName: r.teacherName, branch: r.branch, studentName: r.studentName, booked: true }));
}
```
week.ts'ten `getAllProgramTemplates`/`etutAktifThisWeek`/`EtutSablonu` importlarını kaldır (başka kullanıcı yoksa).

- [ ] **Step 4:** `npm run build && npm test` yeşil (mobil today/week mevcut saf testleri etkilenmez — etüt toplama I/O idi, testleri yoktu; davranış doğrulaması Task 7 canlı smoke'ta).
- [ ] **Step 5: Commit** — `feat(etüt-faz3): mobil today/week etüt okumaları EtutReservation efektif kaynağına geçti`

---

### Task 4: ProgramEditor — haftalık rez verisi + WEEK/RECURRING atama-kaldırma UI

**Files:**
- Modify: `app/_components/director/ProgramEditor.tsx`

**Consumes:** Task 2 (`SablonRezDTO` tip — `import type { SablonRezDTO } from '@/lib/etut/sablon-service'`; type-only import, bundle'a sunucu kodu sızmaz; PATCH `scope`/`weekKey` sözleşmesi).

- [ ] **Step 1: Tip + fetch değişimi:**
  - `EtutSablonu` (lib/slots JSON tipi) yerine `SablonRezDTO` kullan: `etutSablonlar`/`selectedEtut` state tipleri, `EtutEylemModalProps.sablon`, `cakisanAktifEtut` dönüşü. (`EtutSablonu` importu kalkar.)
  - Şablon yükleme effect'i (satır ~83-90): dependency `[teacher.id, weekKey]` yap, URL'e `&week=${weekKey}` ekle, `.catch { setEtutSablonlar([]) }` sessiz dalını `showToast((e as Error).message, 'error')` + boş liste yap:
  ```ts
  useEffect(() => {
    (async () => {
      try {
        const d = await api<{ sablonlar?: SablonRezDTO[] }>(`/api/etut-sablon?teacherId=${teacher.id}&week=${weekKey}`);
        setEtutSablonlar(d.sablonlar || []);
      } catch (e) { showToast((e as Error).message, 'error'); setEtutSablonlar([]); }
    })();
  }, [teacher.id, weekKey, showToast]);
  ```
  - `deleteEtutSablon` gövdesindeki DELETE body'sine `weekKey` ekle (`{ teacherId: teacher.id, id, weekKey }`).
- [ ] **Step 2: `assignEtutSablon` imzasını genişlet:**
  ```ts
  async function assignEtutSablon(id: string, student: { id: string; name: string; cls: string } | null, scope: 'WEEK' | 'RECURRING') {
    try {
      const r = await api<{ sablonlar?: SablonRezDTO[] }>('/api/etut-sablon', {
        method: 'PATCH',
        body: JSON.stringify({ teacherId: teacher.id, id, student, scope, weekKey }),
      });
      const list = r.sablonlar || [];
      setEtutSablonlar(list);
      setSelectedEtut(list.find(s => s.id === id) || null);
      showToast(student ? (scope === 'RECURRING' ? 'Öğrenci atandı (her hafta)' : 'Öğrenci atandı (bu hafta)') : 'Atama kaldırıldı');
    } catch (e) { showToast((e as Error).message, 'error'); }
  }
  ```
- [ ] **Step 3: `EtutEylemModal` yeniden düzenle** (Mustafa kararı 2: seçimli, kalıcı DEFAULT; kaldırırken kalıcıysa hafta/seri sorusu):
  - Props: `onAssign: (id: string, student: {...} | null, scope: 'WEEK' | 'RECURRING') => void`.
  - Atama bölümü: öğrenci select'inin ÜSTÜNE kapsam radio'su:
  ```tsx
  const [assignScope, setAssignScope] = useState<'WEEK' | 'RECURRING'>('RECURRING'); // kalıcı DEFAULT
  // ...
  <div className="flex gap-3 text-sm" role="radiogroup" aria-label="Atama kapsamı">
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="radio" checked={assignScope === 'RECURRING'} onChange={() => setAssignScope('RECURRING')} />
      Her hafta (kalıcı)
    </label>
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="radio" checked={assignScope === 'WEEK'} onChange={() => setAssignScope('WEEK')} />
      Sadece bu hafta
    </label>
  </div>
  ```
  - `handleStudentSelect`: boş seçenek ("— Boş —") artık KALDIRMA yapmaz — select yalnız atama içindir; boş değer seçilirse hiçbir şey yapma. Atama: `onAssign(sablon.id, { id, name, cls }, assignScope)`.
  - Mevcut atama görünümü: `sablon.studentName` varken "Atandı: {studentName}" satırının yanına rozet: `sablon.rezScope === 'RECURRING' ? 'Her hafta' : 'Bu hafta'`.
  - KALDIRMA: atanmışken ayrı buton(lar):
  ```tsx
  {sablon.studentId && (
    sablon.rezScope === 'RECURRING' ? (
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 justify-center" onClick={() => onAssign(sablon.id, null, 'WEEK')}>Bu haftayı iptal et</button>
        <button className="btn-ghost flex-1 justify-center text-red-500 hover:bg-red-50" onClick={() => onAssign(sablon.id, null, 'RECURRING')}>Seriyi iptal et</button>
      </div>
    ) : (
      <button className="btn-ghost w-full justify-center text-red-500 hover:bg-red-50" onClick={() => onAssign(sablon.id, null, 'WEEK')}>Atamayı kaldır (bu hafta)</button>
    )
  )}
  ```
  (PATCH `student:null, scope:'WEEK', weekKey` → o haftaya tombstone; `scope:'RECURRING'` → '*' serisi iptal — Task 2 sözleşmesi. Görüntülenen haftanın weekKey'i gittiği için müdür GELECEK haftanın tek-hafta iptalini de o haftaya gezinerek yapabilir.)
- [ ] **Step 4: Takvim bloğu etiketi** — satır ~414 `sb.studentName || 'Etüt'` zaten SablonRezDTO ile yeniden dolacak; RECURRING'e işaret ekle:
  ```tsx
  {sb.studentName ? `${sb.studentName}${sb.rezScope === 'RECURRING' ? ' ↻' : ''}` : 'Etüt'}{aktif ? '' : ' (pasif)'}
  ```
- [ ] **Step 5:** `npm run build && npm test` yeşil; TS hataları (EtutSablonu→SablonRezDTO geçişinde kalan alan uyuşmazlıkları) temizlenmiş olmalı.
- [ ] **Step 6: Commit** — `feat(etüt-faz3): ProgramEditor hafta-bazlı rezervasyon görünümü + kalıcı/tek-hafta atama seçimi (öğrenci adı geri geldi)`

---

### Task 5: Öğrenci/öğretmen/veli/müdür panelleri — pencere UI + weekKey iptal + rozetler

**Files:**
- Modify: `app/_components/StudentPanel.tsx`
- Modify: `app/_components/AvailableTree.tsx` (`bookingDisabled` prop)
- Modify: `app/_components/StudentBookingsView.tsx` ("Her hafta" rozeti)
- Modify: `app/_components/TeacherPanel.tsx` (TeacherEtutPanel)
- Modify: `app/_components/ParentPanel.tsx` (ProgramView hata durumu)
- Modify: `app/_components/director/TeachersTab.tsx` (TeacherEtutReservations)

**Consumes:** Task 1 response sözleşmesi: `{ weekKey, etutler, bookableWeeks }`; `EtutAllDTO.scope`.

- [ ] **Step 1: StudentPanel pencere UI:**
  - State: `const [bookableWeeks, setBookableWeeks] = useState<string[]>([]);`
  - `loadData` içinde: `const etutData = await api<{ etutler?: EtutAllDTO[]; bookableWeeks?: string[] }>(...)` → `setBookableWeeks(etutData.bookableWeeks || []);` — map'e `scope: e.scope` alanını da taşı.
  - `const canBookThisWeek = bookableWeeks.includes(weekKey);`
  - Kapalı GELECEK hafta bandı (available sekmesinin üstüne; geçmiş haftada gösterilmez — orada available zaten boş):
  ```tsx
  {!canBookThisWeek && weekKey > getWeekKey() && (
    <div className="card p-3 mb-3 text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
      <span aria-hidden>🔒</span>
      {weekKey === getAdjacentWeek(getWeekKey(), 1)
        ? 'Gelecek haftanın rezervasyonu Pazar 11:00\'de açılır. Şimdilik sadece görüntüleyebilirsin.'
        : 'Bu hafta yalnız görüntülenebilir — rezervasyon penceresi dışında.'}
    </div>
  )}
  ```
  - `<AvailableTree ... bookingDisabled={!canBookThisWeek} />`
  - `handleCancel`: DELETE body'sine `weekKey` ekle: `JSON.stringify({ teacherId, etutId, weekKey })`.
- [ ] **Step 2: AvailableTree `bookingDisabled`:**
  - Props'a `bookingDisabled?: boolean` ekle; her iki `onBook` butonuna `disabled={bookingDisabled}` + `className`'e koşullu `opacity-40 cursor-not-allowed` + `title={bookingDisabled ? 'Bu hafta için rezervasyon henüz açık değil' : undefined}`.
- [ ] **Step 3: StudentBookingsView:**
  - Rozet (mevcut 'Sabit' rozetinin yanına): `{s.scope === 'RECURRING' && (<span className="badge" style={{ background: 'color-mix(in srgb, var(--time-etut) 14%, transparent)', color: 'var(--time-etut)' }}>Her hafta</span>)}`
  - İptalin hafta bilgisi: bileşen weekKey BİLMEZ ve bilmesi gerekmez — StudentPanel `handleCancel` kendi `weekKey` state'ini gövdeye koyar (Step 1'de yapıldı). `BookingCancelArgs`'a alan EKLENMEZ.
- [ ] **Step 4: TeacherEtutPanel (TeacherPanel.tsx ~:613-722):**
  - `load` içindeki `.catch(() => ({ etutler: [] }))` KALDIR — dış try/catch zaten showToast yapıyor; `bookableWeeks`'i de al: `const data = await api<{ etutler?: EtutAllDTO[]; bookableWeeks?: string[] }>(...)`; state'e yaz.
  - WeekNav sınırını SERBEST yap (Mustafa kararı 1): `canPrev`/`canNext` hesaplayan IIFE'yi kaldır, `<WeekNav weekKey={weekKey} onPrev={() => changeWeek(-1)} onNext={() => changeWeek(1)} />`.
  - `const canWrite = bookableWeeks.includes(weekKey);` — `canWrite` değilken 'Öğrenci ata' ve kaldır (X) butonları yerine bilgi metni: `<span className="text-caption">Salt görüntüleme</span>`; pencere bandı (StudentPanel Step 1'deki bandın aynısı, metin: gelecek hafta ise 'Gelecek haftanın ataması Pazar 11:00\'de açılır.', diğer: 'Bu hafta salt görüntüleme — atama penceresi dışında.').
  - `submitAssign`/`removeStudent` body'lerine zaten `weekKey` var mı kontrol et: submitAssign VAR, removeStudent YOK → `removeStudent` body'sine `weekKey` ekle.
  - Dolu satırda `e.scope === 'RECURRING'` ise öğrenci adının yanına küçük rozet: `<span className="badge badge-info shrink-0">Her hafta</span>`.
- [ ] **Step 5: TeachersTab / TeacherEtutReservations:**
  - `load` içindeki `.catch(() => ({ etutler: [] }))` kaldır (dış catch showToast+setRows([]) zaten var).
  - `EtutRow`'a `scope?: string | null` ekle; satırda RECURRING rozeti (Step 4'teki aynı badge).
  - `cancel(etutId)` → `cancel(etutId, scope)` yap; body: `JSON.stringify({ teacherId, etutId, weekKey, scope: 'week' })` — görüntülenen haftayı iptal eder (tombstone). Buton title'ı: `scope === 'RECURRING' ? 'Bu haftanın etüdünü iptal et (seri devam eder — seriyi ProgramEditor\'dan yönetin)' : 'Rezervasyonu iptal et'`.
- [ ] **Step 6: ParentPanel ProgramView:**
  - Etüt fetch'indeki `.catch(() => ({ etutler: [] }))` KALDIR; dış `catch { setAllSlots([]) }` yerine hata mesajı state'i:
  ```tsx
  const [loadError, setLoadError] = useState<string | null>(null);
  // load içinde: setLoadError(null); ... catch (e) { setAllSlots([]); setLoadError((e as Error).message || 'Program yüklenemedi'); }
  // render: {loadError && <div className="card p-3 mb-3 text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{loadError}</div>}
  ```
  - Map'e `scope: e.scope` ekle (StudentBookingsView rozeti veli tarafında da çalışsın).
- [ ] **Step 7:** `npm run build && npm test` yeşil. **Step 8: Commit** — `feat(etüt-faz3): panel pencere UI — serbest hafta gezinme + bookableWeeks kapıları + weekKey'li iptal + 'Her hafta' rozetleri + sessiz catch temizliği`

---

### Task 6: Mobil etüt ekranı — hafta seçici + cancel weekKey

**Files:**
- Modify: `app/api/mobile/v1/etut/route.ts` (+`bookableWeeks`, `currentWeekKey`, `nextWeekKey`)
- Modify: `lib/mobile/api-types.ts` (`EtutScreenResponse` genişletme; `EtutSlotView.branches` yorumu düzelt: sınıf değil DÜZEY havuzu)
- Modify: `mobile/src/api/types.ts` (`npm run mobile:types` ile senkron — elle YAZMA)
- Modify: `mobile/src/app/etut.tsx` (hafta seçici + cancel weekKey + satır 10 stale yorum düzeltme)

**Interfaces (Produces):**
```ts
// EtutScreenResponse (lib/mobile/api-types.ts):
export interface EtutScreenResponse {
  weekKey: string;           // gösterilen hafta
  currentWeekKey: string;    // TSİ bu hafta
  nextWeekKey: string;       // TSİ gelecek hafta
  bookableWeeks: string[];   // öğrencinin YAZABİLECEĞİ haftalar (Pazar 11:00 kuralı sunucuda)
  slots: EtutSlotView[];
}
```

- [ ] **Step 1: Route** — `app/api/mobile/v1/etut/route.ts` GET gövdesi sonu:
  ```ts
  import { allowedBookingWeeks, currentWeekKeyTSI, shiftWeekKey } from '@/lib/etut/weeks';
  // ...
  const currentWeekKey = currentWeekKeyTSI();
  const nextWeekKey = shiftWeekKey(currentWeekKey, 1);
  const bookableWeeks = allowedBookingWeeks('student');
  // hafta paramı yalnız current/next kabul (mobil UI iki hafta sunar; başka değer → current)
  const weekKey = rawWeek && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(rawWeek) && (rawWeek === currentWeekKey || rawWeek === nextWeekKey)
    ? rawWeek : currentWeekKey;
  const bookable = await listBookableEtuts(String(session.id ?? ''), weekKey);
  const slots = bookable.map((b) => ({ ...b, dayLabel: ALL_DAYS[b.dayIndex]?.label ?? '' }));
  return NextResponse.json({ weekKey, currentWeekKey, nextWeekKey, bookableWeeks, slots });
  ```
  (`trToday` importu kullanılmıyorsa kaldır. NOT: hafta anahtarı artık `currentWeekKeyTSI` — `trToday().weekKey` ile aynı matematik, tek kaynak weeks.ts.)
- [ ] **Step 2: Tipler** — `lib/mobile/api-types.ts`'te `EtutScreenResponse`'u yukarıdaki şekle genişlet; `npm run mobile:types` koş (mobile/src/api/types.ts byte-senkron).
- [ ] **Step 3: etut.tsx** —
  - Satır 10 stale yorum: `reserveEtut` → `bookEtut/cancelEtutV2 (lib/etut/booking.ts)`.
  - State: `const [week, setWeek] = useState<'current' | 'next'>('current');`
  - `load`: `api.get<EtutScreenResponse>('/api/mobile/v1/etut' + (week === 'next' && data?.nextWeekKey ? `?week=${data.nextWeekKey}` : ''))` — DİKKAT: ilk yüklemede nextWeekKey henüz bilinmez; `week` değişince mevcut `data.nextWeekKey` ile fetch; useFocusEffect + `[load, week]` dependency. Basit kalıp:
  ```tsx
  const load = useCallback(async (target?: string) => {
    if (!api) return;
    setError(null);
    try {
      const q = target ? `?week=${target}` : '';
      setData(await api.get<EtutScreenResponse>(`/api/mobile/v1/etut${q}`));
    } catch (e) { /* mevcut hata bloğu aynen */ }
  }, [api]);
  useFocusEffect(useCallback(() => { void load(); setWeek('current'); }, [load]));
  const switchWeek = (w: 'current' | 'next') => {
    setWeek(w);
    void load(w === 'next' ? data?.nextWeekKey : data?.currentWeekKey);
  };
  ```
  - Segment UI (Title altına):
  ```tsx
  <View style={st.segment}>
    {(['current', 'next'] as const).map((w) => (
      <Button key={w} label={w === 'current' ? 'Bu hafta' : 'Gelecek hafta'}
        onPress={() => switchWeek(w)} variant={week === w ? undefined : 'ghost'} color={brand} />
    ))}
  </View>
  {week === 'next' && data && !data.bookableWeeks.includes(data.weekKey) && (
    <Sub>Gelecek haftanın rezervasyonu Pazar 11:00'de açılır — şimdilik sadece görüntüleme.</Sub>
  )}
  ```
  (`st.segment`: `{ flexDirection: 'row', gap: 8, marginTop: 12 }`.)
  - Rezerve butonlarını pencereyle kapıla: `const canBook = !!data && data.bookableWeeks.includes(data.weekKey);` — `canBook` false iken rezerve butonları yerine `<Text style={st.status}>Rezervasyon kapalı</Text>` (mine/İptal görünümü AYNEN kalır — iptal weekKey'li olarak her zaman gönderilebilir, sunucu karar verir).
  - `reserve`/`cancel`: her ikisi `weekKey: data?.weekKey` göndersin (reserve zaten gönderiyor; **cancel'a ekle**): `await api.del('/api/mobile/v1/etut/reserve', { teacherId: slot.teacherId, etutId: slot.etutId, weekKey: data?.weekKey });`
  - `reserve`/`cancel` sonrası `load(data?.weekKey)` (gösterilen haftayı yeniden çek — mevcut `load()` çağrıları güncellenir).
- [ ] **Step 4:** `npm run build && npm test` yeşil; `cd mobile && npx tsc --noEmit` (Expo tip kontrolü) temiz.
- [ ] **Step 5: Commit** — `feat(etüt-faz3): mobil etüt ekranına bu/gelecek hafta seçici (Pazar 11:00 pencere sunucu-otoriter) + cancel weekKey`

---

### Task 7: Kapanış — canlı smoke + gate + doküman

**Files:** scratchpad smoke scripti (repo'ya GİRMEZ), plan checkbox işaretleme, `.superpowers/sdd/progress.md` (controller yazar).

- [ ] **Step 1: Canlı smoke (testkurs, servis-katmanı — Faz 2 Task 7 kalıbı: runWithTenant + cleanup):** scratchpad'e tek seferlik script; senaryolar:
  1. **Hafta izolasyonu:** öğrenciyle `bookEtut`(WEEK, currentWeek) → `listEtutlerForWeek(currentWeek)` satırında `studentName` + `scope:'WEEK'`; `listEtutlerForWeek(nextWeek)` AYNI şablon `booked:false` (bug'ın öldüğünün kanıtı — eski JSON tüm haftalarda dolu gösterirdi).
  2. **Recurring görünürlüğü:** müdür aktörüyle `bookEtut`(RECURRING) → current VE current+3 haftalarında görünür (`scope:'RECURRING'`); bir haftaya `cancelEtutV2`(week) tombstone → O haftada `booked:false`, diğerlerinde dolu.
  3. **deletedAt süzgeci:** `softDeleteSablon` → `listEtutlerForWeek` VE `listSablonlarWithRez` şablonu DÖNDÜRMEZ; sonra DB'den `deletedAt:null` restore.
  4. **listSablonlarWithRez:** senaryo 2'nin recurring'i `rezScope:'RECURRING'` + `studentName` ile döner.
  5. **Mobil builder:** `buildStudentToday`/`buildStudentWeek` (rezervasyonlu öğrenci + doğru gün) etüt satırını TABLODAN döndürür.
  Cleanup: yaratılan EtutReservation satırları `deleteMany` → baseline'a dön (EtutReservation=0 doğrula). Çıktılar task raporuna.
- [ ] **Step 2: Grep gate'leri:**
  - `grep -rn "etutSablonlari" app/ lib/ --include="*.ts" --include="*.tsx"` → yalnız: `app/api/program/route.ts` pass-through (bilinçli, Faz 5), `lib/slots.ts` tip/template yardımcıları, göç scriptleri. `app/api/etut-sablon/all`, `lib/mobile/today.ts`, `lib/mobile/week.ts` SONUÇTA YOK.
  - `grep -n "getAllProgramTemplates" lib/ app/ -r` → mobil today/week'te KALMADI.
  - `grep -rn "catch(() =>" app/_components/StudentPanel.tsx app/_components/TeacherPanel.tsx app/_components/ParentPanel.tsx app/_components/director/TeachersTab.tsx app/_components/director/ProgramEditor.tsx` → etüt fetch'lerinde sıfır.
- [ ] **Step 3: Tam gate:** `npm run build` + `npm test` (343 + yeni testler) yeşil; plan checkboxları işaretli; kapanış commit — `docs(etüt-faz3): Faz 3 tamamlandı — tüm okuma yolları hafta-bazlı efektif kaynağa geçti`
- [ ] **Step 4 (controller):** Faz 3 BÜTÜNÜ çok-model denetimi (Codex + Gemini + Explore) — özel sorular: (a) `/all` + `listSablonlarWithRez` + mobil builder'ların efektif çözümü tutarlı mı (WEEK-ezer-RECURRING + tombstone + deletedAt), (b) pencere UI'ın sunucu kuralıyla uyumu (istemci TSİ hesabı sızdı mı), (c) PATCH scope genişletmesinin geriye uyumu, (d) response sözleşme kırılması var mı (eski alan adları). Bulgular kapanmadan Faz 4'e geçilmez.

## Faz 3 Bitiş Kriterleri

1. `/api/etut-sablon/all` + `/api/etut-sablon` GET + mobil today/week + tüm panel görünümleri EtutSablon/EtutReservation'dan okuyor; rezervasyonlar HAFTA-BAZLI görünüyor (İrem W30 senaryosu: yalnız W30'da dolu).
2. Tüm yeni okuma yolları `deletedAt:null` süzgeçli (Gemini ORTA-2 kapandı).
3. ProgramEditor öğrenci adını gösteriyor (T5 Minor kapandı) + kalıcı/tek-hafta atama-kaldırma seçimi çalışıyor.
4. Öğrenci/öğretmen panelleri serbest gezinme + `bookableWeeks` kapılı; mobil bu/gelecek hafta seçici + cancel weekKey (T7 Minor kapandı).
5. Canlı smoke 5 senaryo PASS + testkurs baseline'a temiz döndü.
6. Çok-model denetim bulguları kapatıldı.
