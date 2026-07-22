import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';
import { tdb, tenant } from '@/lib/sqldb';
import type { Finance, Installment, Prisma } from '@prisma/client';
import { financeLockKey, type PaymentEntry } from '@/lib/finance';
import { planHatasi } from '@/lib/finance-plan';
import { lockResource } from '@/lib/locks';
import { HttpError } from '@/lib/errors';

type FinanceWithInst = Finance & { installments?: Installment[] };
// financeOut'a giren öğrenci görünümü (tam Student veya POST'un kurduğu kısmi nesne).
interface StudentLike {
  legacyId?: string;
  name?: string;
  class?: { legacyId?: string } | null;
}

// SQL Finance(+installments) + Student → mevcut sözleşme şekli (balance türetilir).
const financeOut = (f: FinanceWithInst | null | undefined, stu: StudentLike | null) => f ? ({
  studentId: stu?.legacyId, studentName: stu?.name, studentCls: stu?.class?.legacyId || '',
  registrationDate: f.registrationDate, totalFee: f.totalFee, discount: f.discount, netFee: f.netFee,
  paymentPlan: f.paymentPlan,
  installments: (f.installments || []).map((i) => ({ idx: i.idx, dueDate: i.dueDate, amount: i.amount, paid: i.paid, paidDate: i.paidDate, paidAmount: i.paidAmount, method: i.method, receiptNo: i.receiptNo })),
  payments: ((f.payments as unknown as PaymentEntry[] | null) || []),
  balance: f.netFee - ((f.payments as unknown as PaymentEntry[] | null) || []).reduce((s, p) => s + (p.amount || 0), 0),
}) : null;
// Bir öğrencinin finans kaydını SQL'den çek (legacyId ile).
async function financeByLegacySql(studentId: string | null) {
  const stu = await tdb().student.findFirst({ where: { legacyId: studentId || '' }, include: { class: true } });
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

// Bilinçli inline rol dallanması: veli kendi çocuğunu okur, müdür/muhasebeci tümünü.
export const GET = withAuth('auth', 'finance', async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');

  // Veli: yalnız kendi çocuğunun finansal kaydını görür (salt-okunur).
  if (session.role === 'parent') {
    if (!canReadStudent(session, studentId)) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const { stu, f } = await financeByLegacySql(studentId);
    return NextResponse.json(financeOut(f, stu));
  }

  if (session.role !== 'director' && session.role !== 'accountant') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  if (studentId) {
    // Tek öğrenci finansal kaydı
    const { stu, f } = await financeByLegacySql(studentId);
    return NextResponse.json(financeOut(f, stu));
  }

  const studs = await tdb().student.findMany({ include: { class: true, finance: { include: { installments: { orderBy: { idx: 'asc' } } } } } });
  const list = studs.map((s) => ({
    studentId: s.legacyId, studentName: s.name, studentCls: s.class?.legacyId || '',
    // Muhasebe belgeleri (senet/makbuz/gecikmiş liste) için öğrenci+veli kimlik bilgisi.
    studentTc: s.tcNo || '', studentPhone: s.phone || '', parentName: s.parentName || '', parentPhone: s.parentPhone || '',
    parentTcNo: s.parentTcNo || '', parentAddress: s.parentAddress || '', className: s.class?.ad || '',
    finance: financeOut(s.finance, s),
  }));
  list.sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr'));
  return NextResponse.json(list);
});

export const POST = withAuth(['director', 'accountant'], 'finance', async (req, _ctx, session) => {
  const parsed = await parseBody(req, FinanceSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, studentName, studentCls, totalFee, discount, paymentPlan, installments } = parsed.data;
  if (!totalFee) {
    return NextResponse.json({ error: 'Öğrenci ve ücret zorunlu' }, { status: 400 });
  }

  const netFee = Math.max(0, (parseFloat(String(totalFee)) || 0) - (parseFloat(String(discount)) || 0));

  const stu = await tdb().student.findFirst({ where: { legacyId: studentId } });
  if (!stu) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  // Plan kurulumu da ödeme yoluyla AYNI kilit + tek transaction (denetim damar-3):
  // deleteMany → update → create döngüsü kilitsiz/transaction'sızken araya giren çökme
  // taksitleri TAMAMEN silinmiş halde bırakıyordu, eşzamanlı bir ödeme de yeni kurulan
  // taksitlere değil silinmiş olanlara yazabiliyordu.
  const { orgSlug, branch } = tenant();
  let instCount = 0;
  let created = false;
  const full = await tdb().$transaction(async (rawTx) => {
    const tx = rawTx as unknown as Prisma.TransactionClient;
    await lockResource(tx, financeLockKey(orgSlug, branch, stu.id));

    const existing = await tx.finance.findFirst({ where: { orgSlug, branch, studentId: stu.id }, include: { installments: { orderBy: { idx: 'asc' } } } });
    created = !existing;
    const prevByIdx: Record<number, Installment> = {}; for (const i of (existing?.installments || [])) prevByIdx[i.idx] = i;
    let instData: { idx: number; dueDate: string; amount: number; paid: boolean; paidDate: string | null; paidAmount: number | null; method: string | null; receiptNo: string | null }[] = [];
    if (paymentPlan === 'taksitli' && installments && installments.length > 0) {
      instData = installments.map((inst, idx) => { const prev = prevByIdx[idx]; return { idx, dueDate: inst.dueDate || '', amount: parseFloat(String(inst.amount)) || 0, paid: prev?.paid || false, paidDate: prev?.paidDate || null, paidAmount: prev?.paidAmount ?? null, method: prev?.method || null, receiptNo: prev?.receiptNo || null }; });
    }
    // INVARIANT: taksit toplamı === netFee. İstemci tutarları serbestçe gönderiyordu ve
    // hiç doğrulanmıyordu → plan toplamı net ücretten sapınca para sessizce buharlaşıyordu
    // (bkz. lib/finance-plan.ts). İstemci de aynı dağıtımı kullanır → normal akışta tetiklenmez.
    const planErr = planHatasi(instData, netFee);
    if (planErr) throw new HttpError(400, planErr);
    instCount = instData.length;

    const data = { registrationDate: existing?.registrationDate || new Date().toISOString().slice(0, 10), totalFee: parseFloat(String(totalFee)) || 0, discount: parseFloat(String(discount)) || 0, netFee, paymentPlan: paymentPlan || 'pesin', payments: ((existing?.payments as unknown as PaymentEntry[] | null) || []) as unknown as object };
    let finRow: Finance;
    if (existing) { await tx.installment.deleteMany({ where: { financeId: existing.id } }); finRow = await tx.finance.update({ where: { id: existing.id }, data }); }
    else finRow = await tx.finance.create({ data: { ...data, orgSlug, branch, studentId: stu.id } });
    if (instData.length) await tx.installment.createMany({ data: instData.map((i) => ({ financeId: finRow.id, ...i })) });
    return tx.finance.findFirst({ where: { id: finRow.id }, include: { installments: { orderBy: { idx: 'asc' } } } });
  });

  await logAudit({ ...actorFrom(session), action: created ? 'finance.create' : 'finance.update', target: { type: 'student', id: studentId, name: studentName || studentId }, detail: `Finansal kayıt ${created ? 'oluşturuldu' : 'güncellendi'}: ${studentName || studentId} — net ücret ${netFee} TL, ${paymentPlan || 'pesin'}${instCount ? ` (${instCount} taksit)` : ''}` });
  return NextResponse.json({ ok: true, record: financeOut(full, { legacyId: studentId, name: studentName, class: { legacyId: studentCls } }) });
});

export const DELETE = withAuth(['director'], 'finance', async (req, _ctx, session) => {
  const parsed = await parseBody(req, FinanceDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId } = parsed.data;

  const stu = await tdb().student.findFirst({ where: { legacyId: studentId } });
  const f = stu ? await tdb().finance.findFirst({ where: { studentId: stu.id } }) : null;
  if (f) await tdb().finance.delete({ where: { id: f.id } }); // cascade: installments
  await logAudit({ ...actorFrom(session), action: 'finance.delete', target: { type: 'student', id: studentId, name: stu?.name || studentId }, detail: `Finansal kayıt silindi: ${stu?.name || studentId}` });
  return NextResponse.json({ ok: true });
});
