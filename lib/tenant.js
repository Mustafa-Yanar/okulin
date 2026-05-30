import { headers } from 'next/headers';
import redis from './redis';
import { DEFAULT_ORG } from './org';

// Kurum-kapsamlı (multi-tenant) Redis erişimi.
// Tüm anahtarlar `t:<org>:<branch>:` ön ekiyle scope'lanır → kurumlar birbirinin
// verisini GÖREMEZ. Faz A: branch daima "main" (şube desteği Faz D).
//
// Route'lar `import redis` yerine `tenantRedis()` çağırır; anahtar string'leri AYNI
// kalır (ör. redis.get('teacher:x') → otomatik t:cozum:main:teacher:x).
//
// scan/keys DÖNÜŞTE prefix'i SOYAR → çağıran eskisi gibi ön-eksiz anahtar görür ve
// onu tekrar scoped op'a verince doğru şekilde yeniden prefix'lenir (çift prefix olmaz).

const BRANCH = 'main';

// İstekteki kurum (middleware'in koyduğu x-org header'ından; yoksa varsayılan).
export function currentOrg() {
  try {
    return headers().get('x-org') || DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG; // istek bağlamı dışında (güvenlik ağı)
  }
}

function prefixFor(org) {
  return `t:${org}:${BRANCH}:`;
}

// Test edilebilir çekirdek: bir client + prefix alır, scoped sarmalayıcı döner.
export function _scopedClient(client, prefix) {
  const k = (key) => prefix + key;
  const strip = (key) => (typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : key);

  const scopedPipeline = () => {
    const p = client.pipeline();
    const wrap = {
      get: (key) => { p.get(k(key)); return wrap; },
      set: (key, val, opts) => { opts === undefined ? p.set(k(key), val) : p.set(k(key), val, opts); return wrap; },
      del: (...keys) => { p.del(...keys.map(k)); return wrap; },
      sadd: (key, ...m) => { p.sadd(k(key), ...m); return wrap; },
      srem: (key, ...m) => { p.srem(k(key), ...m); return wrap; },
      incr: (key) => { p.incr(k(key)); return wrap; },
      exec: () => p.exec(),
    };
    return wrap;
  };

  return {
    get: (key) => client.get(k(key)),
    set: (key, val, opts) => (opts === undefined ? client.set(k(key), val) : client.set(k(key), val, opts)),
    del: (...keys) => client.del(...keys.map(k)),
    exists: (...keys) => client.exists(...keys.map(k)),
    incr: (key) => client.incr(k(key)),
    expire: (key, s) => client.expire(k(key), s),
    sadd: (key, ...m) => client.sadd(k(key), ...m),
    srem: (key, ...m) => client.srem(k(key), ...m),
    smembers: (key) => client.smembers(k(key)),
    scard: (key) => client.scard(k(key)),
    keys: async (pattern) => (await client.keys(prefix + pattern)).map(strip),
    scan: async (cursor, opts = {}) => {
      const o = { ...opts };
      if (o.match) o.match = prefix + o.match;
      const [next, found] = await client.scan(cursor, o);
      return [next, (found || []).map(strip)];
    },
    pipeline: scopedPipeline,
  };
}

// İstek bağlamındaki kuruma scoped Redis. orgOverride verilirse onu kullanır (scriptler).
export function tenantRedis(orgOverride) {
  const org = orgOverride || currentOrg();
  return _scopedClient(redis, prefixFor(org));
}

// Org-bağımsız ham client — yalnız yedek/cron (tüm org'ları gezer) ve scriptler için.
export { default as rawRedis } from './redis';
export { prefixFor };
