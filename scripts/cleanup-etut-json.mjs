// FAZ 5 CUTOVER SONRASI çalıştırılır — Faz 1-4'te ASLA --apply ile ÇALIŞTIRMA.
// Önce TÜM programTemplate.etutSablonlari içeriğini yedek dosyasına yazar,
// sonra JSON'dan etutSablonlari anahtarını siler (grid şablonu programTemplate'te kalır).
// Kullanım: node scripts/cleanup-etut-json.mjs [--apply] [--org <slug>]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const orgArg = process.argv.indexOf('--org');
const ORG = orgArg !== -1 ? process.argv[orgArg + 1] : null;
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

if (!APPLY) { console.log('DRY-RUN — JSON temizlenmedi. Temizlik için --apply.'); await p.$disconnect(); process.exit(0); }

for (const b of backup) {
  const t = await p.teacher.findUnique({ where: { id: b.teacherDbId } });
  const tpl = { ...t.programTemplate };
  delete tpl.etutSablonlari;
  await p.teacher.update({ where: { id: b.teacherDbId }, data: { programTemplate: tpl } });
  console.log(`Temizlendi: ${b.orgSlug} / ${b.name}`);
}
await p.$disconnect();
