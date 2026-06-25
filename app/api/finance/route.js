import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, canReadStudent } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

function canAccess(session) {
  return session && (session.role === 'director' || session.role === 'accountant');
}

// SQL Finance(+installments) + Student → mevcut sözleşme şekli (balance türetilir).
const financeOut = (f, stu) => f ? ({
  studentId: stu?.legacyId, studentName: stu?.name, studentCls: stu?.class?.legacyId || '',
  registrationDate: f.registrationDate, totalFee: f.totalFee, discount: f.discount, netFee: f.netFee,
  paymentPlan: f.paymentPlan,
  installments: (f.installments || []).map((i) => ({ idx: i.idx, dueDate: i.dueDate, amount: i.amount, paid: i.paid, paidDate: i.paidDate, paidAmount: i.paidAmount, method: i.method, receiptNo: i.receiptNo })),
  payments: f.payments || [],
  balance: f.netFee - (f.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
}) : null;
// Bir öğrencinin finans kaydını SQL'den çek (legacyId ile).
async function financeByLegacySql(studentId) {
  const stu = await tdb().student.findFirst({ where: { legacyId: studentId }, include: { class: true } });
  if (!stu) return { stu: null, f: null };
  const f = await tdb().finance.findFirst({ where: { studentId: stu.id }, include: { installments: { orderBy: { idx: 'asc' } } } });
  return { stu, f };
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
  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');

  // Veli: yalnız kendi çocuğunun finansal kaydını görür (salt-okunur).
  if (session && session.role === 'parent') {
    if (!canReadStudent(session, studentId)) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    if (isSqlEnabled()) { const { stu, f } = await financeByLegacySql(studentId); return NextResponse.json(financeOut(f, stu)); }
    const record = await redis.get(`finance:${studentId}`);
    return NextResponse.json(record || null);
  }

  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  if (studentId) {
    // Tek öğrenci finansal kaydı
    if (isSqlEnabled()) { const { stu, f } = await financeByLegacySql(studentId); return NextResponse.json(financeOut(f, stu)); }
    const record = await redis.get(`finance:${studentId}`);
    return NextResponse.json(record || null);
  }

  if (isSqlEnabled()) {
    const studs = await tdb().student.findMany({ include: { class: true, finance: { include: { installments: { orderBy: { idx: 'asc' } } } } } });
    const list = studs.map((s) => ({ studentId: s.legacyId, studentName: s.name, studentCls: s.class?.legacyId || '', finance: financeOut(s.finance, s) }));
    list.sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr'));
    return NextResponse.json(list);
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

  if (isSqlEnabled()) {
    const stu = await tdb().student.findFirst({ where: { legacyId: studentId } });
    if (!stu) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });
    const existing = await tdb().finance.findFirst({ where: { studentId: stu.id }, include: { installments: { orderBy: { idx: 'asc' } } } });
    const prevByIdx = {}; for (const i of (existing?.installments || [])) prevByIdx[i.idx] = i;
    let instData = [];
    if (paymentPlan === 'taksitli' && installments && installments.length > 0) {
      instData = installments.map((inst, idx) => { const prev = prevByIdx[idx]; return { idx, dueDate: inst.dueDate, amount: parseFloat(inst.amount) || 0, paid: prev?.paid || false, paidDate: prev?.paidDate || null, paidAmount: prev?.paidAmount ?? null, method: prev?.method || null, receiptNo: prev?.receiptNo || null }; });
    }
    const data = { registrationDate: existing?.registrationDate || new Date().toISOString().slice(0, 10), totalFee: parseFloat(totalFee) || 0, discount: parseFloat(discount) || 0, netFee, paymentPlan: paymentPlan || 'pesin', payments: existing?.payments || [] };
    let finRow;
    if (existing) { await tdb().installment.deleteMany({ where: { financeId: existing.id } }); finRow = await tdb().finance.update({ where: { id: existing.id }, data }); }
    else finRow = await tdb().finance.create({ data: { ...data, studentId: stu.id } });
    for (const i of instData) await tdb().installment.create({ data: { financeId: finRow.id, ...i } });
    await logAudit({ ...actorFrom(session), action: existing ? 'finance.update' : 'finance.create', target: { type: 'student', id: studentId, name: studentName || studentId }, detail: `Finansal kayıt ${existing ? 'güncellendi' : 'oluşturuldu'}: ${studentName || studentId} — net ücret ${netFee} TL, ${data.paymentPlan}${instData.length ? ` (${instData.length} taksit)` : ''}` });
    const full = await tdb().finance.findFirst({ where: { id: finRow.id }, include: { installments: { orderBy: { idx: 'asc' } } } });
    return NextResponse.json({ ok: true, record: financeOut(full, { legacyId: studentId, name: studentName, class: { legacyId: studentCls } }) });
  }

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

  if (isSqlEnabled()) {
    const stu = await tdb().student.findFirst({ where: { legacyId: studentId } });
    const f = stu ? await tdb().finance.findFirst({ where: { studentId: stu.id } }) : null;
    if (f) await tdb().finance.delete({ where: { id: f.id } }); // cascade: installments
    await logAudit({ ...actorFrom(session), action: 'finance.delete', target: { type: 'student', id: studentId, name: stu?.name || studentId }, detail: `Finansal kayıt silindi: ${stu?.name || studentId}` });
    return NextResponse.json({ ok: true });
  }

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
