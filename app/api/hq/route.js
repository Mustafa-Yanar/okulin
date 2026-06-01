import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { rawRedis, currentOrg, tenantRedis } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { parseBody, z, zName, zPassword } from '@/lib/validate';

// HQ (Genel Merkez) API — çok şubeli kurumların şube yönetimi.
// Erişim: org_admin (kendi org'u) veya superadmin (tüm org'lar).
// Tüm branch metadata GLOBAL (org:<slug>:* prefix'i, tenant prefix YOK).

function requireHQ(session, org) {
  if (!session) return false;
  if (session.role === 'superadmin') return true;
  if (session.role === 'org_admin' && session.org === org) return true;
  return false;
}

function isValidBranchSlug(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,38}$/.test(s) && s !== '__hq__';
}

// GET /api/hq — şube listesi + her şube için istatistik
export async function GET() {
  const session = await getSession();
  const org = currentOrg();
  if (!requireHQ(session, org)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const slugs = await rawRedis.smembers(`org:${org}:branches`);

  // 'main' yoksa ekle (tek şube fallback — eski/single-type org'lar için)
  const branchSlugs = slugs && slugs.length > 0 ? slugs : ['main'];

  // Branch metadata + müdür + istatistik paralel çek
  const pipeline = rawRedis.pipeline();
  branchSlugs.forEach(slug => {
    pipeline.get(`org:${org}:branch:${slug}`);
    pipeline.get(`t:${org}:${slug}:director`);
  });
  const results = await pipeline.exec();

  // scard için ayrı pipeline (scard pipeline'da destekleniyor)
  const scardPipeline = rawRedis.pipeline();
  branchSlugs.forEach(slug => {
    // scard raw redis ile doğrudan — prefix manuel yazılır (raw client)
    scardPipeline.scard(`t:${org}:${slug}:students`);
    scardPipeline.scard(`t:${org}:${slug}:teachers`);
  });
  const counts = await scardPipeline.exec();

  const branches = branchSlugs.map((slug, i) => {
    const meta = results[i * 2] || { slug, name: slug === 'main' ? 'Ana Şube' : slug, active: true };
    const dir = results[i * 2 + 1];
    return {
      slug,
      name: meta.name || slug,
      active: meta.active !== false,
      createdAt: meta.createdAt || null,
      directorUsername: dir?.username || null,
      studentCount: counts[i * 2] || 0,
      teacherCount: counts[i * 2 + 1] || 0,
    };
  }).sort((a, b) => {
    if (a.slug === 'main') return -1;
    if (b.slug === 'main') return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  const orgRec = await rawRedis.get(`org:${org}`);

  return NextResponse.json({ org, orgName: orgRec?.name || org, branches });
}

const HQActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_branch'),
    branchSlug: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    directorUsername: zName,
    directorPassword: zPassword,
    directorName: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal('toggle_active'),
    branchSlug: z.string().min(1).max(40),
  }),
  z.object({
    action: z.literal('reset_director'),
    branchSlug: z.string().min(1).max(40),
    newPassword: zPassword,
  }),
  z.object({
    action: z.literal('rename'),
    branchSlug: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
  }),
]);

// POST /api/hq — yeni şube oluştur veya güncelle
export async function POST(req) {
  const session = await getSession();
  const org = currentOrg();
  if (!requireHQ(session, org)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, HQActionSchema);
  if (!parsed.ok) return parsed.response;
  const { action, branchSlug } = parsed.data;

  if (action === 'create_branch') {
    if (!isValidBranchSlug(branchSlug)) {
      return NextResponse.json({ error: 'Geçersiz slug — küçük harf, rakam ve tire, "main" dışında' }, { status: 400 });
    }

    // Çakışma kontrolü
    const existing = await rawRedis.sismember(`org:${org}:branches`, branchSlug);
    if (existing) return NextResponse.json({ error: `"${branchSlug}" şubesi zaten var` }, { status: 409 });

    const { name, directorUsername, directorPassword, directorName } = parsed.data;

    // Branch metadata (global)
    await rawRedis.sadd(`org:${org}:branches`, branchSlug);
    await rawRedis.set(`org:${org}:branch:${branchSlug}`, {
      slug: branchSlug,
      name,
      active: true,
      createdAt: new Date().toISOString(),
    });

    // Müdür (scoped — bu şubeye ait)
    const passwordHash = await bcrypt.hash(directorPassword, 10);
    await rawRedis.set(`t:${org}:${branchSlug}:director`, {
      username: directorUsername,
      passwordHash,
      name: directorName || name,
    });

    return NextResponse.json({ ok: true, branchSlug });
  }

  // Şube güncelleme işlemleri
  const meta = await rawRedis.get(`org:${org}:branch:${branchSlug}`);
  if (!meta && branchSlug !== 'main') {
    return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });
  }
  const currentMeta = meta || { slug: branchSlug, name: branchSlug === 'main' ? 'Ana Şube' : branchSlug, active: true };

  if (action === 'toggle_active') {
    if (branchSlug === 'main') return NextResponse.json({ error: 'Ana şube devre dışı bırakılamaz' }, { status: 400 });
    await rawRedis.set(`org:${org}:branch:${branchSlug}`, { ...currentMeta, active: !currentMeta.active });
    return NextResponse.json({ ok: true, active: !currentMeta.active });
  }

  if (action === 'reset_director') {
    const dirKey = `t:${org}:${branchSlug}:director`;
    const dir = await rawRedis.get(dirKey);
    if (!dir) return NextResponse.json({ error: 'Müdür kaydı bulunamadı' }, { status: 404 });
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await rawRedis.set(dirKey, { ...dir, passwordHash, mustChangePassword: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'rename') {
    await rawRedis.set(`org:${org}:branch:${branchSlug}`, { ...currentMeta, name: parsed.data.name });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
}
