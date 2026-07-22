// bookEtut/cancelEtutV2 — birleşik rezervasyon orkestratörü (Faz 2b Task 4, spec §4/§9).
// Tüm yazma yolları (web + mobil) BURADAN geçecek (Task 5-6 route adaptörleri bağlar).
// İş kuralları burada YOK — decideBooking (booking-rules.ts) SAF karar çekirdeğinde;
// bu dosya yalnız I/O (DB okuma/yazma + tx + audit) + eski davranışla BİREBİR uyumlu
// girdi doğrulama (hedef öğrenci çözümü, tek-aday ders otomatiği — aşağıda saf export).
import type { EtutReservation, Prisma } from '@prisma/client';
import type { Session } from '@/lib/auth';
import { canManage } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { getOrgConfig } from '@/lib/config';
import { logAudit, actorFrom } from '@/lib/audit';
import { getAllTeachers, getAllStudents, slotStartTime } from '@/lib/slots';
import { getSablonForBooking } from './sablon-service';
import { decideBooking, type BookingContext } from './booking-rules';
import { currentWeekKeyTSI, allowedBookingWeeks, isValidWeekKey, type BookingRole } from './weeks';
import { levelPoolForStudent } from './level-pool';
import {
  getWeekReservations, resolveEffective, upsertWeekReservation, upsertRecurring,
  cancelToTombstone, cancelRecurring, lockResource, lockStudentWeek, RECURRING_WEEKKEY, type ReservationWrite,
} from './reservations';
import { normalizeEtutBookings } from './student-week';
import { toMin } from './overlap';

// weekKey doğrulama (Faz 2 audit-fix FIX-C, isValidWeekKey — W00/W54+ artık "biçimi tutuyor"
// sayılmıyor, weeks.ts'teki ISO-doğru aralığa göre). WEEK: mobil deseniyle uyumlu — format
// tutmuyorsa 400 ile reddetmek yerine geçerli haftaya düş. RECURRING: AÇIKÇA verilmiş ama
// geçersiz bir weekKey SESSİZCE düşürülMEZ — upsertRecurring bunu effectiveFromWeek'e yazar;
// örn. '2026-W99' resolveEffective'in string karşılaştırmasında HER ZAMAN gerçek haftalardan
// büyük kalır → seri ASLA effektif olmaz ("ölü seri"). weekKey hiç verilmemişse (undefined,
// tipik PATCH akışı) sorun yok — currentWeekKeyTSI()'ye düşer, hata YOK.
function normalizeWeekKey(weekKey: string | undefined, scope: 'WEEK' | 'RECURRING' = 'WEEK'): string {
  if (weekKey === undefined) return currentWeekKeyTSI();
  if (isValidWeekKey(weekKey)) return weekKey;
  if (scope === 'RECURRING') throw new HttpError(400, 'Geçersiz hafta');
  return currentWeekKeyTSI();
}

// Rehberin salt-okunur olup olmadığı — app/api/slots/route.ts POST/DELETE (satır 105-112 /
// 294-300) ile AYNI desen: yalnız role==='counselor' iken config.permissions okunur.
// canManage(session) counselor için AYNI kontrolü yapar (auth.ts:78-85); burada AYRI
// tutuyoruz çünkü decideBooking rule 1'in kendi (daha spesifik) mesajı için ayrı bayrak gerekiyor.
async function isReadOnlyCounselor(session: Session, orgSlug: string, branch: string): Promise<boolean> {
  if (session.role !== 'counselor') return false;
  const perms = await getOrgConfig('permissions', orgSlug, branch);
  return !!perms?.counselor?.readOnly;
}

// ── Saf yardımcılar (birim testli — booking.test.ts) ──────────────────────────

// Hedef öğrenci çözümü — lib/etut/rezervasyon.ts reserveEtut satır 76-87 ile BİREBİR:
// öğrenci kendini, öğretmen SADECE kendi etüdüne (aksi halde 403), müdür/rehber (director/
// counselor — BookingRole) girdideki studentId'yi hedefler; başka rol (örn. veli) → 403
// 'Yetkisiz'. Hedef boş kalırsa 400 'Öğrenci belirtilmedi' (legacy'nin AYNI birimi — DB'ye
// gitmeden, saf girdi doğrulaması).
export function resolveTargetStudent(
  actorRole: string,
  actorId: string,
  teacherId: string,
  inputStudentId: string | undefined,
): string {
  let targetStudentId: string | undefined;
  if (actorRole === 'student') {
    targetStudentId = actorId;
  } else if (actorRole === 'teacher') {
    if (teacherId !== actorId) throw new HttpError(403, 'Sadece kendi etütlerinize öğrenci yazabilirsiniz');
    targetStudentId = inputStudentId;
  } else if (actorRole === 'director' || actorRole === 'counselor') {
    targetStudentId = inputStudentId;
  } else {
    throw new HttpError(403, 'Yetkisiz');
  }
  if (!targetStudentId) throw new HttpError(400, 'Öğrenci belirtilmedi');
  return targetStudentId;
}

// Tek-aday ders otomatiği — lib/etut/rezervasyon.ts reserveEtut satır 115-119 ile BİREBİR,
// TEK farkla: havuz kaynağı sınıf-listesi DEĞİL öğrencinin DÜZEY havuzu (spec §4a —
// levelPoolForGroup; decideBooking kural 8'in kullandığı AYNI kaynak, tutarlılık için).
// branch açıkça verilmişse (boş string HARİÇ — falsy) aynen döner; geçerliliği decideBooking
// doğrular. Verilmemişse öğretmen branşı ∩ havuz TEK elemansa otomatik seçilir, değilse
// (0 veya 2+ aday) undefined — decideBooking 'Geçersiz veya seçilmemiş ders...' ile reddeder.
export function autoPickBranch(
  teacherBranches: string[],
  levelPool: string[],
  requested: string | undefined,
): string | undefined {
  if (requested) return requested;
  const candidates = teacherBranches.filter((b) => levelPool.includes(b));
  return candidates.length === 1 ? candidates[0] : undefined;
}

// ── bookEtut ────────────────────────────────────────────────────────────────

export interface BookEtutInput {
  teacherId: string;
  etutId: string; // EtutSablon.legacyId
  weekKey?: string;
  branch?: string;
  studentId?: string;
  scope?: 'WEEK' | 'RECURRING';
  force?: boolean;
  reason?: string;
}

export async function bookEtut(session: Session, input: BookEtutInput): Promise<EtutReservation> {
  const actorRole = session.role;
  const actorId = String(session.id ?? '');
  const scope: 'WEEK' | 'RECURRING' = input.scope === 'RECURRING' ? 'RECURRING' : 'WEEK';
  const weekKey = normalizeWeekKey(input.weekKey, scope);

  // Hedef öğrenci — DB'ye gitmeden, rol ihlallerini en erken noktada keser (legacy sırası).
  const targetStudentId = resolveTargetStudent(actorRole, actorId, input.teacherId, input.studentId);

  const orgSlug = currentOrg();
  const branch = currentBranch();

  const [isManagerActor, readOnlyCounselor] = await Promise.all([
    canManage(session),
    isReadOnlyCounselor(session, orgSlug, branch),
  ]);

  // erken çıkış — tx/lock açmadan; nihai otorite decideBooking kural 1 (aşağıda, tx içinde
  // AYNI ctx.actor.readOnlyCounselor bayrağıyla tekrar değerlendirilir — burası yalnız ucuz
  // bir fast-path, review bulgusu: cancelEtutV2 ile tutarlılık için eklendi).
  if (readOnlyCounselor) throw new HttpError(403, 'Salt-okunur rehber etüt rezervasyonu yapamaz');

  // Force bypass yalnız isManager+force birlikte anlamlı (decideBooking kural 10 — force
  // TEK BAŞINA hiçbir şeyi geçmez). Reason zorunluluğu da bu yüzden yalnız bu kombinasyonda:
  // non-manager'dan gelen force zaten decideBooking'de sessizce yok sayılır, burada da
  // reddedilmeye gerek yok (brief'in "force bypass'ta reason zorunlu" kuralı — bypass
  // yalnız müdür/rehber için GERÇEK bir kapasite olduğundan bu şekilde yorumlandı).
  if (isManagerActor && input.force && !input.reason?.trim()) {
    throw new HttpError(400, 'Bypass için gerekçe (reason) zorunlu');
  }

  const [sablonRow, allTeachers, allStudents, etutConfig] = await Promise.all([
    getSablonForBooking(input.teacherId, input.etutId),
    getAllTeachers(),
    getAllStudents(),
    getOrgConfig('etut', orgSlug, branch),
  ]);

  const teacher = allTeachers.find((t) => t.id === input.teacherId) ?? null;
  const student = allStudents.find((s) => s.id === targetStudentId) ?? null;
  // levelPoolForStudent (Fix 2, review bulgusu): grup havuzu boşsa (örn. 'ilkokul' —
  // FALLBACK_KEYS'te yok + registry'de henüz sınıf yok) öğrencinin KENDİ şubesine düşer —
  // levelPoolForGroup TEK BAŞINA o gruptaki TÜM öğrencileri branş doğrulamasında reddederdi.
  const levelPool = student ? await levelPoolForStudent(student.cls || '', student.group) : [];
  const dersBranch = autoPickBranch(teacher?.branches ?? [], levelPool, input.branch);

  const allowedWeeks = allowedBookingWeeks(actorRole as BookingRole, new Date());
  // sablonRow yoksa decideBooking kural 5'te 404 döner — bu iki değer o zaman hiç okunmaz.
  const slotStartsAt = sablonRow ? slotStartTime(weekKey, sablonRow.dayIndex, sablonRow.start) : new Date(0);
  const candidate = sablonRow
    ? { dayIndex: sablonRow.dayIndex, startMin: toMin(sablonRow.start), endMin: toMin(sablonRow.end) }
    : { dayIndex: -1, startMin: 0, endMin: 0 };
  const maxWeeklyPerStudent = etutConfig.maxWeeklyPerStudent > 0 ? etutConfig.maxWeeklyPerStudent : null;

  const row = await tdb(orgSlug, branch).$transaction(async (rawTx) => {
    // $extends sarmalı tdb()'nin ürettiği tx tipi, Prisma'nın generic extension imzaları
    // (Exact<> vs SelectSubset<>) yüzünden yapısal olarak Prisma.TransactionClient'a UYUMSUZ
    // görünür (tsc TS2345) — ama ÇALIŞMA ZAMANINDA aynı tam-model delegesidir (yalnız
    // $connect/$disconnect/$on/$extends eksik, ikisi de burada kullanılmıyor). reservations.ts
    // DEĞİŞTİRİLEMEDİĞİ için (brief: "Modify: YOK") tip köprüsü BURADA, tek satırda kurulur.
    const tx = rawTx as unknown as Prisma.TransactionClient;
    // Kaynak-bazlı advisory lock (Faz 2 audit-fix FIX-A, KRİTİK) — ÖNCE. Kök neden: yalnız
    // lockStudentWeek varken İKİ FARKLI öğrenci AYNI (sablonId, weekKey) kaynağına eşzamanlı
    // başvurunca FARKLI kilit alıyordu → ikisi de boş görüp ikisi de upsert ediyordu (2.
    // 1.'yi sessizce eziyordu). sablonRow null olabilir (geçersiz etutId — decideBooking
    // kural 5'te 404 dönecek) — o durumda input.etutId'ye düşer (yine deterministik, yalnız
    // lock-ömrü boyunca anlamlı bir anahtar; gerçek yazma olmayacağı için doğruluk etkilenmez).
    // RECURRING'te kilit anahtarının hafta bileşeni RECURRING_WEEKKEY='*' (FIX-B carry-over,
    // FIX-1 review) — yazma YİNE weekKey (cari/referans hafta) ile upsertRecurring'e gider
    // (effectiveFromWeek=weekKey), yalnız KİLİT anahtarı '*' olur. Aksi halde bookEtut(RECURRING)
    // cari-hafta kilidi alırken cancelEtutV2(recurring) '*' kilidi alır — FARKLI kaynaklar,
    // aynı satıra eşzamanlı yazma/iptal yarışı KAPANMAZDI.
    const lockWeekKey = scope === 'RECURRING' ? RECURRING_WEEKKEY : weekKey;
    await lockResource(tx, `etut:${orgSlug}:${branch}:${sablonRow?.id ?? input.etutId}:${lockWeekKey}`);
    // Öğrenci+hafta advisory lock — aynı öğrencinin eşzamanlı etüt işlemlerini serileştirir.
    // SIRA: HER ZAMAN lockResource'tan SONRA (deadlock-free, bkz. reservations.ts lockResource).
    // (Eski SlotBooking çapraz-sistem ayağı 2026-07-22 denetim B3/dalga3'te kaldırıldı —
    // grid rezervasyon yüzeyi emekli, booked satır üreticisi yok; kanıt: harita B3/B4.)
    await lockStudentWeek(tx, orgSlug, branch, targetStudentId, weekKey);

    // effective + otherBookings TX İÇİNDE yeniden okunur (lock alındıktan SONRA) — pre-tx
    // okuma yalnız DTO/ders otomatiği için, yarışa açık kararlar burada TAZE veriyle alınır.
    const allRows = await getWeekReservations(tx, orgSlug, branch, weekKey);
    const effectiveMap = resolveEffective(allRows, weekKey);
    const currentEffectiveRow = sablonRow ? effectiveMap.get(sablonRow.id) ?? null : null;
    const effectiveEtutRows = [...effectiveMap.values()].filter(
      (r) => r.studentId === targetStudentId && r.sablonId !== sablonRow?.id,
    );
    const { list: otherBookings, weeklyCount } = normalizeEtutBookings(effectiveEtutRows);

    const ctx: BookingContext = {
      actor: { role: actorRole, id: actorId, isManager: isManagerActor, readOnlyCounselor },
      scope, weekKey, allowedWeeks,
      slotStartsAt, now: new Date(),
      sablon: sablonRow ? { aktif: sablonRow.aktif, pasifHaftalar: sablonRow.pasifHaftalar, deletedAt: sablonRow.deletedAt } : null,
      teacher: teacher ? { legacyId: teacher.id, branches: teacher.branches, allowedGroups: teacher.allowedGroups } : null,
      student: student ? { id: student.id, group: student.group } : null,
      levelPool,
      dersBranch,
      currentEffective: currentEffectiveRow ? { studentId: currentEffectiveRow.studentId } : null,
      otherBookings,
      candidate,
      weeklyCount,
      maxWeeklyPerStudent,
      studentSelfBookingEnabled: etutConfig.studentSelfBooking,
      force: input.force,
    };

    const decision = decideBooking(ctx);
    if ('error' in decision) throw new HttpError(decision.status, decision.error);

    // decideBooking 'ok' döndüyse kural 5-7 gereği sablon/teacher/student/dersBranch KESİN dolu.
    const write: ReservationWrite = {
      orgSlug, branch,
      sablonId: sablonRow!.id, teacherId: input.teacherId,
      studentId: student!.id, studentName: student!.name, studentCls: student!.cls || '',
      dersBranch: dersBranch!, bookedByRole: actorRole, bookedById: actorId,
      dayIndex: sablonRow!.dayIndex, startsAt: sablonRow!.start, endsAt: sablonRow!.end,
    };

    // ÜRÜN KARARI (Mustafa 2026-07-20, Faz 4): kalıcı atamanın GELECEK-hafta çakışmaları
    // taranmaz/uyarılmaz (Y2 — 'görünürlük yeter'): WEEK satırı kalıcıyı ezer, müdür
    // görünümü çakışmayı gösterir, elle çözülür.
    return scope === 'RECURRING'
      ? upsertRecurring(tx, weekKey, write)
      : upsertWeekReservation(tx, weekKey, write);
  });

  // Audit best-effort (Faz 2 audit-fix FIX-C) — try/catch: logAudit KENDİ İÇİNDE zaten
  // hataları yutuyor (lib/audit.ts, asla throw etmez) ama tx COMMIT OLMUŞ bir rezervasyonu
  // audit'in (bugünkü veya gelecekteki bir davranış değişikliğiyle) 500'e çevirmesi KESİN
  // engellensin diye çağrı yerinde de savunma katmanı. force:true YALNIZ isManagerActor+
  // input.force birlikteyken loglanır (Gemini DÜŞÜK-1) — yetkisiz/etkisiz bir force bayrağı
  // (non-manager gönderirse decideBooking'de zaten sessizce yok sayılır) audit'te YANILTICI
  // 'bypass yapıldı' izlenimi vermesin.
  try {
    await logAudit({
      ...actorFrom(session),
      action: 'etut.book',
      target: { type: 'student', id: row.studentId, name: row.studentName },
      detail: `Etüt rezervasyonu: ${row.studentName} → ${teacher?.name ?? input.teacherId} (${row.dersBranch}, ${weekKey}${scope === 'RECURRING' ? ', tekrarlayan' : ''})`,
      ...(isManagerActor && input.force ? { force: true, reason: input.reason } : {}),
    }, { org: orgSlug, branch });
  } catch (e) {
    console.warn('[booking] etut.book audit kaydı başarısız (rezervasyon commit edildi):', e instanceof Error ? e.message : e);
  }

  return row;
}

// ── cancelEtutV2 (adı legacy lib/etut/rezervasyon.ts cancelEtut ile ÇAKIŞMASIN diye V2 —
//    Task 5 route adaptörleri bağlar) ──────────────────────────────────────────

export interface CancelEtutInput {
  teacherId: string;
  etutId: string;
  weekKey?: string;
  scope?: 'week' | 'recurring';
  reason?: string;
}

export async function cancelEtutV2(session: Session, input: CancelEtutInput): Promise<void> {
  const actorRole = session.role;
  const actorId = String(session.id ?? '');
  const scope: 'week' | 'recurring' = input.scope === 'recurring' ? 'recurring' : 'week';
  const weekKey = normalizeWeekKey(input.weekKey);

  const orgSlug = currentOrg();
  const branch = currentBranch();

  const [isManagerActor, readOnlyCounselor] = await Promise.all([
    canManage(session),
    isReadOnlyCounselor(session, orgSlug, branch),
  ]);

  // Salt-okunur rehber etüt iptali yapamaz (app/api/slots/route.ts DELETE satır 294-300 —
  // metin birebir; bookEtut'taki simetriği decideBooking kural 1'de yaşıyor, cancelEtutV2
  // decideBooking'den GEÇMEDİĞİ için burada AYRICA kontrol edilir).
  if (readOnlyCounselor) throw new HttpError(403, 'Salt-okunur rehber etüt iptali yapamaz');

  // Tekrarlayanın TÜMDEN iptali yalnız müdür/rehber — decideBooking kural 2 ('Tekrarlayan
  // atama yalnız müdür/rehber tarafından yapılabilir') ile AYNI metin, cancel tarafında
  // brief'te kaynak gösterilmemişti; simetri için aynı ifade kullanıldı (bilinçli karar,
  // rapora not düşüldü).
  if (scope === 'recurring' && !isManagerActor) {
    throw new HttpError(403, 'Tekrarlayan atama yalnız müdür/rehber tarafından yapılabilir');
  }

  const sablonRow = await getSablonForBooking(input.teacherId, input.etutId);
  if (!sablonRow) throw new HttpError(404, 'Etüt bulunamadı');

  // ── FIX-B (Faz 2 audit-fix, YÜKSEK — 3/3 denetim): recurring iptal BAĞIMSIZ dal ──────
  // Kök neden (eski kod): scope==='recurring' olsa BİLE aşağıdaki 'week' akışı ÇALIŞIYORDU —
  // efektif-CARİ-HAFTA kaydını arıyordu (resolveEffective(weekKey)); o hafta tombstone'lanmışsa
  // veya hiç görünür değilse (örn. pasifHaftalar) 404 dönüyordu — ACTIVE '*' satırı VARKEN.
  // Reachable: ProgramEditor atama-kaldır → PATCH /api/etut-sablon → cancelEtutV2(scope:
  // 'recurring'), weekKey YOK (cari haftaya düşer). Çözüm: recurring iptali HAFTADAN TAMAMEN
  // BAĞIMSIZ — doğrudan '*' satırını arar, bulur, iptal eder. weekKey/effectiveRow/
  // cancelLockHours/sahiplik-erken-çıkış AŞAĞIDAKİ 'week' akışına AİT, burada KULLANILMAZ
  // (recurring iptali zaten yalnız müdür/rehbere açık — yukarıdaki guard; öğrenci/öğretmen
  // sahiplik kontrolü bu yüzden MOOT).
  if (scope === 'recurring') {
    const recurringRow = await tdb(orgSlug, branch).$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      // Kaynak kilidi — anahtarın hafta bileşeni RECURRING_WEEKKEY='*' (bookEtut'un RECURRING
      // yolundaki AYNI anahtar, bkz bookEtut lockWeekKey yorumu) — recurring atama ve recurring
      // iptal AYNI '*' kaynağında serileşir.
      await lockResource(tx, `etut:${orgSlug}:${branch}:${sablonRow.id}:${RECURRING_WEEKKEY}`);

      // ACTIVE '*' RECURRING satırını DOĞRUDAN bul — kilit ALTINDA, TAZE (resource kilidi
      // aynı sablonId+'*' üzerindeki her yazmayı serileştirdiği için bu okuma OTORİTER).
      const row = await tx.etutReservation.findFirst({
        where: { orgSlug, branch, sablonId: sablonRow.id, weekKey: RECURRING_WEEKKEY, scope: 'RECURRING', status: 'ACTIVE' },
      });
      if (!row) throw new HttpError(404, 'Bu etütte tekrarlayan rezervasyon yok');

      // Öğrenci-hafta kilidi — resource kilidinden SONRA (deadlock-free sıra, bkz.
      // reservations.ts lockResource yorumu). Recurring haftadan bağımsız olduğu için
      // RECURRING_WEEKKEY sabit anahtarıyla kilitlenir (kaynak kilidiyle tutarlı).
      await lockStudentWeek(tx, orgSlug, branch, row.studentId, RECURRING_WEEKKEY);

      await cancelRecurring(tx, orgSlug, branch, sablonRow.id, { role: actorRole, id: actorId, reason: input.reason });
      return row;
    });

    // Audit best-effort (FIX-C) — hedef BU TAZE satırdan (stale effectiveRow YOK, çünkü bu
    // dalda hiç okunmadı).
    try {
      await logAudit({
        ...actorFrom(session),
        action: 'etut.cancel',
        target: { type: 'student', id: recurringRow.studentId, name: recurringRow.studentName },
        detail: `Etüt rezervasyonu iptal edildi: ${recurringRow.studentName} — ${recurringRow.dersBranch} (tekrarlayan, tümden)`,
        ...(input.reason ? { reason: input.reason } : {}),
      }, { org: orgSlug, branch });
    } catch (e) {
      console.warn('[booking] etut.cancel (recurring) audit kaydı başarısız (iptal commit edildi):', e instanceof Error ? e.message : e);
    }
    return;
  }

  // ÜRÜN KARARI (Mustafa 2026-07-20, Faz 3 denetimi): öğrenci iptaline hafta-penceresi
  // UYGULANMAZ — müdürün ileri-haftaya yerleştirdiği rezervasyonu da öğrenci iptal
  // edebilir (esneklik; eski davranışla uyumlu; cancelLockHours ayrıca korur). İstişare
  // sonrası kapatılmak istenirse: actorRole==='student' && !allowedBookingWeeks('student')
  // .includes(weekKey) → 403. Davranış T7 canlı smoke ile regresyon-sabit.
  // ── 'week' kapsamı — davranış AYNEN (FIX-B'den ETKİLENMEZ) ───────────────────────────
  const allRows = await getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey);
  const effectiveRow = resolveEffective(allRows, weekKey).get(sablonRow.id) ?? null;
  if (!effectiveRow) throw new HttpError(404, 'Bu etütte rezervasyon yok');

  // Öğrenci iptal kilidi — app/api/slots/route.ts DELETE satır 302-317 ile config anahtarı
  // (etut.cancelLockHours) + metin BİREBİR. Yalnız 'week' kapsamı: 'recurring' artık YUKARIDA
  // AYRI daldan döner, buraya hiç gelmez (müdür/rehber zaten bu kilitten MUAF olurdu).
  if (actorRole === 'student') {
    const etutConfig = await getOrgConfig('etut', orgSlug, branch);
    const lockH = etutConfig.cancelLockHours;
    if (lockH > 0) {
      const slotStart = slotStartTime(weekKey, effectiveRow.dayIndex, effectiveRow.startsAt);
      if (slotStart.getTime() - Date.now() < lockH * 3600 * 1000) {
        throw new HttpError(403, `Etüt başlamasına ${lockH} saatten az kala iptal edemezsiniz. Öğretmeninize başvurun.`);
      }
    }
  }

  // Sahiplik — lib/etut/rezervasyon.ts cancelEtut satır 158-160 ile BİREBİR. Bu, ucuz bir
  // ERKEN-ÇIKIŞ (tx/lock açmadan önce en yaygın red durumlarını keser) — STALE effectiveRow'a
  // dayandığından OTORİTER DEĞİL; nihai/otoriter kontrol tx içinde freshEffective'e karşı
  // tekrarlanır (aşağıda — review bulgusu: lock-öncesi okuma ile lock arasında rezervasyon
  // başka bir öğrenciye geçmiş olabilir, o durumda bu erken kontrol YANLIŞ pozitif verebilir).
  if (actorRole === 'student' && effectiveRow.studentId !== actorId) throw new HttpError(403, 'Yetkisiz');
  if (actorRole === 'teacher' && input.teacherId !== actorId) throw new HttpError(403, 'Yetkisiz');
  if (!isManagerActor && actorRole !== 'student' && actorRole !== 'teacher') throw new HttpError(403, 'Yetkisiz');

  const freshEffective = await tdb(orgSlug, branch).$transaction(async (rawTx) => {
    // Tip köprüsü — yukarıdaki bookEtut yorumuyla AYNI gerekçe (Prisma extension tipi vs
    // Prisma.TransactionClient uyuşmazlığı, reservations.ts değiştirilemediği için burada çözülür).
    const tx = rawTx as unknown as Prisma.TransactionClient;
    // Kaynak-bazlı advisory lock (Faz 2 audit-fix FIX-A) — ÖNCE, bookEtut ile AYNI anahtar
    // biçimi (`etut:${orgSlug}:${branch}:${sablonId}:${weekKey}`) — aksi halde bookEtut ve
    // cancelEtutV2 aynı kaynağa AYNI ANDA dokunurken FARKLI kilitler alır, yarış kapanmaz.
    await lockResource(tx, `etut:${orgSlug}:${branch}:${sablonRow.id}:${weekKey}`);
    // SIRA: HER ZAMAN lockResource'tan SONRA (deadlock-free).
    await lockStudentWeek(tx, orgSlug, branch, effectiveRow.studentId, weekKey);

    // Race penceresi: lock alınana kadar başka bir istek aynı satırı iptal etmiş/başka bir
    // öğrenciye yeniden rezerve etmiş olabilir — TAZE veriyle yeniden doğrula (bookEtut'taki
    // AYNI ilke).
    const freshRows = await getWeekReservations(tx, orgSlug, branch, weekKey);
    const fresh = resolveEffective(freshRows, weekKey).get(sablonRow.id) ?? null;
    if (!fresh) throw new HttpError(404, 'Bu etütte rezervasyon yok');

    // YETKİ TX İÇİNDE fresh'e karşı — lock-öncesi okuma yarışa açık (review bulgusu).
    // Öğretmen kendi-etüdü kontrolü satır-bağımsız (input.teacherId sabit) — yukarıdaki
    // pre-tx kontrol zaten yeterli, burada tekrarlanmaz. Öğrenci sahipliği İSE fresh
    // satırına bağlı (kim rezerve etmiş, tx öncesi/sonrası değişebilir) — bu yüzden burada
    // TAZE veriyle, legacy'nin AYNI 'Yetkisiz' metniyle yeniden doğrulanır.
    if (actorRole === 'student' && fresh.studentId !== actorId) throw new HttpError(403, 'Yetkisiz');

    // Tombstone snapshot'ı EFEKTİF SAHİBİN bilgileriyle (Faz 2a kararı) — cancelledBy AYRI
    // (kim iptal etti — actorRole/actorId), snapshot kim rezerve etmişti onu taşır.
    await cancelToTombstone(tx, {
      orgSlug, branch, sablonId: sablonRow.id, teacherId: input.teacherId,
      weekKey, cancelledByRole: actorRole, cancelledById: actorId, cancelReason: input.reason,
      snapshot: {
        studentId: fresh.studentId, studentName: fresh.studentName,
        studentCls: fresh.studentCls, dersBranch: fresh.dersBranch,
        dayIndex: fresh.dayIndex, startsAt: fresh.startsAt, endsAt: fresh.endsAt,
      },
    });
    return fresh;
  });

  // Audit best-effort (FIX-C) — hedef TAZE satırdan (freshEffective), stale pre-tx
  // effectiveRow'dan DEĞİL (review bulgusu: lock penceresinde sahip değişmiş olabilir).
  try {
    await logAudit({
      ...actorFrom(session),
      action: 'etut.cancel',
      target: { type: 'student', id: freshEffective.studentId, name: freshEffective.studentName },
      detail: `Etüt rezervasyonu iptal edildi: ${freshEffective.studentName} — ${freshEffective.dersBranch} (${weekKey})`,
      ...(input.reason ? { reason: input.reason } : {}),
    }, { org: orgSlug, branch });
  } catch (e) {
    console.warn('[booking] etut.cancel audit kaydı başarısız (iptal commit edildi):', e instanceof Error ? e.message : e);
  }
}
