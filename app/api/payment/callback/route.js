import { rawRedis, tenantRedis } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';
import { decryptSecret } from '@/lib/payment/crypto';
import { getProvider } from '@/lib/payment';
import { applyInstallmentPayment, applyInstallmentPaymentSql } from '@/lib/finance';
import { useSql } from '@/lib/usesql';

export const runtime = 'nodejs'; // HMAC + crypto

// PayTR Bildirim (callback) URL'i. Server-to-server, form-urlencoded POST.
// Kimlik doğrulama: HMAC hash (oturum/cookie YOK). Middleware'de CSRF'ten MUAF.
// Para kredilendiren KRİTİK uç → idempotent olmalı; her durumda düz metin "OK".

function ok() {
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
function fail(msg) {
  // Non-OK → PayTR tekrar dener. Yalnız gerçekten işleyemediğimizde (hash/uyumsuzluk).
  return new Response(`FAIL: ${msg}`, { status: 400, headers: { 'Content-Type': 'text/plain' } });
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
  const order = await rawRedis.get(`payorder:${merchantOid}`);
  if (!order) {
    // Bilinmeyen/expired sipariş → işleyecek bir şey yok; PayTR'i susturmak için OK.
    return ok();
  }

  // Zaten işlenmişse tekrar kredilendirme YOK (idempotency).
  if (order.status === 'paid') return ok();

  // İlgili kurumun config'ini AÇIKÇA order'ın tenant'ından yükle.
  // (payment:config + payorder/paylock = ödeme akış state'i, Redis-only; finans yazma SQL.)
  const orderRedis = tenantRedis(order.org, order.branch);
  const cfg = await orderRedis.get('payment:config');
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
    await rawRedis.set(`payorder:${merchantOid}`, { ...order, status: 'failed', failedAt: new Date().toISOString() }, { ex: 60 * 60 * 24 * 7 });
    return ok();
  }

  // Çift işlemeye karşı kısa NX kilit (eşzamanlı tekrar callback).
  const lockKey = `paylock:${merchantOid}`;
  const lock = await rawRedis.set(lockKey, '1', { nx: true, ex: 30 });
  if (!lock) return ok(); // başka bir çağrı işliyor → idempotent çık

  try {
    // Son kontrol: kilidi aldıktan sonra order durumunu yeniden oku.
    const fresh = await rawRedis.get(`payorder:${merchantOid}`);
    if (fresh?.status === 'paid') return ok();

    const paymentOpts = {
      studentId: order.studentId,
      installmentIdx: order.installmentIdx,
      method: 'PayTR (online)',
      date: new Date().toISOString().slice(0, 10),
      recordedBy: 'Online ödeme',
    };
    const result = useSql()
      ? await applyInstallmentPaymentSql({ ...paymentOpts, orgOverride: order.org, branchOverride: order.branch })
      : await applyInstallmentPayment(orderRedis, paymentOpts);

    if (!result.ok) {
      // Finans kaydı yoksa (silinmiş) tekrar denemenin anlamı yok → OK.
      await rawRedis.set(`payorder:${merchantOid}`, { ...order, status: 'error', error: result.error, at: new Date().toISOString() }, { ex: 60 * 60 * 24 * 7 });
      return ok();
    }

    await rawRedis.set(`payorder:${merchantOid}`, {
      ...order, status: 'paid', paidAt: new Date().toISOString(), receiptNo: result.receiptNo,
    }, { ex: 60 * 60 * 24 * 30 });

    await logAudit({
      actorRole: 'system', actorName: 'Online Ödeme (PayTR)', actorId: 'paytr',
      action: 'finance.payment',
      target: { type: 'student', id: order.studentId, name: order.studentName || order.studentId },
      detail: `Online ödeme alındı: ${order.studentName || order.studentId} — ${result.payment.amount} TL (PayTR), makbuz ${result.receiptNo}. Kalan bakiye: ${result.balance} TL`,
    }, { org: order.org, branch: order.branch });

    return ok();
  } catch (e) {
    // Beklenmedik hata → kilidi bırak ki PayTR tekrarı işleyebilsin.
    await rawRedis.del(lockKey);
    return fail('işleme hatası');
  }
}
