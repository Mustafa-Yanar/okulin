import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { rawRedis } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { parseBody, z, zName, zPassword } from '@/lib/validate';
import { generateOrgCode, formatCode, hostForOrg } from '@/lib/orgcode';
import { addProjectDomain } from '@/lib/vercel';
import { normalizeFacets } from '@/lib/institution';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';

// Kurum silmede temizlenecek tenant tabloları (orgSlug bazında, tüm şubeler). Cascade
// alt tabloları (Installment/BehaviorEntry/ExamRow/FormResponse/AnnouncementRecipient) otomatik.
const TENANT_MODELS = [
  'director', 'counselor', 'accountant', 'parent', 'teacher', 'student', 'class', 'course',
  'slotBooking', 'tenantConfig', 'finance', 'expense', 'attendance', 'behavior', 'exam',
  'odev', 'hedef', 'etkinlik', 'form', 'lead', 'announcement', 'resource', 'topic',
  'guidance', 'auditLog', 'errLog', 'pushSub', 'payOrder',
];

// Tüm işlemler rawRedis (global) — tenant prefix YOK.
// Erişim: yalnız superadmin rolü.

function requireSuperadmin(session) {
  if (!session || session.role !== 'superadmin') return false;
  return true;
}

// Slug doğrulama: küçük harf, yalnız a-z0-9-, 2-40 karakter.
function isValidSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/.test(s);
}

// GET /api/superadmin — tüm kurumları listele
export async function GET() {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  // Org kayıtlarını ham şekilde topla (rec listesi), sonra ortak biçimlendirme
  let recs;
  if (isSqlEnabled()) {
    const rows = await tdb().org.findMany(); // global (SKIP)
    recs = rows.map((r) => ({ ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt }));
  } else {
    const slugs = await rawRedis.smembers('orgs');
    if (!slugs || slugs.length === 0) return NextResponse.json({ orgs: [] });
    const pipeline = rawRedis.pipeline();
    slugs.forEach(slug => pipeline.get(`org:${slug}`));
    const got = await pipeline.exec();
    recs = slugs.map((slug, i) => got[i] || { slug, name: slug, active: true });
  }
  if (!recs || recs.length === 0) return NextResponse.json({ orgs: [] });

  const orgs = recs.map((rec) => {
    const f = normalizeFacets(rec);
    return {
      slug: rec.slug,
      name: rec.name || rec.slug,
      shortName: rec.shortName || null,
      themeColor: rec.themeColor || null,
      active: rec.active !== false,
      createdAt: rec.createdAt || null,
      type: rec.type || 'single',
      code: rec.code ? formatCode(rec.code) : null,
      sektor: f.sektor,
      mulkiyet: f.mulkiyet,
      kademeler: f.kademeler,
    };
  }).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  // Her org için müdür kullanıcı adı + (multi ise) branch sayısı
  if (isSqlEnabled()) {
    for (const o of orgs) {
      const dir = await tdb(o.slug, 'main').director.findFirst();
      o.directorUsername = dir?.username || null;
      o.branchCount = o.type === 'multi' ? await tdb().branch.count({ where: { orgSlug: o.slug } }) : 1;
    }
  } else {
    const dPipeline = rawRedis.pipeline();
    orgs.forEach(o => {
      dPipeline.get(`t:${o.slug}:main:director`);
      dPipeline.scard(`org:${o.slug}:branches`);
    });
    const dResults = await dPipeline.exec();
    orgs.forEach((o, i) => {
      o.directorUsername = dResults[i * 2]?.username || null;
      o.branchCount = dResults[i * 2 + 1] || (o.type === 'multi' ? 0 : 1);
    });
  }

  return NextResponse.json({ orgs });
}

const CreateOrgSchema = z.object({
  action: z.literal('create'),
  slug: z.string().min(2).max(40),
  name: z.string().min(1).max(120),
  shortName: z.string().max(60).optional(),
  type: z.enum(['single', 'multi']).optional(),
  // Kurum türü facet'leri (additive — bkz lib/institution.js)
  sektor: z.enum(['okul', 'dershane']).optional(),
  mulkiyet: z.enum(['devlet', 'ozel']).optional(),
  kademeler: z.array(z.enum(['ilkokul', 'ortaokul', 'lise', 'mezun'])).optional(),
  directorUsername: zName,
  directorPassword: zPassword,
  directorName: z.string().max(200).optional(),
  // multi-type için org_admin bilgileri
  orgAdminUsername: zName.optional(),
  orgAdminPassword: zPassword.optional(),
  orgAdminName: z.string().max(200).optional(),
});

const UpdateOrgSchema = z.object({
  action: z.enum(['toggle_active', 'reset_director', 'rename', 'change_own_password', 'provision_domain']),
  slug: z.string().min(2).max(40).optional(),
  // toggle_active: ilave alan yok
  // reset_director / change_own_password:
  currentPassword: zPassword.optional(),
  newPassword: zPassword.optional(),
  // rename:
  name: z.string().min(1).max(120).optional(),
  shortName: z.string().max(60).optional(),
});

// POST /api/superadmin — yeni kurum + müdür oluştur
export async function POST(req) {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, CreateOrgSchema);
  if (!parsed.ok) return parsed.response;
  const { slug, name, shortName, type, sektor, mulkiyet, kademeler,
    directorUsername, directorPassword, directorName,
    orgAdminUsername, orgAdminPassword, orgAdminName } = parsed.data;

  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'Geçersiz slug — küçük harf, rakam ve tire, min 2 karakter' }, { status: 400 });
  }
  const orgType = type || 'single';
  if (orgType === 'multi' && (!orgAdminUsername || !orgAdminPassword)) {
    return NextResponse.json({ error: 'Çok şubeli kurum için org_admin bilgileri zorunlu' }, { status: 400 });
  }

  if (isSqlEnabled()) {
    const dup = await tdb().org.findFirst({ where: { slug } });
    if (dup) return NextResponse.json({ error: `"${slug}" zaten kayıtlı` }, { status: 409 });

    // Benzersiz kurum kodu (Org.code ile reverse-lookup; ayrı orgcode kaydı gerekmez)
    let code;
    for (let i = 0; i < 20; i++) {
      const c = generateOrgCode();
      if (!(await tdb().org.findFirst({ where: { code: c } }))) { code = c; break; }
    }
    const facets = normalizeFacets({ sektor, mulkiyet, kademeler });
    await tdb().org.create({ data: {
      slug, name, shortName: shortName || null, active: true, type: orgType, code,
      sektor: facets.sektor, mulkiyet: facets.mulkiyet, kademeler: facets.kademeler,
    } });

    // Ana şube müdürü (tenant-scoped)
    const passwordHash = await bcrypt.hash(directorPassword, 10);
    await tdb(slug, 'main').director.create({ data: { username: directorUsername, passwordHash, name: directorName || name } });

    // Çok şubeli: org_admin + 'main' şube kaydı
    if (orgType === 'multi') {
      const adminHash = await bcrypt.hash(orgAdminPassword, 10);
      await tdb().orgAdmin.create({ data: { orgSlug: slug, username: orgAdminUsername, passwordHash: adminHash, name: orgAdminName || name } });
      await tdb().branch.create({ data: { orgSlug: slug, slug: 'main', name: 'Ana Şube', active: true } });
    }

    const domain = hostForOrg(slug, 'main');
    const domainResult = await addProjectDomain(domain);
    return NextResponse.json({
      ok: true, slug, type: orgType, code: formatCode(code), domain,
      domainProvisioned: domainResult.ok,
      domainWarning: domainResult.ok ? null : (domainResult.error || 'Domain eklenemedi'),
    });
  }

  // Çakışma kontrolü (Redis)
  const exists = await rawRedis.sismember('orgs', slug);
  if (exists) return NextResponse.json({ error: `"${slug}" zaten kayıtlı` }, { status: 409 });

  // Benzersiz kurum kodu üret (landing girişi için)
  let code;
  for (let i = 0; i < 20; i++) {
    const c = generateOrgCode();
    if (!(await rawRedis.get(`orgcode:${c}`))) { code = c; break; }
  }

  // org kaydı (global)
  await rawRedis.sadd('orgs', slug);
  const createdAt = new Date().toISOString();
  const facets = normalizeFacets({ sektor, mulkiyet, kademeler });
  await rawRedis.set(`org:${slug}`, {
    slug,
    name,
    shortName: shortName || undefined,
    active: true,
    type: orgType,
    createdAt,
    code,
    // Kurum türü facet'leri
    sektor: facets.sektor,
    mulkiyet: facets.mulkiyet,
    kademeler: facets.kademeler,
  });
  // Kod → subdomain ters araması
  await rawRedis.set(`orgcode:${code}`, { slug, branch: 'main', name, host: hostForOrg(slug, 'main') });

  // Ana şube müdürü (scoped)
  const passwordHash = await bcrypt.hash(directorPassword, 10);
  await rawRedis.set(`t:${slug}:main:director`, {
    username: directorUsername,
    passwordHash,
    name: directorName || name,
  });

  // Çok şubeli: org_admin + 'main' şube metadata
  if (orgType === 'multi') {
    const adminHash = await bcrypt.hash(orgAdminPassword, 10);
    await rawRedis.set(`orgadmin:${slug}`, {
      username: orgAdminUsername,
      passwordHash: adminHash,
      name: orgAdminName || name,
    });
    await rawRedis.sadd(`org:${slug}:branches`, 'main');
    await rawRedis.set(`org:${slug}:branch:main`, {
      slug: 'main', name: 'Ana Şube', active: true, createdAt,
    });
  }

  // Subdomain'i Vercel projesine ekle (SSL otomatik üretilsin). Org zaten Redis'e
  // yazıldı; domain eklenemezse kurum yine de oluşmuş sayılır — sonuç yanıtta döner,
  // panelden "Domain'i Sağla" ile tekrar denenebilir.
  const domain = hostForOrg(slug, 'main');
  const domainResult = await addProjectDomain(domain);

  return NextResponse.json({
    ok: true,
    slug,
    type: orgType,
    code: formatCode(code),
    domain,
    domainProvisioned: domainResult.ok,
    domainWarning: domainResult.ok ? null : (domainResult.error || 'Domain eklenemedi'),
  });
}

// DELETE /api/superadmin — kurumu ve tüm verisini kalıcı sil
export async function DELETE(req) {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, z.object({ slug: z.string().min(2).max(40) }));
  if (!parsed.ok) return parsed.response;
  const { slug } = parsed.data;

  if (isSqlEnabled()) {
    const org = await tdb().org.findFirst({ where: { slug } });
    if (!org) return NextResponse.json({ error: 'Kurum bulunamadı' }, { status: 404 });
    let deleted = 0;
    for (const m of TENANT_MODELS) {
      try { const r = await prisma[m].deleteMany({ where: { orgSlug: slug } }); deleted += r.count; } catch { /* model yoksa atla */ }
    }
    await prisma.branch.deleteMany({ where: { orgSlug: slug } });
    await prisma.orgAdmin.deleteMany({ where: { orgSlug: slug } });
    await prisma.org.delete({ where: { slug } });
    return NextResponse.json({ ok: true, deleted });
  }

  const exists = await rawRedis.sismember('orgs', slug);
  if (!exists) return NextResponse.json({ error: 'Kurum bulunamadı' }, { status: 404 });

  // Tüm t:<slug>:* anahtarlarını tara + sil
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await rawRedis.scan(cursor, { match: `t:${slug}:*`, count: 200 });
    cursor = String(next);
    if (keys && keys.length > 0) {
      await rawRedis.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');

  // Şube metadata anahtarlarını sil
  const branchMembers = await rawRedis.smembers(`org:${slug}:branches`) || [];
  const branchKeys = branchMembers.map(b => `org:${slug}:branch:${b}`);

  const globalKeys = [`org:${slug}`, `orgadmin:${slug}`, `org:${slug}:branches`, ...branchKeys];
  if (globalKeys.length > 0) await rawRedis.del(...globalKeys);
  await rawRedis.srem('orgs', slug);

  return NextResponse.json({ ok: true, deleted });
}

// PATCH /api/superadmin — kurum güncelle (aktif/pasif, müdür şifresi, ad)
export async function PATCH(req) {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, UpdateOrgSchema);
  if (!parsed.ok) return parsed.response;
  const { action, slug, newPassword, name, shortName } = parsed.data;

  if (!slug) return NextResponse.json({ error: 'slug gerekli' }, { status: 400 });

  if (isSqlEnabled()) {
    if (action === 'change_own_password') {
      const { currentPassword, newPassword: newPw } = parsed.data;
      if (!currentPassword || !newPw) return NextResponse.json({ error: 'currentPassword ve newPassword gerekli' }, { status: 400 });
      const sa = await tdb().superAdmin.findFirst();
      if (!sa) return NextResponse.json({ error: 'Superadmin kaydı bulunamadı' }, { status: 404 });
      if (!(await bcrypt.compare(currentPassword, sa.passwordHash))) return NextResponse.json({ error: 'Mevcut şifre yanlış' }, { status: 401 });
      await tdb().superAdmin.update({ where: { id: sa.id }, data: { passwordHash: await bcrypt.hash(newPw, 10) } });
      return NextResponse.json({ ok: true });
    }
    if (action === 'provision_domain') {
      const domain = hostForOrg(slug, 'main');
      const result = await addProjectDomain(domain);
      if (!result.ok) return NextResponse.json({ error: result.error || 'Domain eklenemedi', domain }, { status: 502 });
      return NextResponse.json({ ok: true, domain, alreadyExists: result.alreadyExists || false });
    }
    const org = await tdb().org.findFirst({ where: { slug } });
    if (!org) return NextResponse.json({ error: 'Kurum bulunamadı' }, { status: 404 });
    if (action === 'toggle_active') {
      await tdb().org.update({ where: { slug }, data: { active: !org.active } });
      return NextResponse.json({ ok: true, active: !org.active });
    }
    if (action === 'reset_director') {
      if (!newPassword) return NextResponse.json({ error: 'newPassword gerekli' }, { status: 400 });
      const dir = await tdb(slug, 'main').director.findFirst();
      if (!dir) return NextResponse.json({ error: 'Müdür kaydı bulunamadı' }, { status: 404 });
      await tdb(slug, 'main').director.update({ where: { id: dir.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
      return NextResponse.json({ ok: true });
    }
    if (action === 'rename') {
      if (!name) return NextResponse.json({ error: 'name gerekli' }, { status: 400 });
      const data = { name };
      if (shortName !== undefined) data.shortName = shortName || null;
      await tdb().org.update({ where: { slug }, data });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
  }

  const orgRec = await rawRedis.get(`org:${slug}`);
  if (!orgRec) return NextResponse.json({ error: 'Kurum bulunamadı' }, { status: 404 });

  if (action === 'toggle_active') {
    await rawRedis.set(`org:${slug}`, { ...orgRec, active: !orgRec.active });
    return NextResponse.json({ ok: true, active: !orgRec.active });
  }

  if (action === 'reset_director') {
    if (!newPassword) return NextResponse.json({ error: 'newPassword gerekli' }, { status: 400 });
    const dirKey = `t:${slug}:main:director`;
    const dir = await rawRedis.get(dirKey);
    if (!dir) return NextResponse.json({ error: 'Müdür kaydı bulunamadı' }, { status: 404 });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await rawRedis.set(dirKey, { ...dir, passwordHash, mustChangePassword: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'rename') {
    if (!name) return NextResponse.json({ error: 'name gerekli' }, { status: 400 });
    const next = { ...orgRec, name };
    if (shortName !== undefined) next.shortName = shortName || undefined;
    await rawRedis.set(`org:${slug}`, next);
    return NextResponse.json({ ok: true });
  }

  if (action === 'provision_domain') {
    // Subdomain'i Vercel projesine (yeniden) ekle — idempotent (zaten ekliyse 409 → ok).
    // Mevcut kurumlar veya oluşturmada domain eklenemeyen kurumlar için.
    const domain = hostForOrg(slug, 'main');
    const result = await addProjectDomain(domain);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Domain eklenemedi', domain }, { status: 502 });
    }
    return NextResponse.json({ ok: true, domain, alreadyExists: result.alreadyExists || false });
  }

  if (action === 'change_own_password') {
    const { currentPassword, newPassword: newPw } = parsed.data;
    if (!currentPassword || !newPw) return NextResponse.json({ error: 'currentPassword ve newPassword gerekli' }, { status: 400 });
    const sa = await rawRedis.get('superadmin');
    if (!sa) return NextResponse.json({ error: 'Superadmin kaydı bulunamadı' }, { status: 404 });
    const ok = await bcrypt.compare(currentPassword, sa.passwordHash);
    if (!ok) return NextResponse.json({ error: 'Mevcut şifre yanlış' }, { status: 401 });
    const passwordHash = await bcrypt.hash(newPw, 10);
    await rawRedis.set('superadmin', { ...sa, passwordHash });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
}
