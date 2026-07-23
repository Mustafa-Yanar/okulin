import crypto from 'node:crypto';

// PayTR iFrame API sağlayıcısı.
// Akış: createToken() → iframe → (ödeme) → PayTR Bildirim URL'ine callback → verifyCallback().
// Hash formülleri PayTR resmi dokümanından (dev.paytr.com).

const GET_TOKEN_URL = 'https://www.paytr.com/odeme/api/get-token';
const IFRAME_BASE = 'https://www.paytr.com/odeme/guzel';

export interface PaytrConfig {
  merchantId: string;
  key: string;
  salt: string;
  testMode?: boolean;
}

export interface PaytrOrder {
  merchantOid: string;
  amountKurus: number;
  basketName?: string;
}

export interface PaytrBuyer {
  email?: string;
  name?: string;
  address?: string;
  phone?: string;
}

export interface CreateTokenArgs {
  config: PaytrConfig;
  order: PaytrOrder;
  buyer: PaytrBuyer;
  reqIp?: string;
  okUrl: string;
  failUrl: string;
}

export type CreateTokenResult =
  | { ok: true; token: string; iframeUrl: string }
  | { ok: false; reason: string };

function hmacB64(data: string, key: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('base64');
}

// Adım 1 — token al. Başarılıysa { ok:true, token, iframeUrl }, değilse { ok:false, reason }.
//
// config: { merchantId, key, salt, testMode }   (key/salt çözülmüş düz metin)
// order:  { merchantOid, amountKurus, basketName }
// buyer:  { email, name, address, phone }
// okUrl/failUrl: tarayıcı yönlendirme hedefleri (iframe içinde)
export async function createToken({ config, order, buyer, reqIp, okUrl, failUrl }: CreateTokenArgs): Promise<CreateTokenResult> {
  const { merchantId, key, salt, testMode } = config;
  const test = testMode ? '1' : '0';
  const currency = 'TL';
  const noInstallment = '0';   // taksit serbest
  const maxInstallment = '0';  // sınır yok
  const email = buyer.email || 'noemail@etut.local';
  const ip = (reqIp || '').split(',')[0].trim() || '0.0.0.0';
  const amount = String(order.amountKurus); // kuruş

  // user_basket = base64( JSON [[ad, birimFiyat, adet]] )
  const basket = Buffer.from(
    JSON.stringify([[order.basketName || 'Ödeme', (order.amountKurus / 100).toFixed(2), 1]])
  ).toString('base64');

  const hashStr = merchantId + ip + order.merchantOid + email + amount + basket + noInstallment + maxInstallment + currency + test;
  const paytrToken = hmacB64(hashStr + salt, key);

  const form = new URLSearchParams({
    merchant_id: merchantId,
    user_ip: ip,
    merchant_oid: order.merchantOid,
    email,
    payment_amount: amount,
    paytr_token: paytrToken,
    user_basket: basket,
    debug_on: testMode ? '1' : '0',
    no_installment: noInstallment,
    max_installment: maxInstallment,
    user_name: (buyer.name || 'Veli').slice(0, 60),
    user_address: (buyer.address || '-').slice(0, 400),
    user_phone: (buyer.phone || '0000000000').slice(0, 20),
    merchant_ok_url: okUrl,
    merchant_fail_url: failUrl,
    timeout_limit: '30',
    currency,
    test_mode: test,
  });

  let res: Response, data: { status?: string; token?: string; reason?: string } | undefined;
  try {
    res = await fetch(GET_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    data = await res.json();
  } catch (e) {
    return { ok: false, reason: 'PayTR bağlantı hatası: ' + (e instanceof Error ? e.message : 'bilinmiyor') };
  }

  if (data?.status === 'success' && data.token) {
    return { ok: true, token: data.token, iframeUrl: `${IFRAME_BASE}?token=${data.token}` };
  }
  return { ok: false, reason: data?.reason || 'PayTR token alınamadı' };
}

export interface CallbackForm {
  merchant_oid?: string;
  status?: string;
  total_amount?: string;
  payment_amount?: string; // orijinal sepet tutarı (kuruş) — HMAC'e DAHİL DEĞİL
  hash?: string;
}

export interface VerifyCallbackResult {
  valid: boolean;
  status: string;
  merchantOid: string;
  amount: string;        // total_amount — HMAC ile bütünlük korumalı; vade farkı/taksit
                         // komisyonu nedeniyle sipariş tutarından BÜYÜK olabilir (PayTR sözleşmesi)
  paymentAmount: string; // payment_amount — bilgi amaçlı ikincil kontrol (imzasız alan)
}

// Adım 2 — callback hash doğrula. form: { merchant_oid, status, total_amount, hash }
// config: { key, salt }
// Döner: { valid, status, merchantOid, amount }
export function verifyCallback({ config, form }: { config: Pick<PaytrConfig, 'key' | 'salt'>; form: CallbackForm }): VerifyCallbackResult {
  const merchantOid = form.merchant_oid || '';
  const status = form.status || '';
  const totalAmount = form.total_amount || '';
  const received = form.hash || '';

  const expected = hmacB64(merchantOid + config.salt + status + totalAmount, config.key);

  let valid = false;
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { valid = false; }

  return { valid, status, merchantOid, amount: totalAmount, paymentAmount: form.payment_amount || '' };
}
