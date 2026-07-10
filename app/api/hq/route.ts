import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { currentOrg } from '@/lib/tenant';
import { withAuth, type Session } from '@/lib/auth';
import { parseBody, z, zName, zPassword } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';

// HQ (Genel Merkez) API — çok şubeli kurumların şube yönetimi.
// Erişim: org_admin (kendi org'u) veya superadmin (tüm org'lar).
// Tüm branch metadata GLOBAL (org:<slug>:* prefix'i, tenant prefix YOK).

function requireHQ(session: Session | null | undefined, org: string): boolean {
  if (!session) return false;
  if (session.role === 'superadmin') return true;
  if (session.role === 'org_admin' && session.org === org) return true;
  return false;
}

function isValidBranchSlug(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,38}$/.test(s) && s !== '__hq__';
}

// GET /api/hq — şube listesi + her şube için istatistik
// withAuth predicate: org_admin yalnız kendi org'unda (currentOrg header'dan çözülür).
export const GET = withAuth((s: Session) => requireHQ(s, currentOrg()), async () => {
  const org = currentOrg();

  const rows = await tdb().branch.findMany({ where: { orgSlug: org } });
  const metaMap: Record<string, { slug: string; name: string; active: boolean; createdAt: Date | string | null }> = {};
  rows.forEach((r) => { metaMap[r.slug] = r; });
  const branchSlugs = rows.length > 0 ? rows.map((r) => r.slug) : ['main'];

  const branches: { slug: string; name: string; active: boolean; createdAt: string | null; directorUsername: string | null; studentCount: number; teacherCount: number }[] = [];
  for (const slug of branchSlugs) {
    const meta = metaMap[slug] || { slug, name: slug === 'main' ? 'Ana Şube' : slug, active: true, createdAt: null };
    const dir = await tdb(org, slug).director.findFirst();
    const studentCount = await tdb(org, slug).student.count();
    const teacherCount = await tdb(org, slug).teacher.count();
    branches.push({
      slug,
      name: meta.name || slug,
      active: meta.active !== false,
      createdAt: meta.createdAt instanceof Date ? meta.createdAt.toISOString() : (meta.createdAt || null),
      directorUsername: dir?.username || null,
      studentCount, teacherCount,
    });
  }
  branches.sort((a, b) => {
    if (a.slug === 'main') return -1;
    if (b.slug === 'main') return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  const orgRec = await tdb().org.findFirst({ where: { slug: org } });
  return NextResponse.json({ org, orgName: orgRec?.name || org, branches, appDomain: process.env.APP_DOMAIN || '' });
});

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
export const POST = withAuth((s: Session) => requireHQ(s, currentOrg()), async (req) => {
  const org = currentOrg();

  const parsed = await parseBody(req, HQActionSchema);
  if (!parsed.ok) return parsed.response;
  const { action, branchSlug } = parsed.data;

  if (action === 'create_branch') {
    if (!isValidBranchSlug(branchSlug)) {
      return NextResponse.json({ error: 'Geçersiz slug — küçük harf, rakam ve tire, "main" dışında' }, { status: 400 });
    }
    const dup = await tdb().branch.findFirst({ where: { orgSlug: org, slug: branchSlug } });
    if (dup) return NextResponse.json({ error: `"${branchSlug}" şubesi zaten var` }, { status: 409 });
    const { name, directorUsername, directorPassword, directorName } = parsed.data;
    await tdb().branch.create({ data: { orgSlug: org, slug: branchSlug, name, active: true } });
    const passwordHash = await bcrypt.hash(directorPassword, 10);
    // tdb(org, branchSlug) enjeksiyonu doğru şubeye yazar — withScope tip iddiası aynı değerlerle dolar
    await tdb(org, branchSlug).director.create({ data: withScope({ username: directorUsername, passwordHash, name: directorName || name }) });
    return NextResponse.json({ ok: true, branchSlug });
  }

  const meta = await tdb().branch.findFirst({ where: { orgSlug: org, slug: branchSlug } });
  if (!meta && branchSlug !== 'main') return NextResponse.json({ error: 'Şube bulunamadı' }, { status: 404 });

  if (action === 'toggle_active') {
    if (branchSlug === 'main') return NextResponse.json({ error: 'Ana şube devre dışı bırakılamaz' }, { status: 400 });
    await tdb().branch.update({ where: { orgSlug_slug: { orgSlug: org, slug: branchSlug } }, data: { active: !meta!.active } });
    return NextResponse.json({ ok: true, active: !meta!.active });
  }
  if (action === 'reset_director') {
    const dir = await tdb(org, branchSlug).director.findFirst();
    if (!dir) return NextResponse.json({ error: 'Müdür kaydı bulunamadı' }, { status: 404 });
    await tdb(org, branchSlug).director.update({ where: { id: dir.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) } });
    return NextResponse.json({ ok: true });
  }
  if (action === 'rename') {
    if (meta) await tdb().branch.update({ where: { orgSlug_slug: { orgSlug: org, slug: branchSlug } }, data: { name: parsed.data.name } });
    else await tdb().branch.create({ data: { orgSlug: org, slug: branchSlug, name: parsed.data.name, active: true } }); // main fallback
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
});
