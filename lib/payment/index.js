import * as paytr from './paytr';

// Ödeme sağlayıcı soyutlaması. İleride iyzico aynı arayüzle eklenir:
//   createToken({config, order, buyer, reqIp, okUrl, failUrl}) → { ok, token, iframeUrl, reason }
//   verifyCallback({config, form}) → { valid, status, merchantOid, amount }

const PROVIDERS = { paytr };

export function getProvider(name = 'paytr') {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Bilinmeyen ödeme sağlayıcı: ${name}`);
  return p;
}
