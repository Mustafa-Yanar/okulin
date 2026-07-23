/**
 * Yerel sentetik kurumda nesne/rol sınırları (IDOR negatif matrisi).
 * İkinci öğrenci ve dolu etüt seed tarafından hazırlanır; canlı veriye dayanmaz.
 */
const { test, expect } = require('@playwright/test');
const { BASE, JSON_HEADERS, TEA_STATE, STU_STATE, whoami } = require('./helpers');

test.describe('rol ve kimlik erişim sınırları', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(process.env.OKULIN_RELATION_FIXTURE !== 'YES', 'yalnız sentetik ilişki fikstürüyle çalışır');

  let teacherReq;
  let studentReq;
  let parentReq;
  let teacher;
  let student;

  test.beforeAll(async ({ playwright }) => {
    teacherReq = await playwright.request.newContext({ storageState: TEA_STATE });
    studentReq = await playwright.request.newContext({ storageState: STU_STATE });
    parentReq = await playwright.request.newContext();
    teacher = await whoami(teacherReq);
    student = await whoami(studentReq);

    const login = await parentReq.post(`${BASE}/api/auth`, {
      headers: JSON_HEADERS,
      data: {
        action: 'login', role: 'parent',
        username: process.env.OKULIN_PAR_USER,
        password: process.env.OKULIN_PAR_PASS,
      },
    });
    expect(login.status(), await login.text()).toBe(200);
  });

  test.afterAll(async () => {
    await Promise.all([teacherReq?.dispose(), studentReq?.dispose(), parentReq?.dispose()]);
  });

  test('öğrenci ham öğretmen programı ve yoklama sözlüğünü okuyamaz', async () => {
    const program = await studentReq.get(`${BASE}/api/program?teacherId=${teacher.id}`);
    expect(program.status()).toBe(403);

    const attendance = await studentReq.get(
      `${BASE}/api/attendance?date=2026-07-20&teacherId=${teacher.id}&cls=${student.cls}&lessonNo=1`,
    );
    expect(attendance.status()).toBe(403);
  });

  test('öğretmen kendi program/yoklamasını okur, başka öğretmen kimliğini okuyamaz', async () => {
    expect((await teacherReq.get(`${BASE}/api/program?teacherId=${teacher.id}`)).status()).toBe(200);
    expect((await teacherReq.get(`${BASE}/api/program?teacherId=t_yabanci`)).status()).toBe(403);

    const own = `${BASE}/api/attendance?date=2026-07-20&teacherId=${teacher.id}&cls=${student.cls}&lessonNo=1`;
    const foreign = `${BASE}/api/attendance?date=2026-07-20&teacherId=t_yabanci&cls=${student.cls}&lessonNo=1`;
    expect((await teacherReq.get(own)).status()).toBe(200);
    expect((await teacherReq.get(foreign)).status()).toBe(403);
  });

  test('öğrenci dolu etüt slotunu görür ama diğer öğrencinin kimliği maskelenir', async () => {
    const response = await studentReq.get(`${BASE}/api/etut-sablon/all`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    const occupied = (body.etutler || []).find((row) => row.booked && row.studentId === null);
    expect(occupied, 'başka öğrenciye ait maskelenmiş dolu etüt olmalı').toBeTruthy();
    expect(occupied).toMatchObject({
      studentId: null, studentName: null, studentCls: null,
      branch: null, bookedBy: null, scope: null, booked: true,
    });
  });

  test('öğretmen etüt yüzeyinde yalnız kendi şablonlarını görür', async () => {
    const response = await teacherReq.get(`${BASE}/api/etut-sablon/all`);
    expect(response.status()).toBe(200);
    const rows = (await response.json()).etutler || [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((row) => row.teacherId))).toEqual(new Set([teacher.id]));
    expect(rows.some((row) => row.booked && row.studentName)).toBe(true);
  });

  test('veli kendi çocuğunu okur, aynı kurumdaki başka öğrenciyi yedi yüzeyde okuyamaz', async () => {
    const own = 's_101_1';
    const foreign = 's_101_2';
    const endpoints = [
      (id) => `/api/finance?studentId=${id}`,
      (id) => `/api/guidance?studentId=${id}`,
      (id) => `/api/topics?studentId=${id}`,
      (id) => `/api/hedef?studentId=${id}`,
      (id) => `/api/deneme/student?studentId=${id}`,
      (id) => `/api/davranis?studentId=${id}`,
      (id) => `/api/etut-sablon/all?studentId=${id}`,
    ];

    for (const endpoint of endpoints) {
      const ownResponse = await parentReq.get(`${BASE}${endpoint(own)}`);
      expect(ownResponse.status(), `veli kendi çocuğu: ${endpoint(own)}`).toBe(200);
      const foreignResponse = await parentReq.get(`${BASE}${endpoint(foreign)}`);
      expect(foreignResponse.status(), `veli yabancı öğrenci: ${endpoint(foreign)}`).toBe(403);
    }
  });
});
