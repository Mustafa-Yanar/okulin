import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';
import { applyInstallmentPayment } from '@/lib/finance';

function canAccess(session) {
  return session && (session.role === 'director' || session.role === 'accountant');
}

const PaymentSchema = z.object({
  studentId: zId,
  amount: zMoney.optional(),
  date: z.string().max(40).optional(),
  method: z.string().max(80).optional(),
  note: z.string().max(1000).optional(),
  installmentIdx: z.coerce.number().int().min(0).max(1000).nullable().optional(),
});
const PaymentDeleteSchema = z.object({ studentId: zId, paymentId: zId });

export async function POST(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, PaymentSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, amount, date, method, note, installmentIdx } = parsed.data;

  const result = await applyInstallmentPayment(redis, {
    studentId, amount, installmentIdx, method, note, date, recordedBy: session.name,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status || 400 });

  const { record, payment, balance, receiptNo } = result;
  await logAudit({
    ...actorFrom(session),
    action: 'finance.payment',
    target: { type: 'student', id: studentId, name: record.studentName || studentId },
    detail: `Ödeme alındı: ${record.studentName || studentId} — ${payment.amount} TL (${method || 'Nakit'}), makbuz ${receiptNo}. Kalan bakiye: ${balance} TL`,
  });

  return NextResponse.json({ ok: true, payment, balance, receiptNo });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, PaymentDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, paymentId } = parsed.data;
  const record = await redis.get(`finance:${studentId}`);
  if (!record) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });

  const payment = record.payments?.find(p => p.id === paymentId);
  if (!payment) return NextResponse.json({ error: 'Ödeme bulunamadı' }, { status: 404 });

  // Taksitteki eşleşmeyi geri al
  const installments = (record.installments || []).map(inst => {
    if (inst.receiptNo === payment.receiptNo) {
      return { ...inst, paid: false, paidDate: null, paidAmount: null, method: null, receiptNo: null };
    }
    return inst;
  });

  const payments = record.payments.filter(p => p.id !== paymentId);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const balance = record.netFee - totalPaid;

  const updated = { ...record, payments, installments, balance };
  await redis.set(`finance:${studentId}`, updated);

  await logAudit({
    ...actorFrom(session),
    action: 'finance.paymentDelete',
    target: { type: 'student', id: studentId, name: record.studentName || studentId },
    detail: `Ödeme silindi: ${record.studentName || studentId} — ${payment.amount} TL (makbuz ${payment.receiptNo}). Yeni bakiye: ${balance} TL`,
  });

  return NextResponse.json({ ok: true, balance });
}
