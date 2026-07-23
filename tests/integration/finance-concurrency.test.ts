import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { applyInstallmentPaymentSql } from '@/lib/finance';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('finans işlemi atomikliği', () => {
  it('aynı taksite eşzamanlı iki ödeme gelirse yalnız biri işlenir', async () => {
    const attempts = await Promise.allSettled([
      applyInstallmentPaymentSql({
        orgOverride: 'testkurs', branchOverride: 'main', studentId: 's_101_1',
        installmentIdx: 0, amount: 1, method: 'Test', recordedBy: 'Entegrasyon Testi',
      }),
      applyInstallmentPaymentSql({
        orgOverride: 'testkurs', branchOverride: 'main', studentId: 's_101_1',
        installmentIdx: 0, amount: 999999, method: 'Test', recordedBy: 'Entegrasyon Testi',
      }),
    ]);

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const student = await prisma.student.findFirstOrThrow({ where: { orgSlug: 'testkurs', legacyId: 's_101_1' } });
    const finance = await prisma.finance.findUniqueOrThrow({
      where: {
        orgSlug_branch_studentId: { orgSlug: 'testkurs', branch: 'main', studentId: student.id },
      },
      include: { installments: { orderBy: { idx: 'asc' } } },
    });
    const payments = (finance.payments as Array<{ amount: number; receiptNo: string }>) || [];
    const config = await prisma.tenantConfig.findUniqueOrThrow({
      where: { orgSlug_branch: { orgSlug: 'testkurs', branch: 'main' } },
    });

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: 5000, receiptNo: expect.stringMatching(/^MKB-\d{4}-00001$/) });
    expect(finance.installments[0]).toMatchObject({ paid: true, paidAmount: 5000 });
    expect(finance.installments[1]).toMatchObject({ paid: false, paidAmount: null });
    expect(config.receiptCounter).toBe(1);
  });
});
