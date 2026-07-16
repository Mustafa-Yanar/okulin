import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';
import redis from './redis';
import { prisma } from './prisma';
import { DEFAULT_ORG } from './org';
import type { Redis } from '@upstash/redis';

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

type SetOpts = Parameters<Redis['set']>[2];
type ScanOpts = { match?: string; count?: number; type?: string };

// İstek-DIŞI tenant bağlamı (cron/script). runWithTenant() bunu set eder; currentOrg/
// currentBranch önce buna bakar, yoksa istek header'ına düşer → tüm tdb()/tenantRedis()
// (dolayısıyla slots/push/db) çağıran koda dokunmadan doğru kuruma yönlenir.
interface TenantStore { org: string; branch: string; }
const tenantContext = new AsyncLocalStorage<TenantStore>();

// Belirtilen kurum+şube bağlamında fn'i çalıştırır. İçindeki tüm currentOrg()/
// currentBranch() bu değerleri döndürür. Cron'ların çok-kurum döngüsü için.
export function runWithTenant<T>(org: string, branch: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ org, branch }, fn);
}

// İstekteki kurum: önce ALS bağlamı (cron), sonra middleware x-org header'ı, sonra varsayılan.
export function currentOrg(): string {
  const store = tenantContext.getStore();
  if (store) return store.org;
  try {
    return headers().get('x-org') || DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG; // istek bağlamı dışında (güvenlik ağı)
  }
}

// İstekteki şube: önce ALS bağlamı (cron), sonra x-branch header'ı, sonra 'main'.
export function currentBranch(): string {
  const store = tenantContext.getStore();
  if (store) return store.branch;
  try {
    return headers().get('x-branch') || 'main';
  } catch {
    return 'main';
  }
}

export interface TenantRef { org: string; branch: string; }

// Aktif tüm kurum×şube çiftleri — çok-kurum cron'ları bu liste üzerinde döner.
// Org'un hiç şubesi yoksa 'main' varsayılır (tek-şubeli eski davranış).
// Liste boşsa (Org tablosu henüz tohumlanmadıysa) DEFAULT_ORG/main'e düşer → mevcut
// tek-kurum cron davranışı korunur (güvenlik ağı).
export async function listActiveTenants(): Promise<TenantRef[]> {
  const orgs = await prisma.org.findMany({ where: { active: true }, select: { slug: true } });
  const out: TenantRef[] = [];
  for (const o of orgs) {
    const branches = await prisma.branch.findMany({
      where: { orgSlug: o.slug, active: true }, select: { slug: true },
    });
    if (branches.length === 0) out.push({ org: o.slug, branch: 'main' });
    else for (const b of branches) out.push({ org: o.slug, branch: b.slug });
  }
  if (out.length === 0) out.push({ org: DEFAULT_ORG, branch: 'main' });
  return out;
}

function prefixFor(org: string): string {
  return `t:${org}:${BRANCH}:`;
}

export interface ScopedPipeline {
  get(key: string): ScopedPipeline;
  set(key: string, val: unknown, opts?: SetOpts): ScopedPipeline;
  del(...keys: string[]): ScopedPipeline;
  sadd(key: string, ...m: unknown[]): ScopedPipeline;
  srem(key: string, ...m: unknown[]): ScopedPipeline;
  scard(key: string): ScopedPipeline;
  sismember(key: string, m: unknown): ScopedPipeline;
  incr(key: string): ScopedPipeline;
  exec(): Promise<unknown[]>;
}

export interface ScopedRedis {
  get<T = unknown>(key: string): Promise<T | null>;
  getdel<T = unknown>(key: string): Promise<T | null>;
  set(key: string, val: unknown, opts?: SetOpts): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, s: number): Promise<0 | 1>;
  sadd(key: string, ...m: unknown[]): Promise<number>;
  srem(key: string, ...m: unknown[]): Promise<number>;
  sismember(key: string, member: unknown): Promise<0 | 1>;
  smembers<T extends unknown[] = string[]>(key: string): Promise<T>;
  scard(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan(cursor: string | number, opts?: ScanOpts): Promise<[string, string[]]>;
  pipeline(): ScopedPipeline;
}

// Test edilebilir çekirdek: bir client + prefix alır, scoped sarmalayıcı döner.
export function _scopedClient(client: Redis, prefix: string): ScopedRedis {
  const k = (key: string) => prefix + key;
  const strip = (key: string) => (typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : key);

  const scopedPipeline = (): ScopedPipeline => {
    const p = client.pipeline();
    const wrap: ScopedPipeline = {
      get: (key) => { p.get(k(key)); return wrap; },
      set: (key, val, opts) => { opts === undefined ? p.set(k(key), val) : p.set(k(key), val, opts); return wrap; },
      del: (...keys) => { p.del(...keys.map(k)); return wrap; },
      sadd: (key, ...m) => { p.sadd(k(key), ...(m as [unknown, ...unknown[]])); return wrap; },
      srem: (key, ...m) => { p.srem(k(key), ...(m as [unknown, ...unknown[]])); return wrap; },
      scard: (key) => { p.scard(k(key)); return wrap; },
      sismember: (key, m) => { p.sismember(k(key), m); return wrap; },
      incr: (key) => { p.incr(k(key)); return wrap; },
      exec: () => p.exec(),
    };
    return wrap;
  };

  return {
    get: (key) => client.get(k(key)),
    getdel: (key) => client.getdel(k(key)),
    set: (key, val, opts) => (opts === undefined ? client.set(k(key), val) : client.set(k(key), val, opts)),
    del: (...keys) => client.del(...keys.map(k)),
    exists: (...keys) => client.exists(...keys.map(k)),
    incr: (key) => client.incr(k(key)),
    expire: (key, s) => client.expire(k(key), s),
    sadd: (key, ...m) => client.sadd(k(key), ...(m as [unknown, ...unknown[]])),
    srem: (key, ...m) => client.srem(k(key), ...(m as [unknown, ...unknown[]])),
    sismember: (key, member) => client.sismember(k(key), member),
    smembers: <T extends unknown[] = string[]>(key: string) => client.smembers<T>(k(key)),
    scard: (key) => client.scard(k(key)),
    keys: async (pattern) => (await client.keys(prefix + pattern)).map(strip),
    scan: async (cursor, opts = {}) => {
      const o: ScanOpts = { ...opts };
      if (o.match) o.match = prefix + o.match;
      const [next, found] = await client.scan(cursor, o as Parameters<Redis['scan']>[1]);
      return [String(next), (found || []).map(strip)];
    },
    pipeline: scopedPipeline,
  };
}

// İstek bağlamındaki kuruma+şubeye scoped Redis.
// orgOverride: scriptlerde veya HQ panel API'sinde explicit org geçilir.
// branchOverride: HQ panel API'sinde explicit şube geçilir (ör. 'ankara').
// Her ikisi de verilmezse istek bağlamındaki org + şube (x-branch, yoksa 'main') kullanılır.
export function tenantRedis(orgOverride?: string, branchOverride?: string): ScopedRedis {
  const org = orgOverride || currentOrg();
  const branch = branchOverride || currentBranch();
  return _scopedClient(redis, `t:${org}:${branch}:`);
}

// Org-bağımsız ham client — yalnız yedek/cron (tüm org'ları gezer) ve scriptler için.
export { default as rawRedis } from './redis';
export { prefixFor };
