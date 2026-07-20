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
import { getAllTeachers, getAllStudents, getDaySlotTimes, slotStartTime, type SlotCell } from '@/lib/slots';
import { getSablonForBooking } from './sablon-service';
import { decideBooking, type BookingContext } from './booking-rules';
import { currentWeekKeyTSI, allowedBookingWeeks, type BookingRole } from './weeks';
import { levelPoolForStudent } from './level-pool';
import {
  getWeekReservations, resolveEffective, upsertWeekReservation, upsertRecurring,
  cancelToTombstone, cancelRecurring, lockResource, lockStudentWeek, type ReservationWrite,
} from './reservations';
import { combineBookings, type SlotRowLike } from './student-week';
import { toMin } from './overlap';

const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;

// weekKey doğrulama — mobil deseniyle uyumlu: format tutmuyorsa geçerli haftaya düş
// (400 ile reddetmek yerine — brief: "geçersizse currentWeekKeyTSI()'ye düş").
function normalizeWeekKey(weekKey: string | undefined): string {
  return weekKey && WEEK_KEY_RE.test(weekKey) ? weekKey : currentWeekKeyTSI();
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
  const weekKey = normalizeWeekKey(input.weekKey);

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

  const [sablonRow, allTeachers, allStudents, etutConfig, slotTimes] = await Promise.all([
    getSablonForBooking(input.teacherId, input.etutId),
    getAllTeachers(),
    getAllStudents(),
    getOrgConfig('etut', orgSlug, branch),
    getDaySlotTimes(),
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
    await lockResource(tx, `etut:${orgSlug}:${branch}:${sablonRow?.id ?? input.etutId}:${weekKey}`);
    // Öğrenci+hafta advisory lock — SlotBooking+EtutReservation çapraz-sistem yarışını kapatır.
    // SIRA: HER ZAMAN lockResource'tan SONRA (deadlock-free, bkz. reservations.ts lockResource).
    await lockStudentWeek(tx, orgSlug, branch, targetStudentId, weekKey);

    // effective + otherBookings TX İÇİNDE yeniden okunur (lock alındıktan SONRA) — pre-tx
    // okuma yalnız DTO/ders otomatiği için, yarışa açık kararlar burada TAZE veriyle alınır.
    const [allRows, slotRowsRaw] = await Promise.all([
      getWeekReservations(tx, orgSlug, branch, weekKey),
      // orgSlug/branch AÇIKÇA (review bulgusu) — bu, tx üzerinde $extends enjeksiyonuna
      // dayanan TEK sorguydu; artık dosyadaki diğer tüm sorgularla aynı desende.
      tx.slotBooking.findMany({ where: { orgSlug, branch, weekKey, booked: true, studentId: targetStudentId } }),
    ]);
    const effectiveMap = resolveEffective(allRows, weekKey);
    const currentEffectiveRow = sablonRow ? effectiveMap.get(sablonRow.id) ?? null : null;
    const effectiveEtutRows = [...effectiveMap.values()].filter(
      (r) => r.studentId === targetStudentId && r.sablonId !== sablonRow?.id,
    );
    const slotRows: SlotRowLike[] = slotRowsRaw.map((r) => ({
      dayIndex: r.dayIndex, slotId: r.slotId, startsAt: r.startsAt, endsAt: r.endsAt,
      dersBranch: r.dersBranch, data: r.data as SlotCell | null,
    }));
    const { list: otherBookings, weeklyCount } = combineBookings(effectiveEtutRows, slotRows, slotTimes);

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

    return scope === 'RECURRING'
      ? upsertRecurring(tx, weekKey, write)
      : upsertWeekReservation(tx, weekKey, write);
  });

  await logAudit({
    ...actorFrom(session),
    action: 'etut.book',
    target: { type: 'student', id: row.studentId, name: row.studentName },
    detail: `Etüt rezervasyonu: ${row.studentName} → ${teacher?.name ?? input.teacherId} (${row.dersBranch}, ${weekKey}${scope === 'RECURRING' ? ', tekrarlayan' : ''})`,
    ...(input.force ? { force: true, reason: input.reason } : {}),
  }, { org: orgSlug, branch });

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

  const allRows = await getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey);
  const effectiveRow = resolveEffective(allRows, weekKey).get(sablonRow.id) ?? null;
  if (!effectiveRow) throw new HttpError(404, 'Bu etütte rezervasyon yok');

  // Öğrenci iptal kilidi — app/api/slots/route.ts DELETE satır 302-317 ile config anahtarı
  // (etut.cancelLockHours) + metin BİREBİR. Yalnız 'week' kapsamı: 'recurring' zaten yalnız
  // isManager'a açık ve müdür/rehber/öğretmen bu kilitten MUAF (config yorumunda açık).
  if (actorRole === 'student' && scope === 'week') {
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

  await tdb(orgSlug, branch).$transaction(async (rawTx) => {
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
    const freshEffective = resolveEffective(freshRows, weekKey).get(sablonRow.id) ?? null;
    if (!freshEffective) throw new HttpError(404, 'Bu etütte rezervasyon yok');

    // YETKİ TX İÇİNDE freshEffective'e karşı — lock-öncesi okuma yarışa açık (review bulgusu).
    // Öğretmen kendi-etüdü kontrolü satır-bağımsız (input.teacherId sabit) — yukarıdaki
    // pre-tx kontrol zaten yeterli, burada tekrarlanmaz. Öğrenci sahipliği İSE freshEffective
    // satırına bağlı (kim rezerve etmiş, tx öncesi/sonrası değişebilir) — bu yüzden burada
    // TAZE veriyle, legacy'nin AYNI 'Yetkisiz' metniyle yeniden doğrulanır.
    if (actorRole === 'student' && freshEffective.studentId !== actorId) throw new HttpError(403, 'Yetkisiz');

    if (scope === 'recurring') {
      await cancelRecurring(tx, orgSlug, branch, sablonRow.id, { role: actorRole, id: actorId, reason: input.reason });
    } else {
      // Tombstone snapshot'ı EFEKTİF SAHİBİN bilgileriyle (Faz 2a kararı) — cancelledBy AYRI
      // (kim iptal etti — actorRole/actorId), snapshot kim rezerve etmişti onu taşır.
      await cancelToTombstone(tx, {
        orgSlug, branch, sablonId: sablonRow.id, teacherId: input.teacherId,
        weekKey, cancelledByRole: actorRole, cancelledById: actorId, cancelReason: input.reason,
        snapshot: {
          studentId: freshEffective.studentId, studentName: freshEffective.studentName,
          studentCls: freshEffective.studentCls, dersBranch: freshEffective.dersBranch,
          dayIndex: freshEffective.dayIndex, startsAt: freshEffective.startsAt, endsAt: freshEffective.endsAt,
        },
      });
    }
  });

  await logAudit({
    ...actorFrom(session),
    action: 'etut.cancel',
    target: { type: 'student', id: effectiveRow.studentId, name: effectiveRow.studentName },
    detail: `Etüt rezervasyonu iptal edildi: ${effectiveRow.studentName} — ${effectiveRow.dersBranch} (${scope === 'recurring' ? 'tekrarlayan, tümden' : weekKey})`,
    ...(input.reason ? { reason: input.reason } : {}),
  }, { org: orgSlug, branch });
}
