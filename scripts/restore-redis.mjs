// okulin Redis RESTORE — yedek JSON'undan (typed-v1) Redis'e type-aware geri yükleme.
// Hem felaket kurtarma hem "yedekten dönüş tatbikatı" aracı.
//
// Yedek formatı (typed-v1): { ..., data: { "<key>": { type, val } } }  ← /api/backup
//                       veya { "<key>": { type, val } }                  ← scripts/dump-redis.mjs
//
// Kullanım:
//   # 1) Local döküm al (type-aware), izole prefix'e GÜVENLE geri yükle, doğrula:
//   UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… node scripts/dump-redis.mjs > tmp/dump.json
//   … node scripts/restore-redis.mjs --file=tmp/dump.json --prefix=drill: --write --flush
//
//   # 2) GitHub yedeğinden gerçek kurtarma (DİKKAT: canlı anahtarları EZER):
//   gh api repos/<owner>/<repo>/contents/backups/2026-06-11.json --jq .content \
//     | base64 -d | node scripts/restore-redis.mjs --stdin --write --flush
//
// Bayraklar:
//   --file=PATH  : yedek dosyası        --stdin : yedeği stdin'den oku
//   --prefix=STR : her anahtarın önüne ekle (izole tatbikat; canlı veriye dokunmaz)
//   --write      : GERÇEKTEN yaz. YOKSA dry-run (ne yapacağını sayar, hiçbir şey yazmaz)
//   --flush      : yazmadan önce hedef anahtarı sil (temiz/idempotent restore)
//   --only=PFX   : yalnız bu (orijinal) önekle başlayan anahtarları geri yükle
//
// Güvenlik: --write olmadan ASLA yazmaz. Upstash REST env'inden okur (yazma token gerekir).

import { Redis } from '@upstash/redis';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));

const WRITE = !!args.write;
const FLUSH = !!args.flush;
const PREFIX = typeof args.prefix === 'string' ? args.prefix : '';
const ONLY = typeof args.only === 'string' ? args.only : '';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!url || !token) { console.error('HATA: Upstash env (URL/TOKEN) yok.'); process.exit(1); }
const redis = new Redis({ url, token });

// ── Yedeği oku ───────────────────────────────────────────────────────────────
let raw;
if (args.stdin) {
  raw = readFileSync(0, 'utf-8');
} else if (typeof args.file === 'string') {
  raw = readFileSync(args.file, 'utf-8');
} else {
  console.error('HATA: --file=PATH ya da --stdin gerekli.');
  process.exit(1);
}

let parsed;
try { parsed = JSON.parse(raw); } catch (e) { console.error('HATA: JSON ayrıştırılamadı:', e.message); process.exit(1); }
const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
const entries = Object.entries(data).filter(([k]) => !ONLY || k.startsWith(ONLY));

if (!entries.length) { console.error('Yedekte (filtreye uyan) anahtar yok.'); process.exit(1); }

console.error(`Yedek: ${entries.length} anahtar${ONLY ? ` (--only=${ONLY})` : ''}`);
console.error(`Hedef: ${PREFIX ? `"${PREFIX}" önekiyle` : 'AYNI anahtarlar (canlıyı ezer)'} — mod: ${WRITE ? 'YAZMA' : 'dry-run (yazma yok)'}${FLUSH ? ' +flush' : ''}`);
console.error('');

// ── Tipe göre yaz ──────────────────────────────────────────────────────────────
const stats = { string: 0, set: 0, list: 0, hash: 0, zset: 0, skipped: 0, errors: 0 };

async function writeKey(key, type, val) {
  if (FLUSH) await redis.del(key);
  if (type === 'string') {
    await redis.set(key, val);
  } else if (type === 'set') {
    const m = Array.isArray(val) ? val : [];
    if (m.length) await redis.sadd(key, ...m);
  } else if (type === 'list') {
    const m = Array.isArray(val) ? val : [];
    if (m.length) await redis.rpush(key, ...m);
  } else if (type === 'hash') {
    if (val && typeof val === 'object' && Object.keys(val).length) await redis.hset(key, val);
  } else if (type === 'zset') {
    // withScores → düz dizi [member, score, member, score, …]
    const members = [];
    for (let i = 0; i + 1 < val.length; i += 2) members.push({ member: val[i], score: Number(val[i + 1]) });
    if (members.length) await redis.zadd(key, ...members);
  } else {
    return false;
  }
  return true;
}

for (const [origKey, entry] of entries) {
  const type = entry?.type;
  const val = entry?.val;
  if (!type) { stats.skipped++; continue; }
  const key = PREFIX + origKey;
  if (!WRITE) { stats[type] = (stats[type] || 0) + 1; continue; } // dry-run: yalnız say
  try {
    const ok = await writeKey(key, type, val);
    if (ok) stats[type] = (stats[type] || 0) + 1; else stats.skipped++;
  } catch (e) {
    stats.errors++;
    if (stats.errors <= 5) console.error(`  HATA ${key} (${type}): ${e.message}`);
  }
}

console.error('');
console.error(`${WRITE ? 'Yazıldı' : 'Yazılacaktı (dry-run)'}: string ${stats.string}, set ${stats.set}, list ${stats.list}, hash ${stats.hash}, zset ${stats.zset}` +
  (stats.skipped ? `, atlanan ${stats.skipped}` : '') + (stats.errors ? `, HATA ${stats.errors}` : ''));
if (!WRITE) console.error('(Hiçbir şey yazılmadı. Gerçekten yüklemek için --write ekle.)');
process.exit(stats.errors ? 1 : 0);
