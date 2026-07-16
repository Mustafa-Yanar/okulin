import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { tenantRedis, currentOrg } from '@/lib/tenant';
import { orgFromHost } from '@/lib/org';
import { normalizeBranding } from '@/lib/branding';
import { getSession, setSession, clearSession } from '@/lib/auth';
import { loginRatelimit, passwordChangeRatelimit, getClientIp, formatResetWait, safeLimit, isSuperadminIpAllowed } from '@/lib/ratelimit';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zPassword, zNewPassword, zId } from '@/lib/validate';
import { sendOtp } from '@/lib/sms';
import { getOrgConfig } from '@/lib/config';
import { tdb } from '@/lib/sqldb';
import { verifyLogin, maskPhone, type RoleCategory } from '@/lib/login';

// Bilinçli withAuth istisnası: bu route'un kendisi LOGIN ucu — oturum burada kurulur.
// GET login ekranı için oturumsuz da çalışır; POST action'larının oturum gerektirenleri
// (change_password, reset_password, update_director_name) kendi içinde getSession doğrular.

// action'a göre ayrışan gövde — her işlemin yalnız kendi alanları doğrulanır.
const AuthSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), username: zName, password: zPassword, role: z.enum(['student', 'parent', 'teacher', 'management', 'superadmin']).optional() }),
  z.object({ action: z.literal('setup_director'), username: zName, password: zPassword, name: z.string().max(200).optional() }),
  z.object({ action: z.literal('update_director_name'), name: zName }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('change_password'), password: zPassword, newPassword: zNewPassword }),
  z.object({ action: z.literal('reset_password'), targetRole: z.enum(['teacher', 'student', 'accountant', 'counselor', 'assistant_director']), targetId: zId, newPassword: zNewPassword }),
]);

export async function GET() {
  const session = await getSession();
  const directorExists = (await tdb().director.count()) > 0;
  // Marka (org kaydı global) — login ekranı + header bunu kullanır.
  const orgRec = await tdb().org.findFirst({ where: { slug: currentOrg() } });
  // Kurum konfigürasyonu — istemcinin davranışını etkileyen alanlar (hassas değil,
  // tüm roller için döner). modules: Sidebar sekme gizleme. etut: self-rezervasyon butonu.
  // permissions: rehber salt-okunur ise yönetim butonlarını gizlemek için (UI; API ayrıca 403).
  const [modules, etut, permissions] = await Promise.all([
    getOrgConfig('modules'), getOrgConfig('etut'), getOrgConfig('permissions'),
  ]);
  return NextResponse.json({ session, directorExists: !!directorExists, branding: normalizeBranding(orgRec), modules, etut, permissions });
}

export async function POST(req: NextRequest) {
  const redis = tenantRedis(); // OTP cihaz tanıma alt-sistemi — hâlâ Redis (bkz aşağı NOT)
  const parsed = await parseBody(req, AuthSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  const { action } = data;

  if (action === 'login') {
    const { username, password } = data;
    // Rate limit kontrolü — IP + username birleşik key
    const ip = getClientIp(req);
    const rlKey = `${ip}:${(username || 'anon').toLowerCase()}`;
    const { success, reset } = await safeLimit(loginRatelimit, rlKey);
    if (!success) {
      return NextResponse.json(
        { error: `Çok fazla başarısız deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
        { status: 429 }
      );
    }

    const selectedRole = data.role;

    // ── superadmin 2FA cihaz tanıma (KORUNUR — yalnız superadmin bloğu kullanır) ──
    // NOT (2026-07-16): normal rollerin OTP/cihaz doğrulaması ASKIYA ALINDI (Mustafa).
    // Aşağıdaki maybeOtp/isKnownDevice yalnız superadmin login'inde çağrılır; normal
    // roller verifyLogin sonrası doğrudan cookie alır. Kod korunur (geri getirilebilir).
    const deviceToken = req.cookies.get('device_token')?.value;
    async function isKnownDevice(cat: string): Promise<boolean> {
      if (!deviceToken) return false;
      const found = await redis.get(`device:${cat}:${username}:${deviceToken}`);
      return !!found;
    }
    async function maybeOtp(cat: string, phone: string | null): Promise<NextResponse | null> {
      const known = await isKnownDevice(cat);
      if (known) return null;
      if (!phone) return null;
      try {
        await sendOtp(phone);
      } catch {
        return null;
      }
      return NextResponse.json({ needsOtp: true, phone: maskPhone(phone) }, { status: 200 });
    }

    // Superadmin (global, kurum-bağımsız) — WEB'E ÖZGÜ, mobilde HİÇ üretilmez.
    // GÜVENLİK: yalnız gizli süper-admin sayfasından (role:'superadmin') denenebilir.
    if (selectedRole === 'superadmin') {
      // GÜVENLİK: süper-admin YALNIZ apex domain'den (okulin.com) girilebilir.
      const host = headers().get('host');
      if (orgFromHost(host)) {
        return NextResponse.json({ error: 'Süper yönetici girişi bu adresten yapılamaz.' }, { status: 403 });
      }
      // IP kısıtı — SUPERADMIN_ALLOWED_IPS tanımlıysa yalnız listedeki IP'ler girebilir.
      if (!isSuperadminIpAllowed(getClientIp(req))) {
        return NextResponse.json({ error: 'Süper yönetici girişi bu ağdan yapılamaz.' }, { status: 403 });
      }
      const superadmin = await tdb().superAdmin.findFirst({ where: { username } });
      if (superadmin && superadmin.username === username) {
        const ok = await bcrypt.compare(password, superadmin.passwordHash);
        if (ok) {
          const saName = (superadmin as { name?: string }).name || 'Süper Admin';
          // 2FA: telefon kayıtlıysa + cihaz tanınmıyorsa OTP iste (KORUNUR).
          const otpRes = await maybeOtp('superadmin', superadmin.phone || null);
          if (otpRes) return otpRes;
          const res = NextResponse.json({ role: 'superadmin', name: saName });
          await setSession(res, { role: 'superadmin', id: 'superadmin', name: saName });
          return res;
        }
      }
      return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı.' }, { status: 401 });
    }

    // Ortak çekirdek: org_admin/director/rol tabloları/veli zinciri + rol kapısı +
    // veli modül geçidi (lib/login.ts — mobil login de aynı çekirdeği kullanır).
    // superadmin bloğu yukarıda return etti; kalan selectedRole RoleCategory'dir (cast).
    const result = await verifyLogin(username, password, selectedRole as RoleCategory | undefined);
    if (!result.ok) {
      return NextResponse.json(
        result.correctRole ? { error: result.error, correctRole: result.correctRole } : { error: result.error },
        { status: result.status }
      );
    }

    // OTP ASKIYA ALINDI — normal roller şifre doğruysa doğrudan giriş yapar.
    const res = NextResponse.json(result.payload);
    await setSession(res, result.payload);
    return res;
  }

  if (action === 'setup_director') {
    const { username, password, name } = data;
    const directorName = name || 'Müdür';
    const hash = await bcrypt.hash(password, 10);
    const exists = await tdb().director.findFirst();
    if (exists) return NextResponse.json({ error: 'Müdür zaten kayıtlı' }, { status: 400 });
    const { withScope } = await import('@/lib/sqldb');
    await tdb().director.create({ data: withScope({ username, passwordHash: hash, name: directorName }) });
    const res = NextResponse.json({ ok: true });
    await setSession(res, { role: 'director', id: 'director', name: directorName });
    return res;
  }

  if (action === 'update_director_name') {
    const { name } = data;
    const session = await getSession();
    if (!session || session.role !== 'director') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const dir = await tdb().director.findFirst();
    if (!dir) return NextResponse.json({ error: 'Müdür bulunamadı' }, { status: 404 });
    await tdb().director.update({ where: { id: dir.id }, data: { name } });
    const res = NextResponse.json({ ok: true });
    await setSession(res, { role: 'director', id: 'director', name });
    return res;
  }

  if (action === 'logout') {
    const res = NextResponse.json({ ok: true });
    await clearSession(res);
    return res;
  }

  // Kendi şifresini değiştir (mevcut şifre doğrulanır)
  if (action === 'change_password') {
    const { password, newPassword } = data;
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

    // Rate limit — oturumu kapılmış birinin mevcut şifre tahminini yavaşlat
    const ip = getClientIp(req);
    const pwRlKey = `${ip}:${session.id}`;
    const pwRl = await safeLimit(passwordChangeRatelimit, pwRlKey);
    if (!pwRl.success) {
      return NextResponse.json(
        { error: `Çok fazla deneme. Lütfen ${formatResetWait(pwRl.reset)} tekrar deneyin.` },
        { status: 429 }
      );
    }

    // Şifre değiştirme yardımcısı — başarılı değişimde mustChangePassword:false setler
    // ve session JWT'sini yeniler (frontend, yeni mustChange durumunu görsün).
    // Dinamik model erişimi: rol → Prisma delegesi eşlemesi statik ifade edilemez (cast gerekçeli).
    async function updatePasswordFor(roleKey: string, sessionPayloadFields: Record<string, unknown>): Promise<NextResponse> {
      const db = tdb() as unknown as Record<string, {
        findFirst: (a: { where: Record<string, string | undefined> }) => Promise<{ id: string; passwordHash: string } | null>;
        update: (a: { where: { id: string }; data: { passwordHash: string; mustChangePassword: boolean } }) => Promise<unknown>;
      }>;
      const rec = roleKey === 'parent'
        ? await db.parent.findFirst({ where: { phone: session!.id } })
        : await db[roleKey].findFirst({ where: { legacyId: session!.id } });
      if (!rec) return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
      const ok = await bcrypt.compare(password, rec.passwordHash);
      if (!ok) return NextResponse.json({ error: 'Mevcut şifre hatalı' }, { status: 400 });
      const newHash = await bcrypt.hash(newPassword, 10);
      await db[roleKey].update({ where: { id: rec.id }, data: { passwordHash: newHash, mustChangePassword: false } });
      const res = NextResponse.json({ ok: true });
      await setSession(res, { ...session!, mustChangePassword: false, ...sessionPayloadFields });
      return res;
    }

    // Müdür yardımcısı: oturumda role='director' ama asst:true → kendi
    // assistant_director kaydını hedefle (müdürün 'director' kaydını DEĞİL).
    if (session.role === 'director' && session.asst) {
      return updatePasswordFor('assistantDirector', { asst: true });
    }
    if (session.role === 'teacher') {
      return updatePasswordFor('teacher', { branches: session.branches, allowedGroups: session.allowedGroups });
    }
    if (session.role === 'student') {
      return updatePasswordFor('student', { cls: session.cls, group: session.group });
    }
    if (session.role === 'accountant') {
      return updatePasswordFor('accountant', {});
    }
    if (session.role === 'counselor') {
      return updatePasswordFor('counselor', {});
    }
    if (session.role === 'parent') {
      return updatePasswordFor('parent', { children: session.children });
    }

    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Müdür başkasının şifresini sıfırlar
  if (action === 'reset_password') {
    const { targetRole, targetId, newPassword } = data;
    const session = await getSession();
    if (!session || session.role !== 'director') {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    const labels: Record<string, string> = { teacher: 'Öğretmen', student: 'Öğrenci', accountant: 'Muhasebeci', counselor: 'Rehber', assistant_director: 'Müdür yardımcısı' };
    // targetRole snake_case olabilir; Prisma model adı camelCase.
    const MODEL: Record<string, string> = { assistant_director: 'assistantDirector' };
    const model = MODEL[targetRole] || targetRole;
    // Dinamik model erişimi: rol → Prisma delegesi eşlemesi statik ifade edilemez (cast gerekçeli).
    const db = tdb() as unknown as Record<string, {
      findFirst: (a: { where: { legacyId: string } }) => Promise<{ id: string; name?: string | null } | null>;
      update: (a: { where: { id: string }; data: { passwordHash: string; mustChangePassword: boolean } }) => Promise<unknown>;
    }>;
    const rec = await db[model].findFirst({ where: { legacyId: targetId } });
    if (!rec) return NextResponse.json({ error: `${labels[targetRole]} bulunamadı` }, { status: 404 });
    await db[model].update({ where: { id: rec.id }, data: { passwordHash: hash, mustChangePassword: true } });
    await logAudit({ ...actorFrom(session), action: 'auth.resetPassword', target: { type: targetRole, id: targetId, name: rec.name || targetId }, detail: `${labels[targetRole]} şifresi sıfırlandı: ${rec.name || targetId}` });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}
