// Süper admin hesabı oluşturma/güncelleme scripti.
// Mevcut hesap varsa --force olmadan atlanır.
//
// Kullanım:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//   node scripts/seed-superadmin.mjs --username=... --password=... [--name=...] [--force]

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

if (!args.username || !args.password) {
  console.error('HATA: --username ve --password zorunlu.');
  process.exit(1);
}

const exists = await redis.exists('superadmin');
if (exists && !args.force) {
  console.log('Superadmin zaten var — atlandı. Güncellemek için --force ekle.');
  process.exit(0);
}

const passwordHash = await bcrypt.hash(String(args.password), 10);
await redis.set('superadmin', {
  username: String(args.username),
  passwordHash,
  name: String(args.name || 'Süper Admin'),
  createdAt: new Date().toISOString(),
});

console.log('Superadmin oluşturuldu:', args.username);
