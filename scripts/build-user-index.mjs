// Tek seferlik: mevcut tüm kullanıcılar için username→{role,id} ters indeksini kurar.
// Login'in O(n) taramasını O(1)'e indiren indeks (Madde 2).
//
// Kullanım:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/build-user-index.mjs
//
// Idempotent: tekrar çalıştırmak güvenli (addToIndex tekilleştirir).

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function indexKey(username) {
  return `uidx:${String(username || '').trim().toLowerCase()}`;
}

async function addToIndex(username, role, id) {
  if (!username) return false;
  const key = indexKey(username);
  const existing = (await redis.get(key)) || [];
  const list = Array.isArray(existing) ? existing : [];
  if (!list.some(e => e.role === role && e.id === id)) {
    list.push({ role, id });
    await redis.set(key, list);
  }
  return true;
}

async function indexRole(setKey, keyPrefix, role) {
  const ids = await redis.smembers(setKey);
  console.log(`\n[${role}] ${ids.length} kullanıcı indeksleniyor...`);
  let n = 0, skipped = 0;
  for (const id of ids) {
    const user = await redis.get(`${keyPrefix}:${id}`);
    if (!user?.username) { skipped++; continue; }
    await addToIndex(user.username, role, id);
    n++;
    if (n % 50 === 0) console.log(`  ... ${n}/${ids.length}`);
  }
  console.log(`  ✓ ${role}: ${n} indekslendi${skipped ? `, ${skipped} atlandı (username yok)` : ''}`);
  return n;
}

async function main() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('HATA: UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN gerekli.');
    process.exit(1);
  }

  console.log('=== Kullanıcı ters indeksi kuruluyor ===');
  let total = 0;
  total += await indexRole('students', 'student', 'student');
  total += await indexRole('teachers', 'teacher', 'teacher');
  total += await indexRole('accountants', 'accountant', 'accountant');

  console.log(`\n=== TAMAMLANDI: ${total} kullanıcı indekslendi ===`);
}

main().catch((err) => { console.error('HATA:', err); process.exit(1); });
