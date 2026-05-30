// Kurum (org) tohumlama scripti — Faz A reset + ileride yeni kurum açma.
// Upstash REST env'inden okur (URL/TOKEN). Şifre CLI'dan gelir, dosyada DURMAZ.
//
// Kullanım:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//   node scripts/seed-org.mjs --org=cozum --name="Akyazı Çözüm" \
//     --director-user="..." --director-pass="..." --director-name="..." [--force] [--clean-legacy]
//
// - org registry: `orgs` (set) + `org:<slug>` (global)
// - director:     `t:<slug>:main:director` (scoped)
// - --clean-legacy: t:/org/orgs dışındaki eski düz anahtarları siler (Faz A temizliği)

import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!url || !token) { console.error('HATA: Upstash env (URL/TOKEN) yok.'); process.exit(1); }
const redis = new Redis({ url, token });

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));

const org = args.org || 'cozum';
const name = args.name || 'Kurum';
const prefix = `t:${org}:main:`;

async function cleanLegacy() {
  let cursor = '0', deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, { count: 500 });
    cursor = String(next);
    const legacy = (keys || []).filter(k => !k.startsWith('t:') && k !== 'orgs' && !k.startsWith('org:'));
    if (legacy.length) { await redis.del(...legacy); deleted += legacy.length; }
  } while (cursor !== '0');
  console.log('Eski (legacy) anahtar silindi:', deleted);
}

async function main() {
  if (args['clean-legacy']) await cleanLegacy();

  // org kaydı (global)
  await redis.sadd('orgs', org);
  await redis.set(`org:${org}`, { slug: org, name, active: true, createdAt: new Date().toISOString() });
  console.log('org kaydı:', org, '→', name);

  // director (scoped)
  if (args['director-user'] && args['director-pass']) {
    const exists = await redis.exists(prefix + 'director');
    if (exists && !args.force) {
      console.log('director zaten var — atlandı (--force ile ez).');
    } else {
      const passwordHash = await bcrypt.hash(String(args['director-pass']), 10);
      await redis.set(prefix + 'director', {
        username: args['director-user'],
        passwordHash,
        name: args['director-name'] || name,
      });
      console.log('director tohumlandı:', args['director-user']);
    }
  }
  console.log('TAMAM. prefix:', prefix);
}

main().catch(e => { console.error(e); process.exit(1); });
