import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { encryptSecret } from '@/lib/payment/crypto';
import { POST as paymentCallback } from '@/app/api/payment/callback/route';

const ORG = 'digerkurs';
const BRANCH = 'main';
const STUDENT_ID = 's_202_1';
const KEY = 'integration-paytr-key';
const SALT = 'integration-paytr-salt';
const OID_MISMATCH = 'integration_amount_mismatch';
const OID_CONCURRENT = 'integration_concurrent_callback';
const EXPECTED_AMOUNT = 500_000; // 5.000 TL, kuruş

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
    await prisma.payOrder.createMany({
      data: [OID_MISMATCH, OID_CONCURRENT].map((oid, index) => ({
        oid, orgSlug: ORG, branch: BRANCH, studentId: STUDENT_ID,
        amount: EXPECTED_AMOUNT, status: 'pending',
        data: { installmentIdx: index, studentName: 'İkinci Test Öğrencisi' },
      })),
    });
  });

  afterAll(async () => {
    await prisma.payOrder.deleteMany({ where: { oid: { in: [OID_MISMATCH, OID_CONCURRENT] } } });
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
});
