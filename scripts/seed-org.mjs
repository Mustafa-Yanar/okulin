// Kurum (org) tohumlama scripti — Faz A reset + yeni kurum açma.
// Upstash REST env'inden okur (URL/TOKEN). Şifreler CLI'dan gelir, dosyada DURMAZ.
//
// Kullanım (tek şube):
//   node scripts/seed-org.mjs --org=cozum --name="Akyazı Çözüm" \
//     --director-user="..." --director-pass="..." [--force] [--clean-legacy]
//
// Kullanım (çok şubeli + org_admin):
//   node scripts/seed-org.mjs --org=final --name="Final Dershanesi" --type=multi \
//     --director-user="..." --director-pass="..." \
//     --orgadmin-user="..." --orgadmin-pass="..." [--orgadmin-name="..."]
//
// - org registry: `orgs` (set) + `org:<slug>` (global)
// - director:     `t:<slug>:main:director` (scoped)
// - org_admin:    `orgadmin:<slug>` (global, yalnız --type=multi)
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
const type = args.type || 'single';
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
  const createdAt = new Date().toISOString();
  await redis.sadd('orgs', org);
  await redis.set(`org:${org}`, { slug: org, name, active: true, type, createdAt });
  console.log('org kaydı:', org, '→', name, `[${type}]`);

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
  // Çok şubeli: org_admin + 'main' branch metadata
  if (type === 'multi') {
    if (args['orgadmin-user'] && args['orgadmin-pass']) {
      const orgAdminExists = await redis.exists(`orgadmin:${org}`);
      if (orgAdminExists && !args.force) {
        console.log('orgadmin zaten var — atlandı (--force ile ez).');
      } else {
        const adminHash = await bcrypt.hash(String(args['orgadmin-pass']), 10);
        await redis.set(`orgadmin:${org}`, {
          username: args['orgadmin-user'],
          passwordHash: adminHash,
          name: args['orgadmin-name'] || name,
        });
        console.log('orgadmin tohumlandı:', args['orgadmin-user']);
      }
    } else {
      console.warn('UYARI: --type=multi verildi ama --orgadmin-user/pass eksik — org_admin oluşturulmadı.');
    }
    // Ana şube metadata
    await redis.sadd(`org:${org}:branches`, 'main');
    await redis.set(`org:${org}:branch:main`, { slug: 'main', name: 'Ana Şube', active: true, createdAt });
    console.log('Ana şube (main) kaydı oluşturuldu.');
  }

  console.log('TAMAM. prefix:', prefix);
}

main().catch(e => { console.error(e); process.exit(1); });
