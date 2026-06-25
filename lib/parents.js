import bcrypt from 'bcryptjs';
import { tenantRedis } from './tenant';
import { addToIndex, removeFromIndex } from './userIndex';
import { isSqlEnabled } from './usesql';
import { tdb } from './sqldb';

// Veli (parent) — TELEFON-BAZLI kimlik. Bir veli telefonu → o telefonu `parentPhone`
// olarak taşıyan TÜM öğrenciler (kardeşler tek girişte). Kayıt: `parent:<telefon>`.
//   { id: phone, username: phone, passwordHash, mustChangePassword, children:[{id,name,cls}] }
// `parents` (set) → tüm veli telefonları. Telefon kanonik (10 hane, 5 ile başlar).

export function parentKey(phone) {
  return `parent:${phone}`;
}

// Tüm öğrencileri okuyup parentPhone'a göre grupla.
// → Map(phone → { children:[{id,name,cls}], parentName }).
// parentName: o telefondaki öğrenciler arasında DOLU olan ilk veli adı (kardeşlerde
// farklı girilmişse ilki kazanır — pratikte aynı veli, aynı ad).
async function groupStudentsByParentPhone(redis) {
  const map = new Map();
  const ids = await redis.smembers('students');
  if (!ids || ids.length === 0) return map;
  const pipe = redis.pipeline();
  ids.forEach(id => pipe.get(`student:${id}`));
  const recs = await pipe.exec();
  for (const s of recs) {
    if (!s || !s.parentPhone) continue;
    const entry = map.get(s.parentPhone) || { children: [], parentName: '' };
    entry.children.push({ id: s.id, name: s.name, cls: s.cls });
    if (!entry.parentName && s.parentName) entry.parentName = String(s.parentName).trim();
    map.set(s.parentPhone, entry);
  }
  return map;
}

// Müdür "veli erişimini senkronize et" → parent kayıtlarını öğrencilerden yeniden kurar.
// - Yeni veli: ilk şifre = telefonun kendisi, ilk girişte ZORUNLU değişim.
// - Var olan veli: children güncellenir, ŞİFRE KORUNUR.
// - Artık çocuğu kalmayan veli (tüm öğrencileri silinmiş): hesap kaldırılır.
// SQL: öğrencileri parentPhone'a göre grupla (legacy id/name/cls).
async function groupStudentsByParentPhoneSql() {
  const map = new Map();
  const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
  for (const s of rows) {
    if (!s.parentPhone) continue;
    const entry = map.get(s.parentPhone) || { children: [], parentName: '' };
    entry.children.push({ id: s.legacyId, name: s.name, cls: s.class?.legacyId || '' });
    if (!entry.parentName && s.parentName) entry.parentName = String(s.parentName).trim();
    map.set(s.parentPhone, entry);
  }
  return map;
}

export async function syncParents() {
  if (isSqlEnabled()) {
    const map = await groupStudentsByParentPhoneSql();
    const existing = await tdb().parent.findMany();
    const byPhone = new Map(existing.map(p => [p.phone, p]));
    let created = 0, updated = 0, removed = 0;
    for (const [phone, { children, parentName }] of map.entries()) {
      children.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
      const ex = byPhone.get(phone);
      if (ex) {
        await tdb().parent.update({ where: { id: ex.id }, data: { children, name: parentName || ex.name || '' } });
        updated++;
      } else {
        const passwordHash = await bcrypt.hash(phone, 10); // ilk şifre = telefon
        await tdb().parent.create({ data: { phone, passwordHash, mustChangePassword: true, children, name: parentName || '' } });
        // NOT: userIndex (SQL'de login doğrudan sorgular) atlandı → auth göçü.
        created++;
      }
    }
    for (const p of existing) {
      if (!map.has(p.phone)) { await tdb().parent.delete({ where: { id: p.id } }); removed++; }
    }
    const totalChildren = Array.from(map.values()).reduce((s, a) => s + a.children.length, 0);
    const totalStudents = await tdb().student.count();
    return { created, updated, removed, totalParents: map.size, totalChildren, studentsWithoutPhone: totalStudents - totalChildren };
  }

  const redis = tenantRedis();
  const map = await groupStudentsByParentPhone(redis);
  const existingPhones = (await redis.smembers('parents')) || [];

  let created = 0, updated = 0, removed = 0;

  for (const [phone, { children, parentName }] of map.entries()) {
    children.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
    const existing = await redis.get(parentKey(phone));
    if (existing) {
      // Veli adını güncelle (öğrenci formundan değişmiş olabilir); boşsa eskiyi koru.
      await redis.set(parentKey(phone), { ...existing, children, name: parentName || existing.name || '' });
      updated++;
    } else {
      const passwordHash = await bcrypt.hash(phone, 10); // ilk şifre = telefon
      await redis.set(parentKey(phone), {
        id: phone, username: phone, passwordHash,
        mustChangePassword: true, children, name: parentName || '',
      });
      await redis.sadd('parents', phone);
      await addToIndex(phone, 'parent', phone);
      created++;
    }
  }

  // Çocuğu kalmayan velileri temizle
  for (const phone of existingPhones) {
    if (!map.has(phone)) {
      await redis.del(parentKey(phone));
      await redis.srem('parents', phone);
      await removeFromIndex(phone, 'parent', phone);
      removed++;
    }
  }

  const totalChildren = Array.from(map.values()).reduce((s, a) => s + a.children.length, 0);
  const withoutPhone = await countStudentsWithoutParentPhone(redis);
  return { created, updated, removed, totalParents: map.size, totalChildren, studentsWithoutPhone: withoutPhone };
}

async function countStudentsWithoutParentPhone(redis) {
  const ids = await redis.smembers('students');
  if (!ids || ids.length === 0) return 0;
  const pipe = redis.pipeline();
  ids.forEach(id => pipe.get(`student:${id}`));
  const recs = await pipe.exec();
  return recs.filter(s => s && !s.parentPhone).length;
}

// Müdür durum görünümü: kayıtlı veli listesi.
export async function parentsStatus() {
  if (isSqlEnabled()) {
    const rows = await tdb().parent.findMany();
    return rows.map(r => ({
      phone: r.phone, name: r.name || '',
      childrenNames: (r.children || []).map(c => c.name),
      childrenCount: (r.children || []).length,
      mustChangePassword: !!r.mustChangePassword,
    })).sort((a, b) => String(a.phone).localeCompare(String(b.phone)));
  }
  const redis = tenantRedis();
  const phones = (await redis.smembers('parents')) || [];
  if (phones.length === 0) return [];
  const pipe = redis.pipeline();
  phones.forEach(p => pipe.get(parentKey(p)));
  const recs = await pipe.exec();
  return recs.filter(Boolean).map(r => ({
    phone: r.id,
    name: r.name || '',
    childrenNames: (r.children || []).map(c => c.name),
    childrenCount: (r.children || []).length,
    mustChangePassword: !!r.mustChangePassword,
  })).sort((a, b) => String(a.phone).localeCompare(String(b.phone)));
}

// Bir velinin şifresini sıfırla → telefon yeniden geçici şifre olur, ilk girişte değişir.
export async function resetParent(phone) {
  if (isSqlEnabled()) {
    const rec = await tdb().parent.findFirst({ where: { phone } });
    if (!rec) return false;
    await tdb().parent.update({ where: { id: rec.id }, data: { passwordHash: await bcrypt.hash(phone, 10), mustChangePassword: true } });
    return true;
  }
  const redis = tenantRedis();
  const rec = await redis.get(parentKey(phone));
  if (!rec) return false;
  const passwordHash = await bcrypt.hash(phone, 10);
  await redis.set(parentKey(phone), { ...rec, passwordHash, mustChangePassword: true });
  return true;
}
