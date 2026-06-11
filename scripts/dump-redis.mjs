// Tüm Redis verisini (key + value + type) JSON'a döker — silmeden önce yedek.
// Kullanım: node scripts/dump-redis.mjs > tmp/redis-yedek/dump.json
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!url || !token) { console.error('Upstash env yok'); process.exit(1); }
const redis = new Redis({ url, token });

const out = {};
let cursor = '0', total = 0;
do {
  const [next, keys] = await redis.scan(cursor, { count: 300 });
  cursor = String(next);
  for (const k of keys) {
    const type = await redis.type(k);
    let val;
    if (type === 'string') val = await redis.get(k);
    else if (type === 'set') val = await redis.smembers(k);
    else if (type === 'list') val = await redis.lrange(k, 0, -1);
    else if (type === 'hash') val = await redis.hgetall(k);
    else if (type === 'zset') val = await redis.zrange(k, 0, -1, { withScores: true });
    else val = null;
    out[k] = { type, val };
    total++;
  }
} while (cursor !== '0');

console.error(`Yedeklendi: ${total} anahtar`);
process.stdout.write(JSON.stringify(out, null, 2));
