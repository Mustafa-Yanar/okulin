/**
 * SQL GÖÇ TESTİ — Okuma uçları
 * Kritik GET endpoint'lerinin SQL'den doğru veri döndürdüğünü doğrular.
 * Oturumlar auth.setup.js'ten gelir (storageState) — bu dosyada login YOK.
 * Kimlikler dinamik: oturum sahibi öğretmen GET /api/auth ile keşfedilir.
 */
const { test, expect } = require('@playwright/test');
const { BASE, TEA_STATE, whoami } = require('./helpers');

test.describe('Director okuma testleri', () => {
  test.use({ storageState: 'e2e/.auth/director.json' });

  test('teachers: en az 1 geçerli öğretmen gelir', async ({ request }) => {
    const res = await request.get(`${BASE}/api/teachers`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('name');
    expect(body[0]).toHaveProperty('branches');
  });

  test('students: en az 1 öğrenci gelir', async ({ request }) => {
    const res = await request.get(`${BASE}/api/students`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.students || [];
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('cls');
  });

  test('slot-times: 7-gün formatı ({days:{0..6}}) döner', async ({ request }) => {
    const res = await request.get(`${BASE}/api/slot-times`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // 7-gün göçü sonrası sözleşme: { days: {0..6: {count, times}}, etutSuresi, molaSuresi }
    expect(body).toHaveProperty('days');
    for (let d = 0; d < 7; d++) {
      const day = body.days[String(d)] ?? body.days[d];
      expect(day, `gün ${d} tanımlı olmalı`).toBeDefined();
      expect(typeof day.count).toBe('number');
      expect(Array.isArray(day.times)).toBe(true);
      expect(day.times.length).toBe(day.count);
    }
    expect(typeof body.etutSuresi).toBe('number');
    expect(typeof body.molaSuresi).toBe('number');
    // En az bir günde ders saati tanımlı olmalı (kurum çalışıyor)
    const totalSlots = Object.values(body.days).reduce((n, d) => n + (d.count || 0), 0);
    expect(totalSlots).toBeGreaterThan(0);
  });

  test('stats: öğretmen/öğrenci sayısı tutarlı', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.teacherCount).toBeGreaterThanOrEqual(1);
    expect(body.studentCount).toBeGreaterThanOrEqual(1);
  });

  test('finance: en az 1 kayıt gelir', async ({ request }) => {
    const res = await request.get(`${BASE}/api/finance`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.records || [];
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  test('deneme/exams: liste gelir', async ({ request }) => {
    const res = await request.get(`${BASE}/api/deneme/exams`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const exams = body.exams || body;
    expect(Array.isArray(exams)).toBe(true);
  });
});

test.describe('Teacher okuma testleri', () => {
  test.use({ storageState: TEA_STATE });

  test('teacher: kendi slot grid\'ini okur (oturumdan keşif)', async ({ request }) => {
    const me = await whoami(request);
    expect(me.role).toBe('teacher');
    const res = await request.get(`${BASE}/api/slots?teacherId=${me.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('grid');
    expect(body).toHaveProperty('weekKey');
  });

  test('teacher: kendi programını okur', async ({ request }) => {
    const me = await whoami(request);
    const res = await request.get(`${BASE}/api/program?teacherId=${me.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('weekKey');
  });

  test('teacher: finans verisine erişemez (403)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/finance`);
    expect(res.status()).toBe(403);
  });
});

test.describe('Student okuma testleri', () => {
  test.use({ storageState: 'e2e/.auth/student.json' });

  // 2026-07-22 denetim B3/dalga2: teacherId'siz org-geneli /api/slots taraması kaldırıldı
  // (üretim tüketicisi yoktu; öğrenci etüt verisini /api/etut-sablon/all'dan okur).
  test('student: teacherId\'siz /api/slots → 400 (org-geneli tarama emekli)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/slots`);
    expect(res.status()).toBe(400);
  });

  test('student: etüt listesini okur (/api/etut-sablon/all)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/etut-sablon/all`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('etutler');
  });

  test('student: öğretmen listesini okuyabilir (etüt rezervasyonu için)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/teachers`);
    expect(res.status()).toBe(200);
  });

  test('student: finans verilerine erişemez (403)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/finance`);
    expect(res.status()).toBe(403);
  });
});
