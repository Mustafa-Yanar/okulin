import { tenantRedis } from './tenant';

// Kullanıcı adı → [{role, id}] ters indeksi.
// Login'in her seferinde tüm kullanıcıları taramasını (O(n)) önler → O(1) lookup.
//
// Aynı isimde birden çok kullanıcı olabilir (örn öğrenci + öğretmen aynı ad)
// → dizi tutulur, login her adayı dener.
//
// Anahtar: uidx:<küçük-harf-username>
// Değer:   [{ role:'student'|'teacher'|'accountant', id }]

function indexKey(username) {
  return `uidx:${String(username || '').trim().toLowerCase()}`;
}

// İndekse ekle (role+id'ye göre tekilleştirir).
export async function addToIndex(username, role, id) {
  if (!username) return;
  const redis = tenantRedis();
  const key = indexKey(username);
  const existing = (await redis.get(key)) || [];
  const list = Array.isArray(existing) ? existing : [];
  if (!list.some(e => e.role === role && e.id === id)) {
    list.push({ role, id });
    await redis.set(key, list);
  }
}

// İndeksten kaldır.
export async function removeFromIndex(username, role, id) {
  if (!username) return;
  const redis = tenantRedis();
  const key = indexKey(username);
  const existing = (await redis.get(key)) || [];
  const list = Array.isArray(existing) ? existing : [];
  const filtered = list.filter(e => !(e.role === role && e.id === id));
  if (filtered.length > 0) await redis.set(key, filtered);
  else await redis.del(key);
}

// İsim değişiminde indeksi güncelle (eski isimden sil, yeni isme ekle).
export async function updateIndexUsername(oldUsername, newUsername, role, id) {
  const o = String(oldUsername || '').trim().toLowerCase();
  const n = String(newUsername || '').trim().toLowerCase();
  if (o && o !== n) await removeFromIndex(oldUsername, role, id);
  await addToIndex(newUsername, role, id);
}

// Login için: kullanıcı adına ait adayları döndür.
export async function lookupIndex(username) {
  const redis = tenantRedis();
  const existing = (await redis.get(indexKey(username))) || [];
  return Array.isArray(existing) ? existing : [];
}
