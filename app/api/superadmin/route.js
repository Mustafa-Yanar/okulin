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
    };
  }).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  // Her org için müdür kullanıcı adını al
  const dPipeline = rawRedis.pipeline();
  orgs.forEach(o => dPipeline.get(`t:${o.slug}:main:director`));
  const directors = await dPipeline.exec();
  orgs.forEach((o, i) => { o.directorUsername = directors[i]?.username || null; });

  return NextResponse.json({ orgs });
}

const CreateOrgSchema = z.object({
  action: z.literal('create'),
  slug: z.string().min(2).max(40),
  name: z.string().min(1).max(120),
  shortName: z.string().max(60).optional(),
  directorUsername: zName,
  directorPassword: zPassword,
  directorName: z.string().max(200).optional(),
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
  const { slug, name, shortName, directorUsername, directorPassword, directorName } = parsed.data;

  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'Geçersiz slug — küçük harf, rakam ve tire, min 2 karakter' }, { status: 400 });
  }

  // Çakışma kontrolü
  const exists = await rawRedis.sismember('orgs', slug);
  if (exists) return NextResponse.json({ error: `"${slug}" zaten kayıtlı` }, { status: 409 });

  // org kaydı (global)
  await rawRedis.sadd('orgs', slug);
  await rawRedis.set(`org:${slug}`, {
    slug,
    name,
    shortName: shortName || undefined,
    active: true,
    createdAt: new Date().toISOString(),
  });

  // müdür (scoped)
  const passwordHash = await bcrypt.hash(directorPassword, 10);
  await rawRedis.set(`t:${slug}:main:director`, {
    username: directorUsername,
    passwordHash,
    name: directorName || name,
  });

  return NextResponse.json({ ok: true, slug });
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
