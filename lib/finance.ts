// Ortak finans yardımcıları. Taksit kredilendirme mantığı TEK yerde — hem manuel
// ödeme route'u (app/api/finance/payment) hem online ödeme callback'i (PayTR)
// buradan geçer → mantık çatallanmaz (çift kredilendirme/makbuz hataları önlenir).
//
// orgOverride/branchOverride: online callback org bağlamı header'dan gelmediği
// için EXPLICIT tenant scope geçer; manuel ödemede undefined → mevcut istek tenant'ı.

import type { Prisma } from '@prisma/client';
import { tdb, tenant } from '@/lib/sqldb';
import { newId } from '@/lib/id';
import { HttpError } from '@/lib/errors';
import { lockResource } from '@/lib/locks';
import { kapanacakTaksitSayisi, kabulEdilenTutarlar } from '@/lib/finance-plan';

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

// Başarı yükü. İş-kuralı ihlalinde (kayıt yok / geçersiz tutar / taksit zaten ödendi)
// fonksiyon HttpError FIRLATIR — hata dönüşü yoktur (lib↔route tek hata sözleşmesi).
export interface ApplyPaymentResult {
  record: { studentId: string; studentName: string; studentCls: string; netFee: number; payments: PaymentEntry[]; balance: number };
  payment: PaymentEntry;
  balance: number;
  receiptNo: string;
}

// Bir öğrencinin finans kaydına yazan HER yol bu anahtarla serileşir: ödeme alma
// (lib/finance), ödeme silme (finance/payment DELETE), plan kurma/güncelleme
// (finance POST). Anahtar formülü ÜÇ yerde de birebir aynı olmalı — tek kaynak burası.
// studentId = Student.id (cuid), legacyId DEĞİL.
export const financeLockKey = (orgSlug: string, branch: string, studentId: string): string =>
  `finance:${orgSlug}:${branch}:${studentId}`;

// Makbuz no: TenantConfig.receiptCounter atomik artır. TRANSACTION İÇİNDE çağrılır —
// ödeme geri alınırsa sayaç da geri alınır (yanmış/atlanmış makbuz numarası kalmaz).
async function nextReceiptNo(tx: Prisma.TransactionClient, orgSlug: string, branch: string): Promise<string> {
  const year = new Date().getFullYear();
  const tc = await tx.tenantConfig.upsert({
    where: { orgSlug_branch: { orgSlug, branch } },
    update: { receiptCounter: { increment: 1 } },
    create: { orgSlug, branch, receiptCounter: 1 },
  });
  return `MKB-${year}-${String(tc.receiptCounter).padStart(5, '0')}`;
}

// Taksit ödeme uygula (SQL). opts: studentId(legacyId), amount, installmentIdx, method,
// note, date, recordedBy, orgOverride, branchOverride.
//
// ATOMİKLİK (denetim damar-3, KRİTİK): makbuz sayacı + taksit güncellemesi + ledger yazımı
// TEK transaction. Eskiden üçü ayrı sorguydu; araya giren bir çökme taksiti paid=true
// bırakıp ödemeyi ledger'a yazmıyordu → bakiye borcu göstermeye devam ediyor, öğrenciden
// ikinci kez tahsilat isteniyordu.
//
// YARIŞ (denetim damar-3, KRİTİK): payments bir Json DİZİSİ, yani read-modify-write.
// Kilitsiz iki eşzamanlı ödeme aynı diziyi okuyup üzerine yazıyordu → biri makbuzu
// kesilmiş halde ledger'dan siliniyordu (lost update). Ayrıca ikisi de taksiti paid=false
// görüp "zaten ödenmiş" kontrolünü geçiyordu. Kilit OKUMADAN ÖNCE alınır — aksi halde
// yarış penceresi kapanmaz.
export async function applyInstallmentPaymentSql(opts: ApplyPaymentOpts): Promise<ApplyPaymentResult> {
  const { studentId, amount, installmentIdx, method, note, date, recordedBy, orgOverride, branchOverride } = opts;
  const { orgSlug, branch } = tenant(orgOverride, branchOverride);
  const t = tdb(orgOverride, branchOverride);
  const stu = await t.student.findFirst({ where: { legacyId: studentId }, include: { class: true } });
  if (!stu) throw new HttpError(404, 'Finansal kayıt bulunamadı');

  return t.$transaction(async (rawTx) => {
    const tx = rawTx as unknown as Prisma.TransactionClient; // slots.ts/booking.ts'teki tip köprüsü
    await lockResource(tx, financeLockKey(orgSlug, branch, stu.id));

    // Kilit ALINDIKTAN SONRA taze oku. tx $extends tenant-enjeksiyonundan geçmez →
    // orgSlug/branch AÇIKÇA where'de (slots.ts ile aynı gerekçe).
    const record = await tx.finance.findFirst({ where: { orgSlug, branch, studentId: stu.id }, include: { installments: { orderBy: { idx: 'asc' } } } });
    if (!record) throw new HttpError(404, 'Finansal kayıt bulunamadı');

    // Decimal kolonlar: runtime katmanı number döndürür (lib/prisma decimal-to-number);
    // Number() sarmaları Prisma'nın statik Decimal tipini number'a indirger (tip-gerçeği).
    const netFee = Number(record.netFee);
    const installments = record.installments.map((i) => ({
      ...i, amount: Number(i.amount), paidAmount: i.paidAmount === null ? null : Number(i.paidAmount),
    }));
    const explicit = installmentIdx !== null && installmentIdx !== undefined && installmentIdx >= 0;
    const targetInst = explicit
      ? installments.find((i) => i.idx === installmentIdx)
      : installments.find((i) => !i.paid);
    if (explicit && targetInst?.paid) throw new HttpError(400, 'Bu taksit zaten ödenmiş');

    // parseFloat: eski davranış korunur (number da string de gelebilir → String() ile coerce).
    // explicit yolda tutar taksitin KENDİ tutarına zorlanır — istemcinin gönderdiği amount
    // yok sayılır (seçili taksit hep tam kapanır; kısmi ödeme yalnız explicit-olmayan yol).
    const payAmount = (explicit && targetInst) ? (parseFloat(String(targetInst.amount)) || 0) : parseFloat(String(amount));
    if (!payAmount || payAmount <= 0) throw new HttpError(400, 'Geçersiz ödeme tutarı');

    // Kapatılacak taksitler. explicit: yalnız seçilen (tutar zaten tam tutara zorlandı).
    // Genel ödeme: tutar açık taksitleri BAŞTAN tam sayıda kapatmalı (kısmi ödeme alınmaz,
    // Mustafa kararı — bkz. finance-plan.kapanacakTaksitSayisi). Eskiden serbest tutar
    // kabul ediliyordu: taksitten azsa hiçbir taksit kapanmıyor (sonsuza dek "gecikmiş",
    // yanlış senet), birkaç taksiti karşılıyorsa yalnız İLKİ kapanıyordu.
    let kapatilacak: typeof installments = [];
    if (explicit) {
      kapatilacak = targetInst ? [targetInst] : [];
    } else {
      const acik = installments.filter((i) => !i.paid);
      if (acik.length) {
        const n = kapanacakTaksitSayisi(acik, payAmount);
        if (n === null) {
          const kabul = kabulEdilenTutarlar(acik).map((x) => `${x} TL`).join(', ');
          throw new HttpError(400, `Kısmi taksit ödemesi alınmaz. Tutar açık taksitleri baştan tam kapatmalı — kabul edilen tutarlar: ${kabul}.`);
        }
        kapatilacak = acik.slice(0, n);
      }
      // acik.length === 0 → peşin plan ya da tüm taksitler kapalı: serbest tutar geçerli
      // (peşin planda hiç taksit yoktur, normal yol budur).
    }

    const receiptNo = await nextReceiptNo(tx, orgSlug, branch);
    const paymentDate = date || new Date().toISOString().slice(0, 10);
    const payment: PaymentEntry = { id: newId(), date: paymentDate, amount: payAmount, method: method || 'Nakit', note: note || '', receiptNo, recordedBy: recordedBy || '' };

    // payments Json ledger — applyInstallmentPaymentSql/route'lar PaymentEntry[] yazar
    const payments: PaymentEntry[] = [...((record.payments as unknown as PaymentEntry[] | null) || []), payment];
    const balance = netFee - payments.reduce((s, p) => s + (p.amount || 0), 0);

    // Kapatılan her taksite KENDİ tutarı yazılır (tek makbuz birden çok taksiti kapatabilir).
    for (const inst of kapatilacak) {
      await tx.installment.update({ where: { id: inst.id }, data: { paid: true, paidDate: paymentDate, paidAmount: parseFloat(String(inst.amount)) || 0, method: method || 'Nakit', receiptNo } });
    }
    await tx.finance.update({ where: { id: record.id }, data: { payments: payments as unknown as object } });

    const recOut = { studentId, studentName: stu.name, studentCls: stu.class?.legacyId || '', netFee, payments, balance };
    return { record: recOut, payment, balance, receiptNo };
  });
}
