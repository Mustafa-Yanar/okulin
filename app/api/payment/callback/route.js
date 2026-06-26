import { rawRedis, tenantRedis } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';
import { decryptSecret } from '@/lib/payment/crypto';
import { getProvider } from '@/lib/payment';
import { applyInstallmentPayment, applyInstallmentPaymentSql } from '@/lib/finance';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs'; // HMAC + crypto

// PayTR Bildirim (callback) URL'i. Server-to-server, form-urlencoded POST.
// Kimlik doğrulama: HMAC hash (oturum/cookie YOK). Middleware'de CSRF'ten MUAF.
// Para kredilendiren KRİTİK uç → idempotent olmalı; her durumda düz metin "OK".
// SQL-aware: payorder = PayOrder modeli; finans = applyInstallmentPaymentSql.
// paylock (NX kilit) transient → Redis kalır.

function ok() {
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
function fail(msg) {
  return new Response(`FAIL: ${msg}`, { status: 400, headers: { 'Content-Type': 'text/plain' } });
}

// PayOrder okuma — SQL (PayOrder modeli) veya Redis. Ortak şekle normalize eder.
async function readOrder(oid) {
  if (isSqlEnabled()) {
    const po = await prisma.payOrder.findUnique({ where: { oid } });
    if (!po) return null;
    return {
      org: po.orgSlug, branch: po.branch, studentId: po.studentId, status: po.status,
      installmentIdx: po.data?.installmentIdx, studentName: po.data?.studentName, data: po.data || {},
    };
  }
  return rawRedis.get(`payorder:${oid}`);
}
// PayOrder durum güncelle (idempotency kaydı).
async function patchOrder(oid, order, patch, days) {
  if (isSqlEnabled()) {
    const { status, ...rest } = patch;
    await prisma.payOrder.update({ where: { oid }, data: { status, data: { ...(order.data || {}), ...rest } } });
  } else {
    await rawRedis.set(`payorder:${oid}`, { ...order, ...patch }, { ex: 60 * 60 * 24 * (days || 7) });
  }
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
  const cfg = isSqlEnabled()
    ? (await tdb(order.org, order.branch).tenantConfig.findFirst())?.paymentConfig
    : await tenantRedis(order.org, order.branch).get('payment:config');
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
    await patchOrder(merchantOid, order, { status: 'failed', failedAt: new Date().toISOString() }, 7);
    return ok();
  }

  // Çift işlemeye karşı kilit. SQL'de: PayOrder.status'ta ATOMİK claim
  // (updateMany WHERE status≠paid/processing → count:1 ise bu çağrı sahiplendi,
  // count:0 ise başka callback zaten işliyor/işledi). PostgreSQL UPDATE atomik →
  // Redis NX lock'un birebir eşdeğeri, ödeme verisiyle AYNI sistemde (tutarlı).
  // Redis yolunda: eski NX kilit (göç sonrası ölecek).
  let lockKey = null;
  if (isSqlEnabled()) {
    const claim = await prisma.payOrder.updateMany({
      where: { oid: merchantOid, status: { notIn: ['paid', 'processing'] } },
      data: { status: 'processing' },
    });
    if (claim.count === 0) return ok(); // başka çağrı sahiplendi/işledi → idempotent çık
  } else {
    lockKey = `paylock:${merchantOid}`;
    const lock = await rawRedis.set(lockKey, '1', { nx: true, ex: 30 });
    if (!lock) return ok();
  }

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
    };
    const result = isSqlEnabled()
      ? await applyInstallmentPaymentSql({ ...paymentOpts, orgOverride: order.org, branchOverride: order.branch })
      : await applyInstallmentPayment(tenantRedis(order.org, order.branch), paymentOpts);

    if (!result.ok) {
      await patchOrder(merchantOid, order, { status: 'error', error: result.error, at: new Date().toISOString() }, 7);
      return ok();
    }

    await patchOrder(merchantOid, order, { status: 'paid', paidAt: new Date().toISOString(), receiptNo: result.receiptNo }, 30);

    await logAudit({
      actorRole: 'system', actorName: 'Online Ödeme (PayTR)', actorId: 'paytr',
      action: 'finance.payment',
      target: { type: 'student', id: order.studentId, name: order.studentName || order.studentId },
      detail: `Online ödeme alındı: ${order.studentName || order.studentId} — ${result.payment.amount} TL (PayTR), makbuz ${result.receiptNo}. Kalan bakiye: ${result.balance} TL`,
    }, { org: order.org, branch: order.branch });

    return ok();
  } catch (e) {
    // Kilidi serbest bırak ki tekrar deneme işleyebilsin.
    // SQL: 'processing' claim'ini geri al (yoksa sipariş kalıcı kilitlenir).
    if (isSqlEnabled()) {
      try {
        await prisma.payOrder.updateMany({
          where: { oid: merchantOid, status: 'processing' },
          data: { status: 'pending' },
        });
      } catch { /* en iyi çaba */ }
    } else if (lockKey) {
      await rawRedis.del(lockKey);
    }
    return fail('işleme hatası');
  }
}
