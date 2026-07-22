// Canlı sözleşme testleri: screens/today (3 rol) + notifications inbox akışı.
// RATE LİMİT BÜTÇESİ: 3 mobil login (5/15dk kovası) — bu pencerede başka mobil
// suite koşma. Duyuru web istemcisiyle (DIR_STATE cookie) gönderilir.
const { test, expect, request } = require('@playwright/test');
const { BASE, DIR_STATE } = require('./helpers');

test.describe.configure({ mode: 'serial' });

const CREDS = {
  student: { user: process.env.OKULIN_STU_USER, pass: process.env.OKULIN_STU_PASS },
  teacher: { user: process.env.OKULIN_TEA_USER, pass: process.env.OKULIN_TEA_PASS },
  management: { user: process.env.OKULIN_DIR_USER, pass: process.env.OKULIN_DIR_PASS },
};

let api; // Origin'siz native taklidi
let web; // cookie'li yönetici (duyuru gönderimi)
const tokens = {}; // role -> accessToken
let stuId = null; // duyuru hedefi (login yanıtındaki session.id)
let annId = null; // temizlik için (uçtan uca testinin duyurusu)
let annId2 = null; // temizlik için (izolasyon testinin duyurusu)
let annEventId = null;

const H = (t) => ({ Authorization: 'Bearer ' + t });

test.beforeAll(async () => {
  for (const [role, c] of Object.entries(CREDS)) {
    expect(c.user, `OKULIN_${role} creds .env.local'de olmalı`).toBeTruthy();
    expect(c.pass).toBeTruthy();
  }
  api = await request.newContext();
  web = await request.newContext({ storageState: DIR_STATE, extraHTTPHeaders: { Origin: BASE } });
  for (const [role, c] of Object.entries(CREDS)) {
    const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, {
      data: { username: c.user, password: c.pass, role },
    });
    // 429 kabul EDİLMEZ: başarılı login kovayı sıfırlar; 429 = bütçe invariant'ı bozuldu.
    expect(r.status(), `${role} login`).toBe(200);
    const j = await r.json();
    tokens[role] = j.accessToken;
    if (role === 'student') stuId = j.session.id;
  }
});

test.afterAll(async () => {
  // Test duyurularını sil (yönetici web ucu) — inbox event'leri kalır (90g retention, zararsız).
  if (annId) await web.delete(`${BASE}/api/announcements?id=${encodeURIComponent(annId)}`).catch(() => {});
  if (annId2) await web.delete(`${BASE}/api/announcements?id=${encodeURIComponent(annId2)}`).catch(() => {});
  await api?.dispose();
  await web?.dispose();
});

test('today: öğrenci şekli (role/date/lessons/unread)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('student');
  expect(j.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(j.weekKey).toMatch(/^\d{4}-W\d{2}$/);
  expect(Array.isArray(j.lessons)).toBe(true);
  expect(typeof j.unreadNotifications).toBe('number');
  // modül alanları: null YA DA doğru şekil
  if (j.odev) expect(typeof j.odev.pending).toBe('number');
  if (j.davranis) expect(typeof j.davranis.total).toBe('number');
});

test('today: öğretmen şekli', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tokens.teacher) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('teacher');
  expect(Array.isArray(j.lessons)).toBe(true);
});

test('today: yönetici management döner (native 2. dalga)', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tokens.management) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.role).toBe('management');
  expect(j.lessons).toBeUndefined();
});

test('today: Bearer\'sız 401', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/screens/today`);
  expect(r.status()).toBe(401);
});

test('inbox: liste şekli + geçersiz before 400', async () => {
  const r = await api.get(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student) });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(Array.isArray(j.items)).toBe(true);
  expect(typeof j.unreadCount).toBe('number');
  const bad = await api.get(`${BASE}/api/mobile/v1/notifications?before=garbage`, { headers: H(tokens.student) });
  expect(bad.status()).toBe(400);
});

test('uçtan uca: duyuru gönder → öğrenci inbox\'ında görünür → okundu → sayaç düşer', async () => {
  const title = `Plan4 int ${Date.now()}`;
  const send = await web.post(`${BASE}/api/announcements`, {
    data: { action: 'send', title, body: 'Plan 4 canlı test duyurusu', audience: { role: 'student', scope: 'selected', ids: [stuId] } },
  });
  expect(send.status()).toBe(200);
  annId = (await send.json()).id ?? null; // yanıt id dönmüyorsa temizlik GET listesinden bulunur (aşağıda fallback)

  // Fan-out senkron (enqueue login isteği içinde) — kısa bekleme yeterli.
  let found = null;
  for (let i = 0; i < 5 && !found; i++) {
    const list = await api.get(`${BASE}/api/mobile/v1/notifications?limit=10`, { headers: H(tokens.student) });
    expect(list.status()).toBe(200);
    const j = await list.json();
    found = j.items.find((it) => it.title.includes(title));
    if (!found) await new Promise((r2) => setTimeout(r2, 1000));
  }
  expect(found, 'duyuru event\'i inbox\'a düşmeli').toBeTruthy();
  expect(found.read).toBe(false);
  annEventId = found.id;

  const before = await api.get(`${BASE}/api/mobile/v1/notifications?limit=1`, { headers: H(tokens.student) });
  const unreadBefore = (await before.json()).unreadCount;

  const read = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { eventId: annEventId } });
  expect(read.status()).toBe(200);
  const rj = await read.json();
  expect(rj.updated).toBe(1);
  expect(rj.unreadCount).toBe(unreadBefore - 1);

  // idempotent tekrar: updated 0 ama 200
  const again = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { eventId: annEventId } });
  expect(again.status()).toBe(200);
  expect((await again.json()).updated).toBe(0);
});

test('izolasyon: öğrenci, öğretmenin GERÇEK event\'ini okuyamaz/işaretleyemez (IDOR)', async () => {
  // Gerçek IDOR kanıtı (İnceleme Codex #13): öğretmene hedefli duyuru üret,
  // event id'sini ÖĞRETMEN kutusundan al, öğrenci token'ıyla erişmeyi dene.
  const title = `Plan4 idor ${Date.now()}`;
  const teaRes = await api.get(`${BASE}/api/mobile/v1/me`, { headers: H(tokens.teacher) });
  const teaId = (await teaRes.json()).session.id;
  const send = await web.post(`${BASE}/api/announcements`, {
    data: { action: 'send', title, body: 'izolasyon testi', audience: { role: 'teacher', scope: 'selected', ids: [teaId] } },
  });
  expect(send.status()).toBe(200);
  annId2 = (await send.json()).id ?? null;
  let teaEvent = null;
  for (let i = 0; i < 5 && !teaEvent; i++) {
    const tl = await api.get(`${BASE}/api/mobile/v1/notifications?limit=10`, { headers: H(tokens.teacher) });
    teaEvent = (await tl.json()).items.find((it) => it.title.includes(title));
    if (!teaEvent) await new Promise((r2) => setTimeout(r2, 1000));
  }
  expect(teaEvent, 'öğretmen event\'i üretilmiş olmalı').toBeTruthy();
  // Okundu işaretleme (POST) ve tek-kayıt okuma (GET ?id=) ikisi de 404 (varlık sızdırma yok)
  const w = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { eventId: teaEvent.id } });
  expect(w.status()).toBe(404);
  const g = await api.get(`${BASE}/api/mobile/v1/notifications?id=${encodeURIComponent(teaEvent.id)}`, { headers: H(tokens.student) });
  expect(g.status()).toBe(404);
});

test('tek-kayıt modu: sahibi ?id= ile eski event\'i çekebilir', async () => {
  const list = await api.get(`${BASE}/api/mobile/v1/notifications?limit=1`, { headers: H(tokens.student) });
  const item = (await list.json()).items[0];
  test.skip(!item, 'öğrenci kutusu boş');
  const g = await api.get(`${BASE}/api/mobile/v1/notifications?id=${encodeURIComponent(item.id)}`, { headers: H(tokens.student) });
  expect(g.status()).toBe(200);
  const j = await g.json();
  expect(j.items).toHaveLength(1);
  expect(j.items[0].id).toBe(item.id);
});

test('read-all: unreadCount sıfırlanır', async () => {
  const r = await api.post(`${BASE}/api/mobile/v1/notifications`, { headers: H(tokens.student), data: { all: true } });
  expect(r.status()).toBe(200);
  expect((await r.json()).unreadCount).toBe(0);
});

test('veli today (creds varsa)', async () => {
  const user = process.env.OKULIN_PAR_USER, pass = process.env.OKULIN_PAR_PASS;
  test.skip(!user || !pass, 'veli creds yok — cihaz turunda doğrulanır (plan ADR)');
  const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, { data: { username: user, password: pass, role: 'parent' } });
  expect(r.status()).toBe(200);
  const tok = (await r.json()).accessToken;
  const t = await api.get(`${BASE}/api/mobile/v1/screens/today`, { headers: H(tok) });
  expect(t.status()).toBe(200);
  const j = await t.json();
  expect(j.role).toBe('parent');
  expect(Array.isArray(j.children)).toBe(true);
});
