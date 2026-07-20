# Etüt Hafta-Bazlı Rezervasyon — Faz 4: Görünürlük + Geçmiş — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Müdür-tarafı öğrenci etüt görünümü/geçmişi + yoklama etiketi + arşiv EtutReservation'a bağlansın; freeze-on-rollover cron'u geçmişi kalıcılaştırsın; Y3 yazma açıkları (ölü `type:'etut'` dalı + initWeek kilidi) kapansın; kritik sessiz-catch'ler temizlensin.

**Architecture:** Yeni lib yardımcıları (`listStudentEtutHistory` all-weeks sorgusu — index `[orgSlug,branch,studentId,weekKey]` hazır; `freezeRecurringWeek` — efektif RECURRING satırlarını somut WEEK satırlarına dondurur) + mevcut `listEtutlerForWeek`/`resolveEffective` üzerine route/panel kablolaması. Müdür öğrenci-detay etüt sekmesi kendi veri-çeken bileşenine geçer (`/api/etut-sablon/all` + hafta nav, Faz 3 panel deseniyle aynı).

**Tech Stack:** TS strict, vitest, lib/etut (reservations/rezervasyon/weeks), Prisma (EtutReservation/EtutSablon/Attendance/SlotBooking), React panelleri.

**Spec:** `docs/superpowers/specs/2026-07-19-etut-hafta-bazli-rezervasyon-design.md` §10-Faz4 (müdür merge + öğrenci geçmişi hafta nav + attendance snapshot + archive/cron + freeze-on-rollover + sessiz-hata).
**Denetim taşınanları:** Explore Faz-3 Orta (attendance bayat JSON — İLK İŞ), Codex Faz-2 Y3 (program route direct SlotBooking + initWeek kilitsiz), orijinal denetim gap #5 (attendance branch weekKey-join).

## Mustafa kararları (2026-07-20)

1. **İleri-hafta iptal:** ŞİMDİLİK SERBEST (öğrenci kendi rezervasyonunu her zaman iptal edebilir) — kurumla istişare sonrası istenirse pencere kapısı eklenir. Bu fazda: davranış canlı smoke ile REGRESYON-SABİTLENİR (T7 senaryo) + `cancelEtutV2`'ye karar yorumu.
2. **Y2 (kalıcı atamanın gelecek-hafta çakışmaları):** GÖRÜNÜRLÜK YETER — sessiz kabul; WEEK satırı kalıcıyı ezer, müdür görünümü çakışmayı gösterir, elle çözülür. Uyarı/red YOK. `booking.ts`'e karar yorumu + davranış smoke'ta belgelenir.
3. Hafta gezinme serbest + yazma kapıları `bookableWeeks` (Faz 3 kararı — müdür etüt sekmesinde de aynı desen).

## Global Constraints

- Dal `etut-hafta-bazli`; main'e push YOK; deploy YOK (cutover Faz 5).
- Yeni okuma yolları `deletedAt: null` süzgeçli — **TEK İSTİSNA (bilinçli, yorumla):** yoklama/arşiv GEÇMİŞ etiketleri silinmiş şablonun saatini de çözebilmeli → o lookup'larda deletedAt süzgeci UYGULANMAZ (satır zaten soft-delete, tarihsel etiket doğruluğu önce gelir).
- `app/api/program/route.ts` JSON `etutSablonlari` pass-through'una (satır ~159-185, ~237-245) DOKUNULMAZ (Faz 5 reconcile). Y3 temizliği YALNIZ SlotBooking'e etüt YAZAN/OKUYAN geçici-etüt dallarını kaldırır.
- Dış sözleşmeler korunur + yalnız eklenir: `/api/archive` `{ weeks }` şekli aynı (etüt satırları AYNI entry şekliyle eklenir); `/api/attendance/student` entry şekli aynı (alanlar dolmaya başlar).
- Kilit disiplini: `tdb().$transaction` + `lockResource` (reservations.ts); kilit sırası GLOBAL SABİT: `slotweek → slot-cell → student` (yeni slotweek kilidi en önce — deadlock-free).
- Transaction'lar YALNIZ `tdb().$transaction`; compound-where'lerde orgSlug/branch AÇIK.
- TDD; her commit öncesi `npm run build` + `npm test` (taban 353) yeşil; Türkçe commit; client bileşenleri lib'den yalnız `import type`.

---

### Task 1: `app/api/attendance/student` etüt etiketi → EtutSablon + EtutReservation (weekKey-join)

**Files:**
- Modify: `app/api/attendance/student/route.ts` (etüt dalı ~satır 13-19, 58-78)
- Modify: `lib/etut/rezervasyon.test.ts` DEĞİL — yeni saf yardımcı yoksa test route-level kalamaz; aşağıdaki saf `pickEtutLabel` için Create: test bloğu `lib/etut/attendance-label.test.ts` + Create: `lib/etut/attendance-label.ts`

**Interfaces (Produces):**
```ts
// lib/etut/attendance-label.ts — SAF: yoklama satırının etüt etiketi çözümü
export interface EtutLabelSource {
  sablon: { legacyId: string; start: string; end: string } | null;      // EtutSablon (deletedAt DAHİL — tarihsel etiket)
  reservation: { dersBranch: string; startsAt: string; endsAt: string } | null; // o haftanın efektif satırı (varsa)
}
export function pickEtutLabel(src: EtutLabelSource): { branch: string; slotLabel: string }
// Öncelik: reservation (weekKey-join: dersBranch + startsAt/endsAt snapshot) → sablon (saat, branch '') → boş.
```

- [ ] **Step 1: Failing testler** — `lib/etut/attendance-label.test.ts` (4 test):

```ts
import { describe, it, expect } from 'vitest';
import { pickEtutLabel } from './attendance-label';

describe('pickEtutLabel', () => {
  it('rezervasyon varsa branch + snapshot saati (şablon saatinden farklıysa bile rezervasyon anı kazanır)', () => {
    expect(pickEtutLabel({
      sablon: { legacyId: 'e1', start: '15:00', end: '16:00' },
      reservation: { dersBranch: 'Fizik', startsAt: '14:00', endsAt: '15:00' },
    })).toEqual({ branch: 'Fizik', slotLabel: '14:00–15:00' });
  });
  it('rezervasyon yoksa şablon saati, branch boş', () => {
    expect(pickEtutLabel({ sablon: { legacyId: 'e1', start: '15:00', end: '16:00' }, reservation: null }))
      .toEqual({ branch: '', slotLabel: '15:00–16:00' });
  });
  it('ikisi de yoksa boş etiket', () => {
    expect(pickEtutLabel({ sablon: null, reservation: null })).toEqual({ branch: '', slotLabel: '' });
  });
  it('rezervasyon var ama şablon silinmiş/yok → yine rezervasyon etiketi', () => {
    expect(pickEtutLabel({ sablon: null, reservation: { dersBranch: 'TYT Matematik', startsAt: '10:00', endsAt: '11:00' } }))
      .toEqual({ branch: 'TYT Matematik', slotLabel: '10:00–11:00' });
  });
});
```

- [ ] **Step 2: FAIL doğrula** → **Step 3: `attendance-label.ts` implementasyonu:**

```ts
// Yoklama geçmişi etüt etiketi (Faz 4 T1) — orijinal denetim gap #5'in kapanışı:
// branch HAFTA-SCOPED (EtutReservation weekKey-join, snapshot saatiyle); rezervasyon
// satırı yoksa şablon saatine düşer. SAF — route batch-lookup yapıp buraya verir.
export interface EtutLabelSource { /* yukarıdaki gibi */ }
export function pickEtutLabel(src: EtutLabelSource): { branch: string; slotLabel: string } {
  if (src.reservation) {
    return { branch: src.reservation.dersBranch, slotLabel: `${src.reservation.startsAt}–${src.reservation.endsAt}` };
  }
  if (src.sablon) return { branch: '', slotLabel: `${src.sablon.start}–${src.sablon.end}` };
  return { branch: '', slotLabel: '' };
}
```

- [ ] **Step 4: Route'u bağla** — `app/api/attendance/student/route.ts` etüt dalını değiştir:
  - Yerel `interface EtutSablon` + `getProgramTemplate`/`progCache` KALKAR.
  - Döngü ÖNCESİ batch-lookup (N+1 yok):
  ```ts
  // Etüt etiketleri: EtutSablon (deletedAt DAHİL — silinmiş şablonun tarihsel saati geçerli
  // etiket; deletedAt-süzgeci istisnası BİLİNÇLİ) + o haftanın efektif rezervasyonu
  // (weekKey-join: branch hafta-scoped, gap #5). JSON etutSablonlari OKUNMAZ (Faz 4 T1).
  const etutMatches = matched.filter((m): m is Extract<Matched, { isEtut: true }> => m.isEtut);
  const sablonRows = etutMatches.length
    ? await tdb().etutSablon.findMany({ where: { legacyId: { in: [...new Set(etutMatches.map(m => m.etutId))] } } })
    : [];
  const sablonByLegacy = new Map(sablonRows.map(r => [r.legacyId, r]));
  const weekKeys = [...new Set(etutMatches.map(m => getWeekKey(new Date(m.rec.date))))];
  const orgSlug = currentOrg(); const branch = currentBranch();
  const rezRows = etutMatches.length
    ? await tdb(orgSlug, branch).etutReservation.findMany({
        where: { orgSlug, branch, sablonId: { in: sablonRows.map(r => r.id) }, OR: [{ weekKey: { in: weekKeys } }, { weekKey: RECURRING_WEEKKEY }] },
      })
    : [];
  const effByWeek = new Map(weekKeys.map(wk => [wk, resolveEffective(rezRows, wk)]));
  ```
  (import: `currentOrg, currentBranch` `@/lib/tenant`; `resolveEffective, RECURRING_WEEKKEY` `@/lib/etut/reservations`; `pickEtutLabel` `@/lib/etut/attendance-label`.)
  - Etüt entry üretimi:
  ```ts
  if (m.isEtut) {
    const sb = sablonByLegacy.get(m.etutId) ?? null;
    const wk = getWeekKey(new Date(m.rec.date));
    const eff = sb ? effByWeek.get(wk)?.get(sb.id) ?? null : null;
    const label = pickEtutLabel({
      sablon: sb ? { legacyId: sb.legacyId, start: sb.start, end: sb.end } : null,
      reservation: eff ? { dersBranch: eff.dersBranch, startsAt: eff.startsAt, endsAt: eff.endsAt } : null,
    });
    entries.push({
      date: m.rec.date, dayLabel: DAY_NAMES_TR[d.getDay()],
      teacherId: teacher.legacyId, teacherName: teacher.name,
      branch: label.branch, cls: m.rec.cls,
      lessonNo: null, slotLabel: label.slotLabel,
      subBranch: '', isEtut: true, status: m.status,
    });
  }
  ```
- [ ] **Step 5:** `npm run build && npm test` yeşil (353+4). **Step 6: Commit** — `feat(etüt-faz4): yoklama etüt etiketi EtutSablon+EtutReservation weekKey-join'ine geçti (bayat JSON okuma kapandı, branch hafta-scoped)`

---

### Task 2: `lib/etut` — öğrenci all-weeks geçmişi + freeze-on-rollover yardımcıları (lib-only)

**Files:**
- Create: `lib/etut/history.ts`, `lib/etut/history.test.ts`
- Modify: `lib/etut/reservations.ts` (yalnız EXPORT eklenmez — dokunulmaz; freeze kendi dosyasında)

**Interfaces (Produces — Task 3/5 kullanır):**
```ts
// lib/etut/history.ts
export interface EtutHistoryEntry {
  day: number; dayLabel: string; slotId: string; slotLabel: string;   // ArchiveEntry-uyumlu (HistoryModal şekli)
  studentId: string; studentName: string; studentCls: string;
  bookedBy: string; fixed: boolean; teacherId: string; teacherName: string; branch: string;
}
export function buildEtutHistoryWeeks(
  rows: EtutReservation[],                       // status ACTIVE + scope WEEK ön-süzülmüş satırlar
  teacherNameById: Map<string, string>,          // legacyId → ad
): { weekKey: string; entries: EtutHistoryEntry[] }[]   // SAF; hafta DESC, gün+saat ASC
export async function listStudentEtutHistory(studentId: string): Promise<{ weekKey: string; entries: EtutHistoryEntry[] }[]>
export async function listTeacherEtutHistory(teacherLegacyId: string): Promise<{ weekKey: string; entries: EtutHistoryEntry[] }[]>
export function selectRecurringToFreeze(effective: Map<string, EtutReservation>): EtutReservation[]  // SAF: scope==='RECURRING' satırlar
export async function freezeRecurringWeek(weekKey: string): Promise<number>  // dondurulmuş satır sayısı
```

- [ ] **Step 1: Failing testler** — `history.test.ts` (6 test):

```ts
// rez üretici: { weekKey:'2026-W30', scope:'WEEK', status:'ACTIVE', sablonId:'c1', teacherId:'t1',
//   studentId:'s1', studentName:'İrem', studentCls:'11A', dersBranch:'Fizik', bookedByRole:'student',
//   dayIndex:1, startsAt:'14:00', endsAt:'15:00' } as unknown as EtutReservation — override'lı helper.
it('haftalara gruplar, hafta DESC sıralar', ...)          // W31+W30 satırları → [W31, W30]
it('hafta içinde gün+saat ASC sıralar', ...)
it('entry alanları ArchiveEntry şekliyle eşleşir (slotId etut:<sablonId>, slotLabel start–end, branch=dersBranch, teacherName map’ten)', ...)
it('öğretmen adı map’te yoksa teacherId gösterilir (boş değil)', ...)
it('selectRecurringToFreeze: yalnız scope RECURRING efektif satırlar döner (WEEK satırları dondurulmaz)', ...)
it('selectRecurringToFreeze: boş map → boş liste', ...)
```

- [ ] **Step 2: FAIL** → **Step 3: implementasyon:**

```ts
// lib/etut/history.ts — Faz 4 T2. Öğrenci/öğretmen TÜM-haftalar etüt geçmişi
// (index [orgSlug,branch,studentId,weekKey] / [orgSlug,branch,teacherId,weekKey] hazır — Faz 1)
// + freeze-on-rollover (spec §3.3: recurring sahibi değişince geçmiş bozulmasın diye biten
// haftanın efektif RECURRING satırları somut WEEK/ACTIVE satırlara dondurulur).
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { ALL_DAYS } from '@/lib/constants';
import { getAllTeachers } from '@/lib/slots';
import { getWeekReservations, resolveEffective, RECURRING_WEEKKEY } from './reservations';
import type { EtutReservation } from '@prisma/client';

export function buildEtutHistoryWeeks(rows, teacherNameById) {
  const dayLabel = new Map(ALL_DAYS.map(d => [d.index, d.label]));
  const byWeek = new Map<string, EtutHistoryEntry[]>();
  for (const r of rows) {
    const entry: EtutHistoryEntry = {
      day: r.dayIndex, dayLabel: dayLabel.get(r.dayIndex) || '',
      slotId: `etut:${r.sablonId}`, slotLabel: `${r.startsAt}–${r.endsAt}`,
      studentId: r.studentId, studentName: r.studentName, studentCls: r.studentCls,
      bookedBy: r.bookedByRole, fixed: false,
      teacherId: r.teacherId, teacherName: teacherNameById.get(r.teacherId) ?? r.teacherId,
      branch: r.dersBranch,
    };
    (byWeek.get(r.weekKey) ?? byWeek.set(r.weekKey, []).get(r.weekKey)!).push(entry);
  }
  return [...byWeek.entries()]
    .map(([weekKey, entries]) => ({ weekKey, entries: entries.sort((a, b) => (a.day - b.day) || a.slotLabel.localeCompare(b.slotLabel)) }))
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey));
}

// status ACTIVE + scope WEEK: yalnız SOMUT haftalar (recurring '*' marker'ı geçmiş listesi değildir;
// dondurulmamış recurring haftalar freeze-on-rollover cron'u işledikçe somutlaşır).
export async function listStudentEtutHistory(studentId: string) {
  const orgSlug = currentOrg(); const branch = currentBranch();
  const [rows, teachers] = await Promise.all([
    tdb(orgSlug, branch).etutReservation.findMany({
      where: { orgSlug, branch, studentId, status: 'ACTIVE', scope: 'WEEK' },
    }),
    getAllTeachers(),
  ]);
  return buildEtutHistoryWeeks(rows, new Map(teachers.map(t => [t.id, t.name])));
}
// listTeacherEtutHistory: AYNI gövde, where'de studentId yerine teacherId — kopya değil, ortak
// iç fonksiyona (whereExtra parametresi) çıkar.

export function selectRecurringToFreeze(effective: Map<string, EtutReservation>): EtutReservation[] {
  return [...effective.values()].filter(r => r.scope === 'RECURRING');
}

// Biten haftanın efektif RECURRING satırlarını somut WEEK/ACTIVE satırlara dondurur.
// resolveEffective WEEK-öncelikli olduğundan efektif RECURRING dönen haftada o sablon için
// WEEK satırı KESİN yoktur (tombstone dahil) → createMany güvenli; skipDuplicates yarış guard'ı.
export async function freezeRecurringWeek(weekKey: string): Promise<number> {
  const orgSlug = currentOrg(); const branch = currentBranch();
  const rows = await getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey);
  const toFreeze = selectRecurringToFreeze(resolveEffective(rows, weekKey));
  if (!toFreeze.length) return 0;
  const res = await tdb(orgSlug, branch).etutReservation.createMany({
    data: toFreeze.map(r => ({
      orgSlug, branch, sablonId: r.sablonId, teacherId: r.teacherId,
      scope: 'WEEK' as const, status: 'ACTIVE' as const, weekKey, effectiveFromWeek: null,
      studentId: r.studentId, studentName: r.studentName, studentCls: r.studentCls,
      dersBranch: r.dersBranch, bookedByRole: r.bookedByRole, bookedById: r.bookedById,
      bookedAt: r.bookedAt, dayIndex: r.dayIndex, startsAt: r.startsAt, endsAt: r.endsAt,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
```
(`EtutHistoryEntry` interface'i dosyada tam yazılır; `listTeacherEtutHistory` ortak iç fonksiyonla.)

- [ ] **Step 4: PASS** (353+4+6). **Step 5: Commit** — `feat(etüt-faz4): all-weeks etüt geçmişi (listStudent/TeacherEtutHistory) + freeze-on-rollover yardımcısı (lib+test)`

---

### Task 3: `/api/archive` etüt haftaları + cron freeze entegrasyonu

**Files:**
- Modify: `app/api/archive/route.ts` (EtutReservation haftalarını merge et)
- Modify: `app/api/cron/weekly/route.ts` (`rollTenant` içine freeze adımı)

**Consumes:** Task 2 (`listStudentEtutHistory`/`listTeacherEtutHistory`/`freezeRecurringWeek`).

- [ ] **Step 1: archive route** — SlotBooking `weeksMap` kurulduktan SONRA etüt haftalarını AYNI entry şekliyle merge et:
  ```ts
  // Etüt geçmişi EtutReservation'dan (Faz 4 T3) — SlotBooking'de etüt artık yok (Faz 7c-3
  // sonrası ders-only); HistoryModal 'Geçmiş Etütler' bu satırlarla dolar. Entry şekli
  // ArchiveEntry ile birebir (lib/etut/history.ts). Ders satırları (SlotBooking) aynen kalır.
  const etutWeeks = type === 'teacher' ? await listTeacherEtutHistory(id) : await listStudentEtutHistory(id);
  for (const w of etutWeeks) {
    (weeksMap[w.weekKey] ||= []).push(...w.entries);
  }
  ```
  (import `listStudentEtutHistory, listTeacherEtutHistory` — `@/lib/etut/history`. `weeks` sıralaması mevcut sort'la aynı kalır.)
- [ ] **Step 2: cron freeze** — `rollTenant()` içinde arşiv yazımından SONRA, `initWeekForTeacher` Promise.all'ından ÖNCE:
  ```ts
  // Faz 4: biten haftanın efektif RECURRING etüt rezervasyonlarını somut WEEK satırlarına
  // dondur (spec §3.3 freeze-on-rollover) — recurring sahibi sonradan değişse/iptal edilse
  // bile geçmiş haftaların görünümü (arşiv/geçmiş listeleri) değişmez.
  const frozenEtut = await freezeRecurringWeek(currentWeek);
  ```
  Dönüş objesine `frozenEtut` ekle (`{ previousWeek, newWeek, teachers, frozenEtut }`). (import `freezeRecurringWeek` — `@/lib/etut/history`.)
- [ ] **Step 3:** `npm run build && npm test` yeşil. **Step 4: Commit** — `feat(etüt-faz4): arşiv EtutReservation etüt haftalarını içeriyor + haftalık cron freeze-on-rollover (geçmiş kalıcılaştı)`

---

### Task 4: Müdür öğrenci-detay "Etüt Geçmişi" — tablo kaynağı + hafta nav + etüt iptali

**Files:**
- Create: `app/_components/director/StudentEtutTab.tsx`
- Modify: `app/_components/director/StudentList.tsx` (StudentExpandedView 'etut' sekmesi + prop temizliği)
- Modify: `app/_components/director/SinifOgrenci.tsx` (allSlots/onCancelBooking prop zinciri temizliği; readOnly/showToast aktarımı)
- Modify: `app/_components/DirectorPanel.tsx` (SinifOgrenci çağrısından allSlots/onCancelBooking kaldır; catch:117,130 loglama — Task 6 kapsamı DEĞİL, burada yalnız prop değişikliği)

**Interfaces (Consumes):** `/api/etut-sablon/all?week=` → `{ weekKey, etutler: EtutAllDTO[], bookableWeeks }` (Faz 3 T1); iptal → `DELETE /api/etut-sablon/rezervasyon` `{ teacherId, etutId, weekKey, scope: 'week' }` (Faz 2b); `WeekNav/getAdjacentWeek/api` → `../shared`; `getWeekKey` → `@/lib/constants`; `StudentBookingsView` + `BookingSlotEntry` mevcut.

- [ ] **Step 1: `StudentEtutTab.tsx`** — kendi veri-çeken sekme (TeachersTab/TeacherEtutReservations deseni):

```tsx
'use client';

// Müdür öğrenci-detayı "Etüt Geçmişi" sekmesi (Faz 4 T4) — kaynak EtutReservation
// (/api/etut-sablon/all efektif listesi, hafta-bazlı) + SERBEST hafta nav (Faz 3 kararı).
// Eski kaynak DirectorPanel allSlots (SlotBooking) idi — etüt oraya artık yazılmıyor,
// İrem'in rezervasyonu görünmüyordu (bu işin ilk şikayeti). İptal: hafta-tombstone
// (scope:'week'); seri yönetimi ProgramEditor'da.
import { useState, useEffect, useCallback } from 'react';
import { getWeekKey } from '@/lib/constants';
import { api, getAdjacentWeek, WeekNav } from '../shared';
import { StudentBookingsView } from '../StudentBookingsView';
import type { BookingSlotEntry, BookingCancelArgs, EtutAllDTO } from '../student-types';
import type { ShowToast } from '../types';
import LoadingBox from '../Loading';

interface StudentEtutTabProps {
  student: { id: string };
  readOnly?: boolean;
  showToast: ShowToast;
}

export default function StudentEtutTab({ student, readOnly = false, showToast }: StudentEtutTabProps) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [slots, setSlots] = useState<BookingSlotEntry[] | null>(null);

  const load = useCallback(async (wk: string) => {
    setSlots(null);
    try {
      const d = await api<{ etutler?: EtutAllDTO[] }>(`/api/etut-sablon/all?week=${wk}`);
      setSlots((d.etutler || []).filter(e => e.studentId === student.id).map(e => ({
        kind: 'etut', etutId: e.id, teacherId: e.teacherId, teacherName: e.teacherName,
        day: e.dayIndex, dayLabel: e.dayLabel, slotId: `etut:${e.id}`, slotLabel: `${e.start}–${e.end}`,
        booked: e.booked, studentId: e.studentId, studentName: e.studentName,
        branch: e.branch ?? undefined, bookedBy: e.bookedBy ?? undefined, scope: e.scope,
      })));
    } catch (err) { showToast((err as Error).message, 'error'); setSlots([]); }
  }, [student.id, showToast]);

  useEffect(() => { load(weekKey); }, [load, weekKey]);

  const handleCancel = async ({ teacherId, etutId }: BookingCancelArgs) => {
    try {
      await api('/api/etut-sablon/rezervasyon', { method: 'DELETE', body: JSON.stringify({ teacherId, etutId, weekKey, scope: 'week' }) });
      showToast('Etüt iptal edildi');
      load(weekKey);
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <WeekNav weekKey={weekKey} onPrev={() => setWeekKey(w => getAdjacentWeek(w, -1))} onNext={() => setWeekKey(w => getAdjacentWeek(w, 1))} />
      </div>
      {slots === null
        ? <LoadingBox height="h-24" />
        : <StudentBookingsView student={student} allSlots={slots} onCancel={readOnly ? undefined : handleCancel} />}
    </div>
  );
}
```

- [ ] **Step 2: Prop zinciri temizliği** —
  - `StudentList.tsx` `StudentExpandedView`: `allSlots`/`onCancelBooking` propları KALKAR; yerine `readOnly?: boolean` + `showToast: ShowToast` gelir; `'etut'` sekmesi `<StudentEtutTab student={student} readOnly={readOnly} showToast={showToast} />`. `StudentListProps`'tan da `allSlots`/`onCancelBooking` kalkar (aynı ekleme: readOnly/showToast — mevcutta showToast yoksa ekle).
  - `SinifOgrenci.tsx`: `allSlots`/`onCancelBooking` propları KALKAR (satır ~34, ~55, ~204); `readOnly`+`showToast` zaten var/aktarılıyor mu kontrol et, yoksa geçir.
  - `DirectorPanel.tsx` SinifOgrenci çağrısı (~248-277): `allSlots={allSlots}` ve `onCancelBooking={...}` satırları KALKAR (`allSlots` state'i DirectorPanel'de KALIR — HistoryModal currentEntries + TeachersTab kullanıyor).
  - tsc'nin gösterdiği tüm kullanım yerlerini düzelt; başka tüketici kırılmadığını `npx tsc --noEmit` ile kanıtla.
- [ ] **Step 3:** `npm run build && npm test` yeşil. **Step 4: Commit** — `feat(etüt-faz4): müdür öğrenci-detay Etüt sekmesi EtutReservation kaynağına + serbest hafta nav + hafta-tombstone iptal (İrem senaryosu müdür panelinde kapandı)`

---

### Task 5: Y3 — program route ölü etüt dalları + initWeek/slots hafta-kilidi

**Files:**
- Modify: `app/api/program/route.ts` (GET ~71-77 geçici-etüt okuma; POST ~203-206 etüt yazma dalı)
- Modify: `lib/slots.ts` (`initWeekForTeacher` ~267-336 — tx + slotweek kilidi)
- Modify: `app/api/slots/route.ts` (POST/DELETE tx'lerine slotweek kilidi — mevcut kilitlerden ÖNCE)

**Consumes:** `lockResource` (lib/etut/reservations.ts). Kilit anahtarı: `` `slotweek:${orgSlug}:${branch}:${weekKey}:${teacherCUID}` `` — DİKKAT: SlotBooking.teacherId **Teacher.id (CUID)** kullanır (EtutSablon'un legacyId konvansiyonundan FARKLI); kilit anahtarında da CUID kullan, iki yol aynı değeri türetmeli.

- [ ] **Step 1: Ölü dal temizliği** — `program/route.ts`:
  - GET: satır ~70-77 "Geçici etüt" bloğunu KALDIR (etüt artık EtutReservation'da; SlotBooking'e etüt yazan yol kalmıyor — aşağıda). "Geçici ders" bloğu AYNEN kalır.
  - POST: satır ~203-206 `entry.type === 'etut' && entry.studentId` hücre-yazma dalını ve ~205-206 `type === 'etut'` boş-hücre dalını KALDIR; yerine:
  ```ts
  } else if (entry.type === 'etut') {
    continue; // Faz 4 Y3: etüt SlotBooking'e YAZILMAZ (EtutReservation tek yol — bookEtut);
              // eski istemci kalıntısı 'etut' girdisi sessizce yok sayılır (UI artık göndermiyor).
  ```
  - Grep-kanıt: `type:'etut'` veya `type: 'etut'` GÖNDEREN istemci kodu app/_components altında YOK (rapora yaz).
- [ ] **Step 2: `initWeekForTeacher` kilidi** — gövdeyi `tdb().$transaction` içine al:
  ```ts
  // Faz 4 Y3: hafta-grid yeniden kurulumu ile eşzamanlı slot rezervasyonu yarışı — okuma
  // (existingRows) ile deleteMany arasında commit olan booking kayboluyordu. slotweek kilidi
  // /api/slots POST/DELETE ile AYNI anahtar; kilit sırası GLOBAL: slotweek → slot-cell → student.
  const orgSlug = currentOrg(); const branch = currentBranch();
  await tdb(orgSlug, branch).$transaction(async (rawTx) => {
    const tx = rawTx as unknown as Prisma.TransactionClient;   // booking.ts'teki tip köprüsü gerekçesi
    await lockResource(tx, `slotweek:${orgSlug}:${branch}:${weekKey}:${teacher.id}`);
    // existingRows okuma + newRows hesabı + deleteMany + createMany — HEPSİ tx içinde, tx client'la
  });
  ```
  (Mevcut okuma/hesap/yazma adımları tx client (`tx.slotBooking...`) kullanacak şekilde taşınır; `getDaySlotTimes` tx-dışı kalabilir (config okuması). import: `lockResource` — dosya sunucu-lib, döngüsel import YOK (reservations.ts slots.ts'i import etmiyor — DOĞRULA; ediyorsa lockResource'u `lib/etut/locks.ts`'e çıkarıp iki taraftan import et).)
- [ ] **Step 3: `/api/slots` POST/DELETE** — mevcut tx'lerde İLK kilit olarak (mevcut `lockResource(slot:...)` çağrısından ÖNCE):
  ```ts
  await lockResource(tx, `slotweek:${orgSlug}:${branch}:${weekKey}:${teacherRow.id}`);
  ```
  (POST'ta teacher CUID zaten çözülüyor — hangi değişkende olduğunu route'tan bul; DELETE'te de aynı. Kilit sırası yorumunu her iki noktaya yaz.)
- [ ] **Step 4:** `npm run build && npm test` yeşil; `npx tsc --noEmit` temiz. **Step 5: Commit** — `fix(etüt-faz4): Y3 kapandı — program route etüt dalları kaldırıldı (EtutReservation tek yol) + initWeek/slots slotweek kilidi (grid-rebuild yarışı)`

---

### Task 6: Kritik sessiz-catch temizliği + karar yorumları

**Files:**
- Modify: `app/_components/director/HistoryModal.tsx` (:72 arşiv, :84 attendance)
- Modify: `app/_components/director/StudentList.tsx` (:246 class-schedule)
- Modify: `app/_components/DirectorPanel.tsx` (:117 guidance, :130 slot-times)
- Modify: `lib/etut/booking.ts` (yalnız YORUM: 2 karar notu)

- [ ] **Step 1: HistoryModal** — iki catch'e hata durumu: `const [loadError, setLoadError] = useState<string | null>(null);` — arşiv catch'i `setLoadError('Arşiv yüklenemedi: ' + (e as Error).message)`; attendance catch'i mevcut boş-özet fallback'ini korur AMA `setLoadError(...)` de yazar. Render: etut/devamsizlik içeriklerinin üstünde `{loadError && <div className="card p-3 mb-3 text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{loadError}</div>}`.
- [ ] **Step 2: StudentList:246** — class-schedule catch'i: boş liste yerine hata state'i + aynı kırmızı satır deseni (bileşendeki mevcut state yapısına uyarla; `showToast` erişimi yoksa yerel hata satırı yeterli).
- [ ] **Step 3: DirectorPanel** — `:117` `loadPendingGuidance` catch → `console.warn('[director] rehberlik bekleyen sayısı yüklenemedi:', e)` (rozet boş kalır — davranış aynı, artık teşhis edilebilir); `:130` slot-times `.catch(() => {})` → `.catch(e => { console.warn('[director] slot-times yüklenemedi:', e); showToast('Ders saatleri yüklenemedi', 'error'); })`.
- [ ] **Step 4: Karar yorumları** — `lib/etut/booking.ts`:
  - `cancelEtutV2` 'week' dalının başına: `// ÜRÜN KARARI (Mustafa 2026-07-20, Faz 3 denetimi): öğrenci iptaline hafta-penceresi UYGULANMAZ — müdürün ileri-haftaya yerleştirdiği rezervasyonu da öğrenci iptal edebilir (esneklik; eski davranışla uyumlu; cancelLockHours ayrıca korur). İstişare sonrası kapatılmak istenirse: actorRole==='student' && !allowedBookingWeeks('student').includes(weekKey) → 403. Davranış T7 canlı smoke ile regresyon-sabit.`
  - `bookEtut` RECURRING yolu yakınına: `// ÜRÜN KARARI (Mustafa 2026-07-20, Faz 4): kalıcı atamanın GELECEK-hafta çakışmaları taranmaz/uyarılmaz (Y2 — 'görünürlük yeter'): WEEK satırı kalıcıyı ezer, müdür görünümü çakışmayı gösterir, elle çözülür.`
- [ ] **Step 5:** `npm run build && npm test` yeşil. **Step 6: Commit** — `fix(etüt-faz4): kritik sessiz-catch'ler görünür hataya çevrildi (HistoryModal/StudentList/DirectorPanel) + ileri-iptal ve Y2 ürün-kararı yorumları`

---

### Task 7: Kapanış — canlı smoke + gate + doküman

**Files:** scratchpad smoke scripti (repo'ya girmez), plan checkboxları.

- [ ] **Step 1: Canlı smoke (testkurs, servis-katmanı, Faz 3 T7 kalıbı — baseline ölç/geri-dön, id-listeli temizlik):**
  1. **Arşiv/geçmiş:** öğrenciye 2 farklı haftaya WEEK rezervasyonu yaz → `listStudentEtutHistory` iki haftayı DESC sırayla, doğru entry alanlarıyla döner; `/api/archive` şekli (route-level değil servis-level: `listStudentEtutHistory` + SlotBooking merge mantığı) tutarlı.
  2. **Freeze:** müdür RECURRING ataması yaz → `freezeRecurringWeek(currentWeek)` → o hafta için somut WEEK satırı OLUŞTU (count=1); İKİNCİ çağrı count=0 (idempotent, skipDuplicates); tombstone'lu haftada freeze o şablonu ATLAR.
  3. **Yoklama etiketi:** rezervasyonlu şablon+hafta için attendance-label akışı (pickEtutLabel'e giden lookup'ların DB karşılığı): EtutReservation'lı haftada branch dolu; şablonu soft-delete edip lookup'ın yine saat döndürdüğünü doğrula → restore.
  4. **İleri-hafta iptal REGRESYONU (Mustafa kararı):** müdür aktörüyle öğrenciye +2 haftaya WEEK rezervasyonu → öğrenci aktörüyle `cancelEtutV2(scope:'week', weekKey=+2)` → BAŞARILI (403 YOK) + tombstone doğru haftada.
  5. **initWeek kilidi düz-yol:** `initWeekForTeacher` testkurs öğretmeninde çalışır, grid satır sayısı öncekiyle aynı (kilit davranışı bozmadı).
  Cleanup: yaratılan EtutReservation satırları id-listesiyle sil; baseline (EtutSablon=4, EtutReservation=0) birebir teyit.
- [ ] **Step 2: Grep gate'leri:** `grep -rn "etutSablonlari" app/ lib/ --include="*.ts" --include="*.tsx"` → yalnız `app/api/program/route.ts` pass-through (~159-185, ~237-245) + `lib/slots.ts` tip/yardımcı + göç scriptleri (attendance/student SONUÇTA YOK); `grep -n "type === 'etut'\|type:'etut'" app/` → program route'ta yalnız yeni `continue` dalı.
- [ ] **Step 3:** Tam gate: `npm run build` + `npm test` yeşil; plan checkboxları işaretle (Step 4 hariç); kapanış commit — `docs(etüt-faz4): Faz 4 tamamlandı — görünürlük+geçmiş EtutReservation'da, freeze-on-rollover canlı, Y3 kapandı`
- [ ] **Step 4 (controller):** Faz 4 BÜTÜNÜ çok-model denetimi (Codex + Gemini `--sandbox --dangerously-skip-permissions` + Explore) — özel sorular: (a) freeze idempotency + tombstone etkileşimi, (b) slotweek kilit sırasının 3 yoldaki tutarlılığı (deadlock analizi), (c) arşiv/geçmiş entry-şekil uyumu (HistoryModal kırılmadı mı), (d) attendance deletedAt-istisnasının sınırı (yalnız tarihsel etiket mi). Bulgular kapanmadan Faz 5'e geçilmez.

## Faz 4 Bitiş Kriterleri

1. Müdür panelinde öğrenci etüt görünümü/geçmişi EtutReservation'dan, hafta nav'lı; İrem senaryosu müdür tarafında da kapandı.
2. Yoklama etüt etiketi hafta-scoped (weekKey-join), silinmiş şablonda da doğru; bayat JSON okuyucusu attendance'ta sıfır.
3. Arşiv etüt haftalarını içeriyor; haftalık cron freeze-on-rollover ile geçmişi kalıcılaştırıyor (idempotent).
4. Y3 kapandı: SlotBooking'e etüt yazan/okuyan dal yok; initWeek/slots slotweek kilidiyle yarışsız.
5. İleri-hafta iptal serbestliği canlı regresyon senaryosuyla sabitlendi; Y2 kararı kodda belgeli.
6. Kritik sessiz-catch'ler görünür; canlı smoke 5/5 + testkurs temiz; çok-model denetim bulguları kapatıldı.
