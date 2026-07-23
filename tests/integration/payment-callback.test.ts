import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { applyInstallmentPaymentSql, type PaymentEntry } from '@/lib/finance';
import { encryptSecret } from '@/lib/payment/crypto';
import { POST as paymentCallback } from '@/app/api/payment/callback/route';

const ORG = 'digerkurs';
const BRANCH = 'main';
const STUDENT_ID = 's_202_1';
const RECOVERY_STUDENT_ID = 's_202_2';
const KEY = 'integration-paytr-key';
const SALT = 'integration-paytr-salt';
const OID_MISMATCH = 'integration_amount_mismatch';
const OID_CONCURRENT = 'integration_concurrent_callback';
const OID_FRESH_PROCESSING = 'integration_fresh_processing';
const OID_STALE_PROCESSING = 'integration_stale_processing';
const OID_LEDGER_RECOVERY = 'integration_ledger_recovery';
const EXPECTED_AMOUNT = 500_000; // 5.000 TL, kuruş
const RECOVERY_AMOUNT = 100_000; // 1.000 TL, kuruş
const RECOVERY_FINANCE_ID = 'finance_digerkurs_callback_recovery';
const PAYMENT_PROCESSING_LEASE_MS = 10 * 60 * 1000;

const ALL_OIDS = [
  OID_MISMATCH,
  OID_CONCURRENT,
  OID_FRESH_PROCESSING,
  OID_STALE_PROCESSING,
  OID_LEDGER_RECOVERY,
];

function hash(oid: string, status: string, amount: string): string {
  return crypto.createHmac('sha256', KEY).update(oid + SALT + status + amount).digest('base64');
}

function callbackRequest(oid: string, amount: string): Request {
  const body = new URLSearchParams({
    merchant_oid: oid,
    status: 'success',
    total_amount: amount,
    hash: hash(oid, 'success', amount),
  });
  return new Request('http://localhost/api/payment/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe.sequential('PayTR callback güvenliği ve idempotency', () => {
  beforeAll(async () => {
    await prisma.tenantConfig.update({
      where: { orgSlug_branch: { orgSlug: ORG, branch: BRANCH } },
      data: {
        paymentConfig: {
          provider: 'paytr', merchantId: 'integration-merchant', active: false, testMode: true,
          keyEnc: encryptSecret(KEY), saltEnc: encryptSecret(SALT),
        },
      },
    });
    const recoveryStudent = await prisma.student.findFirstOrThrow({
      where: { orgSlug: ORG, branch: BRANCH, legacyId: RECOVERY_STUDENT_ID },
    });
    await prisma.finance.create({
      data: {
        id: RECOVERY_FINANCE_ID, orgSlug: ORG, branch: BRANCH, studentId: recoveryStudent.id,
        totalFee: 3000, discount: 0, netFee: 3000, paymentPlan: 'taksitli', payments: [],
        installments: {
          create: [0, 1, 2].map((idx) => ({
            id: `inst_digerkurs_callback_${idx}`, idx,
            dueDate: `2026-${String(9 + idx).padStart(2, '0')}-01`, amount: 1000,
          })),
        },
      },
    });

    await prisma.payOrder.createMany({
      data: [OID_MISMATCH, OID_CONCURRENT].map((oid, index) => ({
        oid, orgSlug: ORG, branch: BRANCH, studentId: STUDENT_ID,
        amount: EXPECTED_AMOUNT, status: 'pending',
        data: { installmentIdx: index, studentName: 'İkinci Test Öğrencisi' },
      })),
    });
    await prisma.payOrder.createMany({
      data: [
        {
          oid: OID_FRESH_PROCESSING, installmentIdx: 0,
          processingToken: 'fresh-owner', processingStartedAt: new Date(),
        },
        {
          oid: OID_STALE_PROCESSING, installmentIdx: 1,
          processingToken: 'stale-owner',
          processingStartedAt: new Date(Date.now() - PAYMENT_PROCESSING_LEASE_MS - 60_000),
        },
        {
          oid: OID_LEDGER_RECOVERY, installmentIdx: 2,
          processingToken: 'crashed-owner',
          processingStartedAt: new Date(Date.now() - PAYMENT_PROCESSING_LEASE_MS - 60_000),
        },
      ].map((order) => ({
        oid: order.oid, orgSlug: ORG, branch: BRANCH, studentId: RECOVERY_STUDENT_ID,
        amount: RECOVERY_AMOUNT, status: 'processing',
        processingToken: order.processingToken,
        processingStartedAt: order.processingStartedAt,
        data: { installmentIdx: order.installmentIdx, studentName: 'İkinci Yapay Öğrenci' },
      })),
    });
  });

  afterAll(async () => {
    await prisma.payOrder.deleteMany({ where: { oid: { in: ALL_OIDS } } });
    await prisma.finance.deleteMany({ where: { id: RECOVERY_FINANCE_ID } });
    await prisma.$disconnect();
  });

  it('imzası geçerli olsa bile siparişten farklı tutarı kredilendirmez', async () => {
    const response = await paymentCallback(callbackRequest(OID_MISMATCH, '1'));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('tutar uyuşmuyor');

    const order = await prisma.payOrder.findUniqueOrThrow({ where: { oid: OID_MISMATCH } });
    const student = await prisma.student.findFirstOrThrow({ where: { orgSlug: ORG, legacyId: STUDENT_ID } });
    const finance = await prisma.finance.findUniqueOrThrow({ where: { studentId: student.id } });
    expect(order.status).toBe('pending');
    expect(finance.payments).toEqual([]);
  });

  it('aynı geçerli callback eşzamanlı gelirse yalnız bir kez kredilendirir', async () => {
    const [first, second] = await Promise.all([
      paymentCallback(callbackRequest(OID_CONCURRENT, String(EXPECTED_AMOUNT))),
      paymentCallback(callbackRequest(OID_CONCURRENT, String(EXPECTED_AMOUNT))),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await first.text()).toBe('OK');
    expect(await second.text()).toBe('OK');

    const order = await prisma.payOrder.findUniqueOrThrow({ where: { oid: OID_CONCURRENT } });
    const student = await prisma.student.findFirstOrThrow({ where: { orgSlug: ORG, legacyId: STUDENT_ID } });
    const finance = await prisma.finance.findUniqueOrThrow({
      where: { studentId: student.id }, include: { installments: { orderBy: { idx: 'asc' } } },
    });
    const payments = (finance.payments as Array<{ amount: number }>) || [];

    expect(order.status).toBe('paid');
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(5000);
    expect(finance.installments[1]).toMatchObject({ paid: true, paidAmount: 5000 });
  });

  it('henüz süresi dolmamış processing kaydını ikinci çağrı devralmaz', async () => {
    const response = await paymentCallback(callbackRequest(OID_FRESH_PROCESSING, String(RECOVERY_AMOUNT)));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');

    const order = await prisma.payOrder.findUniqueOrThrow({ where: { oid: OID_FRESH_PROCESSING } });
    const finance = await prisma.finance.findUniqueOrThrow({ where: { id: RECOVERY_FINANCE_ID } });
    expect(order).toMatchObject({ status: 'processing', processingToken: 'fresh-owner' });
    expect(finance.payments).toEqual([]);
  });

  it('süresi dolmuş processing kaydını güvenle devralıp tamamlar', async () => {
    const response = await paymentCallback(callbackRequest(OID_STALE_PROCESSING, String(RECOVERY_AMOUNT)));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');

    const order = await prisma.payOrder.findUniqueOrThrow({ where: { oid: OID_STALE_PROCESSING } });
    const finance = await prisma.finance.findUniqueOrThrow({
      where: { id: RECOVERY_FINANCE_ID }, include: { installments: { orderBy: { idx: 'asc' } } },
    });
    const payments = (finance.payments as unknown as PaymentEntry[]) || [];
    expect(order).toMatchObject({ status: 'paid', processingToken: null, processingStartedAt: null });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: 1000, externalRef: `paytr:${OID_STALE_PROCESSING}` });
    expect(finance.installments[1]).toMatchObject({ paid: true, paidAmount: 1000 });
  });

  it('finansa yazıldıktan sonra süreç kapanmışsa aynı ödemeyi tekrar yazmadan siparişi kapatır', async () => {
    const idempotencyKey = `paytr:${OID_LEDGER_RECOVERY}`;
    const original = await applyInstallmentPaymentSql({
      orgOverride: ORG, branchOverride: BRANCH, studentId: RECOVERY_STUDENT_ID,
      installmentIdx: 2, method: 'PayTR (online)', recordedBy: 'Çökme Senaryosu',
      idempotencyKey,
    });
    const counterBefore = (await prisma.tenantConfig.findUniqueOrThrow({
      where: { orgSlug_branch: { orgSlug: ORG, branch: BRANCH } },
    })).receiptCounter;

    const response = await paymentCallback(callbackRequest(OID_LEDGER_RECOVERY, String(RECOVERY_AMOUNT)));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');

    const order = await prisma.payOrder.findUniqueOrThrow({ where: { oid: OID_LEDGER_RECOVERY } });
    const finance = await prisma.finance.findUniqueOrThrow({ where: { id: RECOVERY_FINANCE_ID } });
    const counterAfter = (await prisma.tenantConfig.findUniqueOrThrow({
      where: { orgSlug_branch: { orgSlug: ORG, branch: BRANCH } },
    })).receiptCounter;
    const payments = (finance.payments as unknown as PaymentEntry[]) || [];
    const matching = payments.filter((payment) => payment.externalRef === idempotencyKey);

    expect(order.status).toBe('paid');
    expect(matching).toHaveLength(1);
    expect(matching[0].receiptNo).toBe(original.receiptNo);
    expect(payments).toHaveLength(2);
    expect(counterAfter).toBe(counterBefore);
  });
});
