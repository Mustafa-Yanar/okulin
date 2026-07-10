import { tenantRedis, type ScopedRedis } from './tenant';

// Drop-in kurum-kapsamlı Redis. Route'lar `import redis from '@/lib/db'` ile bunu
// kullanır — gövdeye hiç dokunmadan. Her metod çağrısında org'u istek header'ından
// (x-org) çözer, doğru `t:<org>:main:` namespace'ine yazar/okur.
//
// redis.get/set/del/smembers/pipeline(... ) → hepsi otomatik scope'lanır.
// pipeline() çağrı anında scoped pipeline döner (zincirlenebilir).
//
// NOT: yedek/cron gibi tüm-org gezen yerler bunu DEĞİL, ham '@/lib/redis'i kullanır.

// Proxy her metod çağrısını istek-anı tenantRedis()'ine yönlendirir; şekli birebir
// ScopedRedis olduğundan cast güvenli (dinamik Proxy'yi statik tiplemenin tek yolu).
const db = new Proxy({} as ScopedRedis, {
  get(_target, prop: keyof ScopedRedis) {
    return (...args: unknown[]) => (tenantRedis()[prop] as (...a: unknown[]) => unknown)(...args);
  },
});

export default db;
