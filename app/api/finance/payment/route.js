import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';

function canAccess(session) {
  return session && (session.role === 'director' || session.role === 'accountant');
}

// Makbuz numarası üret: MKB-YYYY-00001 formatı
async function generateReceiptNo() {
  const year = new Date().getFullYear();
  const count = await redis.incr('receipt_counter');
  return `MKB-${year}-${String(count).padStart(5, '0')}`;
}

export async function POST(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const { studentId, amount, date, method, note, installmentIdx } = await req.json();
  if (!studentId || !amount || amount <= 0) {
    return NextResponse.json({ error: 'Geçersiz ödeme bilgisi' }, { status: 400 });
  }

  const record = await redis.get(`finance:${studentId}`);
  if (!record) return NextResponse.json({ error: 'Finansal kayıt bulunamadı' }, { status: 404 });

  const receiptNo = await generateReceiptNo();
  const paymentDate = date || new Date().toISOString().slice(0, 10);

  const payment = {
    id: Math.random().toString(36).slice(2, 10),
    date: paymentDate,
    amount: parseFloat(amount),
    method: method || 'Nakit',
    note: note || '',
    receiptNo,
    recordedBy: session.name,
  };

  const payments = [...(record.payments || []), payment];
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const balance = record.netFee - totalPaid;

  // Taksit eşleştirme: belirtilmişse veya otomatik (en yakın vadeli ödenmemiş)
  let installments = [...(record.installments || [])];
  let targetIdx = installmentIdx ?? null;

  if (installments.length > 0 && targetIdx === null) {
    // Otomatik: ilk ödenmemiş taksiti işaretle
    targetIdx = installments.findIndex(inst => !inst.paid);
  }

  if (targetIdx !== null && targetIdx >= 0 && installments[targetIdx]) {
    const due = parseFloat(installments[targetIdx].amount) || 0;
    const pay = parseFloat(amount);
    // Taksiti YALNIZ ödeme tutarı taksiti karşılıyorsa "ödendi" işaretle (kısmi ödeme kapatmaz;
    // tutar yine payments[]'e yazılır ve bakiyeyi düşürür). +0.01 kuruş yuvarlama toleransı.
    if (due <= 0 || pay + 0.01 >= due) {
      installments[targetIdx] = {
        ...installments[targetIdx],
        paid: true,
        paidDate: paymentDate,
        paidAmount: pay,
        method: method || 'Nakit',
        receiptNo,
      };
    }
  }

  const updated = { ...record, payments, installments, balance };
  await redis.set(`finance:${studentId}`, updated);

  return NextResponse.json({ ok: true, payment, balance, receiptNo });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const { studentId, paymentId } = await req.json();
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

  return NextResponse.json({ ok: true, balance });
}
