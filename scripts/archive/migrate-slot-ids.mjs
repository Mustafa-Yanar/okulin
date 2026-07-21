// ═══ ARŞİVLENMİŞ SCRIPT (2026-07-22 büyük temizlik B8) — ÇALIŞTIRMA ═══
// Görevi tamamlandı (7-gün slot id göçü 2026-07'de bitti, canlı veri yeni formatta).
// DİKKAT: --dry bayrağı OPSİYONEL — bayraksız koşum doğrudan YAZAR; ikinci koşum
// slotId'leri bozabilir. Bilinçli çalıştırmak için aşağıdaki iki satırı silin.
// Gerekçe: docs/superpowers/specs/2026-07-22-buyuk-temizlik-faz1-harita.md (B8)
console.error('⛔ ARŞİV script — çalıştırma engellendi (bkz dosya başı yorumu).');
process.exit(1);

// Slot id migrasyonu — eski (w{n}/e{n}) → yeni güne-özgü (d{gün}s{n}).
//
// 7-gün bağımsız slot modeline geçişte (2026-07) slot id'leri güne özgü oldu.
// Eski veri: programTemplate {gün: {"w1":entry,...}} + SlotBooking.slotId="w1".
// Yeni: {gün: {"d{gün}s1":entry,...}} + slotId="d0s1".
//
// programTemplate ASIL veridir (öğretmen şablonu); SlotBooking türev (initWeekForTeacher
// yeniden üretir) ama tutarlılık için o da güncellenir.
//
// Kullanım:
//   node scripts/migrate-slot-ids.mjs            # tüm org/branch
//   node scripts/migrate-slot-ids.mjs --dry      # sadece rapor, yazma yok
//
// DATABASE_URL env gerekli (Vercel Postgres / Prisma).

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

// Eski id'yi yeni id'ye çevir. gün anahtarı context'ten (programTemplate'te gün = obje anahtarı).
function migrateId(oldId, dayIndex) {
  const m = /^[we](\d+)$/.exec(oldId);
  return m ? `d${dayIndex}s${m[1]}` : oldId;
}

// programTemplate {gün: {slotId: entry}} → id'leri migrate et. etutSablonlari dokunma.
function migrateTemplate(tmpl) {
  if (!tmpl || typeof tmpl !== 'object') return { changed: false, tmpl };
  let changed = false;
  const out = {};
  for (const [key, val] of Object.entries(tmpl)) {
    // Gün anahtarları "0".."6"; etutSablonlari gibi diğer anahtarlar aynen kopyalanır.
    const dayIndex = /^[0-6]$/.test(key) ? parseInt(key, 10) : null;
    if (dayIndex === null || !val || typeof val !== 'object') { out[key] = val; continue; }
    const newDay = {};
    for (const [slotId, entry] of Object.entries(val)) {
      const newId = migrateId(slotId, dayIndex);
      if (newId !== slotId) changed = true;
      newDay[newId] = entry;
    }
    out[key] = newDay;
  }
  return { changed, tmpl: out };
}

async function main() {
  console.log(`Slot id migrasyonu başlıyor${DRY ? ' (DRY RUN)' : ''}...`);

  // 1) Öğretmen programTemplate
  const teachers = await prisma.teacher.findMany({ where: { programTemplate: { not: null } } });
  let tplChanged = 0;
  for (const t of teachers) {
    const { changed, tmpl } = migrateTemplate(t.programTemplate);
    if (changed) {
      tplChanged++;
      console.log(`  [template] ${t.orgSlug}/${t.branch} ${t.name} → migrate`);
      if (!DRY) await prisma.teacher.update({ where: { id: t.id }, data: { programTemplate: tmpl } });
    }
  }
  console.log(`programTemplate: ${tplChanged}/${teachers.length} öğretmen güncellendi.`);

  // 2) SlotBooking.slotId (türev; günün dayIndex'i satırda mevcut)
  const bookings = await prisma.slotBooking.findMany({ where: { slotId: { startsWith: 'w' } } });
  const bookingsE = await prisma.slotBooking.findMany({ where: { slotId: { startsWith: 'e' } } });
  const allOld = [...bookings, ...bookingsE];
  let bkChanged = 0;
  for (const b of allOld) {
    const newId = migrateId(b.slotId, b.dayIndex);
    if (newId !== b.slotId) {
      bkChanged++;
      if (!DRY) await prisma.slotBooking.update({ where: { id: b.id }, data: { slotId: newId } });
    }
  }
  console.log(`SlotBooking: ${bkChanged}/${allOld.length} satır güncellendi.`);

  console.log(DRY ? 'DRY RUN bitti (hiçbir şey yazılmadı).' : 'Migrasyon tamamlandı.');
}

main()
  .catch((e) => { console.error('HATA:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
