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
