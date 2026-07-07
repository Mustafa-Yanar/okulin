import { logAudit } from '@/lib/audit';
import { decryptSecret } from '@/lib/payment/crypto';
import { getProvider } from '@/lib/payment';
import { applyInstallmentPaymentSql } from '@/lib/finance';
import { tdb } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs'; // HMAC + crypto

// PayTR Bildirim (callback) URL'i. Server-to-server, form-urlencoded POST.
// Kimlik doğrulama: HMAC hash (oturum/cookie YOK). Middleware'de CSRF'ten MUAF.
// Para kredilendiren KRİTİK uç → idempotent olmalı; her durumda düz metin "OK".
// payorder = PayOrder modeli; finans = applyInstallmentPaymentSql.
// Çift işleme kilidi: PayOrder.status ATOMİK claim (bkz. aşağı), ayrı Redis kilidi gerekmez.

function ok() {
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
function fail(msg) {
  return new Response(`FAIL: ${msg}`, { status: 400, headers: { 'Content-Type': 'text/plain' } });
}

// PayOrder okuma — ortak şekle normalize eder.
async function readOrder(oid) {
  const po = await prisma.payOrder.findUnique({ where: { oid } });
  if (!po) return null;
  return {
    org: po.orgSlug, branch: po.branch, studentId: po.studentId, status: po.status,
    installmentIdx: po.data?.installmentIdx, studentName: po.data?.studentName, data: po.data || {},
  };
}
// PayOrder durum güncelle (idempotency kaydı).
async function patchOrder(oid, order, patch) {
  const { status, ...rest } = patch;
  await prisma.payOrder.update({ where: { oid }, data: { status, data: { ...(order.data || {}), ...rest } } });
}

export async function POST(req) {
  let form;
  try {
    const fd = await req.formData();
    form = Object.fromEntries(fd.entries());
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
  const cfg = (await tdb(order.org, order.branch).tenantConfig.findFirst())?.paymentConfig;
  if (!cfg || !cfg.keyEnc || !cfg.saltEnc) return fail('config yok');

  let key, salt;
  try {
    key = decryptSecret(cfg.keyEnc);
    salt = decryptSecret(cfg.saltEnc);
  } catch {
    return fail('anahtar çözülemedi');
  }

  const provider = getProvider(cfg.provider || 'paytr');
  const { valid, status } = provider.verifyCallback({ config: { key, salt }, form });
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
    const result = await applyInstallmentPaymentSql(paymentOpts);

    if (!result.ok) {
      await patchOrder(merchantOid, order, { status: 'error', error: result.error, at: new Date().toISOString() });
      return ok();
    }

    await patchOrder(merchantOid, order, { status: 'paid', paidAt: new Date().toISOString(), receiptNo: result.receiptNo });

    await logAudit({
      actorRole: 'system', actorName: 'Online Ödeme (PayTR)', actorId: 'paytr',
      action: 'finance.payment',
      target: { type: 'student', id: order.studentId, name: order.studentName || order.studentId },
      detail: `Online ödeme alındı: ${order.studentName || order.studentId} — ${result.payment.amount} TL (PayTR), makbuz ${result.receiptNo}. Kalan bakiye: ${result.balance} TL`,
    }, { org: order.org, branch: order.branch });

    return ok();
  } catch (e) {
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
