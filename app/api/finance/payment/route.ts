import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';
import { applyInstallmentPaymentSql, type PaymentEntry } from '@/lib/finance';
import { tdb } from '@/lib/sqldb';

const PaymentSchema = z.object({
  studentId: zId,
  amount: zMoney.optional(),
  date: z.string().max(40).optional(),
  method: z.string().max(80).optional(),
  note: z.string().max(1000).optional(),
  installmentIdx: z.coerce.number().int().min(0).max(1000).nullable().optional(),
});
const PaymentDeleteSchema = z.object({ studentId: zId, paymentId: zId });

export const POST = withAuth(['director', 'accountant'], async (req, _ctx, session) => {
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

export const DELETE = withAuth(['director', 'accountant'], async (req, _ctx, session) => {
  const parsed = await parseBody(req, PaymentDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, paymentId } = parsed.data;

  const stu = await tdb().student.findFirst({ where: { legacyId: studentId } });
  const record = stu ? await tdb().finance.findFirst({ where: { studentId: stu.id }, include: { installments: true } }) : null;
  if (!record) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });
  const ledger = (record.payments as unknown as PaymentEntry[] | null) || []; // payments: Json ledger
  const payment = ledger.find((p) => p.id === paymentId);
  if (!payment) return NextResponse.json({ error: 'Ödeme bulunamadı' }, { status: 404 });
  for (const inst of record.installments) {
    if (inst.receiptNo === payment.receiptNo) {
      await tdb().installment.update({ where: { id: inst.id }, data: { paid: false, paidDate: null, paidAmount: null, method: null, receiptNo: null } });
    }
  }
  const payments = ledger.filter((p) => p.id !== paymentId);
  const balance = record.netFee - payments.reduce((s, p) => s + (p.amount || 0), 0);
  await tdb().finance.update({ where: { id: record.id }, data: { payments: payments as unknown as object } });
  await logAudit({ ...actorFrom(session), action: 'finance.paymentDelete', target: { type: 'student', id: studentId, name: stu?.name || studentId }, detail: `Ödeme silindi: ${stu?.name || studentId} — ${payment.amount} TL (makbuz ${payment.receiptNo}). Yeni bakiye: ${balance} TL` });
  return NextResponse.json({ ok: true, balance });
});
