// Etüt göçü (Faz 1, spec §7): JSON etutSablonlari → EtutSablon + EtutReservation.
// - DRY-RUN varsayılan; yazmak için --apply. --org <slug> tek kuruma sınırlar.
// - İdempotent: EtutSablon upsert (id korunur); EtutReservation varsa ATLANIR + raporlanır.
// - JSON'A DOKUNMAZ (temizlik Faz 5 — cleanup-etut-json.mjs).
// Kullanım: set -a; source .env.local; set +a; node scripts/migrate-etut-to-tables.mjs [--apply] [--org akyazicozum]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';
import { classifyReservation } from './etut-migration-lib.mjs';

const APPLY = process.argv.includes('--apply');
const orgArg = process.argv.indexOf('--org');
const ORG = orgArg !== -1 ? process.argv[orgArg + 1] : null;
const p = new PrismaClient();
const now = new Date();

const report = {
  mode: APPLY ? 'APPLY' : 'DRY-RUN', startedAt: now.toISOString(), org: ORG || 'ALL',
  sablonUpserted: [], reservationCreated: [], reservationSkippedExisting: [],
  unresolved: [], teachersScanned: 0, invalidSablon: [],
};

const teachers = await p.teacher.findMany(ORG ? { where: { orgSlug: ORG } } : undefined);
for (const t of teachers) {
  report.teachersScanned++;
  const tpl = t.programTemplate;
  const list = Array.isArray(tpl?.etutSablonlari) ? tpl.etutSablonlari : [];
  for (const sb of list) {
    // Şablon doğrulaması — bozuk kayıt sessiz geçilmez.
    if (!sb.id || typeof sb.dayIndex !== 'number' || !sb.start || !sb.end) {
      report.invalidSablon.push({ org: t.orgSlug, teacher: t.name, sb });
      continue;
    }
    const sablonRow = {
      id: sb.id, orgSlug: t.orgSlug, branch: t.branch, teacherId: t.legacyId,
      dayIndex: sb.dayIndex, start: sb.start, end: sb.end,
      aktif: sb.aktif !== false,
      pasifHaftalar: Array.isArray(sb.pasifHaftalar) ? sb.pasifHaftalar : [],
    };
    report.sablonUpserted.push({ org: t.orgSlug, teacher: t.name, id: sb.id, gun: sb.dayIndex, saat: `${sb.start}-${sb.end}` });
    if (APPLY) {
      const { id, ...rest } = sablonRow;
      await p.etutSablon.upsert({ where: { id }, create: sablonRow, update: rest });
    }

    const cls = classifyReservation(sb, now);
    if (cls.action === 'none') continue;
    if (cls.action === 'unresolved') {
      report.unresolved.push({ org: t.orgSlug, teacher: t.name, sablonId: sb.id, student: sb.studentName || sb.studentId, reason: cls.reason });
      continue;
    }
    // migrate → tek-haftalık ACTIVE rezervasyon
    const resRow = {
      orgSlug: t.orgSlug, branch: t.branch, sablonId: sb.id, teacherId: t.legacyId,
      scope: 'WEEK', status: 'ACTIVE', weekKey: cls.weekKey,
      studentId: sb.studentId, studentName: sb.studentName || '',
      studentCls: sb.studentCls || '', dersBranch: sb.branch || '',
      bookedByRole: sb.bookedBy || 'unknown', bookedById: 'migration',
      bookedAt: sb.bookedAt ? new Date(sb.bookedAt) : now,
      dayIndex: sb.dayIndex, startsAt: sb.start, endsAt: sb.end,
    };
    const existing = await p.etutReservation.findFirst({
      where: { orgSlug: t.orgSlug, branch: t.branch, sablonId: sb.id, weekKey: cls.weekKey },
    });
    if (existing) {
      report.reservationSkippedExisting.push({ org: t.orgSlug, sablonId: sb.id, weekKey: cls.weekKey, existingStudent: existing.studentName });
      continue;
    }
    report.reservationCreated.push({ org: t.orgSlug, teacher: t.name, sablonId: sb.id, weekKey: cls.weekKey, student: resRow.studentName, ders: resRow.dersBranch, bookedBy: resRow.bookedByRole });
    if (APPLY) await p.etutReservation.create({ data: resRow });
  }
}

mkdirSync('scripts/backups', { recursive: true });
const reportPath = `scripts/backups/etut-migration-report-${now.toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n=== ETÜT GÖÇÜ ${report.mode} ===`);
console.log(`Öğretmen tarandı: ${report.teachersScanned}`);
console.log(`Şablon upsert: ${report.sablonUpserted.length}`);
console.log(`Rezervasyon oluşturuldu: ${report.reservationCreated.length}`);
for (const r of report.reservationCreated) console.log(`  → ${r.org} / ${r.teacher} / ${r.weekKey} / ${r.student} (${r.ders}) [bookedBy=${r.bookedBy}]`);
console.log(`Var olduğu için atlanan: ${report.reservationSkippedExisting.length}`);
console.log(`UNRESOLVED: ${report.unresolved.length}`);
for (const u of report.unresolved) console.log(`  !! ${u.org} / ${u.teacher} / ${u.student}: ${u.reason}`);
console.log(`Bozuk şablon: ${report.invalidSablon.length}`);
console.log(`Rapor: ${reportPath}`);
await p.$disconnect();
