/**
 * E2E ortak yardımcıları — dinamik kimlik keşfi + hafta hesapları.
 *
 * Sabit fikstür kimlikleri (TEACHER_ID='d9sxbn8a' vb.) canlı testkurs verisinden
 * koptuğu için spec'ler kimlikleri BURADAN keşfeder: oturum sahibi kimse onunla
 * çalışılır (GET /api/auth → session). Oturumlar auth.setup.js'in kaydettiği
 * storageState dosyalarından gelir — bu modül login YAPMAZ.
 */
const BASE = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';

const DIR_STATE = 'e2e/.auth/director.json';
const TEA_STATE = 'e2e/.auth/teacher.json';
const STU_STATE = 'e2e/.auth/student.json';

// Mutasyon istekleri için ortak başlıklar (CSRF: Origin hedef hostla eşleşmeli).
const JSON_HEADERS = { 'Content-Type': 'application/json', Origin: BASE };

// ISO hafta anahtarı — lib/constants.getWeekKey ile birebir aynı mantık.
function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Hafta anahtarının pazartesi tarihi — lib/slots.getMondayOfWeek ile aynı.
function getMondayOfWeek(weekKey) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const jan4 = new Date(parseInt(year), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

function shiftWeek(weekKey, delta) {
  const mon = getMondayOfWeek(weekKey);
  mon.setDate(mon.getDate() + delta * 7);
  return getWeekKey(mon);
}

// Slot/etüt başlangıç anı (TSİ +03) — lib/slots.slotStartTime ile aynı.
function slotStartTime(weekKey, dayIndex, startHHMM) {
  const monday = getMondayOfWeek(weekKey);
  const [hh, mm] = (startHHMM || '0:0').split(':').map((n) => parseInt(n) || 0);
  return new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIndex, hh - 3, mm));
}

// Haftanın günü için YYYY-MM-DD (UTC bazlı — TeacherPanel.dateForDay ile aynı).
function dateForDay(weekKey, dayIndex) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const jan4 = new Date(Date.UTC(parseInt(year), 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
  mon.setUTCDate(mon.getUTCDate() + dayIndex);
  return mon.toISOString().slice(0, 10);
}

const DAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DAY_SHORTS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

// Oturum sahibini keşfet: kayıtlı oturumun GET /api/auth yanıtındaki session.
// teacher → { id, name, branches, allowedGroups } · student → { id, name, cls, group }
async function whoami(requestContext) {
  const res = await requestContext.get(`${BASE}/api/auth`);
  if (res.status() !== 200) throw new Error(`whoami başarısız: HTTP ${res.status()}`);
  const body = await res.json();
  if (!body.session) throw new Error('whoami: oturum yok — auth.setup çalıştı mı?');
  return body.session;
}

// Regex kaçışı (dinamik isimleri locator regex'ine gömmek için).
function reEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  BASE, DIR_STATE, TEA_STATE, STU_STATE, JSON_HEADERS,
  getWeekKey, getMondayOfWeek, shiftWeek, slotStartTime, dateForDay,
  DAY_LABELS, DAY_SHORTS, whoami, reEscape,
};
