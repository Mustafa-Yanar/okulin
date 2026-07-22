/**
 * ENTEGRASYON — Para alanları JSON tip sözleşmesi (canlı testkurs)
 * Float→Decimal göçünün mührü: API para alanları HER ZAMAN JSON number kalmalı.
 * Prisma Decimal objesi stringify'da STRING'e döner — decimal-to-number katmanı
 * (lib/prisma) bunu engeller; bu spec sözleşmeyi canlıda kilitler (göç öncesi de
 * sonrası da aynen geçmeli). Kapsam: muhasebe listesi (student→finance include
 * yolu — extension'ın derin-yürüyüş dalı) + tek öğrenci finansı (?studentId).
 * Yanıt şekilleri: liste = düz dizi [{..., finance: financeOut|null}];
 * tek kayıt = doğrudan financeOut objesi (app/api/finance/route.ts GET).
 */
const { test, expect } = require('@playwright/test');
const { BASE, DIR_STATE } = require('./helpers');

function assertMoneyShape(f, label) {
  expect(typeof f.totalFee, `${label}.totalFee`).toBe('number');
  expect(typeof f.discount, `${label}.discount`).toBe('number');
  expect(typeof f.netFee, `${label}.netFee`).toBe('number');
  expect(typeof f.balance, `${label}.balance`).toBe('number');
  for (const [i, inst] of (f.installments || []).entries()) {
    expect(typeof inst.amount, `${label}.inst[${i}].amount`).toBe('number');
    if (inst.paidAmount !== null && inst.paidAmount !== undefined) {
      expect(typeof inst.paidAmount, `${label}.inst[${i}].paidAmount`).toBe('number');
    }
  }
  for (const [i, p] of (f.payments || []).entries()) {
    expect(typeof p.amount, `${label}.payments[${i}].amount`).toBe('number');
  }
}

test.describe('Para tip sözleşmesi (Decimal → number)', () => {
  let web;
  let withFinance = [];

  test.beforeAll(async ({ playwright }) => {
    web = await playwright.request.newContext({ storageState: DIR_STATE, extraHTTPHeaders: { Origin: BASE } });
    const r = await web.get(`${BASE}/api/finance`);
    expect(r.status(), await r.text()).toBe(200);
    const list = await r.json();
    expect(Array.isArray(list), 'liste düz dizi olmalı').toBe(true);
    withFinance = list.filter((s) => s.finance);
  });
  test.afterAll(async () => { await web?.dispose(); });

  test('muhasebe listesi: tüm para alanları number (student→finance include yolu)', async () => {
    test.skip(withFinance.length === 0, 'testkurs\'ta finans kaydı yok — sözleşme örneklenemedi');
    for (const s of withFinance) assertMoneyShape(s.finance, `list[${s.studentId}]`);
  });

  test('tek öğrenci finansı (?studentId): para alanları number', async () => {
    test.skip(withFinance.length === 0, 'finans kaydı yok');
    const sid = withFinance[0].studentId;
    const r = await web.get(`${BASE}/api/finance?studentId=${encodeURIComponent(sid)}`);
    expect(r.status(), await r.text()).toBe(200);
    const f = await r.json();
    expect(f && typeof f, 'tek kayıt obje olmalı').toBe('object');
    assertMoneyShape(f, 'single');
  });
});
