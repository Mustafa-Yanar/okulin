import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';
import { applyInstallmentPaymentSql, financeLockKey, type PaymentEntry } from '@/lib/finance';
import { tdb, tenant } from '@/lib/sqldb';
import { lockResource } from '@/lib/locks';
import { HttpError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

const PaymentSchema = z.object({
  studentId: zId,
  amount: zMoney.optional(),
  date: z.string().max(40).optional(),
  method: z.string().max(80).optional(),
  note: z.string().max(1000).optional(),
  installmentIdx: z.coerce.number().int().min(0).max(1000).nullable().optional(),
});
const PaymentDeleteSchema = z.object({ studentId: zId, paymentId: zId });

export const POST = withAuth(['director', 'accountant'], 'finance', async (req, _ctx, session) => {
  const parsed = await parseBody(req, PaymentSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, amount, date, method, note, installmentIdx } = parsed.data;

  // İş-kuralı ihlalinde applyInstallmentPaymentSql HttpError fırlatır → withAuth çevirir.
  const { record, payment, balance, receiptNo } = await applyInstallmentPaymentSql({ studentId, amount, installmentIdx, method, note, date, recordedBy: session.name });
  await logAudit({
    ...actorFrom(session),
    action: 'finance.payment',
    target: { type: 'student', id: studentId, name: record.studentName || studentId },
    detail: `Ödeme alındı: ${record.studentName || studentId} — ${payment.amount} TL (${method || 'Nakit'}), makbuz ${receiptNo}. Kalan bakiye: ${balance} TL`,
  });

  return NextResponse.json({ ok: true, payment, balance, receiptNo });
});

export const DELETE = withAuth(['director', 'accountant'], 'finance', async (req, _ctx, session) => {
  const parsed = await parseBody(req, PaymentDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, paymentId } = parsed.data;

  const stu = await tdb().student.findFirst({ where: { legacyId: studentId } });
  if (!stu) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });

  // Ödeme alma yoluyla AYNI kilit + tek transaction: taksit sıfırlama ile ledger'dan
  // düşme arasında çökme olursa taksit "ödenmemiş" olur ama ödeme ledger'da durur
  // (bakiye eksik görünür). Kilit ayrıca eşzamanlı ödeme-alma ile silmeyi serileştirir.
  const { orgSlug, branch } = tenant();
  const out = await tdb().$transaction(async (rawTx) => {
    const tx = rawTx as unknown as Prisma.TransactionClient;
    await lockResource(tx, financeLockKey(orgSlug, branch, stu.id));

    const record = await tx.finance.findFirst({ where: { orgSlug, branch, studentId: stu.id }, include: { installments: true } });
    if (!record) throw new HttpError(404, 'Kayıt bulunamadı');
    const ledger = (record.payments as unknown as PaymentEntry[] | null) || []; // payments: Json ledger
    const payment = ledger.find((p) => p.id === paymentId);
    if (!payment) throw new HttpError(404, 'Ödeme bulunamadı');
    for (const inst of record.installments) {
      if (inst.receiptNo === payment.receiptNo) {
        await tx.installment.update({ where: { id: inst.id }, data: { paid: false, paidDate: null, paidAmount: null, method: null, receiptNo: null } });
      }
    }
    const payments = ledger.filter((p) => p.id !== paymentId);
    const balance = record.netFee - payments.reduce((s, p) => s + (p.amount || 0), 0);
    await tx.finance.update({ where: { id: record.id }, data: { payments: payments as unknown as object } });
    return { payment, balance };
  });

  await logAudit({ ...actorFrom(session), action: 'finance.paymentDelete', target: { type: 'student', id: studentId, name: stu.name || studentId }, detail: `Ödeme silindi: ${stu.name || studentId} — ${out.payment.amount} TL (makbuz ${out.payment.receiptNo}). Yeni bakiye: ${out.balance} TL` });
  return NextResponse.json({ ok: true, balance: out.balance });
});
