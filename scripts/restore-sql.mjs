// okulin SQL (PostgreSQL/Prisma) RESTORE — /api/backup'ın sql-v1 dökümünden geri yükleme.
// Neon Free 6 saat PITR boşluğunu kapatan soğuk yedeğin EŞLENİĞİ: yedeği gerçekten
// kullanılabilir kılar (yedek almak ≠ geri yükleyebilmek).
//
// Yedek formatı (sql-v1): { snapshotAt, rowCount, format:'sql-v1', tables: { Model: [rows...] } }
//   ← /api/backup (backups-sql/YYYY-MM-DD.json)
//
// Kullanım:
//   # 1) GitHub yedeğini indir:
//   gh api repos/<owner>/<repo>/contents/backups-sql/2026-06-27.json --jq .content \
//     | base64 -d > tmp/sql-dump.json
//
//   # 2) DRY-RUN (ne yapacağını sayar, hiçbir şey yazmaz — VARSAYILAN):
//   DATABASE_URL=… node scripts/restore-sql.mjs --file=tmp/sql-dump.json
//
//   # 3) GERÇEK restore (DİKKAT: --flush tüm tabloları SİLER sonra yükler):
//   DATABASE_URL=… node scripts/restore-sql.mjs --file=tmp/sql-dump.json --write --flush
//
//   # 4) Tek tablo (örn. yanlışlıkla silinen kurumu kurtar):
//   DATABASE_URL=… node scripts/restore-sql.mjs --file=… --write --only=Org,Branch,Director
//
// Bayraklar:
//   --file=PATH  : yedek dosyası (zorunlu)
//   --write      : GERÇEKTEN yaz. YOKSA dry-run.
//   --flush      : yüklemeden önce hedef tabloları TEMİZLE (idempotent restore; FK sırasıyla ters siler)
//   --only=A,B   : yalnız bu modelleri geri yükle (FK sırası korunur)
//
// Güvenlik: --write olmadan ASLA yazmaz. Yazma ayrıca hedefe göre açık onay değişkeni ister.
// Yerel otomatik tatbikat yalnız okulin_test* DB + okulin_restore_* şemasında çalışır.

import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));

const WRITE = !!args.write;
const FLUSH = !!args.flush;
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',').map((s) => s.trim())) : null;

if (typeof args.file !== 'string') { console.error('HATA: --file=PATH gerekli.'); process.exit(1); }

function assertWriteTarget() {
  const raw = process.env.DATABASE_POSTGRES_PRISMA_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('Yazma hedefi veritabanı adresi tanımlı değil.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Yazma hedefi geçerli bir PostgreSQL adresi değil.'); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const schema = url.searchParams.get('schema') || 'public';
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  const localDrill = local && database.startsWith('okulin_test') && schema.startsWith('okulin_restore_')
    && process.env.OKULIN_TEST_DB_GUARDED === 'YES'
    && process.env.OKULIN_SQL_RESTORE_CONFIRMED === 'LOCAL_RESTORE_DRILL_CONFIRMED';
  const manualConfirmed = process.env.OKULIN_SQL_RESTORE_CONFIRMED === 'I_UNDERSTAND_RESTORE_OVERWRITES_DATA';
  if (!localDrill && !manualConfirmed) {
    throw new Error('GÜVENLİK KİLİDİ: SQL restore yazması için hedefe uygun açık onay değişkeni gerekli.');
  }
  return { host: url.hostname, database, schema, localDrill };
}

let writeTarget = null;
if (WRITE) {
  try { writeTarget = assertWriteTarget(); }
  catch (e) { console.error(`HATA: ${e.message}`); process.exit(1); }
}

// ── Yedeği oku ───────────────────────────────────────────────────────────────
let parsed;
try { parsed = JSON.parse(readFileSync(args.file, 'utf-8')); }
catch (e) { console.error('HATA: JSON ayrıştırılamadı:', e.message); process.exit(1); }
if (parsed.format !== 'sql-v1') { console.error(`HATA: format 'sql-v1' bekleniyor, '${parsed.format}' bulundu.`); process.exit(1); }
const tables = parsed.tables || {};

// ── dmmf: model meta (FK sırası + DateTime alanları) ─────────────────────────
const dmmfModels = Prisma.dmmf.datamodel.models;
const modelByName = Object.fromEntries(dmmfModels.map((m) => [m.name, m]));

// DateTime alanları: JSON'dan gelen ISO string'leri Date'e çevirmek için.
function dateFields(name) {
  return (modelByName[name]?.fields || []).filter((f) => f.type === 'DateTime').map((f) => f.name);
}
// Skaler olmayan (relation) alanlar: createMany'ye verilemez, ayıkla.
function scalarOnly(name, row) {
  const fields = modelByName[name]?.fields || [];
  const scalarNames = new Set(fields.filter((f) => f.kind !== 'object').map((f) => f.name));
  const dfs = new Set(dateFields(name));
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!scalarNames.has(k)) continue;            // relation alanını atla
    out[k] = (dfs.has(k) && typeof v === 'string') ? new Date(v) : v;
  }
  return out;
}

// FK sırası: bir model, "object" (relation) alanı zorunlu bağımlılık olan modellerden SONRA gelmeli.
// Basit topolojik sıralama (dmmf relation'larından). Kendine-referans ihmal edilir.
function topoOrder(names) {
  const deps = {}; // model -> bağımlı olduğu modeller
  for (const n of names) {
    deps[n] = new Set();
    for (const f of modelByName[n]?.fields || []) {
      // bu model, f.relationFromFields varsa (FK bu tarafta) → f.type modeline bağımlı
      if (f.kind === 'object' && f.relationFromFields?.length && f.type !== n && names.includes(f.type)) {
        deps[n].add(f.type);
      }
    }
  }
  const order = [];
  const seen = new Set();
  const visit = (n, stack = new Set()) => {
    if (seen.has(n)) return;
    if (stack.has(n)) return; // döngü → kır
    stack.add(n);
    for (const d of deps[n]) visit(d, stack);
    seen.add(n); order.push(n);
  };
  for (const n of names) visit(n);
  return order;
}

const allNames = Object.keys(tables).filter((n) => modelByName[n] && (!ONLY || ONLY.has(n)));
const loadOrder = topoOrder(allNames);
const deleteOrder = [...loadOrder].reverse(); // çocuklar önce silinir

const prisma = new PrismaClient();

console.error(`Yedek: ${parsed.snapshotAt} | ${parsed.rowCount} satır | ${allNames.length} tablo${ONLY ? ' (--only)' : ''}`);
console.error(`Mod: ${WRITE ? 'YAZMA' : 'dry-run (yazma yok)'}${FLUSH ? ' +flush (önce SİLER)' : ''}`);
if (writeTarget) console.error(`Hedef: ${writeTarget.host}/${writeTarget.database}?schema=${writeTarget.schema}${writeTarget.localDrill ? ' (izole yerel tatbikat)' : ''}`);
console.error(`Yükleme sırası: ${loadOrder.join(' → ')}`);
console.error('');

let totalWritten = 0, totalDeleted = 0, errors = 0;

try {
  if (WRITE) {
    // Flush + tüm yükleme TEK transaction: bir tablo bile başarısızsa hedef yarım kalmaz.
    await prisma.$transaction(async (tx) => {
      if (FLUSH) {
        for (const name of deleteOrder) {
          const prop = name.charAt(0).toLowerCase() + name.slice(1);
          const r = await tx[prop].deleteMany({});
          totalDeleted += r.count;
          console.error(`  flush ${name}: ${r.count} silindi`);
        }
        console.error('');
      }
      for (const name of loadOrder) {
        const prop = name.charAt(0).toLowerCase() + name.slice(1);
        const rows = (tables[name] || []).map((r) => scalarOnly(name, r));
        if (!rows.length) { console.error(`  ${name}: 0 satır (atlandı)`); continue; }
        const r = await tx[prop].createMany({ data: rows, skipDuplicates: !FLUSH });
        totalWritten += r.count;
        console.error(`  ${name}: ${r.count}/${rows.length} yüklendi`);
      }
    }, { maxWait: 10_000, timeout: 120_000 });
  } else {
    // Dry-run: mevcut hedef sayıları ve yedekteki yük miktarı; hiçbir yazma yok.
    if (FLUSH) {
      for (const name of deleteOrder) {
        const prop = name.charAt(0).toLowerCase() + name.slice(1);
        const count = await prisma[prop].count();
        console.error(`  [dry] flush ${name}: ${count} silinecek`);
      }
      console.error('');
    }
    for (const name of loadOrder) {
      const rows = tables[name] || [];
      console.error(rows.length ? `  [dry] ${name}: ${rows.length} yüklenecek` : `  ${name}: 0 satır (atlandı)`);
    }
  }
} catch (e) {
  errors = 1;
  totalWritten = 0;
  totalDeleted = 0;
  console.error(`RESTORE GERİ ALINDI: ${e.message.split('\n')[0]}`);
} finally {
  await prisma.$disconnect();
}

console.error('');
console.error(`Bitti. ${WRITE ? `${totalWritten} satır yüklendi, ${totalDeleted} silindi, ${errors} hata` : 'dry-run — hiçbir şey yazılmadı (--write ile çalıştır)'}`);
if (errors > 0) process.exit(1);
