/**
 * ENTEGRASYON — Ödeme callback'i (PayTR Bildirim URL'i)
 * PayTR'nin server-to-server gönderdiği imzalı isteği KENDİMİZ üretiriz:
 *   hash = HMAC-SHA256-base64( merchant_oid + salt + status + total_amount , key )
 *
 * Kurgu:
 * - testkurs config'ine TEST anahtarları (rastgele key/salt) müdür API'siyle yazılır
 *   (canlıda config boştu; test sonunda pasif + merchantId boş bırakılır).
 * - PayOrder fikstürü doğrudan DB'ye yazılır (payorder API'si yok; payment/start
 *   gerçek PayTR'ye gider) — DATABASE_URL .env.local'den gelir.
 * - Öğrenci + taksitli finans kaydı teste özeldir; test sonunda silinir
 *   (PayOrder öğrenciye FK-cascade bağlı, yine de açıkça temizlenir).
 *
 * Senaryolar: bozuk imza → red · eksik alan → red · geçerli imza → taksit ödenir ·
 * AYNI callback ikinci kez → tek işlem (atomik claim idempotency) · bilinmeyen
 * sipariş → sessiz OK (kredilendirme yok).
 */
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { BASE, JSON_HEADERS, DIR_STATE } = require('./helpers');

const ORG = process.env.DEFAULT_ORG || new URL(BASE).hostname.split('.')[0]; // local wrapper: testkurs
const KEY = 'e2ekey_' + crypto.randomBytes(12).toString('hex');
const SALT = 'e2esalt_' + crypto.randomBytes(12).toString('hex');
const OID = 'e2epay' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const AMOUNT_KURUS = '50000'; // 500 TL

function paytrHash(oid, status, totalAmount) {
  return crypto.createHmac('sha256', KEY).update(oid + SALT + status + totalAmount).digest('base64');
}

test.describe('PayTR ödeme callback zinciri', () => {
  test.describe.configure({ mode: 'serial' });

  let prisma, dirReq, anonReq;
  let stuId = null;
  const stuName = `E2E Ödeme ${Date.now().toString(36)}`;

  // Müdür gözünden finans kaydını oku (taksit + ödeme listesi).
  async function readFinance() {
    const res = await dirReq.get(`${BASE}/api/finance?studentId=${stuId}`);
    expect(res.status()).toBe(200);
    return res.json();
  }

  test.beforeAll(async ({ playwright }) => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL .env.local\'de tanımlı olmalı (PayOrder fikstürü için)').toBeTruthy();
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();

    dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
    anonReq = await playwright.request.newContext(); // callback oturumsuz gelir

    // 1) Teste özel öğrenci (herhangi bir kayıtlı sınıf yeterli — ilk sınıfı keşfet)
    const clsData = await (await dirReq.get(`${BASE}/api/classes`)).json();
    const cls = (clsData.classes || [])[0]?.id;
    expect(cls, 'kurumda en az bir sınıf kayıtlı olmalı').toBeTruthy();
    const createRes = await dirReq.post(`${BASE}/api/students`, {
      headers: JSON_HEADERS,
      data: { name: stuName, cls, password: 'e2e-gecici-sifre', parentName: 'E2E Ödeme Velisi', parentPhone: '0532 999 00 02' },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);
    stuId = (await createRes.json()).id;

    // 2) Taksitli finans planı (2 × 500 TL)
    const finRes = await dirReq.post(`${BASE}/api/finance`, {
      headers: JSON_HEADERS,
      data: {
        studentId: stuId, studentName: stuName, totalFee: 1000, discount: 0,
        paymentPlan: 'taksitli',
        installments: [
          { dueDate: '2026-09-01', amount: 500 },
          { dueDate: '2026-10-01', amount: 500 },
        ],
      },
    });
    expect(finRes.status(), await finRes.text()).toBe(200);

    // 3) PayTR TEST anahtarları (kurum config'i) — active:false (veli arayüzü açılmasın;
    //    callback anahtar varlığına bakar, active bayrağını kontrol etmez)
    const cfgRes = await dirReq.post(`${BASE}/api/payment/config`, {
      headers: JSON_HEADERS,
      data: { merchantId: 'e2e-test-merchant', merchantKey: KEY, merchantSalt: SALT, testMode: true, active: false },
    });
    expect(cfgRes.status(), await cfgRes.text()).toBe(200);

    // 4) PayOrder fikstürü — 1. taksit (idx 0) için bekleyen sipariş
    await prisma.payOrder.create({
      data: {
        oid: OID, orgSlug: ORG, branch: 'main', studentId: stuId,
        amount: parseInt(AMOUNT_KURUS), status: 'pending',
        data: { installmentIdx: 0, amountTL: 500, amountKurus: parseInt(AMOUNT_KURUS), studentName: stuName, createdAt: new Date().toISOString() },
      },
    });
  });

  test.afterAll(async () => {
    // TEMİZLİK: payorder → finans → öğrenci → config pasif (sırayla, best-effort)
    if (prisma) await prisma.payOrder.deleteMany({ where: { oid: { startsWith: 'e2epay' } } }).catch(() => {});
    if (dirReq && stuId) {
      await dirReq.delete(`${BASE}/api/finance`, { headers: JSON_HEADERS, data: { studentId: stuId } }).catch(() => {});
      await dirReq.delete(`${BASE}/api/students`, { headers: JSON_HEADERS, data: { id: stuId } }).catch(() => {});
    }
    if (dirReq) {
      // Anahtarlar şifreli alanda kalır ama merchantId boş + pasif → enabled:false (etkisiz)
      await dirReq.post(`${BASE}/api/payment/config`, {
        headers: JSON_HEADERS,
        data: { merchantId: '', testMode: true, active: false },
      }).catch(() => {});
      await dirReq.dispose();
    }
    if (anonReq) await anonReq.dispose();
    if (prisma) await prisma.$disconnect().catch(() => {});
  });

  test('bozuk imza → reddedilir, kredilendirme olmaz', async () => {
    const res = await anonReq.post(`${BASE}/api/payment/callback`, {
      form: { merchant_oid: OID, status: 'success', total_amount: AMOUNT_KURUS, hash: 'gecersiz-imza-degeri' },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('FAIL');

    // Sipariş hâlâ pending, taksit ödenmemiş
    const po = await prisma.payOrder.findUnique({ where: { oid: OID } });
    expect(po.status).toBe('pending');
    const fin = await readFinance();
    expect(fin.installments[0].paid).toBe(false);
    expect((fin.payments || []).length).toBe(0);
  });

  test('eksik merchant_oid → reddedilir', async () => {
    const res = await anonReq.post(`${BASE}/api/payment/callback`, {
      form: { status: 'success', total_amount: AMOUNT_KURUS, hash: paytrHash('', 'success', AMOUNT_KURUS) },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('FAIL');
  });

  test('geçerli imza → sipariş işlenir (taksit ödenir, makbuz kesilir)', async () => {
    const res = await anonReq.post(`${BASE}/api/payment/callback`, {
      form: { merchant_oid: OID, status: 'success', total_amount: AMOUNT_KURUS, hash: paytrHash(OID, 'success', AMOUNT_KURUS) },
    });
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('OK'); // PayTR sözleşmesi: düz metin OK

    const po = await prisma.payOrder.findUnique({ where: { oid: OID } });
    expect(po.status).toBe('paid');

    const fin = await readFinance();
    expect(fin.installments[0].paid).toBe(true);
    expect(fin.installments[0].method).toContain('PayTR');
    expect((fin.payments || []).length).toBe(1);
    expect(fin.payments[0].amount).toBe(500);
    expect(fin.payments[0].receiptNo).toMatch(/^MKB-/);
    expect(fin.balance).toBe(500); // 1000 net − 500 ödendi
  });

  test('AYNI callback ikinci kez → tek işlem (idempotency)', async () => {
    const res = await anonReq.post(`${BASE}/api/payment/callback`, {
      form: { merchant_oid: OID, status: 'success', total_amount: AMOUNT_KURUS, hash: paytrHash(OID, 'success', AMOUNT_KURUS) },
    });
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('OK'); // tekrar da OK döner (PayTR yeniden denemesin)

    // Çift kredilendirme YOK: hâlâ tek ödeme, bakiye değişmedi
    const fin = await readFinance();
    expect((fin.payments || []).length).toBe(1);
    expect(fin.installments[0].paid).toBe(true);
    expect(fin.balance).toBe(500);
    const po = await prisma.payOrder.findUnique({ where: { oid: OID } });
    expect(po.status).toBe('paid');
  });

  test('bilinmeyen sipariş → sessiz OK, kredilendirme yok', async () => {
    const ghostOid = 'e2epay-hayalet-' + Date.now().toString(36);
    const res = await anonReq.post(`${BASE}/api/payment/callback`, {
      form: { merchant_oid: ghostOid, status: 'success', total_amount: AMOUNT_KURUS, hash: paytrHash(ghostOid, 'success', AMOUNT_KURUS) },
    });
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('OK'); // bilinmeyen/expired sipariş → susarak OK

    const fin = await readFinance();
    expect((fin.payments || []).length).toBe(1); // değişmedi
  });
});
