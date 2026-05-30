import { tenantRedis } from './tenant';

// Drop-in kurum-kapsamlı Redis. Route'lar `import redis from '@/lib/db'` ile bunu
// kullanır — gövdeye hiç dokunmadan. Her metod çağrısında org'u istek header'ından
// (x-org) çözer, doğru `t:<org>:main:` namespace'ine yazar/okur.
//
// redis.get/set/del/smembers/pipeline(... ) → hepsi otomatik scope'lanır.
// pipeline() çağrı anında scoped pipeline döner (zincirlenebilir).
//
// NOT: yedek/cron gibi tüm-org gezen yerler bunu DEĞİL, ham '@/lib/redis'i kullanır.

const db = new Proxy({}, {
  get(_target, prop) {
    return (...args) => tenantRedis()[prop](...args);
  },
});

export default db;
