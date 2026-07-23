/**
 * SQL GÖÇ TESTİ — Çapraz rol / eşzamanlı multi-context
 * Birden fazla rolün aynı anda aktif olduğu gerçekçi senaryolar.
 * Oturumlar storageState'ten yüklenir — login YOK (rate-limit'e takılmaz).
 * Kimlikler dinamik: oturum sahibi öğretmen/öğrenci whoami ile keşfedilir.
 */
const { test, expect } = require('@playwright/test');
const { BASE, JSON_HEADERS, DIR_STATE, TEA_STATE, STU_STATE, whoami } = require('./helpers');

const TEST_DATE = new Date().toISOString().split('T')[0];
const LESSON = '88'; // başka testlerle (99) çakışmayan yapay işaret değeri

test('senaryo: öğretmen yoklama girer → director + öğrenci eşzamanlı kontrol', async ({ playwright }) => {
  const teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
  const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
  const stuReq = await playwright.request.newContext({ storageState: STU_STATE });

  try {
    const STU = await whoami(stuReq);

    // ÖĞRETMEN yoklama yazar (oturum öğrencisinin kendi sınıfına, işaret dersine)
    const post = await teaReq.post(`${BASE}/api/attendance`, {
      headers: JSON_HEADERS,
      data: { date: TEST_DATE, cls: STU.cls, lessonNo: LESSON, attendance: { [STU.id]: 'yok' } },
    });
    expect(post.status()).toBe(200);

    // DIRECTOR aynı anda öğrencinin devamsızlık geçmişinde görür
    // (summary ucu slot-grid'inden türetir; yapay lessonNo 88 orada beklenmez)
    const hist = await dirReq.get(`${BASE}/api/attendance/student?studentId=${STU.id}`);
    expect(hist.status()).toBe(200);
    const body = await hist.json();
    const entry = (body.entries || []).find(
      (e) => e.date === TEST_DATE && String(e.lessonNo) === LESSON && e.status === 'yok'
    );
    expect(entry, 'işaret kaydı (lesson 88) müdür tarafında görünmeli').toBeDefined();

    // ÖĞRENCİ /attendance/student'a erişemez (yalnız director/counselor/teacher) → 403
    const stuRes = await stuReq.get(`${BASE}/api/attendance/student?studentId=${STU.id}`);
    expect(stuRes.status()).toBe(403);
  } finally {
    // TEMİZLİK: işaret kaydını boşalt
    const STU = await whoami(stuReq).catch(() => null);
    if (STU) {
      await teaReq.post(`${BASE}/api/attendance`, {
        headers: JSON_HEADERS,
        data: { date: TEST_DATE, cls: STU.cls, lessonNo: LESSON, attendance: {} },
      }).catch(() => {});
    }
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
    const TEA = await whoami(teaReq);
    // Öğrenci ayağı /api/etut-sablon/all (B3/dalga2: org-geneli /api/slots kaldırıldı).
    const [teaSlots, stuEtut] = await Promise.all([
      teaReq.get(`${BASE}/api/slots?teacherId=${TEA.id}`),
      stuReq.get(`${BASE}/api/etut-sablon/all`),
    ]);
    expect(teaSlots.status()).toBe(200);
    expect(stuEtut.status()).toBe(200);
    expect(await teaSlots.json()).toHaveProperty('grid');
    expect(await stuEtut.json()).toHaveProperty('etutler');
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
      expect((await res.json()).length).toBeGreaterThanOrEqual(1);
    }
  } finally {
    await dirReq.dispose();
  }
});
