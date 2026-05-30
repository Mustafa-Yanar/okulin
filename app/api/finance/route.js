import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';

function canAccess(session) {
  return session && (session.role === 'director' || session.role === 'accountant');
}

const FinanceSchema = z.object({
  studentId: zId,
  studentName: z.string().max(200).optional(),
  studentCls: z.string().max(40).optional(),
  totalFee: zMoney,
  discount: zMoney.optional(),
  paymentPlan: z.enum(['pesin', 'taksitli']).optional(),
  installments: z.array(
    z.object({ dueDate: z.string().max(40).optional(), amount: zMoney.optional() }).passthrough()
  ).max(120).optional(),
});
const FinanceDeleteSchema = z.object({ studentId: zId });

export async function GET(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');

  if (studentId) {
    // Tek öğrenci finansal kaydı
    const record = await redis.get(`finance:${studentId}`);
    return NextResponse.json(record || null);
  }

  // Tüm öğrencilerin finansal özeti
  const studentIds = await redis.smembers('students');
  if (!studentIds || studentIds.length === 0) return NextResponse.json([]);

  // Öğrenci adlarını ve finansal kayıtları paralel çek
  const pipeline = redis.pipeline();
  studentIds.forEach(id => {
    pipeline.get(`student:${id}`);
    pipeline.get(`finance:${id}`);
  });
  const results = await pipeline.exec();

  const list = [];
  for (let i = 0; i < studentIds.length; i++) {
    const student = results[i * 2];
    const finance = results[i * 2 + 1];
    if (!student) continue;
    list.push({
      studentId: studentIds[i],
      studentName: student.name,
      studentCls: student.cls,
      finance: finance || null,
    });
  }
  list.sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr'));
  return NextResponse.json(list);
}

export async function POST(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, FinanceSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, studentName, studentCls, totalFee, discount, paymentPlan, installments } = parsed.data;
  if (!totalFee) {
    return NextResponse.json({ error: 'Öğrenci ve ücret zorunlu' }, { status: 400 });
  }

  const netFee = Math.max(0, (parseFloat(totalFee) || 0) - (parseFloat(discount) || 0));

  const existing = await redis.get(`finance:${studentId}`);

  // Taksit planını yapılandır — mevcut ÖDENMİŞ taksit durumlarını idx'e göre KORU.
  // (Düzenlemede ödeme bilgisi silinmesin; client'tan gelen paid'e güvenme — sunucu yetkili.)
  let installmentList = [];
  if (paymentPlan === 'taksitli' && installments && installments.length > 0) {
    installmentList = installments.map((inst, idx) => {
      const prev = existing?.installments?.[idx];
      return {
        idx,
        dueDate: inst.dueDate,
        amount: parseFloat(inst.amount) || 0,
        paid: prev?.paid || false,
        paidDate: prev?.paidDate || null,
        paidAmount: prev?.paidAmount || null,
        method: prev?.method || null,
        receiptNo: prev?.receiptNo || null,
      };
    });
  }
  const record = {
    studentId,
    studentName,
    studentCls,
    registrationDate: existing?.registrationDate || new Date().toISOString().slice(0, 10),
    totalFee: parseFloat(totalFee) || 0,
    discount: parseFloat(discount) || 0,
    netFee,
    paymentPlan: paymentPlan || 'pesin',
    installments: installmentList,
    payments: existing?.payments || [],
    balance: netFee - (existing?.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
  };

  await redis.set(`finance:${studentId}`, record);
  await logAudit({
    ...actorFrom(session),
    action: existing ? 'finance.update' : 'finance.create',
    target: { type: 'student', id: studentId, name: studentName || studentId },
    detail: `Finansal kayıt ${existing ? 'güncellendi' : 'oluşturuldu'}: ${studentName || studentId} — net ücret ${netFee} TL, ${record.paymentPlan}${installmentList.length ? ` (${installmentList.length} taksit)` : ''}`,
  });
  return NextResponse.json({ ok: true, record });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, FinanceDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId } = parsed.data;
  const existing = await redis.get(`finance:${studentId}`);
  await redis.del(`finance:${studentId}`);
  await logAudit({
    ...actorFrom(session),
    action: 'finance.delete',
    target: { type: 'student', id: studentId, name: existing?.studentName || studentId },
    detail: `Finansal kayıt silindi: ${existing?.studentName || studentId}`,
  });
  return NextResponse.json({ ok: true });
}
