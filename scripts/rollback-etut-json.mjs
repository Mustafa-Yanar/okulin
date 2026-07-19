// Cleanup yedeğini geri yükler: etutSablonlari anahtarını JSON'a geri yazar.
// Kullanım: node scripts/rollback-etut-json.mjs scripts/backups/etut-json-backup-<...>.json --apply
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const backupPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!backupPath) { console.error('Kullanım: node scripts/rollback-etut-json.mjs <backupPath> [--apply]'); process.exit(1); }
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const p = new PrismaClient();

for (const b of backup) {
  console.log(`${APPLY ? 'GERİ YÜKLENİYOR' : 'DRY-RUN'}: ${b.orgSlug} / ${b.name} (${b.etutSablonlari.length} şablon)`);
  if (!APPLY) continue;
  const t = await p.teacher.findUnique({ where: { id: b.teacherDbId } });
  await p.teacher.update({
    where: { id: b.teacherDbId },
    data: { programTemplate: { ...t.programTemplate, etutSablonlari: b.etutSablonlari } },
  });
}
console.log(`${backup.length} öğretmen işlendi (${APPLY ? 'APPLY' : 'dry-run'}).`);
await p.$disconnect();
