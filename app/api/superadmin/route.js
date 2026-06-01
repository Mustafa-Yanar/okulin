import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { rawRedis } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { parseBody, z, zName, zPassword } from '@/lib/validate';

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

  const slugs = await rawRedis.smembers('orgs');
  if (!slugs || slugs.length === 0) return NextResponse.json({ orgs: [] });

  const pipeline = rawRedis.pipeline();
  slugs.forEach(slug => pipeline.get(`org:${slug}`));
  const recs = await pipeline.exec();

  const orgs = slugs.map((slug, i) => {
    const rec = recs[i] || { slug, name: slug, active: true };
    return {
      slug: rec.slug || slug,
      name: rec.name || slug,
      shortName: rec.shortName || null,
      themeColor: rec.themeColor || null,
      active: rec.active !== false,
      createdAt: rec.createdAt || null,
    type: rec.type || 'single',
    };
  }).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  // Her org için müdür kullanıcı adı ve (multi ise) branch sayısını al
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

  return NextResponse.json({ orgs });
}

const CreateOrgSchema = z.object({
  action: z.literal('create'),
  slug: z.string().min(2).max(40),
  name: z.string().min(1).max(120),
  shortName: z.string().max(60).optional(),
  type: z.enum(['single', 'multi']).optional(),
  directorUsername: zName,
  directorPassword: zPassword,
  directorName: z.string().max(200).optional(),
  // multi-type için org_admin bilgileri
  orgAdminUsername: zName.optional(),
  orgAdminPassword: zPassword.optional(),
  orgAdminName: z.string().max(200).optional(),
});

const UpdateOrgSchema = z.object({
  action: z.enum(['toggle_active', 'reset_director', 'rename']),
  slug: z.string().min(2).max(40),
  // toggle_active: ilave alan yok
  // reset_director:
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
  const { slug, name, shortName, type, directorUsername, directorPassword, directorName,
    orgAdminUsername, orgAdminPassword, orgAdminName } = parsed.data;

  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'Geçersiz slug — küçük harf, rakam ve tire, min 2 karakter' }, { status: 400 });
  }
  const orgType = type || 'single';
  if (orgType === 'multi' && (!orgAdminUsername || !orgAdminPassword)) {
    return NextResponse.json({ error: 'Çok şubeli kurum için org_admin bilgileri zorunlu' }, { status: 400 });
  }

  // Çakışma kontrolü
  const exists = await rawRedis.sismember('orgs', slug);
  if (exists) return NextResponse.json({ error: `"${slug}" zaten kayıtlı` }, { status: 409 });

  // org kaydı (global)
  await rawRedis.sadd('orgs', slug);
  const createdAt = new Date().toISOString();
  await rawRedis.set(`org:${slug}`, {
    slug,
    name,
    shortName: shortName || undefined,
    active: true,
    type: orgType,
    createdAt,
  });

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

  return NextResponse.json({ ok: true, slug, type: orgType });
}

// DELETE /api/superadmin — kurumu ve tüm verisini kalıcı sil
export async function DELETE(req) {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, z.object({ slug: z.string().min(2).max(40) }));
  if (!parsed.ok) return parsed.response;
  const { slug } = parsed.data;

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

  return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
}
