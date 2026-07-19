// FAZ 5 CUTOVER SONRASI çalıştırılır — Faz 1-4'te ASLA --apply ile ÇALIŞTIRMA.
// Önce TÜM programTemplate.etutSablonlari içeriğini yedek dosyasına yazar,
// sonra JSON'dan etutSablonlari anahtarını siler (grid şablonu programTemplate'te kalır).
// Kullanım: node scripts/cleanup-etut-json.mjs [--apply] [--org <slug>]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const orgArg = process.argv.indexOf('--org');
let ORG = null;
if (orgArg !== -1) {
  const val = process.argv[orgArg + 1];
  if (!val || val.startsWith('--')) {
    console.error('HATA: --org bir değer bekliyor');
    process.exit(1);
  }
  ORG = val;
}
const p = new PrismaClient();

const backup = [];
const teachers = await p.teacher.findMany(ORG ? { where: { orgSlug: ORG } } : undefined);
for (const t of teachers) {
  const tpl = t.programTemplate;
  if (!Array.isArray(tpl?.etutSablonlari) || tpl.etutSablonlari.length === 0) continue;
  backup.push({ teacherDbId: t.id, orgSlug: t.orgSlug, branch: t.branch, legacyId: t.legacyId, name: t.name, etutSablonlari: tpl.etutSablonlari });
}

mkdirSync('scripts/backups', { recursive: true });
const path = `scripts/backups/etut-json-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(path, JSON.stringify(backup, null, 2));
console.log(`Yedek: ${path} (${backup.length} öğretmen)`);

let ok = 0, skipped = 0, failed = 0;

if (!APPLY) {
  console.log('DRY-RUN — JSON temizlenmedi. Temizlik için --apply.');
  console.log(`Özet: ${backup.length} tarandı, 0 temizlenecek (dry-run).`);
  await p.$disconnect();
  process.exit(0);
}

for (const b of backup) {
  try {
    const t = await p.teacher.findUnique({ where: { id: b.teacherDbId } });
    if (!t) {
      console.log(`ATLANDI (öğretmen silinmiş): ${b.orgSlug} / ${b.name}`);
      skipped++;
      continue;
    }
    const tpl = { ...t.programTemplate };
    delete tpl.etutSablonlari;
    await p.teacher.update({ where: { id: b.teacherDbId }, data: { programTemplate: tpl } });
    console.log(`Temizlendi: ${b.orgSlug} / ${b.name}`);
    ok++;
  } catch (e) {
    console.log(`HATA: ${b.orgSlug} / ${b.name}: ${String(e)}`);
    failed++;
  }
}
console.log(`Özet: ${ok} başarılı, ${skipped} atlandı, ${failed} hata.`);
if (failed > 0) process.exitCode = 1;
await p.$disconnect();
