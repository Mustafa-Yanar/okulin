// Etüt göçü (Faz 1, spec §7): JSON etutSablonlari → EtutSablon + EtutReservation.
// - DRY-RUN varsayılan; yazmak için --apply. --org <slug> tek kuruma sınırlar.
// - İdempotent: EtutSablon upsert (orgSlug+branch+legacyId ile); EtutReservation
//   varsa (orgSlug+branch+sablonId+weekKey) ATLANIR + raporlanır.
// - JSON'A DOKUNMAZ (temizlik Faz 5 — cleanup-etut-json.mjs).
// Kullanım: set -a; source .env.local; set +a; node scripts/migrate-etut-to-tables.mjs [--apply] [--org akyazicozum]
//
// --reconcile (Faz 5 Task 2): JSON-authoritative senkron modu — cutover öncesi, prod'da
// (henüz eski JSON-yazan sistem canlıyken) JSON'un klasik migrate'ten SONRA drift ettiği
// satırları SQL'e senkronlar + hayalet SlotBooking taraması (rapor-only) yapar. --reconcile
// VERİLMEDİĞİNDE aşağıdaki akış (Faz 1) DEĞİŞMEDEN çalışır. Kullanım:
//   node scripts/migrate-etut-to-tables.mjs --reconcile [--apply] [--org akyazicozum]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';
import {
  classifyReservation, validateSablon, isoWeekKeyTSI,
  reconcileSablonDeletes, reconcileReservationOps,
} from './etut-migration-lib.mjs';

const APPLY = process.argv.includes('--apply');
const RECONCILE = process.argv.includes('--reconcile');
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
  mode: RECONCILE ? (APPLY ? 'RECONCILE-APPLY' : 'RECONCILE-DRY-RUN') : (APPLY ? 'APPLY' : 'DRY-RUN'),
  startedAt: now.toISOString(), org: ORG || 'ALL',
  sablonUpserted: [], reservationPlanned: [], reservationCreated: [], reservationSkippedExisting: [],
  unresolved: [], teachersScanned: 0, invalidSablon: [], studentIdMissing: [],
  writeFailed: [], bookedAtInvalid: [],
  // Faz 5 Task 2: yalnız --reconcile'da doldurulur (mode alanına göre bkz. yukarısı) —
  // --reconcile YOKSA bu alanlar report objesine hiç eklenmez (rapor JSON'u Faz 1 ile
  // birebir aynı şekilde kalır).
  ...(RECONCILE ? {
    sablonSoftDeleted: [], sablonRevived: [], resUpdated: [], resCancelled: [], resSynced: [],
    conflicts: [], tableOnly: [], recurringPresent: [], ghostRows: [], ghostAllTimeCount: 0,
    sablonDeleteSkippedRecent: [],
  } : {}),
};

try {
  const teachers = await p.teacher.findMany(ORG ? { where: { orgSlug: ORG } } : undefined);
  if (RECONCILE) {
    await runReconcile(p, teachers, now, report, APPLY);
  } else {
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

  if (RECONCILE) {
    const planLabel = APPLY ? '' : ' (planlanan)';
    console.log(`\n--- RECONCILE ---`);
    console.log(`Şablon soft-delete${planLabel}: ${report.sablonSoftDeleted.length}`);
    for (const s of report.sablonSoftDeleted) console.log(`  → ${s.org} / ${s.teacher} / ${s.legacyId} (iptal edilen migration-rezervasyon: ${s.cancelledReservations})`);
    console.log(`Soft-delete ATLANDI (son 60 dk'da oluşturulmuş — muhtemel post-deploy tablo-first): ${report.sablonDeleteSkippedRecent.length}`);
    for (const s of report.sablonDeleteSkippedRecent) console.log(`  → ${s.org} / ${s.teacher} / ${s.legacyId} (createdAt=${s.createdAt.toISOString()})`);
    console.log(`Şablon diriltildi (JSON'da yaşıyor, tabloda soft-deleted idi)${planLabel}: ${report.sablonRevived.length}`);
    for (const s of report.sablonRevived) console.log(`  → ${s.org} / ${s.teacher} / ${s.legacyId}`);
    console.log(`Rezervasyon güncellendi${planLabel}: ${report.resUpdated.length}`);
    for (const r of report.resUpdated) console.log(`  → ${r.org} / ${r.teacher} / ${r.sablonLegacyId} / ${r.weekKey} → ${r.studentName} (${r.studentId})`);
    console.log(`Rezervasyon iptal edildi${planLabel}: ${report.resCancelled.length}`);
    for (const r of report.resCancelled) console.log(`  → ${r.org} / ${r.teacher} / ${r.sablonLegacyId} / ${r.weekKey} (${r.reason})`);
    console.log(`Zaten senkron: ${report.resSynced.length}`);
    console.log(`ÇAKIŞMA (dokunulmadı): ${report.conflicts.length}`);
    for (const c of report.conflicts) console.log(`  !! [${c.type}] ${c.org} / ${c.teacher} / ${c.sablonLegacyId} / ${c.weekKey}: json=${c.jsonStudentId ?? '-'} tablo=${c.tableStudentId ?? '-'}`);
    console.log(`Tablo-only (JSON dışı, korunuyor): ${report.tableOnly.length}`);
    for (const t2 of report.tableOnly) console.log(`  !! ${t2.org} / ${t2.teacher} / ${t2.sablonLegacyId} / ${JSON.stringify(t2.weekKeys)}: ${t2.reason}`);
    console.log(`RECURRING satır (karara girmedi, mevcut): ${report.recurringPresent.length}`);
    for (const rp of report.recurringPresent) console.log(`  !! ${rp.org} / ${rp.teacher} / ${rp.sablonLegacyId}: ${rp.count}`);
    console.log(`\nHAYALET SlotBooking taraması (booked+fixed:false+dersBranch:null, weekKey>=cari — eski 'geçici etüt' /api/program yazım yolunun (kaldırıldı: commit 1d19c9c) kalıntısı olduğu belirlendi; RAPOR-ONLY, temizlik YOK): ${report.ghostRows.length}`);
    for (const g of report.ghostRows) console.log(`  !! ${g.orgSlug}/${g.branch} / hafta=${g.weekKey} / gün=${g.dayIndex} / slot=${g.slotId} / öğretmen=${g.teacherId} / öğrenci=${g.studentName ?? '-'} / bookedBy=${g.bookedBy ?? '-'}`);
    console.log(`Hayalet — tüm zamanlar sayımı (booked+fixed:false, hafta filtresi yok): ${report.ghostAllTimeCount}`);
  }

  await p.$disconnect();
}

if (RECONCILE) {
  if (APPLY && (report.conflicts.length || report.unresolved.length || report.writeFailed.length || report.invalidSablon.length || report.studentIdMissing.length)) {
    process.exitCode = 1;
  }
} else if (APPLY && (report.unresolved.length || report.invalidSablon.length || report.writeFailed.length || report.studentIdMissing.length)) {
  process.exitCode = 1;
}

// ---- Faz 5 Task 2: --reconcile akışı ----
// JSON-authoritative senkron: reconcileSablonDeletes/reconcileReservationOps (Task 1, saf/test
// edilmiş) karar mantığını taşır — bu fonksiyon yalnız veri çeker + kararı uygular + raporlar,
// KARAR MANTIĞINI YENİDEN YAZMAZ. Öğretmen başına: (1) tablo-only şablonları soft-delete adayı
// olarak işaretle + iptal, (2) JSON şablonlarını upsert (+diriltme) ve rezervasyonlarını senkronla.
// Sonda tek seferlik hayalet SlotBooking taraması (rapor-only).
async function runReconcile(p, teachers, now, report, APPLY) {
  const currentWeek = isoWeekKeyTSI(now);

  for (const t of teachers) {
    report.teachersScanned++;
    const tpl = t.programTemplate;
    const list = Array.isArray(tpl?.etutSablonlari) ? tpl.etutSablonlari : [];

    // 1) Tablo-only şablonlar: JSON'da id'si OLMAYAN ACTIVE tablo şablonları soft-delete
    // adayı. rawIds bozuk (validateSablon fail eden) JSON girdilerinin id'sini de içerir —
    // JSON'da id'si YAŞAYAN ama şu an malformed bir şablonun tablo eşi yanlışlıkla
    // silinmesin diye (veri kalitesi sorunu ayrı, varlık/yokluk ayrı).
    const rawIds = list.map((sb) => sb?.id).filter((id) => typeof id === 'string' && id);
    const tableSablonlar = await p.etutSablon.findMany({
      where: { orgSlug: t.orgSlug, branch: t.branch, teacherId: t.legacyId },
    });
    const deleteIds = reconcileSablonDeletes(rawIds, tableSablonlar);
    for (const legacyId of deleteIds) {
      const row = tableSablonlar.find((r) => r.legacyId === legacyId);
      // reconcile#2 (runbook: deploy SONRASI koşu) penceresinde yeni kodla tablo-first
      // oluşturulmuş EtutSablon satırlarının JSON'da hiçbir zaman karşılığı olmaz — filtresiz
      // bırakılırsa "JSON'dan silinmiş" sanılıp YANLIŞLIKLA soft-delete adayı olurlar. Runbook
      // penceresi dakikalar sürdüğü için sabit 60dk (createdAt payı) yeterli ve güvenli.
      const RECENT_CREATE_GUARD_MS = 60 * 60 * 1000;
      if (row.createdAt.getTime() > now.getTime() - RECENT_CREATE_GUARD_MS) {
        report.sablonDeleteSkippedRecent.push({ org: t.orgSlug, teacher: t.name, legacyId, createdAt: row.createdAt });
        continue;
      }
      const futureActive = await p.etutReservation.findMany({
        where: { orgSlug: t.orgSlug, branch: t.branch, sablonId: row.id, scope: 'WEEK', weekKey: { gte: currentWeek }, status: 'ACTIVE' },
        orderBy: { weekKey: 'asc' },
      });
      const migRows = futureActive.filter((r) => r.bookedById === 'migration');
      const tableOnlyRows = futureActive.filter((r) => r.bookedById !== 'migration');
      if (APPLY) {
        try {
          // Şablon soft-delete + tüm migration-rezervasyon iptalleri TEK transaction —
          // ortada hata olursa (örn. 3. iptalde) şablon "yarı silinmiş" (soft-deleted ama
          // bazı rezervasyonlar hâlâ ACTIVE) durumda KALMAZ; ikinci reconcile koşusu bu
          // şablonu artık aday saymadığından (deletedAt!==null) yarım durumu asla temizleyemezdi.
          await p.$transaction([
            p.etutSablon.update({ where: { id: row.id, orgSlug: t.orgSlug, branch: t.branch }, data: { deletedAt: now } }),
            ...migRows.map((r) => p.etutReservation.update({
              where: { id: r.id, orgSlug: t.orgSlug, branch: t.branch },
              data: {
                status: 'CANCELLED', cancelledByRole: 'migration', cancelledById: 'reconcile',
                cancelledAt: now, cancelReason: 'cutover-reconcile: şablon JSON kaynağından silinmiş',
              },
            })),
          ]);
        } catch (e) {
          report.writeFailed.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: legacyId, weekKey: null, error: String(e) });
          continue;
        }
      }
      report.sablonSoftDeleted.push({ org: t.orgSlug, teacher: t.name, legacyId, cancelledReservations: migRows.length });
      for (const r of migRows) {
        report.resCancelled.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: legacyId, weekKey: r.weekKey, reason: 'sablon-silindi' });
      }
      if (tableOnlyRows.length) {
        report.tableOnly.push({
          org: t.orgSlug, teacher: t.name, sablonLegacyId: legacyId, weekKeys: tableOnlyRows.map((r) => r.weekKey),
          reason: 'şablon siliniyor, migration-olmayan (post-deploy/smoke) gelecek rezervasyon korunuyor',
        });
      }
    }

    // 2) JSON şablonları: doğrula → upsert (+diriltme) → rezervasyon senkronu.
    for (const sb of list) {
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
      // Diriltme tespiti: upsert'ten ÖNCE oku (upsert deletedAt'i null'a çevirecek).
      const existingSablon = await p.etutSablon.findUnique({
        where: { orgSlug_branch_legacyId: { orgSlug: t.orgSlug, branch: t.branch, legacyId: sb.id } },
      });
      const wasSoftDeleted = !!(existingSablon && existingSablon.deletedAt !== null);
      report.sablonUpserted.push({ org: t.orgSlug, teacher: t.name, legacyId: sb.id, gun: sb.dayIndex, saat: `${sb.start}-${sb.end}` });
      let sablonDb = null;
      if (APPLY) {
        try {
          sablonDb = await p.etutSablon.upsert({
            where: { orgSlug_branch_legacyId: { orgSlug: t.orgSlug, branch: t.branch, legacyId: sb.id } },
            create: sablonRow,
            update: { ...sablonRow, deletedAt: null },
          });
        } catch (e) {
          report.writeFailed.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: null, error: String(e) });
          continue;
        }
      }
      if (wasSoftDeleted) {
        report.sablonRevived.push({ org: t.orgSlug, teacher: t.name, legacyId: sb.id });
      }

      // Rezervasyon senkronu için sablonId: APPLY'da az önce upsert edilen DB satırı;
      // DRY-RUN'da (yazma yok) varsa mevcut satır, yoksa henüz DB'de yok → futureRes boş
      // kalır (reconcileReservationOps zaten 'create' önerir — apply'daki gerçek sonuçla
      // tutarlı önizleme).
      const sablonId = APPLY ? sablonDb.id : existingSablon?.id;
      let futureRes = [];
      if (sablonId) {
        // T1 review kararı: stabil sıra (weekKey asc) — reconcileReservationOps'un
        // active[0] determinizmi buna dayanıyor. Süzme (scope/status/geçmiş-hafta)
        // fonksiyonun kendi işi — burada TÜM satırlar verilir.
        futureRes = await p.etutReservation.findMany({
          where: { orgSlug: t.orgSlug, branch: t.branch, sablonId },
          orderBy: { weekKey: 'asc' },
        });
      }

      const ops = reconcileReservationOps(sb, futureRes, now);
      for (const op of ops) {
        if (op.op === 'none') {
          // Yapılacak bir şey yok — sessiz geç (Faz 1 classifyReservation 'none' ile aynı desen).
        } else if (op.op === 'synced') {
          report.resSynced.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey });
        } else if (op.op === 'recurringPresent') {
          report.recurringPresent.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, count: op.count });
        } else if (op.op === 'unresolved') {
          report.unresolved.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, student: sb.studentName || sb.studentId, reason: op.reason });
        } else if (op.op === 'conflict') {
          report.conflicts.push({
            org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey,
            tableStudentId: op.tableStudentId, jsonStudentId: String(sb.studentId), type: 'conflict',
          });
        } else if (op.op === 'conflict-cancelled') {
          report.conflicts.push({
            org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey,
            jsonStudentId: String(sb.studentId), type: 'conflict-cancelled',
          });
        } else if (op.op === 'conflict-recurring') {
          // FIX-C: create hedefinde table-first RECURRING satır bulundu — gölgeleme yapılmadı,
          // mevcut conflict raporlama desenine uy (böylece FIX-B exit gate de bunu yakalar).
          report.conflicts.push({
            org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey,
            jsonStudentId: String(sb.studentId), type: 'conflict-recurring',
          });
        } else if (op.op === 'tableOnly') {
          report.tableOnly.push({
            org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKeys: op.weekKeys,
            reason: 'JSON öğrencisiz, migration-olmayan (post-deploy/smoke) satır korunuyor',
          });
        } else if (op.op === 'create') {
          let bookedAtDate = sb.bookedAt ? new Date(sb.bookedAt) : now;
          if (Number.isNaN(bookedAtDate.getTime())) {
            report.bookedAtInvalid.push({ org: t.orgSlug, sablonLegacyId: sb.id, raw: sb.bookedAt });
            bookedAtDate = now;
          }
          const resRow = {
            orgSlug: t.orgSlug, branch: t.branch, teacherId: t.legacyId,
            scope: 'WEEK', status: 'ACTIVE', weekKey: op.weekKey,
            studentId: String(sb.studentId), studentName: sb.studentName || '',
            studentCls: sb.studentCls || '', dersBranch: sb.branch || '',
            bookedByRole: sb.bookedBy || 'unknown', bookedById: 'migration',
            bookedAt: bookedAtDate,
            dayIndex: sb.dayIndex, startsAt: sb.start, endsAt: sb.end,
          };
          report.reservationPlanned.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey, student: resRow.studentName, ders: resRow.dersBranch, bookedBy: resRow.bookedByRole });
          if (APPLY) {
            try {
              await p.etutReservation.create({ data: { ...resRow, sablonId: sablonDb.id } });
              report.reservationCreated.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey, student: resRow.studentName, ders: resRow.dersBranch, bookedBy: resRow.bookedByRole });
            } catch (e) {
              report.writeFailed.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey, error: String(e) });
            }
          }
        } else if (op.op === 'update') {
          if (APPLY) {
            try {
              await p.etutReservation.update({
                where: { orgSlug_branch_sablonId_weekKey: { orgSlug: t.orgSlug, branch: t.branch, sablonId, weekKey: op.weekKey } },
                data: {
                  studentId: op.studentId, studentName: op.studentName,
                  studentCls: op.studentCls, dersBranch: op.dersBranch, bookedByRole: op.bookedByRole,
                  // bookedAt BİLEREK dokunulmuyor — satırın orijinal rezervasyon tarihçesi korunur.
                },
              });
            } catch (e) {
              report.writeFailed.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey, error: String(e) });
              continue;
            }
          }
          report.resUpdated.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: op.weekKey, studentId: op.studentId, studentName: op.studentName });
        } else if (op.op === 'cancel') {
          for (const wk of op.weekKeys) {
            if (APPLY) {
              try {
                await p.etutReservation.update({
                  where: { orgSlug_branch_sablonId_weekKey: { orgSlug: t.orgSlug, branch: t.branch, sablonId, weekKey: wk } },
                  data: {
                    status: 'CANCELLED', cancelledByRole: 'migration', cancelledById: 'reconcile',
                    cancelledAt: now, cancelReason: 'cutover-reconcile: JSON kaynağında rezervasyon yok',
                  },
                });
              } catch (e) {
                report.writeFailed.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: wk, error: String(e) });
                continue;
              }
            }
            report.resCancelled.push({ org: t.orgSlug, teacher: t.name, sablonLegacyId: sb.id, weekKey: wk, reason: 'json-studentsiz' });
          }
        }
      }
    }
  }

  // 3) Hayalet tarama (Codex O6 + Faz4 T5 notu — RAPOR-ONLY, temizlik YOK).
  // Arkeoloji: `git log -S "type: 'etut'" -- app/api/program` → commit 1d19c9c
  // ("Y3 kapandı — program route etüt dalları kaldırıldı") eski 'geçici etüt' POST
  // dalını gösterdi: cell = { booked:true, disabled:false, studentId, studentName,
  // studentCls, bookedBy:'director', fixed:false } — rowData'da dersBranch HER ZAMAN
  // null'a sabitleniyordu (entry tipinden bağımsız, program/route.ts eski satır ~201).
  // Buna karşın canlı/legit kaynak (/api/slots POST, route.ts:358-368) booked+fixed:false
  // yazarken dersBranch'i HER ZAMAN gerçek bir şube değerine (bookingBranch) set ediyor.
  // Yani booked:true+fixed:false+dersBranch:null artık İMKANSIZ bir 'canlı' kombinasyon —
  // ya o eski yazım yolunun kalıntısı, ya da initWeekForTeacher'ın "Geçici etüt
  // rezervasyonunu koru" satırı (lib/slots.ts computeCellFromEntry, existing.booked &&
  // existing.fixed===false → existing) yüzünden her hafta yeniden üretilen aynı kalıntı.
  // → Filtre bu bulguyla daraltıldı (brief'in "bulunursa filtre daraltılır" dalı).
  const orgFilter = ORG ? { orgSlug: ORG } : {};
  const ghostRows = await p.slotBooking.findMany({
    where: { ...orgFilter, booked: true, fixed: false, weekKey: { gte: currentWeek }, dersBranch: null },
    select: { orgSlug: true, branch: true, weekKey: true, slotId: true, dayIndex: true, teacherId: true, studentName: true, bookedBy: true },
  });
  report.ghostRows = ghostRows;
  report.ghostAllTimeCount = await p.slotBooking.count({ where: { ...orgFilter, booked: true, fixed: false } });
}
