// Ortak finans yardımcıları. Taksit kredilendirme mantığı TEK yerde — hem manuel
// ödeme route'u (app/api/finance/payment) hem online ödeme callback'i (PayTR)
// buradan geçer → mantık çatallanmaz (çift kredilendirme/makbuz hataları önlenir).
//
// orgOverride/branchOverride: online callback org bağlamı header'dan gelmediği
// için EXPLICIT tenant scope geçer; manuel ödemede undefined → mevcut istek tenant'ı.

import { tdb, tenant } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';
import { newId } from '@/lib/id';

// Finance.payments Json ledger'ındaki tek ödeme kaydı.
export interface PaymentEntry {
  id: string;
  date: string;
  amount: number;
  method: string;
  note: string;
  receiptNo: string;
  recordedBy: string;
}

export interface ApplyPaymentOpts {
  studentId: string;
  amount?: number | string;
  installmentIdx?: number | null;
  method?: string;
  note?: string;
  date?: string;
  recordedBy?: string;
  orgOverride?: string;
  branchOverride?: string;
}

export type ApplyPaymentResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      record: { studentId: string; studentName: string; studentCls: string; netFee: number; payments: PaymentEntry[]; balance: number };
      payment: PaymentEntry;
      balance: number;
      receiptNo: string;
    };

// Makbuz no: TenantConfig.receiptCounter atomik artır.
export async function generateReceiptNoSql(orgOverride?: string, branchOverride?: string): Promise<string> {
  const year = new Date().getFullYear();
  const { orgSlug, branch } = tenant(orgOverride, branchOverride);
  const tc = await prisma.tenantConfig.upsert({
    where: { orgSlug_branch: { orgSlug, branch } },
    update: { receiptCounter: { increment: 1 } },
    create: { orgSlug, branch, receiptCounter: 1 },
  });
  return `MKB-${year}-${String(tc.receiptCounter).padStart(5, '0')}`;
}

// Taksit ödeme uygula (SQL). opts: studentId(legacyId), amount, installmentIdx, method,
// note, date, recordedBy, orgOverride, branchOverride. Döner: Redis sürümüyle aynı şekil.
export async function applyInstallmentPaymentSql(opts: ApplyPaymentOpts): Promise<ApplyPaymentResult> {
  const { studentId, amount, installmentIdx, method, note, date, recordedBy, orgOverride, branchOverride } = opts;
  const t = tdb(orgOverride, branchOverride);
  const stu = await t.student.findFirst({ where: { legacyId: studentId }, include: { class: true } });
  if (!stu) return { ok: false, error: 'Finansal kayıt bulunamadı', status: 404 };
  const record = await t.finance.findFirst({ where: { studentId: stu.id }, include: { installments: { orderBy: { idx: 'asc' } } } });
  if (!record) return { ok: false, error: 'Finansal kayıt bulunamadı', status: 404 };

  const installments = record.installments;
  const explicit = installmentIdx !== null && installmentIdx !== undefined && installmentIdx >= 0;
  const targetInst = explicit
    ? installments.find((i) => i.idx === installmentIdx)
    : installments.find((i) => !i.paid);
  if (explicit && targetInst?.paid) return { ok: false, error: 'Bu taksit zaten ödenmiş', status: 400 };

  // parseFloat: eski davranış korunur (number da string de gelebilir → String() ile coerce)
  const payAmount = (explicit && targetInst) ? (parseFloat(String(targetInst.amount)) || 0) : parseFloat(String(amount));
  if (!payAmount || payAmount <= 0) return { ok: false, error: 'Geçersiz ödeme tutarı', status: 400 };

  const receiptNo = await generateReceiptNoSql(orgOverride, branchOverride);
  const paymentDate = date || new Date().toISOString().slice(0, 10);
  const payment: PaymentEntry = { id: newId(), date: paymentDate, amount: payAmount, method: method || 'Nakit', note: note || '', receiptNo, recordedBy: recordedBy || '' };

  // payments Json ledger — applyInstallmentPaymentSql/route'lar PaymentEntry[] yazar
  const payments: PaymentEntry[] = [...((record.payments as unknown as PaymentEntry[] | null) || []), payment];
  const balance = record.netFee - payments.reduce((s, p) => s + (p.amount || 0), 0);

  if (targetInst) {
    const due = parseFloat(String(targetInst.amount)) || 0;
    if (explicit || due <= 0 || payAmount + 0.01 >= due) {
      await t.installment.update({ where: { id: targetInst.id }, data: { paid: true, paidDate: paymentDate, paidAmount: payAmount, method: method || 'Nakit', receiptNo } });
    }
  }
  await t.finance.update({ where: { id: record.id }, data: { payments: payments as unknown as object } });

  const recOut = { studentId, studentName: stu.name, studentCls: stu.class?.legacyId || '', netFee: record.netFee, payments, balance };
  return { ok: true, record: recOut, payment, balance, receiptNo };
}
