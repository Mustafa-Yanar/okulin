// okulin güvenlik smoke-testi — canlı/preview bir kuruma karşı savunma katmanlarını
// sistematik doğrular. Credential SCRIPT'E GÖMÜLÜ DEĞİL, env'den gelir.
//
// Kullanım:
//   BASE_URL=https://testkurs.okulin.com \
//   DIRECTOR_USER=testkurs_mudur DIRECTOR_PASS=... \
//   node scripts/security-smoke.mjs [--rate] [--keep]
//
//   --rate : rate-limit testini de çalıştır (5+ yanlış login üretir; var olmayan
//            kullanıcı adıyla yapılır, gerçek müdür hesabını kilitlemez).
//   --keep : geçici test öğretmenini SİLME (hata ayıklama için; normalde silinir).
//
// Non-destructive: yalnız 1 geçici öğretmen oluşturur ve sonunda siler (finally).
// Çıkış kodu: tüm testler geçerse 0, en az bir FAIL varsa 1 (CI'da kullanılabilir).
//
// Neyi KAPSAMAZ (gerçek müşteri öncesi elle yapılacak — bkz memory/guvenlik-testi-plani):
//   2-kurum cross-tenant veri sızıntısı (2. kurum gerekir), öğrenci→öğrenci IDOR,
//   XSS, LMS dosya yükleme, ödeme callback'in GERÇEK hash doğrulaması (config gerekir).

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const USER = process.env.DIRECTOR_USER;
const PASS = process.env.DIRECTOR_PASS;
const RUN_RATE = process.argv.includes('--rate');
const KEEP = process.argv.includes('--keep');

if (!BASE || !USER || !PASS) {
  console.error('HATA: BASE_URL, DIRECTOR_USER ve DIRECTOR_PASS env değişkenleri zorunlu.');
  console.error('Örnek: BASE_URL=https://testkurs.okulin.com DIRECTOR_USER=... DIRECTOR_PASS=... node scripts/security-smoke.mjs');
  process.exit(2);
}

// ── Mini test koşucusu ──────────────────────────────────────────────────────
const results = [];
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', dim: '\x1b[2m', x: '\x1b[0m' };

// expected: tek sayı (200) ya da dizi ([401,403]) — actual bunlardan biri olmalı.
function check(label, actual, expected) {
  const exp = Array.isArray(expected) ? expected : [expected];
  const ok = exp.includes(actual);
  results.push({ label, ok, actual, expected: exp.join('|') });
  const tag = ok ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`;
  console.log(`  ${tag} ${label} ${C.dim}(geldi ${actual}, beklenen ${exp.join('|')})${C.x}`);
  return ok;
}

function section(t) { console.log(`\n${C.y}── ${t}${C.x}`); }

// ── HTTP yardımcıları (Node global fetch; manuel cookie jar) ─────────────────
let cookie = null; // aktif oturum cookie'si

function setCookieFrom(res) {
  const sc = res.headers.getSetCookie?.() || [];
  for (const c of sc) {
    const m = c.match(/etut_session=([^;]*)/);
    if (m) cookie = m[1] ? `etut_session=${m[1]}` : null;
  }
}

// opts: { method, body(obj), origin(bool|string), cookie(bool), headers }
async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  // Origin: true → BASE; string → o değer; yok → header hiç gönderilmez
  if (opts.origin === true) headers['Origin'] = BASE;
  else if (typeof opts.origin === 'string') headers['Origin'] = opts.origin;
  if (opts.cookie && cookie) headers['Cookie'] = cookie;
  if (opts.rawCookie) headers['Cookie'] = opts.rawCookie;
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  return res;
}

async function login(username, password, role, asSession = false) {
  const res = await req('/api/auth', { method: 'POST', origin: true, body: { action: 'login', username, password, role } });
  if (asSession && res.ok) setCookieFrom(res);
  return res;
}

// ── Testler ──────────────────────────────────────────────────────────────────
async function run() {
  console.log(`${C.dim}Hedef: ${BASE}${C.x}`);

  section('1. Erişilebilirlik');
  check('GET / (200)', (await req('/')).status, 200);

  section('2. Kimliksiz erişim reddi (401/403)');
  for (const ep of ['teachers', 'students', 'finance', 'attendance', 'audit', 'announcements', 'resources']) {
    check(`GET /api/${ep}`, (await req(`/api/${ep}`)).status, [401, 403]);
  }

  section('3. CSRF (mutasyonda origin doğrulaması)');
  check('POST /api/auth — Origin yok → 403', (await req('/api/auth', { method: 'POST', body: { action: 'login', username: 'x', password: 'y', role: 'management' } })).status, 403);
  check('POST /api/auth — yanlış Origin → 403', (await req('/api/auth', { method: 'POST', origin: 'https://evil.example', body: { action: 'login', username: 'x', password: 'y', role: 'management' } })).status, 403);
  check('POST /api/auth — doğru Origin + yanlış şifre → 401 (CSRF değil)', (await login('__smoke_nobody__', 'nope', 'teacher')).status, [401, 429]);

  section('4. JWT sahteciliği reddi (401)');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const noneTok = `${b64({ alg: 'none' })}.${b64({ role: 'director', org: 'testkurs', branch: 'main', id: 'hack', name: 'hack' })}.`;
  check('Çöp token → GET /api/teachers', (await req('/api/teachers', { rawCookie: 'etut_session=eyJ.GARBAGE.xx' })).status, 401);
  check('alg:none forge → GET /api/teachers', (await req('/api/teachers', { rawCookie: `etut_session=${noneTok}` })).status, 401);

  section('5. Müdür girişi');
  const dl = await login(USER, PASS, 'management', true);
  if (!check('Müdür login → 200 + cookie', dl.status, 200) || !cookie) {
    console.error(`${C.r}Müdür girişi başarısız — kalan testler atlanıyor (credential/rate-limit?).${C.x}`);
    return finish();
  }
  for (const ep of ['teachers', 'students', 'audit', 'announcements']) {
    check(`müdür GET /api/${ep} → 200`, (await req(`/api/${ep}`, { cookie: true })).status, 200);
  }
  check('müdür GET /api/superadmin → 403', (await req('/api/superadmin', { cookie: true })).status, 403);
  check('müdür GET /api/hq → 403', (await req('/api/hq', { cookie: true })).status, 403);

  section('6. Multi-tenant: client x-org/x-branch header ENJEKSİYONU ezilmeli');
  const norm = await (await req('/api/teachers', { cookie: true })).json().catch(() => []);
  const inj = await (await req('/api/teachers', { cookie: true, headers: { 'x-org': 'cozum', 'x-branch': 'hacked' } })).json().catch(() => []);
  const nLen = Array.isArray(norm) ? norm.length : -1;
  const iLen = Array.isArray(inj) ? inj.length : -2;
  check(`enjekteli istek aynı kurumun verisini döndürür (${nLen}==${iLen}, >0)`, (nLen === iLen && nLen > 0) ? 'eşit' : 'farklı', 'eşit');

  // ── Geçici öğretmenle rol-bazlı yetki matrisi ──
  let tid = null;
  const directorCookie = cookie; // müdür cookie'sini sakla (öğretmen login üzerine yazacak)
  try {
    section('7. Yetki matrisi (geçici öğretmen rolüyle saldırı)');
    const uname = `__smoke_teacher_${Date.now()}`;
    const cr = await req('/api/teachers', { method: 'POST', origin: true, cookie: true, body: { name: uname, username: uname, branches: ['Matematik'], allowedGroups: ['lise'], password: 'smoke_pass_1234' } });
    const crBody = await cr.json().catch(() => ({}));
    tid = crBody.id;
    if (!check('geçici öğretmen oluşturuldu', cr.status, 200) || !tid) {
      console.error(`${C.r}Geçici öğretmen oluşturulamadı — yetki matrisi atlanıyor.${C.x}`);
    } else {
      cookie = null; // öğretmen olarak yeni oturum
      const tl = await login(uname, 'smoke_pass_1234', 'teacher', true);
      check('öğretmen login → 200', tl.status, 200);
      // Öğretmen → müdür-özel GET (403 beklenir)
      for (const ep of ['audit', 'finance', 'finance/expense', 'counselors', 'accountants']) {
        check(`öğretmen GET /api/${ep} → 403`, (await req(`/api/${ep}`, { cookie: true })).status, 403);
      }
      // Öğretmen → müdür-özel mutasyon (403 beklenir)
      check('öğretmen POST /api/teachers → 403', (await req('/api/teachers', { method: 'POST', origin: true, cookie: true, body: { name: 'x', username: 'x', branches: ['Matematik'], allowedGroups: ['lise'] } })).status, 403);
      check('öğretmen POST /api/finance/payment → 403', (await req('/api/finance/payment', { method: 'POST', origin: true, cookie: true, body: { studentId: 'x', amount: 1 } })).status, 403);
    }

    section('8. Ödeme: start korumalı, callback sahte hash kredilendirmez');
    check('POST /api/payment/start — cookie yok → 403 (CSRF)', (await req('/api/payment/start', { method: 'POST', body: { studentId: 'x', installmentIdx: 0 } })).status, 403);
    // Sahte callback (form-encoded, uydurma merchant_oid + hash). Doğru davranış:
    // order yok → erken OK ya da hash uyuşmaz → fail; HER İKİSİ DE kredilendirmez.
    // Güvenlik göstergesi: 5xx ile ÇÖKMEMELİ (çökme = işlenmemiş istisna riski).
    const cbRes = await fetch(BASE + '/api/payment/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `merchant_oid=SMOKE${Date.now()}&status=success&total_amount=999999&hash=SAHTEHASH`,
    });
    check('callback sahte hash → 5xx/çökme yok (kredilendirme tetiklenmez)', cbRes.status < 500 ? 'sağlam' : 'çöktü', 'sağlam');

    if (RUN_RATE) {
      section('9. Rate limit (var olmayan kullanıcı; gerçek hesabı kilitlemez)');
      let saw429 = false;
      for (let i = 0; i < 12; i++) {
        const r = await login('__smoke_ratelimit__', 'wrong', 'teacher');
        if (r.status === 429) { saw429 = true; break; }
      }
      check('birkaç yanlış denemede 429 görülür', saw429 ? 'evet' : 'hayır', 'evet');
    }
  } finally {
    // ── TEMİZLİK: geçici öğretmeni sil (müdür cookie ile) ──
    cookie = directorCookie;
    if (tid && !KEEP) {
      const del = await req('/api/teachers', { method: 'DELETE', origin: true, cookie: true, body: { id: tid } });
      check('TEMİZLİK: geçici öğretmen silindi', del.status, 200);
      const after = await (await req('/api/teachers', { cookie: true })).json().catch(() => []);
      const stillThere = Array.isArray(after) && after.some((t) => t.id === tid);
      check('TEMİZLİK doğrulandı (kayıt yok)', stillThere ? 'var' : 'yok', 'yok');
    } else if (tid && KEEP) {
      console.log(`  ${C.y}--keep: geçici öğretmen ${tid} BIRAKILDI (elle sil).${C.x}`);
    }
  }
  finish();
}

function finish() {
  const fail = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`Toplam ${results.length} kontrol — ${C.g}${results.length - fail.length} PASS${C.x}, ${fail.length ? C.r : ''}${fail.length} FAIL${C.x}`);
  if (fail.length) {
    console.log(`${C.r}Başarısızlar:${C.x}`);
    for (const f of fail) console.log(`  - ${f.label} (geldi ${f.actual}, beklenen ${f.expected})`);
  }
  process.exit(fail.length ? 1 : 0);
}

run().catch((e) => { console.error('Beklenmeyen hata:', e); process.exit(3); });
