import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { tenantRedis, rawRedis, currentOrg } from '@/lib/tenant';
import { normalizeBranding } from '@/lib/branding';
import { getSession, setSession, clearSession } from '@/lib/auth';
import { loginRatelimit, passwordChangeRatelimit, getClientIp, formatResetWait } from '@/lib/ratelimit';
import { logAudit, actorFrom } from '@/lib/audit';
import { lookupIndex } from '@/lib/userIndex';
import { normalizeTurkishMobile } from '@/lib/phone';
import { parseBody, z, zName, zPassword, zNewPassword, zId } from '@/lib/validate';

// action'a göre ayrışan gövde — her işlemin yalnız kendi alanları doğrulanır.
const AuthSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), username: zName, password: zPassword }),
  z.object({ action: z.literal('setup_director'), username: zName, password: zPassword, name: z.string().max(200).optional() }),
  z.object({ action: z.literal('update_director_name'), name: zName }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('change_password'), password: zPassword, newPassword: zNewPassword }),
  z.object({ action: z.literal('reset_password'), targetRole: z.enum(['teacher', 'student', 'accountant']), targetId: zId, newPassword: zNewPassword }),
]);

export async function GET() {
  const redis = tenantRedis();
  const session = await getSession();
  const directorExists = await redis.exists('director');
  // Marka (org kaydı global — t: prefix YOK) — login ekranı + header bunu kullanır.
  const orgRec = await rawRedis.get(`org:${currentOrg()}`);
  return NextResponse.json({ session, directorExists: !!directorExists, branding: normalizeBranding(orgRec) });
}

export async function POST(req) {
  const redis = tenantRedis();
  const parsed = await parseBody(req, AuthSchema);
  if (!parsed.ok) return parsed.response;
  const { action, username, password, newPassword, targetId, targetRole, name } = parsed.data;

  if (action === 'login') {
    // Rate limit kontrolü — IP + username birleşik key
    const ip = getClientIp(req);
    const rlKey = `${ip}:${(username || 'anon').toLowerCase()}`;
    const { success, reset } = await loginRatelimit.limit(rlKey);
    if (!success) {
      return NextResponse.json(
        { error: `Çok fazla başarısız deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
        { status: 429 }
      );
    }

    // Kayıttan oturum yanıtı üret (rol bazlı payload).
    async function makeLoginResponse(role, rec) {
      let payload;
      if (role === 'teacher') {
        const branches = Array.isArray(rec.branches) ? rec.branches
          : [rec.branch, ...(rec.extraBranches || [])].filter(Boolean); // eski kayıt fallback
        payload = { role: 'teacher', id: rec.id, name: rec.name, branches, allowedGroups: rec.allowedGroups || [], mustChangePassword: !!rec.mustChangePassword };
      } else if (role === 'student') {
        payload = { role: 'student', id: rec.id, name: rec.name, cls: rec.cls, group: rec.group, mustChangePassword: !!rec.mustChangePassword };
      } else if (role === 'parent') {
        const children = Array.isArray(rec.children) ? rec.children : [];
        const name = children.length === 1 ? `${children[0].name} (Veli)` : 'Veli';
        payload = { role: 'parent', id: rec.id, name, children, mustChangePassword: !!rec.mustChangePassword };
      } else { // accountant
        payload = { role: 'accountant', id: rec.id, name: rec.name, mustChangePassword: !!rec.mustChangePassword };
      }
      const res = NextResponse.json(payload);
      await setSession(res, payload);
      return res;
    }

    // Superadmin (global, kurum-bağımsız) — tenantRedis yerine rawRedis.
    const superadmin = await rawRedis.get('superadmin');
    if (superadmin && superadmin.username === username) {
      const ok = await bcrypt.compare(password, superadmin.passwordHash);
      if (ok) {
        const res = NextResponse.json({ role: 'superadmin', name: superadmin.name });
        await setSession(res, { role: 'superadmin', id: 'superadmin', name: superadmin.name });
        return res;
      }
    }

    // Org_admin (kurum-geneli, şube-bağımsız) — rawRedis'te orgadmin:<org> anahtarı.
    const org = currentOrg();
    const orgAdmin = await rawRedis.get(`orgadmin:${org}`);
    if (orgAdmin && orgAdmin.username === username) {
      const ok = await bcrypt.compare(password, orgAdmin.passwordHash);
      if (ok) {
        const res = NextResponse.json({ role: 'org_admin', name: orgAdmin.name });
        await setSession(res, { role: 'org_admin', id: 'org_admin', name: orgAdmin.name });
        return res;
      }
    }

    // Try director (zaten O(1))
    const director = await redis.get('director');
    if (director && director.username === username) {
      const ok = await bcrypt.compare(password, director.passwordHash);
      if (ok) {
        const res = NextResponse.json({ role: 'director', name: director.name });
        await setSession(res, { role: 'director', id: 'director', name: director.name });
        return res;
      }
    }

    // HIZLI YOL: ters indeks (O(1)). Başarılı login burada döner, tarama yok.
    // Veli kullanıcı adı = telefon → "0532..." girilse de kanonik forma normalize edip
    // hem ham hem normalize adayları dener (veli telefonu kanonik kayıtlı).
    const normPhone = normalizeTurkishMobile(username);
    const candidates = await lookupIndex(username);
    if (normPhone && normPhone !== username) {
      candidates.push(...await lookupIndex(normPhone));
    }
    for (const c of candidates) {
      const rec = await redis.get(`${c.role}:${c.id}`);
      if (rec && (rec.username === username || (normPhone && rec.username === normPhone))) {
        const ok = await bcrypt.compare(password, rec.passwordHash);
        if (ok) return makeLoginResponse(c.role, rec);
      }
    }

    // GÜVENLİK AĞI: indeks eksik/stale ise eski lineer tarama (yalnız başarısız
    // login'lerde çalışır — başarılılar yukarıda döndü; başarısızlar rate-limitli).
    async function scanRole(role) {
      const ids = await redis.smembers(`${role}s`);
      if (!ids || ids.length === 0) return null;
      const pipeline = redis.pipeline();
      ids.forEach(id => pipeline.get(`${role}:${id}`));
      const recs = await pipeline.exec();
      for (const rec of recs) {
        if (rec && rec.username === username) {
          const ok = await bcrypt.compare(password, rec.passwordHash);
          if (ok) return makeLoginResponse(role, rec);
        }
      }
      return null;
    }
    for (const role of ['accountant', 'teacher', 'student']) {
      const res = await scanRole(role);
      if (res) return res;
    }

    return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı' }, { status: 401 });
  }

  if (action === 'setup_director') {
    const exists = await redis.exists('director');
    if (exists) return NextResponse.json({ error: 'Müdür zaten kayıtlı' }, { status: 400 });
    const hash = await bcrypt.hash(password, 10);
    const directorName = name || 'Müdür';
    await redis.set('director', { username, passwordHash: hash, name: directorName });
    const res = NextResponse.json({ ok: true });
    await setSession(res, { role: 'director', id: 'director', name: directorName });
    return res;
  }

  if (action === 'update_director_name') {
    const session = await getSession();
    if (!session || session.role !== 'director') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const director = await redis.get('director');
    if (!director) return NextResponse.json({ error: 'Müdür bulunamadı' }, { status: 404 });
    await redis.set('director', { ...director, name });
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
    const pwRl = await passwordChangeRatelimit.limit(pwRlKey);
    if (!pwRl.success) {
      return NextResponse.json(
        { error: `Çok fazla deneme. Lütfen ${formatResetWait(pwRl.reset)} tekrar deneyin.` },
        { status: 429 }
      );
    }

    // Şifre değiştirme yardımcısı — başarılı değişimde mustChangePassword:false setler
    // ve session JWT'sini yeniler (frontend, yeni mustChange durumunu görsün).
    async function updatePasswordFor(roleKey, sessionPayloadFields) {
      const key = `${roleKey}:${session.id}`;
      const user = await redis.get(key);
      if (!user) return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return NextResponse.json({ error: 'Mevcut şifre hatalı' }, { status: 400 });
      const newHash = await bcrypt.hash(newPassword, 10);
      await redis.set(key, { ...user, passwordHash: newHash, mustChangePassword: false });
      // Session JWT yenile: mustChangePassword:false olarak
      const res = NextResponse.json({ ok: true });
      await setSession(res, { ...session, mustChangePassword: false, ...sessionPayloadFields });
      return res;
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

    if (targetRole === 'teacher') {
      const t = await redis.get(`teacher:${targetId}`);
      if (!t) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
      // Müdür sıfırladığında: hedef ilk girişte yine kendi şifresini belirleyecek
      await redis.set(`teacher:${targetId}`, { ...t, passwordHash: hash, mustChangePassword: true });
      await logAudit({ ...actorFrom(session), action: 'auth.resetPassword', target: { type: 'teacher', id: targetId, name: t.name || targetId }, detail: `Öğretmen şifresi sıfırlandı: ${t.name || targetId}` });
      return NextResponse.json({ ok: true });
    }

    if (targetRole === 'student') {
      const s = await redis.get(`student:${targetId}`);
      if (!s) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });
      await redis.set(`student:${targetId}`, { ...s, passwordHash: hash, mustChangePassword: true });
      await logAudit({ ...actorFrom(session), action: 'auth.resetPassword', target: { type: 'student', id: targetId, name: s.name || targetId }, detail: `Öğrenci şifresi sıfırlandı: ${s.name || targetId}` });
      return NextResponse.json({ ok: true });
    }

    if (targetRole === 'accountant') {
      const a = await redis.get(`accountant:${targetId}`);
      if (!a) return NextResponse.json({ error: 'Muhasebeci bulunamadı' }, { status: 404 });
      await redis.set(`accountant:${targetId}`, { ...a, passwordHash: hash, mustChangePassword: true });
      await logAudit({ ...actorFrom(session), action: 'auth.resetPassword', target: { type: 'accountant', id: targetId, name: a.name || targetId }, detail: `Muhasebeci şifresi sıfırlandı: ${a.name || targetId}` });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Geçersiz hedef' }, { status: 400 });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}
