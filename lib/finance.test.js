import { describe, it, expect } from 'vitest';
import { applyInstallmentPayment, generateReceiptNo } from './finance.js';

// Sahte Redis: get/set/incr — applyInstallmentPayment'in kullandığı tek yüzey.
function fakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, v); },
    async incr(k) { const v = (store.get(k) || 0) + 1; store.set(k, v); return v; },
  };
}

const YIL = new Date().getFullYear();

// 3×1000 taksitli temiz kayıt
function kayit() {
  return {
    studentName: 'Ali Veli',
    netFee: 3000,
    payments: [],
    installments: [
      { amount: 1000, dueDate: '2026-09-01', paid: false },
      { amount: 1000, dueDate: '2026-10-01', paid: false },
      { amount: 1000, dueDate: '2026-11-01', paid: false },
    ],
  };
}

function db(record = kayit()) {
  return fakeRedis({ 'finance:s1': record });
}

describe('applyInstallmentPayment — genel ödeme (taksit seçilmeden)', () => {
  it('ilk ödenmemiş taksiti tam karşılarsa öder; bakiye ve makbuz doğru', async () => {
    const redis = db();
    const r = await applyInstallmentPayment(redis, {
      studentId: 's1', amount: 1000, method: 'Nakit', date: '2026-06-11', recordedBy: 'Müdür',
    });
    expect(r.ok).toBe(true);
    expect(r.balance).toBe(2000);
    expect(r.receiptNo).toBe(`MKB-${YIL}-00001`);
    expect(r.payment).toMatchObject({ amount: 1000, method: 'Nakit', date: '2026-06-11', recordedBy: 'Müdür' });
    const saved = await redis.get('finance:s1');
    expect(saved.installments[0]).toMatchObject({ paid: true, paidDate: '2026-06-11', paidAmount: 1000, receiptNo: r.receiptNo });
    expect(saved.installments[1].paid).toBe(false);
    expect(saved.payments).toHaveLength(1);
  });

  it('kısmi ödeme kaydedilir ama taksit ödendi işaretlenmez', async () => {
    const redis = db();
    const r = await applyInstallmentPayment(redis, { studentId: 's1', amount: 400, date: '2026-06-11' });
    expect(r.ok).toBe(true);
    expect(r.balance).toBe(2600);
    const saved = await redis.get('finance:s1');
    expect(saved.installments[0].paid).toBe(false); // 400 < 1000
    expect(saved.payments).toHaveLength(1);
  });

  it('kuruş toleransı: 999.99 taksiti kapatır (±0.01), 999.98 kapatmaz', async () => {
    const r1 = await applyInstallmentPayment(db(), { studentId: 's1', amount: 999.99, date: '2026-06-11' });
    expect(r1.record.installments[0].paid).toBe(true);
    const r2 = await applyInstallmentPayment(db(), { studentId: 's1', amount: 999.98, date: '2026-06-11' });
    expect(r2.record.installments[0].paid).toBe(false);
  });

  it('ilk taksit ödenmişse sıradaki ödenmemişe gider', async () => {
    const rec = kayit();
    rec.installments[0] = { ...rec.installments[0], paid: true };
    rec.payments = [{ id: 'p0', amount: 1000 }];
    const r = await applyInstallmentPayment(db(rec), { studentId: 's1', amount: 1000, date: '2026-06-11' });
    expect(r.record.installments[1].paid).toBe(true);
    expect(r.balance).toBe(1000); // 3000 − (1000 önceki + 1000 yeni)
  });

  it('taksit listesi boş/hepsi ödenmişse ödeme yine kaydedilir (taksit işaretsiz)', async () => {
    const rec = { studentName: 'X', netFee: 500, payments: [], installments: [] };
    const r = await applyInstallmentPayment(db(rec), { studentId: 's1', amount: 200, date: '2026-06-11' });
    expect(r.ok).toBe(true);
    expect(r.balance).toBe(300);
    expect(r.record.payments).toHaveLength(1);
  });
});

describe('applyInstallmentPayment — açık taksit seçimi (installmentIdx)', () => {
  it('seçilen taksitin TAMAMI tahsil edilir; amount parametresi yok sayılır', async () => {
    const redis = db();
    const r = await applyInstallmentPayment(redis, {
      studentId: 's1', amount: 50, installmentIdx: 1, method: 'PayTR', date: '2026-06-11',
    });
    expect(r.ok).toBe(true);
    expect(r.payment.amount).toBe(1000); // 50 değil
    const saved = await redis.get('finance:s1');
    expect(saved.installments[1]).toMatchObject({ paid: true, method: 'PayTR' });
    expect(saved.installments[0].paid).toBe(false); // sıra atlandı, 1. taksit dokunulmadı
  });

  it('string tutarlı taksit (eski kayıt) parseFloat ile işlenir', async () => {
    const rec = kayit();
    rec.installments[0].amount = '1000';
    const r = await applyInstallmentPayment(db(rec), { studentId: 's1', installmentIdx: 0, date: '2026-06-11' });
    expect(r.payment.amount).toBe(1000);
  });

  it('ödenmiş taksite İKİNCİ tahsilat reddedilir (çift kredilendirme siperi)', async () => {
    const redis = db();
    await applyInstallmentPayment(redis, { studentId: 's1', installmentIdx: 0, date: '2026-06-11' });
    const tekrar = await applyInstallmentPayment(redis, { studentId: 's1', installmentIdx: 0, date: '2026-06-11' });
    expect(tekrar.ok).toBe(false);
    expect(tekrar.status).toBe(400);
    expect(tekrar.error).toMatch(/zaten ödenmiş/);
    const saved = await redis.get('finance:s1');
    expect(saved.payments).toHaveLength(1); // ikinci ödeme YAZILMADI
  });
});

describe('applyInstallmentPayment — hata yolları', () => {
  it('finans kaydı yoksa 404', async () => {
    const r = await applyInstallmentPayment(fakeRedis(), { studentId: 'yok', amount: 100 });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it('geçersiz tutar (0 / negatif / eksik) 400', async () => {
    for (const amount of [0, -5, undefined, 'abc']) {
      const r = await applyInstallmentPayment(db(), { studentId: 's1', amount });
      expect(r, `amount=${amount}`).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('hata yollarında kayıt ve sayaç DEĞİŞMEZ', async () => {
    const redis = db();
    await applyInstallmentPayment(redis, { studentId: 's1', amount: -5 });
    expect((await redis.get('finance:s1')).payments).toHaveLength(0);
    // -5 makbuz sayacını tüketmemeli ki numaralar atlamasın
    expect(await redis.get('receipt_counter')).toBeNull();
  });
});

describe('makbuz numarası', () => {
  it('MKB-YYYY-00001 formatı ve artan sayaç', async () => {
    const redis = fakeRedis();
    expect(await generateReceiptNo(redis)).toBe(`MKB-${YIL}-00001`);
    expect(await generateReceiptNo(redis)).toBe(`MKB-${YIL}-00002`);
  });

  it('ardışık ödemeler ardışık makbuz alır; tarih verilmezse bugünün ISO günü', async () => {
    const redis = db();
    const r1 = await applyInstallmentPayment(redis, { studentId: 's1', amount: 1000 });
    const r2 = await applyInstallmentPayment(redis, { studentId: 's1', amount: 1000 });
    expect(r1.receiptNo).toBe(`MKB-${YIL}-00001`);
    expect(r2.receiptNo).toBe(`MKB-${YIL}-00002`);
    expect(r1.payment.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r2.balance).toBe(1000);
  });
});
