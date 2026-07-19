// Etüt göçü (Faz 1, spec §7): JSON etutSablonlari → EtutSablon + EtutReservation.
// - DRY-RUN varsayılan; yazmak için --apply. --org <slug> tek kuruma sınırlar.
// - İdempotent: EtutSablon upsert (orgSlug+branch+legacyId ile); EtutReservation
//   varsa (orgSlug+branch+sablonId+weekKey) ATLANIR + raporlanır.
// - JSON'A DOKUNMAZ (temizlik Faz 5 — cleanup-etut-json.mjs).
// Kullanım: set -a; source .env.local; set +a; node scripts/migrate-etut-to-tables.mjs [--apply] [--org akyazicozum]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';
import { classifyReservation, validateSablon } from './etut-migration-lib.mjs';

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
const now = new Date();

const report = {
  mode: APPLY ? 'APPLY' : 'DRY-RUN', startedAt: now.toISOString(), org: ORG || 'ALL',
  sablonUpserted: [], reservationPlanned: [], reservationCreated: [], reservationSkippedExisting: [],
  unresolved: [], teachersScanned: 0, invalidSablon: [], studentIdMissing: [],
  writeFailed: [], bookedAtInvalid: [],
};

try {
  const teachers = await p.teacher.findMany(ORG ? { where: { orgSlug: ORG } } : undefined);
  for (const t of teachers) {
    report.teachersScanned++;
    const tpl = t.programTemplate;
    const list = Array.isArray(tpl?.etutSablonlari) ? tpl.etutSablonlari : [];
    for (const sb of list) {
      // Şablon doğrulaması — bozuk kayıt sessiz geçilmez.
      const v = validateSablon(sb);
      if (!v.ok) {
        report.invalidSablon.push({ org: t.orgSlug, teacher: t.name, reason: v.reason, sb });
        continue;
      }
      const sablonRow = {
        orgSlug: t.orgSlug, branch: t.branch, teacherId: t.legacyId, legacyId: sb.id,
        dayIndex: sb.dayIndex, start: sb.start, end: sb.end,
        aktif: sb.aktif !== false,
        pasifHaftalar: Array.isArray(sb.pasifHaftalar) ? sb.pasifHaftalar : [],
      };
      report.sablonUpserted.push({ org: t.orgSlug, teacher: t.name, legacyId: sb.id, gun: sb.dayIndex, saat: `${sb.start}-${sb.end}` });
      let sablonDb = null;
      if (APPLY) {
        try {
          sablonDb = await p.etutSablon.upsert({
            where: { orgSlug_branch_legacyId: { orgSlug: t.orgSlug, branch: t.branch, legacyId: sb.id } },
            create: sablonRow,
            update: { ...sablonRow },
          });
        } catch (e) {
          report.writeFailed.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: null, error: String(e) });
          continue;
        }
      }

      const cls = classifyReservation(sb, now);
      if (cls.action === 'none') {
        if (!sb.studentId && (sb.studentName || sb.bookedBy)) {
          report.studentIdMissing.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, studentName: sb.studentName ?? null });
        }
        continue;
      }
      if (cls.action === 'unresolved') {
        report.unresolved.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, student: sb.studentName || sb.studentId, reason: cls.reason });
        continue;
      }
      // migrate → tek-haftalık ACTIVE rezervasyon
      let bookedAtDate = sb.bookedAt ? new Date(sb.bookedAt) : now;
      if (Number.isNaN(bookedAtDate.getTime())) {
        report.bookedAtInvalid.push({ org: t.orgSlug, sablonLegacyId: sb.id, raw: sb.bookedAt });
        bookedAtDate = now;
      }

      // Var olan rezervasyon kontrolü: APPLY'da DB cuid (sablonDb.id) ile, DRY-RUN'da
      // henüz DB satırı garanti olmadığından legacyId üzerinden ilişki filtresiyle.
      const existing = APPLY
        ? await p.etutReservation.findUnique({
            where: { orgSlug_branch_sablonId_weekKey: { orgSlug: t.orgSlug, branch: t.branch, sablonId: sablonDb.id, weekKey: cls.weekKey } },
          })
        : await p.etutReservation.findFirst({
            where: { orgSlug: t.orgSlug, branch: t.branch, sablon: { legacyId: sb.id }, weekKey: cls.weekKey },
          });
      if (existing) {
        report.reservationSkippedExisting.push({ org: t.orgSlug, sablonLegacyId: sb.id, weekKey: cls.weekKey, existingStudent: existing.studentName });
        continue;
      }

      const resRow = {
        orgSlug: t.orgSlug, branch: t.branch, teacherId: t.legacyId,
        scope: 'WEEK', status: 'ACTIVE', weekKey: cls.weekKey,
        studentId: String(sb.studentId), studentName: sb.studentName || '',
        studentCls: sb.studentCls || '', dersBranch: sb.branch || '',
        bookedByRole: sb.bookedBy || 'unknown', bookedById: 'migration',
        bookedAt: bookedAtDate,
        dayIndex: sb.dayIndex, startsAt: sb.start, endsAt: sb.end,
      };
      report.reservationPlanned.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: cls.weekKey, student: resRow.studentName, ders: resRow.dersBranch, bookedBy: resRow.bookedByRole });
      if (APPLY) {
        try {
          await p.etutReservation.create({ data: { ...resRow, sablonId: sablonDb.id } });
          report.reservationCreated.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: cls.weekKey, student: resRow.studentName, ders: resRow.dersBranch, bookedBy: resRow.bookedByRole });
        } catch (e) {
          report.writeFailed.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: cls.weekKey, error: String(e) });
          continue;
        }
      }
    }
  }
} finally {
  mkdirSync('scripts/backups', { recursive: true });
  const reportPath = `scripts/backups/etut-migration-report-${now.toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n=== ETÜT GÖÇÜ ${report.mode} ===`);
  console.log(`Öğretmen tarandı: ${report.teachersScanned}`);
  console.log(`Şablon upsert: ${report.sablonUpserted.length}`);
  console.log(`Rezervasyon planlandı: ${report.reservationPlanned.length}`);
  for (const r of report.reservationPlanned) console.log(`  → ${r.org} / ${r.teacher} / ${r.weekKey} / ${r.student} (${r.ders}) [bookedBy=${r.bookedBy}]`);
  if (APPLY) {
    console.log(`Rezervasyon oluşturuldu: ${report.reservationCreated.length}`);
  }
  console.log(`Var olduğu için atlanan: ${report.reservationSkippedExisting.length}`);
  console.log(`UNRESOLVED: ${report.unresolved.length}`);
  for (const u of report.unresolved) console.log(`  !! ${u.org} / ${u.teacher} / ${u.student}: ${u.reason}`);
  console.log(`Bozuk şablon: ${report.invalidSablon.length}`);
  for (const inv of report.invalidSablon) console.log(`  !! ${inv.org} / ${inv.teacher}: ${inv.reason}`);
  console.log(`studentId eksik (isim/bookedBy var): ${report.studentIdMissing.length}`);
  for (const s of report.studentIdMissing) console.log(`  !! ${s.org} / ${s.teacher} / ${s.sablonLegacyId}: ${s.studentName}`);
  console.log(`bookedAt geçersiz: ${report.bookedAtInvalid.length}`);
  for (const b of report.bookedAtInvalid) console.log(`  !! ${b.org} / ${b.sablonLegacyId}: raw=${JSON.stringify(b.raw)}`);
  console.log(`Yazma hatası: ${report.writeFailed.length}`);
  for (const w of report.writeFailed) console.log(`  !! ${w.org} / ${w.teacher} / ${w.sablonLegacyId} (${w.weekKey}): ${w.error}`);
  console.log(`Rapor: ${reportPath}`);
  await p.$disconnect();
}

if (APPLY && (report.unresolved.length || report.invalidSablon.length || report.writeFailed.length || report.studentIdMissing.length)) {
  process.exitCode = 1;
}
