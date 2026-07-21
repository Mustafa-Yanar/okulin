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

// Şablon alan doğrulaması (göç öncesi). Dönen: { ok: true } | { ok: false, reason: string }
export function validateSablon(sb) {
  if (!sb || typeof sb !== 'object') return { ok: false, reason: 'şablon obje değil' };
  if (!sb.id || typeof sb.id !== 'string') return { ok: false, reason: 'id eksik/geçersiz' };
  if (!Number.isInteger(sb.dayIndex) || sb.dayIndex < 0 || sb.dayIndex > 6) return { ok: false, reason: `dayIndex geçersiz: ${sb.dayIndex}` };
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof sb.start !== 'string' || !HHMM.test(sb.start)) return { ok: false, reason: `start geçersiz: ${sb.start}` };
  if (typeof sb.end !== 'string' || !HHMM.test(sb.end)) return { ok: false, reason: `end geçersiz: ${sb.end}` };
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  if (toMin(sb.end) <= toMin(sb.start)) return { ok: false, reason: `end <= start (${sb.start}-${sb.end})` };
  return { ok: true };
}

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
    // FIX-C (Faz 5 audit): hiç eşleşen ACTIVE gelecek satır yoksa normalde 'create'
    // üretilir — ama aynı şablonda table-first RECURRING satır varsa, JSON'dan üretilecek
    // yeni WEEK satırı onu EFEKTİF EZER (resolveEffective: WEEK > RECURRING). Fiziksel
    // dokunmuyor ama gölgeliyor — sessizce gölgeleme, operatöre raporla.
    if (recurring.length) { ops.push({ op: 'conflict-recurring', weekKey: cls.weekKey }); return ops; }
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
