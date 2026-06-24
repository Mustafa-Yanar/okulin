/**
 * SQL GÖÇ TESTİ — Çapraz rol / eşzamanlı multi-context
 * Birden fazla rolün aynı anda aktif olduğu gerçekçi senaryolar.
 * Oturumlar storageState'ten yüklenir — login YOK (rate-limit'e takılmaz).
 */
const { test, expect } = require('@playwright/test');

const BASE       = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';
const TEACHER_ID = 'd9sxbn8a';
const STUDENT_ID = '741zt9d5';
const TEST_DATE  = new Date().toISOString().split('T')[0];

const DIR_STATE = 'e2e/.auth/director.json';
const TEA_STATE = 'e2e/.auth/teacher.json';
const STU_STATE = 'e2e/.auth/student.json';

test('senaryo: öğretmen yoklama girer → director + öğrenci eşzamanlı kontrol', async ({ playwright }) => {
  const teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
  const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
  const stuReq = await playwright.request.newContext({ storageState: STU_STATE });

  const LESSON = '88'; // başka testlerle çakışmasın

  try {
    // ÖĞRETMEN yoklama yazar
    const post = await teaReq.post(`${BASE}/api/attendance`, {
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      data: { date: TEST_DATE, cls: 'm7', lessonNo: LESSON, attendance: { [STUDENT_ID]: 'yok' } },
    });
    expect(post.status()).toBe(200);

    // DIRECTOR summary'de aynı anda görür
    const summary = await dirReq.get(`${BASE}/api/attendance/summary?date=${TEST_DATE}`);
    expect(summary.status()).toBe(200);
    const clsMap = await summary.json();
    const lesson = (clsMap['m7']?.lessons || []).find(l => String(l.lessonNo) === LESSON);
    expect(lesson).toBeDefined();
    expect(lesson.absent.some(a => a.id === STUDENT_ID)).toBe(true);

    // ÖĞRENCİ /attendance/student'a erişemez (yalnız director/teacher) → 403
    const stuRes = await stuReq.get(`${BASE}/api/attendance/student?studentId=${STUDENT_ID}`);
    expect(stuRes.status()).toBe(403);
  } finally {
    await Promise.all([teaReq.dispose(), dirReq.dispose(), stuReq.dispose()]);
  }
});

test('senaryo: director paralel okuma — stats teacherCount tutarlı', async ({ playwright }) => {
  const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
  try {
    const [teachersRes, studentsRes, statsRes, financeRes] = await Promise.all([
      dirReq.get(`${BASE}/api/teachers`),
      dirReq.get(`${BASE}/api/students`),
      dirReq.get(`${BASE}/api/stats`),
      dirReq.get(`${BASE}/api/finance`),
    ]);

    expect(teachersRes.status()).toBe(200);
    expect(studentsRes.status()).toBe(200);
    expect(statsRes.status()).toBe(200);
    expect(financeRes.status()).toBe(200);

    const teachers = await teachersRes.json();
    const stats    = await statsRes.json();
    expect(stats.teacherCount).toBe(teachers.length);
  } finally {
    await dirReq.dispose();
  }
});

test('senaryo: teacher + student aynı anda slot okur', async ({ playwright }) => {
  const teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
  const stuReq = await playwright.request.newContext({ storageState: STU_STATE });
  try {
    const [teaSlots, stuSlots] = await Promise.all([
      teaReq.get(`${BASE}/api/slots?teacherId=${TEACHER_ID}`),
      stuReq.get(`${BASE}/api/slots`),
    ]);
    expect(teaSlots.status()).toBe(200);
    expect(stuSlots.status()).toBe(200);
    expect(await teaSlots.json()).toHaveProperty('grid');
    expect(await stuSlots.json()).toHaveProperty('slots');
  } finally {
    await Promise.all([teaReq.dispose(), stuReq.dispose()]);
  }
});

test('senaryo: 5 eşzamanlı director isteği — SQL connection pool', async ({ playwright }) => {
  // Tek kayıtlı oturum, 5 paralel istek → bağlantı havuzu stres testi (login tekrarı yok)
  const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
  try {
    const results = await Promise.all(
      Array(5).fill(null).map(() => dirReq.get(`${BASE}/api/teachers`))
    );
    for (const res of results) {
      expect(res.status()).toBe(200);
      expect((await res.json()).length).toBeGreaterThanOrEqual(10);
    }
  } finally {
    await dirReq.dispose();
  }
});
