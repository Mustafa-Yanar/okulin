/**
 * SQL GÖÇ TESTİ — Yazma uçları
 * SQL'e yazmanın çalıştığını ve geri okumanın tutarlı olduğunu doğrular.
 * Oturumlar storageState'ten gelir — login YOK. Kimlikler dinamik keşifle
 * (oturum sahibi öğretmen + öğrenci) gelir; sabit fikstür id'si YOK.
 *
 * lessonNo '99' = yapay işaret değeri (gerçek ders programıyla çakışmaz);
 * test sonunda kayıt boş attendance map'iyle temizlenir (kalıcı çöp yok).
 *
 * NOT: /api/attendance/summary artık slot-grid'inden ders türetir (lessonNo
 * ordinal) — yapay lessonNo 99 orada görünmez. Müdür tarafı doğrulama bu
 * yüzden /api/attendance/student (ham kayıt bazlı) üzerinden yapılır.
 */
const { test, expect } = require('@playwright/test');
const { BASE, JSON_HEADERS, DIR_STATE, TEA_STATE, STU_STATE, whoami } = require('./helpers');

const TEST_DATE   = new Date().toISOString().split('T')[0]; // bugün YYYY-MM-DD
const TEST_LESSON = '99'; // gerçek ders slotuyla çakışmayan yapay ders no

test.describe('Attendance yazma/okuma döngüsü', () => {
  let teaReq, dirReq, stuReq;
  let TEA, STU; // oturum sahipleri (dinamik)

  test.beforeAll(async ({ playwright }) => {
    teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
    dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
    stuReq = await playwright.request.newContext({ storageState: STU_STATE });
    TEA = await whoami(teaReq);
    STU = await whoami(stuReq);
    expect(TEA.role).toBe('teacher');
    expect(STU.role).toBe('student');
    expect(STU.cls).toBeTruthy();
  });

  test.afterAll(async () => {
    // TEMİZLİK: işaret dersinin yoklamasını boşalt (kayıt kalır ama içerik boş — çöp yok)
    if (STU?.cls) {
      await teaReq.post(`${BASE}/api/attendance`, {
        headers: JSON_HEADERS,
        data: { date: TEST_DATE, cls: STU.cls, lessonNo: TEST_LESSON, attendance: {} },
      }).catch(() => {});
    }
    await teaReq?.dispose();
    await dirReq?.dispose();
    await stuReq?.dispose();
  });

  test('öğretmen: attendance POST başarılı', async () => {
    const res = await teaReq.post(`${BASE}/api/attendance`, {
      headers: JSON_HEADERS,
      data: { date: TEST_DATE, cls: STU.cls, lessonNo: TEST_LESSON, attendance: { [STU.id]: 'yok' } },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('öğretmen: attendance GET — kendi yazdığını okur', async () => {
    const res = await teaReq.get(
      `${BASE}/api/attendance?date=${TEST_DATE}&teacherId=${TEA.id}&cls=${STU.cls}&lessonNo=${TEST_LESSON}`
    );
    expect(res.status()).toBe(200);
    expect((await res.json())[STU.id]).toBe('yok');
  });

  test('öğretmen: attendance güncelleme (upsert) çalışır', async () => {
    const res = await teaReq.post(`${BASE}/api/attendance`, {
      headers: JSON_HEADERS,
      data: { date: TEST_DATE, cls: STU.cls, lessonNo: TEST_LESSON, attendance: { [STU.id]: 'gec' } },
    });
    expect(res.status()).toBe(200);

    const get = await teaReq.get(
      `${BASE}/api/attendance?date=${TEST_DATE}&teacherId=${TEA.id}&cls=${STU.cls}&lessonNo=${TEST_LESSON}`
    );
    expect((await get.json())[STU.id]).toBe('gec');
  });

  test('director: öğrenci devamsızlık geçmişinde kayıt görünür', async () => {
    const res = await dirReq.get(`${BASE}/api/attendance/student?studentId=${STU.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Yazılan işaret kaydı (bugün, lessonNo 99, durum 'gec') ham kayıtlarda görünmeli
    const entry = (body.entries || []).find(
      (e) => e.date === TEST_DATE && String(e.lessonNo) === TEST_LESSON && e.status === 'gec'
    );
    expect(entry, 'lessonNo 99 işaret kaydı devamsızlık geçmişinde olmalı').toBeDefined();
    expect(entry.teacherId).toBe(TEA.id);
  });

  test('director: student devamsızlık özeti güncellendi', async () => {
    const res = await dirReq.get(`${BASE}/api/attendance/student?studentId=${STU.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.summary.gec).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Auth/CSRF güvenlik kontrolü', () => {
  test('token olmadan mutation → 401/403', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const res = await anon.post(`${BASE}/api/attendance`, {
      headers: JSON_HEADERS,
      data: { date: TEST_DATE, cls: 'x', lessonNo: '1', attendance: {} },
    });
    expect([401, 403]).toContain(res.status());
    await anon.dispose();
  });

  test('CSRF: Origin header olmadan → reddedilir', async ({ playwright }) => {
    const teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
    const res = await teaReq.post(`${BASE}/api/attendance`, {
      headers: { 'Content-Type': 'application/json' }, // Origin YOK
      data: { date: TEST_DATE, cls: 'x', lessonNo: '1', attendance: {} },
    });
    expect([403, 401]).toContain(res.status());
    await teaReq.dispose();
  });
});
