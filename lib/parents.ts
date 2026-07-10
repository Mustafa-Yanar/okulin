import bcrypt from 'bcryptjs';
import { tdb, withScope } from './sqldb';

// Veli (parent) — TELEFON-BAZLI kimlik. Bir veli telefonu → o telefonu `parentPhone`
// olarak taşıyan TÜM öğrenciler (kardeşler tek girişte).

// Parent.children Json alanındaki tek çocuk kaydı.
export interface ParentChild {
  id: string;
  name: string;
  cls: string;
}

// Müdür "veli erişimini senkronize et" → parent kayıtlarını öğrencilerden yeniden kurar.
// - Yeni veli: ilk şifre = telefonun kendisi, ilk girişte ZORUNLU değişim.
// - Var olan veli: children güncellenir, ŞİFRE KORUNUR.
// - Artık çocuğu kalmayan veli (tüm öğrencileri silinmiş): hesap kaldırılır.
// öğrencileri parentPhone'a göre grupla (legacy id/name/cls).
async function groupStudentsByParentPhone(): Promise<Map<string, { children: ParentChild[]; parentName: string }>> {
  const map = new Map<string, { children: ParentChild[]; parentName: string }>();
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
  const map = await groupStudentsByParentPhone();
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
      await tdb().parent.create({ data: withScope({ phone, passwordHash, mustChangePassword: true, children, name: parentName || '' }) });
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

// Müdür durum görünümü: kayıtlı veli listesi.
export async function parentsStatus() {
  const rows = await tdb().parent.findMany();
  return rows.map(r => {
    const children = (r.children || []) as unknown as ParentChild[]; // Json alanı — syncParents yazar
    return {
      phone: r.phone, name: r.name || '',
      childrenNames: children.map(c => c.name),
      childrenCount: children.length,
      mustChangePassword: !!r.mustChangePassword,
    };
  }).sort((a, b) => String(a.phone).localeCompare(String(b.phone)));
}

// Bir velinin şifresini sıfırla → telefon yeniden geçici şifre olur, ilk girişte değişir.
export async function resetParent(phone: string): Promise<boolean> {
  const rec = await tdb().parent.findFirst({ where: { phone } });
  if (!rec) return false;
  await tdb().parent.update({ where: { id: rec.id }, data: { passwordHash: await bcrypt.hash(phone, 10), mustChangePassword: true } });
  return true;
}
