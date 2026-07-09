import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { tenantRedis, currentOrg } from '@/lib/tenant';
import { orgFromHost } from '@/lib/org';
import { normalizeBranding } from '@/lib/branding';
import { getSession, setSession, clearSession } from '@/lib/auth';
import { loginRatelimit, passwordChangeRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';
import { logAudit, actorFrom } from '@/lib/audit';
import { normalizeTurkishMobile } from '@/lib/phone';
import { parseBody, z, zName, zPassword, zNewPassword, zId } from '@/lib/validate';
import { sendOtp } from '@/lib/sms';
import { getOrgConfig } from '@/lib/config';
import { tdb } from '@/lib/sqldb';

// SQL rol satırını makeLoginResponse'un beklediği eski (Redis) kayıt şekline çevirir.
// id = legacyId (parent: phone); student.cls = class.legacyId (cuid DEĞİL).
function sqlRecToLegacy(role, r) {
  if (!r) return null;
  const base = { name: r.name, phone: r.phone || null, passwordHash: r.passwordHash, mustChangePassword: !!r.mustChangePassword };
  if (role === 'teacher') return { ...base, id: r.legacyId, branches: r.branches || [], allowedGroups: r.allowedGroups || [] };
  if (role === 'student') return { ...base, id: r.legacyId, cls: r.class?.legacyId || '', group: r.group };
  if (role === 'parent') return { ...base, id: r.phone, name: r.name || '', children: r.children || [] };
  return { ...base, id: r.legacyId }; // accountant | counselor | assistant_director
}

// Telefon numarasının ortasını maskele: "0532***67"
function maskPhone(phone) {
  if (!phone || phone.length < 7) return '***';
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

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

export async function POST(req) {
  const redis = tenantRedis(); // OTP cihaz tanıma alt-sistemi — hâlâ Redis (bkz aşağı NOT)
  const parsed = await parseBody(req, AuthSchema);
  if (!parsed.ok) return parsed.response;
  const { action, username, password, newPassword, targetId, targetRole, name } = parsed.data;

  if (action === 'login') {
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

    // Katı rol seçimi + akıllı yönlendirme. Kullanıcı bir rol kartı seçer; bilgileri
    // doğru ama seçtiği rol hesabın gerçek rolüyle uyuşmuyorsa, doğru girişe yönlendir.
    // selectedRole yoksa (eski client) kapı devre dışı — geri uyumlu.
    const selectedRole = parsed.data.role;
    const CATEGORY_LABEL = { student: 'Öğrenci', parent: 'Veli', teacher: 'Öğretmen', management: 'Yönetim' };
    function roleCategory(role) {
      if (role === 'student') return 'student';
      if (role === 'parent') return 'parent';
      if (role === 'teacher') return 'teacher';
      return 'management'; // director, accountant, org_admin, superadmin
    }
    function gateMismatch(actualRole) {
      if (!selectedRole) return null;
      const actualCat = roleCategory(actualRole);
      if (actualCat === selectedRole) return null;
      return NextResponse.json({
        error: `Bu bilgiler ${CATEGORY_LABEL[actualCat]} hesabına ait. Lütfen "${CATEGORY_LABEL[actualCat]}" girişini kullanın.`,
        correctRole: actualCat,
      }, { status: 403 });
    }

    // Cihaz tanıma: güvenilir cihaz cookie'si var ve Redis'te geçerliyse OTP atlanır.
    // NOT: cihaz tanıma alt-sistemi (device:*) SQL'e taşınmadı — kısa ömürlü/geçici veri,
    // Redis TTL doğası ile uyumlu. Ayrı bir göç işi.
    const deviceToken = req.cookies.get('device_token')?.value;
    async function isKnownDevice(roleCategory) {
      if (!deviceToken) return false;
      const key = `device:${roleCategory}:${username}:${deviceToken}`;
      const data = await redis.get(key);
      return !!data;
    }

    // Cihaz tanınmadığında OTP akışını başlat (telefon varsa SMS gönder).
    async function maybeOtp(roleCategory, phone) {
      const known = await isKnownDevice(roleCategory);
      if (known) return null; // null = OTP yok, normal login devam etsin
      if (!phone) return null; // telefon kayıtlı değil → OTP atla (geri uyumluluk)
      try { await sendOtp(phone); } catch { /* SMS hatası login'i engellemesin */ }
      return NextResponse.json({ needsOtp: true, phone: maskPhone(phone) }, { status: 200 });
    }

    // Kayıttan oturum yanıtı üret (rol bazlı payload).
    async function makeLoginResponse(role, rec) {
      const gate = gateMismatch(role);
      if (gate) return gate;

      // Cihaz tanıma — roleCategory = selectedRole varsa o, yoksa gerçek rolden türetilir
      const cat = selectedRole || roleCategory(role);
      const phone = rec.phone || null;
      const otpRes = await maybeOtp(cat, phone);
      if (otpRes) return otpRes;

      let payload;
      if (role === 'teacher') {
        const branches = Array.isArray(rec.branches) ? rec.branches
          : [rec.branch, ...(rec.extraBranches || [])].filter(Boolean); // eski kayıt fallback
        payload = { role: 'teacher', id: rec.id, name: rec.name, branches, allowedGroups: rec.allowedGroups || [], mustChangePassword: !!rec.mustChangePassword };
      } else if (role === 'student') {
        payload = { role: 'student', id: rec.id, name: rec.name, cls: rec.cls, group: rec.group, mustChangePassword: !!rec.mustChangePassword };
      } else if (role === 'parent') {
        const children = Array.isArray(rec.children) ? rec.children : [];
        // Veli adı: kayıttaki gerçek ad (öğrenci formundan girilir). Header her zaman dolu
        // olmalı → ad yoksa eski türetmeye düş. parentName ise SADECE gerçek ad (panel
        // karşılaması için; boşsa karşılama gösterilmez).
        const realName = rec.name || '';
        const headerName = realName || (children.length === 1 ? `${children[0].name} (Veli)` : 'Veli');
        payload = { role: 'parent', id: rec.id, name: headerName, parentName: realName, children, mustChangePassword: !!rec.mustChangePassword };
      } else if (role === 'assistant_director') {
        // Müdür yardımcısı: oturumda MÜDÜRLE BİREBİR aynı → role='director'. asst:true
        // yalnız UI etiketi ("Müdür Yardımcısı") + audit ayrımı için. id = kendi legacyId'si
        // (müdür 'director' sabitinden ayrışır, şifre değişimi kendi kaydını hedefler).
        payload = { role: 'director', asst: true, id: rec.id, name: rec.name, mustChangePassword: !!rec.mustChangePassword };
      } else { // accountant veya counselor (rehber) — aynı şekil
        payload = { role, id: rec.id, name: rec.name, mustChangePassword: !!rec.mustChangePassword };
      }
      const res = NextResponse.json(payload);
      await setSession(res, payload);
      return res;
    }

    // Superadmin (global, kurum-bağımsız).
    // GÜVENLİK: yalnız gizli süper-admin sayfasından (role:'superadmin') denenebilir.
    // Normal "Yönetim" girişi (role:'management' veya role yok) superadmin'i HİÇ kontrol
    // etmez → süper-admin varlığı kurum giriş ekranından sızmaz/denenmez.
    if (selectedRole === 'superadmin') {
      // GÜVENLİK: süper-admin YALNIZ apex domain'den (okulin.com) girilebilir.
      // Kurum subdomain'inde (testkurs.okulin.com) süper-admin girişi reddedilir —
      // kurum-üstü rol, kurum bağlamından tamamen ayrı tutulur. orgFromHost apex/www'da
      // null, subdomain'de kurum slug'ı döner.
      const host = headers().get('host');
      if (orgFromHost(host)) {
        return NextResponse.json({ error: 'Süper yönetici girişi bu adresten yapılamaz.' }, { status: 403 });
      }
      const superadmin = await tdb().superAdmin.findFirst({ where: { username } });
      if (superadmin && superadmin.username === username) {
        const ok = await bcrypt.compare(password, superadmin.passwordHash);
        if (ok) {
          const saName = superadmin.name || 'Süper Admin';
          const res = NextResponse.json({ role: 'superadmin', name: saName });
          await setSession(res, { role: 'superadmin', id: 'superadmin', name: saName });
          return res;
        }
      }
      // superadmin sayfasından gelen başarısız deneme → sadece superadmin denenir,
      // başka role'e düşmesin (kurum hesapları bu kapıdan girmesin).
      return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı.' }, { status: 401 });
    }

    // Org_admin (kurum-geneli, şube-bağımsız).
    const org = currentOrg();
    const orgAdmin = await tdb().orgAdmin.findFirst({ where: { orgSlug: org, username } });
    if (orgAdmin && orgAdmin.username === username) {
      const ok = await bcrypt.compare(password, orgAdmin.passwordHash);
      if (ok) {
        const gate = gateMismatch('org_admin'); if (gate) return gate;
        // Org admin için cihaz tanıma yok
        const res = NextResponse.json({ role: 'org_admin', name: orgAdmin.name });
        await setSession(res, { role: 'org_admin', id: 'org_admin', name: orgAdmin.name });
        return res;
      }
    }

    // Director (zaten O(1)) — Director tablosundan username ile.
    const director = await tdb().director.findFirst({ where: { username } });
    if (director && director.username === username) {
      const ok = await bcrypt.compare(password, director.passwordHash);
      if (ok) {
        const gate = gateMismatch('director'); if (gate) return gate;
        // Director: cihaz tanıma uygula (Director kaydında telefon yok → OTP atlanır)
        const otpRes = await maybeOtp('management', director.phone || null);
        if (otpRes) return otpRes;
        const res = NextResponse.json({ role: 'director', name: director.name });
        await setSession(res, { role: 'director', id: 'director', name: director.name });
        return res;
      }
    }

    // Rol tablolarını username ile doğrudan sorgula.
    // Sıra: assistant_director→accountant→counselor→teacher→student, sonra veli.
    const normP = normalizeTurkishMobile(username);
    const tryRole = async (role, sqlRec) => {
      const rec = sqlRecToLegacy(role, sqlRec);
      if (!rec) return null;
      const ok = await bcrypt.compare(password, rec.passwordHash);
      if (!ok) return null;
      return makeLoginResponse(role, rec);
    };
    let r;
    r = await tryRole('assistant_director', await tdb().assistantDirector.findFirst({ where: { username } })); if (r) return r;
    r = await tryRole('accountant', await tdb().accountant.findFirst({ where: { username } })); if (r) return r;
    r = await tryRole('counselor', await tdb().counselor.findFirst({ where: { username } })); if (r) return r;
    r = await tryRole('teacher', await tdb().teacher.findFirst({ where: { username } })); if (r) return r;
    r = await tryRole('student', await tdb().student.findFirst({ where: { username }, include: { class: { select: { legacyId: true } } } })); if (r) return r;
    // Veli: kullanıcı adı = telefon (ham veya kanonik); kayıtlı phone kanonik.
    const phones = [username, normP].filter(Boolean);
    const parent = phones.length ? await tdb().parent.findFirst({ where: { phone: { in: phones } } }) : null;
    r = await tryRole('parent', parent); if (r) return r;
    return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı' }, { status: 401 });
  }

  if (action === 'setup_director') {
    const directorName = name || 'Müdür';
    const hash = await bcrypt.hash(password, 10);
    const exists = await tdb().director.findFirst();
    if (exists) return NextResponse.json({ error: 'Müdür zaten kayıtlı' }, { status: 400 });
    await tdb().director.create({ data: { username, passwordHash: hash, name: directorName } });
    const res = NextResponse.json({ ok: true });
    await setSession(res, { role: 'director', id: 'director', name: directorName });
    return res;
  }

  if (action === 'update_director_name') {
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
    async function updatePasswordFor(roleKey, sessionPayloadFields) {
      const rec = roleKey === 'parent'
        ? await tdb().parent.findFirst({ where: { phone: session.id } })
        : await tdb()[roleKey].findFirst({ where: { legacyId: session.id } });
      if (!rec) return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
      const ok = await bcrypt.compare(password, rec.passwordHash);
      if (!ok) return NextResponse.json({ error: 'Mevcut şifre hatalı' }, { status: 400 });
      const newHash = await bcrypt.hash(newPassword, 10);
      await tdb()[roleKey].update({ where: { id: rec.id }, data: { passwordHash: newHash, mustChangePassword: false } });
      const res = NextResponse.json({ ok: true });
      await setSession(res, { ...session, mustChangePassword: false, ...sessionPayloadFields });
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
    const session = await getSession();
    if (!session || session.role !== 'director') {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    const labels = { teacher: 'Öğretmen', student: 'Öğrenci', accountant: 'Muhasebeci', counselor: 'Rehber', assistant_director: 'Müdür yardımcısı' };
    // targetRole snake_case olabilir; Prisma model adı camelCase.
    const MODEL = { assistant_director: 'assistantDirector' };
    const model = MODEL[targetRole] || targetRole;
    const rec = await tdb()[model].findFirst({ where: { legacyId: targetId } });
    if (!rec) return NextResponse.json({ error: `${labels[targetRole]} bulunamadı` }, { status: 404 });
    await tdb()[model].update({ where: { id: rec.id }, data: { passwordHash: hash, mustChangePassword: true } });
    await logAudit({ ...actorFrom(session), action: 'auth.resetPassword', target: { type: targetRole, id: targetId, name: rec.name || targetId }, detail: `${labels[targetRole]} şifresi sıfırlandı: ${rec.name || targetId}` });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}
