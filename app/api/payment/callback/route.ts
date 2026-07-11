import { logAudit } from '@/lib/audit';
import type { PaymentConfigData } from '@/lib/payment';
import { decryptSecret } from '@/lib/payment/crypto';
import { getProvider } from '@/lib/payment';
import { applyInstallmentPaymentSql } from '@/lib/finance';
import { HttpError } from '@/lib/errors';
import { tdb } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs'; // HMAC + crypto

// PayTR Bildirim (callback) URL'i. Server-to-server, form-urlencoded POST.
// Bilinçli withAuth istisnası + düz metin yanıt: PayTR sözleşmesi HMAC doğrulama
// ve gövdede literal "OK" bekler — { error } JSON formatı bu uca uygulanmaz.
// Kimlik doğrulama: HMAC hash (oturum/cookie YOK). Middleware'de CSRF'ten MUAF.
// Para kredilendiren KRİTİK uç → idempotent olmalı; her durumda düz metin "OK".
// payorder = PayOrder modeli; finans = applyInstallmentPaymentSql.
// Çift işleme kilidi: PayOrder.status ATOMİK claim (bkz. aşağı), ayrı Redis kilidi gerekmez.

function ok() {
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
function fail(msg: string) {
  return new Response(`FAIL: ${msg}`, { status: 400, headers: { 'Content-Type': 'text/plain' } });
}

// PayOrder okuma — ortak şekle normalize eder.
interface OrderView {
  org: string; branch: string; studentId: string; status: string;
  installmentIdx?: number; studentName?: string; data: Record<string, unknown>;
}

async function readOrder(oid: string): Promise<OrderView | null> {
  const po = await prisma.payOrder.findUnique({ where: { oid } });
  if (!po) return null;
  const d = (po.data as Record<string, unknown> | null) || {}; // data: Json
  return {
    org: po.orgSlug, branch: po.branch, studentId: po.studentId, status: po.status,
    installmentIdx: d.installmentIdx as number | undefined, studentName: d.studentName as string | undefined, data: d,
  };
}
// PayOrder durum güncelle (idempotency kaydı).
async function patchOrder(oid: string, order: OrderView, patch: { status: string; [key: string]: unknown }) {
  const { status, ...rest } = patch;
  await prisma.payOrder.update({ where: { oid }, data: { status, data: { ...(order.data || {}), ...rest } as object } });
}

export async function POST(req: Request) {
  let form: Record<string, string>;
  try {
    const fd = await req.formData();
    form = Object.fromEntries(fd.entries()) as Record<string, string>;
  } catch {
    return fail('gövde okunamadı');
  }

  const merchantOid = form.merchant_oid;
  if (!merchantOid) return fail('merchant_oid yok');

  // Order kaydı = yönlendirme + idempotency kaynağı (host'a güvenmiyoruz).
  const order = await readOrder(merchantOid);
  if (!order) return ok(); // bilinmeyen/expired sipariş → susmak için OK
  if (order.status === 'paid') return ok(); // idempotency

  // İlgili kurumun config'ini AÇIKÇA order'ın tenant'ından yükle.
  const cfg = (await tdb(order.org, order.branch).tenantConfig.findFirst())?.paymentConfig as PaymentConfigData | null | undefined;
  if (!cfg || !cfg.keyEnc || !cfg.saltEnc) return fail('config yok');

  let key: string | null, salt: string | null;
  try {
    key = decryptSecret(cfg.keyEnc);
    salt = decryptSecret(cfg.saltEnc);
  } catch {
    return fail('anahtar çözülemedi');
  }

  const provider = getProvider(cfg.provider || 'paytr');
  const { valid, status } = provider.verifyCallback({ config: { key: key || '', salt: salt || '' }, form });
  if (!valid) return fail('hash uyuşmuyor'); // sahte/bozuk bildirim — kredilendirme yok

  // Başarısız ödeme → işaretle, OK dön (tekrar deneme istemeyiz).
  if (status !== 'success') {
    await patchOrder(merchantOid, order, { status: 'failed', failedAt: new Date().toISOString() });
    return ok();
  }

  // Çift işlemeye karşı ATOMİK claim: updateMany WHERE status≠paid/processing →
  // count:1 ise bu çağrı sahiplendi, count:0 ise başka callback zaten işliyor/işledi.
  // PostgreSQL UPDATE atomik → tek satırlık NX lock'un birebir eşdeğeri.
  const claim = await prisma.payOrder.updateMany({
    where: { oid: merchantOid, status: { notIn: ['paid', 'processing'] } },
    data: { status: 'processing' },
  });
  if (claim.count === 0) return ok(); // başka çağrı sahiplendi/işledi → idempotent çık

  try {
    // Son kontrol: kilidi aldıktan sonra order durumunu yeniden oku.
    const fresh = await readOrder(merchantOid);
    if (fresh?.status === 'paid') return ok();

    const paymentOpts = {
      studentId: order.studentId,
      installmentIdx: order.installmentIdx,
      method: 'PayTR (online)',
      date: new Date().toISOString().slice(0, 10),
      recordedBy: 'Online ödeme',
      orgOverride: order.org,
      branchOverride: order.branch,
    };
    let result;
    try {
      result = await applyInstallmentPaymentSql(paymentOpts);
    } catch (e) {
      // İş-kuralı ihlali (kayıt yok / geçersiz tutar / taksit zaten ödendi) → HttpError:
      // terminal 'error' işaretle + OK dön (tekrar deneme istemeyiz). Altyapı hataları
      // (HttpError DEĞİL) yeniden fırlar → dıştaki catch claim'i geri alır (pending → PayTR tekrar dener).
      if (e instanceof HttpError) {
        await patchOrder(merchantOid, order, { status: 'error', error: e.message, at: new Date().toISOString() });
        return ok();
      }
      throw e;
    }

    await patchOrder(merchantOid, order, { status: 'paid', paidAt: new Date().toISOString(), receiptNo: result.receiptNo });

    await logAudit({
      actorRole: 'system', actorName: 'Online Ödeme (PayTR)', actorId: 'paytr',
      action: 'finance.payment',
      target: { type: 'student', id: order.studentId, name: order.studentName || order.studentId },
      detail: `Online ödeme alındı: ${order.studentName || order.studentId} — ${result.payment.amount} TL (PayTR), makbuz ${result.receiptNo}. Kalan bakiye: ${result.balance} TL`,
    }, { org: order.org, branch: order.branch });

    return ok();
  } catch {
    // Claim'i geri al (yoksa sipariş kalıcı kilitlenir), tekrar deneme işleyebilsin.
    try {
      await prisma.payOrder.updateMany({
        where: { oid: merchantOid, status: 'processing' },
        data: { status: 'pending' },
      });
    } catch { /* en iyi çaba */ }
    return fail('işleme hatası');
  }
}
