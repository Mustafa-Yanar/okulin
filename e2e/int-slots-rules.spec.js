/**
 * ENTEGRASYON — /api/slots yazma yüzeyi KAPALI (nöbetçi test)
 *
 * 2026-07-22 denetim B3: grid slot rezervasyonu (POST/DELETE /api/slots) emekli edildi —
 * etüt rezervasyonunun tek yazım kapısı /api/etut-sablon/rezervasyon (lib/etut/booking.ts
 * bookEtut/cancelEtutV2; kural seti orada, birim testleri lib/etut altında).
 * Bu spec eski 8 iş-kuralı testinin yerine geçer: yüzeyin YANLIŞLIKLA geri açılmasını
 * yakalar. Export edilmeyen metodlara Next.js otomatik 405 döner; JSON_HEADERS Origin
 * içerir (middleware CSRF katmanı 403'e düşürmesin — 405'i route katmanı versin).
 * GET yüzeyi (grid görüntüleme) yaşamaya devam eder — burada 200 ile doğrulanır.
 * Kanıt/harita: docs/superpowers/specs/2026-07-22-buyuk-temizlik-faz1-harita.md (B3).
 */
const { test, expect } = require('@playwright/test');
const { BASE, JSON_HEADERS, TEA_STATE, getWeekKey, whoami } = require('./helpers');

test.describe('/api/slots yazma yüzeyi kapalı', () => {
  let teaReq, TEA;

  test.beforeAll(async ({ playwright }) => {
    teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
    TEA = await whoami(teaReq);
    expect(TEA.role).toBe('teacher');
  });

  test.afterAll(async () => { await teaReq?.dispose(); });

  test('POST /api/slots → 405 (yazma yüzeyi emekli)', async () => {
    const res = await teaReq.post(`${BASE}/api/slots`, {
      headers: JSON_HEADERS,
      data: { teacherId: TEA.id, day: 0, slotId: 'd0s1', studentId: 'x', weekKey: getWeekKey() },
    });
    expect(res.status()).toBe(405);
  });

  test('DELETE /api/slots → 405 (iptal yüzeyi emekli)', async () => {
    const res = await teaReq.delete(`${BASE}/api/slots`, {
      headers: JSON_HEADERS,
      data: { teacherId: TEA.id, day: 0, slotId: 'd0s1', weekKey: getWeekKey() },
    });
    expect(res.status()).toBe(405);
  });

  test('GET /api/slots?teacherId → 200 (grid görüntüleme yaşıyor)', async () => {
    const res = await teaReq.get(`${BASE}/api/slots?teacherId=${encodeURIComponent(TEA.id)}&week=${getWeekKey()}`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.grid).toBeTruthy();
  });
});
