import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAuth } from '@/lib/auth';
import { parseBody, z, zName, zPassword } from '@/lib/validate';
import { generateOrgCode, formatCode, hostForOrg } from '@/lib/orgcode';
import { addProjectDomain } from '@/lib/vercel';
import { normalizeFacets } from '@/lib/institution';
import { normalizeTurkishMobile } from '@/lib/phone';
import { tdb, withScope } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';

// Kurum silmede temizlenecek tenant tabloları (orgSlug bazında, tüm şubeler). Cascade
// alt tabloları (Installment/BehaviorEntry/ExamRow/FormResponse/AnnouncementRecipient) otomatik.
const TENANT_MODELS = [
  'director', 'counselor', 'accountant', 'parent', 'teacher', 'student', 'class', 'course',
  'slotBooking', 'tenantConfig', 'finance', 'expense', 'attendance', 'behavior', 'exam',
  'odev', 'hedef', 'etkinlik', 'form', 'lead', 'announcement', 'resource', 'topic',
  'guidance', 'auditLog', 'errLog', 'pushSub', 'payOrder',
  // Mobil + bildirim tabloları (Plan 3, İnceleme Codex #5): kurum silinince cihaz
  // oturumları/kayıtları ve bildirim kuyruğu da gitmeli — kalan MobileSession,
  // silinmiş kurumun host'unda çalışmaya devam ederdi.
  'assistantDirector', 'notifLog', 'notificationEvent', 'notificationDelivery',
  'mobileSession', 'deviceInstallation', 'notificationPreference',
];

// Erişim: yalnız superadmin rolü (withAuth(['superadmin'])).

// Slug doğrulama: küçük harf, yalnız a-z0-9-, 2-40 karakter.
function isValidSlug(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/.test(s);
}

interface OrgListItem {
  slug: string; name: string; shortName: string | null; themeColor: string | null;
  active: boolean; createdAt: string | null; type: string; code: string | null;
  sektor: string; mulkiyet: string; kademeler: string[];
  directorUsername?: string | null; branchCount?: number;
}

// GET /api/superadmin — tüm kurumları listele
export const GET = withAuth(['superadmin'], async () => {

  const rows = await tdb().org.findMany();
  const recs = rows.map((r) => ({ ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt }));
  if (!recs || recs.length === 0) return NextResponse.json({ orgs: [] });

  const orgs: OrgListItem[] = recs.map((rec) => {
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
  for (const o of orgs) {
    const dir = await tdb(o.slug, 'main').director.findFirst();
    o.directorUsername = dir?.username || null;
    o.branchCount = o.type === 'multi' ? await tdb().branch.count({ where: { orgSlug: o.slug } }) : 1;
  }

  const sa = await tdb().superAdmin.findFirst();
  return NextResponse.json({ orgs, superadmin: { hasPhone: !!sa?.phone } });
});

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
  // multi-type için org_admin bilgileri. Tek şubeli kurumda form bu alanları boş
  // string ('') olarak gönderir → zName/zPassword min(1) reddeder. Boş string'i de
  // kabul et (multi zorunluluğu aşağıda ayrıca kontrol edilir).
  orgAdminUsername: zName.or(z.literal('')).optional(),
  orgAdminPassword: zPassword.or(z.literal('')).optional(),
  orgAdminName: z.string().max(200).optional(),
});

const UpdateOrgSchema = z.object({
  action: z.enum(['toggle_active', 'reset_director', 'rename', 'change_own_password', 'provision_domain', 'set_own_phone']),
  slug: z.string().min(2).max(40).optional(),
  // toggle_active: ilave alan yok
  // reset_director / change_own_password:
  currentPassword: zPassword.optional(),
  newPassword: zPassword.optional(),
  // rename:
  name: z.string().min(1).max(120).optional(),
  shortName: z.string().max(60).optional(),
  // set_own_phone: boş string = 2FA kapat
  phone: z.string().max(30).optional(),
});

// POST /api/superadmin — yeni kurum + müdür oluştur
export const POST = withAuth(['superadmin'], async (req) => {

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

  const dup = await tdb().org.findFirst({ where: { slug } });
  if (dup) return NextResponse.json({ error: `"${slug}" zaten kayıtlı` }, { status: 409 });

  // Benzersiz kurum kodu (Org.code ile reverse-lookup; ayrı orgcode kaydı gerekmez)
  let code: string | undefined;
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
  // tdb(slug,'main') enjeksiyonu doğru kuruma yazar — withScope tip iddiası aynı değerlerle dolar
  await tdb(slug, 'main').director.create({ data: withScope({ username: directorUsername, passwordHash, name: directorName || name }) });

  // Çok şubeli: org_admin + 'main' şube kaydı
  if (orgType === 'multi') {
    // multi ise orgAdminUsername/Password yukarıdaki 400 guard'ında doğrulandı — burada kesin dolu.
    const adminHash = await bcrypt.hash(orgAdminPassword!, 10);
    await tdb().orgAdmin.create({ data: { orgSlug: slug, username: orgAdminUsername!, passwordHash: adminHash, name: orgAdminName || name } });
    await tdb().branch.create({ data: { orgSlug: slug, slug: 'main', name: 'Ana Şube', active: true } });
  }

  const domain = hostForOrg(slug, 'main');
  const domainResult = await addProjectDomain(domain);
  return NextResponse.json({
    ok: true, slug, type: orgType, code: formatCode(code), domain,
    domainProvisioned: domainResult.ok,
    domainWarning: domainResult.ok ? null : (domainResult.error || 'Domain eklenemedi'),
  });
});

// DELETE /api/superadmin — kurumu ve tüm verisini kalıcı sil
export const DELETE = withAuth(['superadmin'], async (req) => {

  const parsed = await parseBody(req, z.object({ slug: z.string().min(2).max(40) }));
  if (!parsed.ok) return parsed.response;
  const { slug } = parsed.data;

  const org = await tdb().org.findFirst({ where: { slug } });
  if (!org) return NextResponse.json({ error: 'Kurum bulunamadı' }, { status: 404 });
  let deleted = 0;
  for (const m of TENANT_MODELS) {
    // Dinamik model erişimi: TENANT_MODELS listesi elle bakımlı — tip birleşimi statik ifade edilemez.
    try { const r = await (prisma[m as 'director'] as unknown as { deleteMany: (a: { where: { orgSlug: string } }) => Promise<{ count: number }> }).deleteMany({ where: { orgSlug: slug } }); deleted += r.count; } catch { /* model yoksa atla */ }
  }
  await prisma.branch.deleteMany({ where: { orgSlug: slug } });
  await prisma.orgAdmin.deleteMany({ where: { orgSlug: slug } });
  await prisma.org.delete({ where: { slug } });
  return NextResponse.json({ ok: true, deleted });
});

// PATCH /api/superadmin — kurum güncelle (aktif/pasif, müdür şifresi, ad)
export const PATCH = withAuth(['superadmin'], async (req) => {

  const parsed = await parseBody(req, UpdateOrgSchema);
  if (!parsed.ok) return parsed.response;
  const { action, slug, newPassword, name, shortName } = parsed.data;

  // Kendine-özel action'lar (kurum değil, süper-adminin kendi hesabı) — slug ZORUNLU DEĞİL.
  if (action === 'change_own_password') {
    const { currentPassword, newPassword: newPw } = parsed.data;
    if (!currentPassword || !newPw) return NextResponse.json({ error: 'currentPassword ve newPassword gerekli' }, { status: 400 });
    const sa = await tdb().superAdmin.findFirst();
    if (!sa) return NextResponse.json({ error: 'Superadmin kaydı bulunamadı' }, { status: 404 });
    if (!(await bcrypt.compare(currentPassword, sa.passwordHash))) return NextResponse.json({ error: 'Mevcut şifre yanlış' }, { status: 401 });
    await tdb().superAdmin.update({ where: { id: sa.id }, data: { passwordHash: await bcrypt.hash(newPw, 10) } });
    return NextResponse.json({ ok: true });
  }
  if (action === 'set_own_phone') {
    const { phone } = parsed.data;
    const sa = await tdb().superAdmin.findFirst();
    if (!sa) return NextResponse.json({ error: 'Superadmin kaydı bulunamadı' }, { status: 404 });
    if (!phone || !phone.trim()) {
      // Boş → 2FA kapat
      await tdb().superAdmin.update({ where: { id: sa.id }, data: { phone: null } });
      return NextResponse.json({ ok: true, hasPhone: false });
    }
    const norm = normalizeTurkishMobile(phone);
    if (!norm) return NextResponse.json({ error: 'Geçersiz telefon numarası' }, { status: 400 });
    await tdb().superAdmin.update({ where: { id: sa.id }, data: { phone: norm } });
    return NextResponse.json({ ok: true, hasPhone: true });
  }

  if (!slug) return NextResponse.json({ error: 'slug gerekli' }, { status: 400 });

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
    const data: { name: string; shortName?: string | null } = { name };
    if (shortName !== undefined) data.shortName = shortName || null;
    await tdb().org.update({ where: { slug }, data });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Geçersiz action' }, { status: 400 });
});
