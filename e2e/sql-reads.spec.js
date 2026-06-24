/**
 * SQL GÖÇ TESTİ — Okuma uçları
 * Kritik GET endpoint'lerinin SQL'den doğru veri döndürdüğünü doğrular.
 * Oturumlar auth.setup.js'ten gelir (storageState) — bu dosyada login YOK.
 */
const { test, expect } = require('@playwright/test');

const BASE       = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';
const TEACHER_ID = 'd9sxbn8a'; // Matematik Öğretmeni1 legacyId

test.describe('Director okuma testleri', () => {
  test.use({ storageState: 'e2e/.auth/director.json' });

  test('teachers: en az 10 öğretmen gelir', async ({ request }) => {
    const res = await request.get(`${BASE}/api/teachers`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(10);
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

  test('slot-times: weekday + weekend slotlar gelir', async ({ request }) => {
    const res = await request.get(`${BASE}/api/slot-times`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.weekday.length).toBeGreaterThan(0);
    expect(body.weekend.length).toBeGreaterThan(0);
  });

  test('stats: öğretmen/öğrenci sayısı tutarlı', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.teacherCount).toBeGreaterThanOrEqual(10);
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
  test.use({ storageState: 'e2e/.auth/teacher.json' });

  test('teacher: kendi slot grid\'ini okur', async ({ request }) => {
    const res = await request.get(`${BASE}/api/slots?teacherId=${TEACHER_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('grid');
    expect(body).toHaveProperty('weekKey');
  });

  test('teacher: kendi programını okur', async ({ request }) => {
    const res = await request.get(`${BASE}/api/program?teacherId=${TEACHER_ID}`);
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

  test('student: slot listesini okur', async ({ request }) => {
    const res = await request.get(`${BASE}/api/slots`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('slots');
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
