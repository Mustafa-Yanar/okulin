/**
 * SQL GÖÇ TESTİ — Yazma uçları
 * SQL'e yazmanın çalıştığını ve geri okumanın tutarlı olduğunu doğrular.
 * Oturumlar storageState'ten gelir — login YOK.
 * Test akışı: öğretmen attendance yazar → kendi okur → director summary'de görür.
 */
const { test, expect } = require('@playwright/test');

const BASE       = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';
const TEACHER_ID = 'd9sxbn8a'; // Matematik Öğretmeni1 legacyId
const STUDENT_ID = '741zt9d5'; // Duha pirinç legacyId

const TEST_DATE   = new Date().toISOString().split('T')[0]; // bugün YYYY-MM-DD
const TEST_CLS    = 'm7';
const TEST_LESSON = '99'; // gerçek ders slotuyla çakışmayan yapay ders no

// İki bağımsız APIRequestContext: öğretmen ve director (kayıtlı oturumlardan)
test.describe('Attendance yazma/okuma döngüsü', () => {
  let teaReq, dirReq;

  test.beforeAll(async ({ playwright }) => {
    teaReq = await playwright.request.newContext({ storageState: 'e2e/.auth/teacher.json' });
    dirReq = await playwright.request.newContext({ storageState: 'e2e/.auth/director.json' });
  });

  test.afterAll(async () => {
    await teaReq.dispose();
    await dirReq.dispose();
  });

  test('öğretmen: attendance POST başarılı', async () => {
    const res = await teaReq.post(`${BASE}/api/attendance`, {
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      data: { date: TEST_DATE, cls: TEST_CLS, lessonNo: TEST_LESSON, attendance: { [STUDENT_ID]: 'yok' } },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('öğretmen: attendance GET — kendi yazdığını okur', async () => {
    const res = await teaReq.get(
      `${BASE}/api/attendance?date=${TEST_DATE}&teacherId=${TEACHER_ID}&cls=${TEST_CLS}&lessonNo=${TEST_LESSON}`
    );
    expect(res.status()).toBe(200);
    expect((await res.json())[STUDENT_ID]).toBe('yok');
  });

  test('öğretmen: attendance güncelleme (upsert) çalışır', async () => {
    const res = await teaReq.post(`${BASE}/api/attendance`, {
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      data: { date: TEST_DATE, cls: TEST_CLS, lessonNo: TEST_LESSON, attendance: { [STUDENT_ID]: 'gec' } },
    });
    expect(res.status()).toBe(200);

    const get = await teaReq.get(
      `${BASE}/api/attendance?date=${TEST_DATE}&teacherId=${TEACHER_ID}&cls=${TEST_CLS}&lessonNo=${TEST_LESSON}`
    );
    expect((await get.json())[STUDENT_ID]).toBe('gec');
  });

  test('director: summary\'de yazılan kayıt görünür', async () => {
    const res = await dirReq.get(`${BASE}/api/attendance/summary?date=${TEST_DATE}`);
    expect(res.status()).toBe(200);
    const clsMap = await res.json();
    const cls = clsMap[TEST_CLS];
    expect(cls).toBeDefined();
    const lesson = cls.lessons.find(l => String(l.lessonNo) === TEST_LESSON);
    expect(lesson).toBeDefined();
    expect(lesson.late.map(l => l.id)).toContain(STUDENT_ID);
  });

  test('director: student devamsızlık özeti güncellendi', async () => {
    const res = await dirReq.get(`${BASE}/api/attendance/student?studentId=${STUDENT_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.summary.gec).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Auth/CSRF güvenlik kontrolü', () => {
  test('token olmadan mutation → 401/403', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const res = await anon.post(`${BASE}/api/attendance`, {
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      data: { date: TEST_DATE, cls: 'm7', lessonNo: '1', attendance: {} },
    });
    expect([401, 403]).toContain(res.status());
    await anon.dispose();
  });

  test('CSRF: Origin header olmadan → reddedilir', async ({ playwright }) => {
    const teaReq = await playwright.request.newContext({ storageState: 'e2e/.auth/teacher.json' });
    const res = await teaReq.post(`${BASE}/api/attendance`, {
      headers: { 'Content-Type': 'application/json' }, // Origin YOK
      data: { date: TEST_DATE, cls: TEST_CLS, lessonNo: '1', attendance: {} },
    });
    expect([403, 401]).toContain(res.status());
    await teaReq.dispose();
  });
});
