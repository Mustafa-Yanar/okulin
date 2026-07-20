// FAZ 5 CUTOVER SONRASI çalıştırılır — Faz 1-4'te ASLA --apply ile ÇALIŞTIRMA.
// Önce TÜM programTemplate.etutSablonlari içeriğini yedek dosyasına yazar,
// sonra JSON'dan etutSablonlari anahtarını siler (grid şablonu programTemplate'te kalır).
//
// FIX-A (Faz 5 audit güvenlik rayı): --apply ÖNCESİ en güncel reconcile-apply raporu
// (scripts/backups/etut-migration-report-*.json, mode==='RECONCILE-APPLY') okunur.
// KAYIP-riskli kova (unresolved/invalidSablon/studentIdMissing/writeFailed) DOLU ise
// veya rapor yoksa/okunamıyorsa/yanlış moddaysa, temizlik REDDEDİLİR (exit 1) —
// --force ile yalnız "kayıp-riskli kova dolu" durumu bilinçli geçilebilir; rapor
// eksik/yanlış-mod durumu --force ile de geçilmez. Bu gate JSON'un TEK KOPYASI
// silinmeden önce kalıcı veri kaybını önler.
// Kullanım: node scripts/cleanup-etut-json.mjs [--apply] [--org <slug>] [--report <path>] [--force]
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
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
const reportArg = process.argv.indexOf('--report');
let REPORT_PATH = null;
if (reportArg !== -1) {
  const val = process.argv[reportArg + 1];
  if (!val || val.startsWith('--')) {
    console.error('HATA: --report bir dosya yolu bekliyor');
    process.exit(1);
  }
  REPORT_PATH = val;
}

// En güncel reconcile raporunu bul (--report verilmediyse). Dosya adı
// ISO-timestamp içerdiğinden (etut-migration-report-<ISO>.json) string sıralaması
// kronolojik sıralamayla eşleşir.
function findLatestReportPath() {
  let files;
  try {
    files = readdirSync('scripts/backups');
  } catch {
    return null;
  }
  const candidates = files.filter((f) => /^etut-migration-report-.*\.json$/.test(f)).sort();
  if (!candidates.length) return null;
  return `scripts/backups/${candidates[candidates.length - 1]}`;
}

// Reconcile raporunu oku + doğrula. Dönen: { ok: true, report, path } | { ok: false, reason }
function loadReconcileReport() {
  const path = REPORT_PATH || findLatestReportPath();
  if (!path) return { ok: false, reason: 'reconcile-apply raporu bulunamadı — önce reconcile --apply koş' };
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, reason: `rapor okunamadı (${path}): ${String(e)}` };
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `rapor parse edilemedi (${path}): ${String(e)}` };
  }
  if (report.mode !== 'RECONCILE-APPLY') {
    return { ok: false, reason: `rapor mode='${report.mode}' — RECONCILE-APPLY bekleniyor (${path}); dry-run/eski Faz 1 raporu kabul edilmez` };
  }
  return { ok: true, report, path };
}

// KAYIP-riskli: bu kovalardan biri doluysa, JSON'da olup tabloya AKTARILAMAMIŞ veri var
// demektir — JSON silinirse KALICI KAYIP.
const RISK_BUCKETS = ['unresolved', 'invalidSablon', 'studentIdMissing', 'writeFailed'];
// KAYIPSIZ: tabloda veri zaten var (ya da kasıtlı dokunulmadı) — JSON silmek kayıp değil,
// yalnız bilgilendirme.
const WARN_BUCKETS = ['conflicts', 'tableOnly', 'recurringPresent', 'sablonDeleteSkippedRecent'];

function evaluateReport(report) {
  const risky = RISK_BUCKETS.filter((k) => Array.isArray(report[k]) && report[k].length > 0);
  const warn = WARN_BUCKETS.filter((k) => Array.isArray(report[k]) && report[k].length > 0);
  return { risky, warn };
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

// --- FIX-A: reconcile-apply rapor gate'i — yedekten SONRA, silmeden ÖNCE ---
const gate = loadReconcileReport();
if (!gate.ok) {
  console.log(`Reconcile raporu geçersiz: ${gate.reason}`);
  if (APPLY) {
    console.error(`HATA: ${gate.reason}`);
    await p.$disconnect();
    process.exit(1);
  }
} else {
  const { risky, warn } = evaluateReport(gate.report);
  console.log(`Reconcile raporu: ${gate.path} (mode=${gate.report.mode})`);
  for (const k of warn) console.log(`  UYARI (kayıpsız, cleanup devam eder): ${k}=${gate.report[k].length}`);
  if (risky.length) {
    const summary = risky.map((k) => `${k}=${gate.report[k].length}`).join(', ');
    if (APPLY && !FORCE) {
      console.error(`HATA: kayıp-riskli kovalar dolu (${summary}) — cleanup REDDEDİLDİ. Bilinçli geçmek için --force.`);
      await p.$disconnect();
      process.exit(1);
    } else if (APPLY && FORCE) {
      console.log(`FORCE: kayıp-riskli kovalar görmezden gelindi: ${summary}`);
    } else {
      console.log(`  UYARI (kayıp-riskli — --apply'da REDDEDİLİR, --force gerekir): ${summary}`);
    }
  } else {
    console.log('Kayıp-riskli kova YOK — cleanup güvenli.');
  }
}

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
