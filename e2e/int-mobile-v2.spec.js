// Canlı sözleşme testleri (Plan 5): etüt reserve/cancel + hafta + ödev submit +
// change-password + notification-prefs + webview-compat + web refactor regresyonu.
// RATE LİMİT BÜTÇESİ: 3 mobil login (5/15dk) — bu pencerede başka mobil suite koşma.
const { test, expect, request } = require('@playwright/test');
const { BASE, STU_STATE, getWeekKey, slotStartTime, shiftWeek } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const CREDS = {
  student: { user: process.env.OKULIN_STU_USER, pass: process.env.OKULIN_STU_PASS },
  teacher: { user: process.env.OKULIN_TEA_USER, pass: process.env.OKULIN_TEA_PASS },
  management: { user: process.env.OKULIN_DIR_USER, pass: process.env.OKULIN_DIR_PASS },
};

let api; // Origin'siz native taklidi
let webStu; // cookie'li öğrenci (web etüt/şifre regresyonu)
const tokens = {};
const H = (t) => ({ Authorization: 'Bearer ' + t });

async function findFutureBookableSlot() {
  const first = await (await api.get(`${BASE}/api/mobile/v1/etut`, { headers: H(tokens.student) })).json();
  const weeks = [...new Set(first.bookableWeeks || [])];
  for (const weekKey of weeks) {
    const list = weekKey === first.weekKey
      ? first
      : await (await api.get(`${BASE}/api/mobile/v1/etut?week=${weekKey}`, { headers: H(tokens.student) })).json();
    const slot = (list.slots || []).find(
      (s) => !s.booked && !s.mine && s.branches.length >= 1
        && slotStartTime(weekKey, s.dayIndex, s.start).getTime() > Date.now(),
    );
    if (slot) return { weekKey, slot };
  }
  return null;
}

test.beforeAll(async () => {
  for (const [role, c] of Object.entries(CREDS)) {
    expect(c.user, `OKULIN_${role} creds .env.local'de olmalı`).toBeTruthy();
    expect(c.pass).toBeTruthy();
  }
  api = await request.newContext();
  webStu = await request.newContext({ storageState: STU_STATE, extraHTTPHeaders: { Origin: BASE } });
  for (const [role, c] of Object.entries(CREDS)) {
    const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, { data: { username: c.user, password: c.pass, role } });
    // 429 kabul EDİLMEZ: başarılı login kovayı sıfırlar; 429 = bütçe invariant'ı bozuldu.
    expect(r.status(), `${role} login`).toBe(200);
    tokens[role] = (await r.json()).accessToken;
  }
});

test.afterAll(async () => {
  await api?.dispose();
  await webStu?.dispose();
});

// ── Etüt ──────────────────────────────────────────────────────────────────
test('etüt: GET bookable liste şekli (öğrenci)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/etut`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.weekKey).toMatch(/^\d{4}-W\d{2}$/);
  expect(Array.isArray(j.slots)).toBe(true);
  for (const s of j.slots) {
    expect(typeof s.teacherId).toBe('string');
    expect(typeof s.etutId).toBe('string');
    expect(typeof s.dayLabel).toBe('string');
    expect(typeof s.booked).toBe('boolean');
    expect(typeof s.mine).toBe('boolean');
    expect(Array.isArray(s.branches)).toBe(true);
  }
});

test('etüt: GET rol guard (öğretmen/yönetim 403)', async () => {
  expect((await api.get(`${BASE}/api/mobile/v1/etut`, { headers: H(tokens.teacher) })).status()).toBe(403);
  expect((await api.get(`${BASE}/api/mobile/v1/etut`, { headers: H(tokens.management) })).status()).toBe(403);
});

test('etüt: reserve → mine → cancel round-trip (uygun slot varsa)', async () => {
  const candidate = await findFutureBookableSlot();
  test.skip(!candidate, 'bu/gelecek hafta rezerve edilebilir etüt yok — cihaz turu (Task 15) kapsar');
  const { weekKey: wk, slot } = candidate;
  const body = { teacherId: slot.teacherId, etutId: slot.etutId, branch: slot.branches[0], weekKey: wk };
  const res = await api.post(`${BASE}/api/mobile/v1/etut/reserve`, { data: body, headers: H(tokens.student) });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).ok).toBe(true);
  // Tekrar listele → mine:true
  const after = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  const now = after.slots.find((s) => s.etutId === slot.etutId && s.teacherId === slot.teacherId);
  expect(now.mine).toBe(true);
  // İptal
  const del = await api.delete(`${BASE}/api/mobile/v1/etut/reserve`, { data: { teacherId: slot.teacherId, etutId: slot.etutId }, headers: H(tokens.student) });
  expect(del.status()).toBe(200);
  const after2 = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  const back = after2.slots.find((s) => s.etutId === slot.etutId && s.teacherId === slot.teacherId);
  expect(back.mine).toBe(false);
});

test('etüt: reserve POST yok-etütId → 404 (Etüt bulunamadı)', async () => {
  const wk = getWeekKey();
  const list = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  // Grup uyumu garantili teacherId: mine olmayan bir slot (listBookableEtuts groupOk
  // olmayanları yalnız mine iken gösterir) — yoksa ilk slot'a düş.
  const slot = (list.slots || []).find((s) => !s.mine) || (list.slots || [])[0];
  test.skip(!slot, 'geçerli teacherId için etüt slotu yok — cihaz turu (Task 15) kapsar');
  const res = await api.post(`${BASE}/api/mobile/v1/etut/reserve`, {
    data: { teacherId: slot.teacherId, etutId: 'yok-boyle-bir-etut', branch: 'x', weekKey: wk },
    headers: H(tokens.student),
  });
  expect(res.status(), await res.text()).toBe(404);
  expect((await res.json()).error).toMatch(/Etüt bulunamadı/);
});

test('etüt: reserve DELETE yok-etütId → 404', async () => {
  const wk = getWeekKey();
  const list = await (await api.get(`${BASE}/api/mobile/v1/etut?week=${wk}`, { headers: H(tokens.student) })).json();
  const slot = (list.slots || []).find((s) => !s.mine) || (list.slots || [])[0];
  test.skip(!slot, 'geçerli teacherId için etüt slotu yok — cihaz turu (Task 15) kapsar');
  const res = await api.delete(`${BASE}/api/mobile/v1/etut/reserve`, {
    data: { teacherId: slot.teacherId, etutId: 'yok-boyle-bir-etut' },
    headers: H(tokens.student),
  });
  expect(res.status(), await res.text()).toBe(404);
  expect((await res.json()).error).toMatch(/Etüt bulunamadı/);
});

// ── Haftalık program ────────────────────────────────────────────────────────
test('week: öğrenci 7 gün şekli', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/week`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('student');
  expect(j.days.length).toBe(7);
  for (const d of j.days) {
    expect(typeof d.dayIndex).toBe('number');
    expect(typeof d.dayLabel).toBe('string');
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(d.lessons)).toBe(true);
  }
});

test('week: öğretmen 7 gün + hafta gezinme + slots kronolojik (ders∪etüt)', async () => {
  const jt = await (await api.get(`${BASE}/api/mobile/v1/screens/week`, { headers: H(tokens.teacher) })).json();
  expect(jt.role).toBe('teacher');
  expect(jt.days.length).toBe(7);
  // B3/dalga2 sonrası days[].slots ders + EtutReservation etütlerini KRONOLOJİK içerir
  // (api-types sözleşmesi; diff-denetim bulgusu sıralamayı sabitledi).
  const toMin = (label) => { const m = /^(\d{2}):(\d{2})/.exec(label || ''); return m ? (+m[1]) * 60 + +m[2] : -1; };
  for (const d of jt.days) {
    expect(Array.isArray(d.slots)).toBe(true);
    const mins = d.slots.map((s) => toMin(s.slotLabel)).filter((x) => x >= 0);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
    for (const s of d.slots) expect(['ders', 'etut']).toContain(s.type);
  }
  const next = shiftWeek(getWeekKey(), 1);
  const jn = await (await api.get(`${BASE}/api/mobile/v1/screens/week?week=${next}`, { headers: H(tokens.teacher) })).json();
  expect(jn.weekKey).toBe(next);
});

// ── Ödev ─────────────────────────────────────────────────────────────────────
test('ödev: GET liste şekli (öğrenci)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/odev`, { headers: H(tokens.student) });
  expect([200, 403]).toContain(r.status()); // 403 = odev modülü kapalı
  if (r.status() === 200) {
    const j = await r.json();
    expect(j.role).toBe('student');
    expect(Array.isArray(j.items)).toBe(true);
  }
});

test('ödev: submit → undo round-trip (teslim edilmemiş ödev varsa)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/odev`, { headers: H(tokens.student) });
  test.skip(r.status() !== 200, 'odev modülü kapalı');
  const items = (await r.json()).items || [];
  const target = items.find((i) => i.status === '');
  test.skip(!target, 'teslim edilmemiş ödev yok — cihaz turu (Task 15) kapsar');
  const sub = await api.post(`${BASE}/api/mobile/v1/odev`, { data: { id: target.id, note: 'int test', done: true }, headers: H(tokens.student) });
  expect(sub.status(), await sub.text()).toBe(200);
  expect((await sub.json()).status).toBe('teslim');
  const undo = await api.post(`${BASE}/api/mobile/v1/odev`, { data: { id: target.id, done: false }, headers: H(tokens.student) });
  expect(undo.status()).toBe(200);
  expect((await undo.json()).status).toBeNull();
});

test('ödev: POST rol guard (öğretmen 403)', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/odev`, { data: { id: 'x', done: true }, headers: H(tokens.teacher) });
  expect(r.status()).toBe(403);
});

// ── Bildirim tercihleri ───────────────────────────────────────────────────────
test('notif-prefs: GET role-relevant + güvenlik yok', async () => {
  const j = await (await api.get(`${BASE}/api/mobile/v1/notification-prefs`, { headers: H(tokens.student) })).json();
  expect(Array.isArray(j.items)).toBe(true);
  const cats = j.items.map((i) => i.category);
  expect(cats).toContain('odev');
  expect(cats).not.toContain('guvenlik');
  for (const it of j.items) expect(typeof it.enabled).toBe('boolean');
});

test('notif-prefs: toggle odev kapat/aç round-trip', async () => {
  const off = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'odev', enabled: false }, headers: H(tokens.student) });
  expect(off.status()).toBe(200);
  expect((await off.json()).items.find((i) => i.category === 'odev').enabled).toBe(false);
  const on = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'odev', enabled: true }, headers: H(tokens.student) });
  expect(on.status()).toBe(200);
  expect((await on.json()).items.find((i) => i.category === 'odev').enabled).toBe(true);
});

test('notif-prefs: role-dışı kategori 400, güvenlik 400 (schema)', async () => {
  // öğrenciye devamsizlik geçerli değil
  const r1 = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'devamsizlik', enabled: false }, headers: H(tokens.student) });
  expect(r1.status()).toBe(400);
  // guvenlik enum dışı → parseBody 400
  const r2 = await api.post(`${BASE}/api/mobile/v1/notification-prefs`, { data: { category: 'guvenlik', enabled: false }, headers: H(tokens.student) });
  expect(r2.status()).toBe(400);
});

// ── Şifre değiştirme (non-destructive) ────────────────────────────────────────
test('change-password: yanlış mevcut şifre → 400 (şifre değişmez)', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/auth/change-password`, { data: { currentPassword: 'kesinlikle-yanlis-xyz', newPassword: 'yeni123456' }, headers: H(tokens.student) });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toMatch(/Mevcut şifre hatalı/);
});

test('change-password: gerçek müdür (management) → 403', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/auth/change-password`, { data: { currentPassword: 'x', newPassword: 'yeni123456' }, headers: H(tokens.management) });
  expect(r.status()).toBe(403);
});

// ── Eski-WebView (session-open UA fallback) ────────────────────────────────────
test('webview-compat: eski UA → 200 HTML güncelleme sayfası', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/session-open?code=${'x'.repeat(25)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/81.0.4044.138 Mobile Safari/537.36' },
  });
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/text\/html/);
  expect(await r.text()).toMatch(/güncel değil/i);
});

test('webview-compat: modern UA → HTML DEĞİL (kod kontrolüne düşer)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/session-open?code=x`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36' },
  });
  expect(r.status()).toBe(400); // code<20 → "Geçersiz kod" (HTML değil, JSON)
  expect(r.headers()['content-type']).toMatch(/application\/json/);
});

// ── Web refactor regresyonu (etüt + şifre servisleri) ─────────────────────────
test('web regresyon: change_password yanlış şifre → 400 (servis çıkarımı sağlam)', async () => {
  const r = await webStu.post(`${BASE}/api/auth`, { data: { action: 'change_password', password: 'kesinlikle-yanlis-xyz', newPassword: 'yeni123456' } });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toMatch(/Mevcut şifre hatalı/);
});

test('web regresyon: etüt reserve/cancel (cookie yolu — servis çıkarımı sağlam)', async () => {
  const candidate = await findFutureBookableSlot();
  test.skip(!candidate, 'web etüt regresyonu için bu/gelecek hafta uygun slot yok — cihaz turu kapsar');
  const { weekKey: wk, slot } = candidate;
  const body = { teacherId: slot.teacherId, etutId: slot.etutId, branch: slot.branches[0], weekKey: wk };
  const res = await webStu.post(`${BASE}/api/etut-sablon/rezervasyon`, { data: body });
  expect(res.status(), await res.text()).toBe(200);
  const del = await webStu.delete(`${BASE}/api/etut-sablon/rezervasyon`, { data: { teacherId: slot.teacherId, etutId: slot.etutId } });
  expect(del.status()).toBe(200);
});
