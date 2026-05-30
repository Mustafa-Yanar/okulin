import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';

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

// Makbuz numarası üret: MKB-YYYY-00001 formatı
async function generateReceiptNo() {
  const year = new Date().getFullYear();
  const count = await redis.incr('receipt_counter');
  return `MKB-${year}-${String(count).padStart(5, '0')}`;
}

export async function POST(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, PaymentSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, amount, date, method, note, installmentIdx } = parsed.data;

  const record = await redis.get(`finance:${studentId}`);
  if (!record) return NextResponse.json({ error: 'Finansal kayıt bulunamadı' }, { status: 404 });

  const installments = [...(record.installments || [])];

  // Hedef taksiti belirle: açıkça seçilen ya da (genel ödemede) ilk ödenmemiş.
  const explicit = installmentIdx !== null && installmentIdx !== undefined && installmentIdx >= 0;
  let targetIdx = explicit ? installmentIdx : null;
  if (!explicit && installments.length > 0) {
    targetIdx = installments.findIndex(inst => !inst.paid);
  }
  const targetInst = (targetIdx !== null && targetIdx >= 0) ? installments[targetIdx] : null;

  // Taksit AÇIKÇA seçildiyse HER ZAMAN taksitin tamamı ödenir (kısmi ödeme yok).
  // Genel ödemede kullanıcının girdiği tutar kullanılır.
  const payAmount = (explicit && targetInst) ? (parseFloat(targetInst.amount) || 0) : parseFloat(amount);
  if (!payAmount || payAmount <= 0) {
    return NextResponse.json({ error: 'Geçersiz ödeme tutarı' }, { status: 400 });
  }

  const receiptNo = await generateReceiptNo();
  const paymentDate = date || new Date().toISOString().slice(0, 10);

  const payment = {
    id: Math.random().toString(36).slice(2, 10),
    date: paymentDate,
    amount: payAmount,
    method: method || 'Nakit',
    note: note || '',
    receiptNo,
    recordedBy: session.name,
  };

  const payments = [...(record.payments || []), payment];
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const balance = record.netFee - totalPaid;

  // Taksiti "ödendi" işaretle: açık seçimde her zaman; genel ödemede yalnız tam karşılanıyorsa.
  if (targetInst) {
    const due = parseFloat(targetInst.amount) || 0;
    if (explicit || due <= 0 || payAmount + 0.01 >= due) {
      installments[targetIdx] = {
        ...targetInst,
        paid: true,
        paidDate: paymentDate,
        paidAmount: payAmount,
        method: method || 'Nakit',
        receiptNo,
      };
    }
  }

  const updated = { ...record, payments, installments, balance };
  await redis.set(`finance:${studentId}`, updated);

  await logAudit({
    ...actorFrom(session),
    action: 'finance.payment',
    target: { type: 'student', id: studentId, name: record.studentName || studentId },
    detail: `Ödeme alındı: ${record.studentName || studentId} — ${payAmount} TL (${method || 'Nakit'}), makbuz ${receiptNo}. Kalan bakiye: ${balance} TL`,
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
