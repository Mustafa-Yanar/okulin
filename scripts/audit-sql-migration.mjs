#!/usr/bin/env node
/**
 * SQL GÖÇ DENETİMİ — kapsamlı statik analiz (AST tabanlı, regex değil).
 *
 * Amaç: OKULIN_USE_SQL=1 (SQL modu) açıkken YANLIŞ davranabilecek HER Redis
 * erişimini bulmak. Etüt/courses/payment-callback buglarının deseni:
 *   "veri SQL'e taşındı ama bir route/helper hâlâ Redis okuyor/yazıyor."
 *
 * Yöntem: app/api altındaki route.js + lib dosyalarını acorn ile parse eder,
 * her `redis.*` / `tenantRedis().*` / pipeline çağrısını bulur ve içinde
 * bulunduğu fonksiyonun isSqlEnabled() koruması olup olmadığını sınıflandırır.
 *
 * Sınıflar:
 *   🔴 KORUMASIZ      — host fonksiyonda isSqlEnabled() YOK → SQL modunda da Redis çalışır (kesin risk)
 *   🔴 SQL-DALINDA    — redis çağrısı if(isSqlEnabled()) consequent'inde → SQL modunda Redis (ciddi)
 *   🟡 FALLBACK       — isSqlEnabled var + redis çağrısı SQL-dalı DIŞINDA → muhtemelen doğru (else/early-return)
 *
 * Ayrıca: Redis-only lib helper'larını (isSqlEnabled içermeyen) ve onları çağıran
 * route'ları cross-reference eder (finance.js/userIndex.js tipi gizli katman).
 *
 * Çalıştır: node scripts/audit-sql-migration.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as acorn from 'acorn';

const REDIS_METHODS = new Set([
  'get', 'set', 'setex', 'del', 'exists', 'expire', 'incr', 'decr', 'mget',
  'smembers', 'sadd', 'srem', 'sismember', 'scard', 'scan', 'keys',
  'hget', 'hset', 'hgetall', 'hdel', 'zadd', 'lpush', 'rpush', 'exec', 'eval',
]);

// ── dosya toplama ──────────────────────────────────────────────────────────
function collectFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) collectFiles(p, out);
    else if (e.endsWith('.js') && !e.endsWith('.test.js')) out.push(p);
  }
  return out;
}
const files = [
  ...collectFiles('app/api'),
  ...readdirSync('lib').filter(f => f.endsWith('.js') && !f.endsWith('.test.js')).map(f => join('lib', f)),
];

// ── AST yardımcıları ───────────────────────────────────────────────────────
const FUNC_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

// node'un subtree'sinde isSqlEnabled() çağrısı var mı (nested fonksiyon dahil — yaklaşım kabul edilebilir)
function subtreeHasUseSql(node) {
  let found = false;
  (function rec(n) {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'isSqlEnabled') { found = true; return; }
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(rec);
      else if (v && typeof v.type === 'string') rec(v);
    }
  })(node);
  return found;
}

// redis-köken tespiti: object `redis`, `tenantRedis()`, ya da bilinen pipeline/alias adı
function isRedisObject(obj, aliases) {
  if (!obj) return false;
  if (obj.type === 'Identifier') return obj.name === 'redis' || obj.name === 'rawRedis' || aliases.has(obj.name);
  if (obj.type === 'CallExpression') {
    if (obj.callee?.type === 'Identifier' && obj.callee.name === 'tenantRedis') return true;
    // redis.pipeline() zincirinin devamı: redis.pipeline().X
    if (obj.callee?.type === 'MemberExpression') return isRedisObject(obj.callee.object, aliases);
  }
  if (obj.type === 'MemberExpression') return isRedisObject(obj.object, aliases);
  return false;
}

// `const x = redis.pipeline()` / `= tenantRedis()` / `= redis` ataması yapılan değişken adlarını topla
function collectAliases(ast) {
  const aliases = new Set();
  (function rec(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
      const init = n.init;
      const isPipeline = init.type === 'CallExpression' && init.callee?.type === 'MemberExpression'
        && init.callee.property?.name === 'pipeline';
      const isTenant = init.type === 'CallExpression' && init.callee?.type === 'Identifier' && init.callee.name === 'tenantRedis';
      const isRedisId = init.type === 'Identifier' && init.name === 'redis';
      if (isPipeline || isTenant || isRedisId) aliases.add(n.id.name);
    }
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(rec);
      else if (v && typeof v.type === 'string') rec(v);
    }
  })(ast);
  return aliases;
}

// ── analiz ─────────────────────────────────────────────────────────────────
const results = [];      // route/genel bulgular
const libRedisOnly = {}; // lib dosyası → Redis-only export fonksiyon adları

function analyzeFile(file) {
  const src = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    results.push({ file, parseError: e.message });
    return;
  }
  const aliases = collectAliases(ast);
  const isLib = file.startsWith('lib/');

  // her redis çağrısını ancestor zinciriyle gez
  (function walk(node, ancestors) {
    if (!node || typeof node.type !== 'string') return;

    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const method = node.callee.property?.name;
      if (REDIS_METHODS.has(method) && isRedisObject(node.callee.object, aliases)) {
        // host fonksiyon = en yakın fonksiyon ancestor'ı (isim/raporlama için)
        let host = null;
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (FUNC_TYPES.has(ancestors[i].type)) { host = ancestors[i]; break; }
        }
        // KORUMA: redis çağrısının bulunduğu ZİNCİRDEKİ HERHANGİ bir fonksiyonda
        // isSqlEnabled() varsa korumalı say. (callback-içi redis, dış handler'ın early-return
        // guard'ıyla korunur — örn ids.forEach(id => redis.get(...)) handler isSqlEnabled'liyse OK.)
        const funcUsesSql = ancestors.some(a => FUNC_TYPES.has(a.type) && subtreeHasUseSql(a));
        // redis çağrısı bir if(isSqlEnabled()) consequent'i içinde mi
        let inSqlConsequent = false;
        for (let i = 0; i < ancestors.length; i++) {
          const a = ancestors[i];
          if (a.type === 'IfStatement' && a.test) {
            const testSrc = src.slice(a.test.start, a.test.end);
            const isUseSqlTest = /\bisSqlEnabled\s*\(\s*\)/.test(testSrc) && !/!\s*isSqlEnabled/.test(testSrc);
            if (isUseSqlTest) {
              // node, bu if'in consequent subtree'sinde mi (alternate değil)
              const next = ancestors[i + 1] || node;
              if (next === a.consequent || isDescendant(a.consequent, node)) { inSqlConsequent = true; }
            }
          }
        }
        // host fonksiyon adı
        let hostName = '(top-level)';
        if (host) {
          if (host.type === 'FunctionDeclaration') hostName = host.id?.name || '(anon)';
          else {
            // export const X = async()=>... veya export async function
            const fa = ancestors[ancestors.indexOf(host) - 1];
            hostName = fa?.id?.name || fa?.key?.name || '(arrow)';
          }
        }
        let cls;
        if (!funcUsesSql) cls = 'UNGUARDED';
        else if (inSqlConsequent) cls = 'REDIS_IN_SQL_BRANCH';
        else cls = 'FALLBACK';
        results.push({ file, line: node.loc.start.line, method, hostName, cls, isLib });
      }
    }

    for (const k in node) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, [...ancestors, node]));
      else if (v && typeof v.type === 'string') walk(v, [...ancestors, node]);
    }
  })(ast, []);
}

function isDescendant(root, target) {
  let found = false;
  (function rec(n) {
    if (found || !n || typeof n.type !== 'string') return;
    if (n === target) { found = true; return; }
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(rec);
      else if (v && typeof v.type === 'string') rec(v);
    }
  })(root);
  return found;
}

for (const f of files) analyzeFile(f);

// lib Redis-only export tespiti: lib dosyasında UNGUARDED redis çağrısı olan fonksiyonlar
for (const r of results) {
  if (r.isLib && r.cls === 'UNGUARDED' && r.hostName && r.hostName !== '(top-level)') {
    const base = r.file.replace('lib/', '').replace('.js', '');
    (libRedisOnly[base] ||= new Set()).add(r.hostName);
  }
}

// ── RAPOR ──────────────────────────────────────────────────────────────────
const ung = results.filter(r => r.cls === 'UNGUARDED' && !r.isLib);
const sqlBranch = results.filter(r => r.cls === 'REDIS_IN_SQL_BRANCH');
const fallback = results.filter(r => r.cls === 'FALLBACK');
const libUng = results.filter(r => r.cls === 'UNGUARDED' && r.isLib);
const parseErrors = results.filter(r => r.parseError);

const byFile = (arr) => {
  const m = {};
  for (const r of arr) (m[r.file] ||= []).push(r);
  return m;
};

console.log('═'.repeat(78));
console.log('  SQL GÖÇ DENETİMİ — kapsamlı statik analiz');
console.log('  Taranan dosya:', files.length, '| toplam redis çağrısı:', results.filter(r => !r.parseError).length);
console.log('═'.repeat(78));

console.log('\n🔴 KATEGORİ 1 — KORUMASIZ ROUTE (host fonksiyonda isSqlEnabled YOK → SQL modunda da Redis):');
console.log('   Bunlar etüt/courses/payment-callback ile AYNI sınıf = en yüksek bug riski.\n');
const ungByFile = byFile(ung);
for (const f of Object.keys(ungByFile).sort()) {
  const rs = ungByFile[f];
  const fns = [...new Set(rs.map(r => r.hostName))].join(', ');
  console.log(`   ${f.replace('app/api/', '')}`);
  console.log(`      fonksiyon(lar): ${fns}  |  ${rs.length} redis çağrısı (satır: ${rs.map(r => r.line).join(',')})`);
}
console.log(`   ── toplam: ${ung.length} korumasız çağrı, ${Object.keys(ungByFile).length} route dosyası`);

console.log('\n🔴 KATEGORİ 2 — SQL-DALINDA REDIS (if(isSqlEnabled()) içinde redis çağrısı):');
if (sqlBranch.length === 0) console.log('   (yok)');
for (const r of sqlBranch) console.log(`   ${r.file.replace('app/api/', '')}:${r.line}  ${r.hostName}() → redis.${r.method}`);

console.log('\n🟠 KATEGORİ 3 — REDIS-ONLY LIB HELPER (isSqlEnabled içermeyen, route\'lar SQL modunda çağırabilir):');
for (const base of Object.keys(libRedisOnly).sort()) {
  console.log(`   lib/${base}.js → ${[...libRedisOnly[base]].join(', ')}`);
}
if (Object.keys(libRedisOnly).length === 0) console.log('   (yok)');

console.log('\n🟡 KATEGORİ 4 — FALLBACK (isSqlEnabled var, redis SQL-dalı dışında → muhtemelen doğru):');
const fbFiles = [...new Set(fallback.map(r => r.file))];
console.log(`   ${fallback.length} çağrı, ${fbFiles.length} dosya. (Çoğu doğru if/else fallback — düşük öncelik, yine de göz atılabilir.)`);

if (parseErrors.length) {
  console.log('\n⚠️  PARSE EDİLEMEYEN DOSYALAR:');
  for (const r of parseErrors) console.log(`   ${r.file}: ${r.parseError}`);
}

console.log('\n' + '═'.repeat(78));
console.log('  ÖZET:');
console.log(`    🔴 Korumasız route çağrısı : ${ung.length}  (${Object.keys(ungByFile).length} dosya) ← ÖNCE BUNLAR`);
console.log(`    🔴 SQL-dalında redis       : ${sqlBranch.length}`);
console.log(`    🟠 Redis-only lib helper   : ${Object.values(libRedisOnly).reduce((n, s) => n + s.size, 0)}  (${Object.keys(libRedisOnly).length} dosya)`);
console.log(`    🟡 Fallback (muhtemel OK)  : ${fallback.length}`);
console.log('═'.repeat(78));
