import bcrypt from 'bcryptjs';
import { tdb } from './sqldb';
import { currentOrg } from './tenant';
import { normalizeTurkishMobile } from './phone';
import type { Session } from './auth';
import type { ParentChild } from './parents';

// Giriş kimlik doğrulama SERVİSİ — web (/api/auth, cookie) ve mobil
// (/api/mobile/v1/auth/login, token) uçlarının ORTAK çekirdeği.
//
// Kapsam: rol kapısı (yanlış giriş kartı yönlendirmesi) + şifre doğrulama +
// oturum payload üretimi + veli modül geçidi.
// KAPSAM DIŞI (çağıran halleder): rate limit, OTP/cihaz tanıma, superadmin
// (yalnız web gizli sayfası — mobilde HİÇ üretilmez), cookie/token yazımı.

export type RoleCategory = 'student' | 'parent' | 'teacher' | 'management';

export const CATEGORY_LABEL: Record<RoleCategory, string> = {
  student: 'Öğrenci', parent: 'Veli', teacher: 'Öğretmen', management: 'Yönetim',
};

export function roleCategory(role: string): RoleCategory {
  if (role === 'student') return 'student';
  if (role === 'parent') return 'parent';
  if (role === 'teacher') return 'teacher';
  return 'management'; // director, assistant_director, accountant, counselor, org_admin
}

// Telefon numarasının ortasını maskele: "0532***67" (superadmin OTP ekranı için).
export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 7) return '***';
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

export type LoginOk = { ok: true; role: string; payload: Session; phone: string | null };
export type LoginFail = { ok: false; status: number; error: string; correctRole?: RoleCategory };
export type LoginResult = LoginOk | LoginFail;

// Rol tablolarından dönen kayıtların ortak görünümü (model başına alan farkları opsiyonel).
interface RoleRow {
  legacyId?: string;
  name?: string | null;
  phone?: string | null;
  passwordHash: string;
  mustChangePassword?: boolean;
  branches?: string[];
  allowedGroups?: string[];
  class?: { legacyId: string } | null;
  group?: string;
  children?: unknown;
}

// Eski (Redis) kayıt şekli — payload üretimi bu ara şekle dayanır.
interface LegacyRec {
  id: string;
  name: string;
  phone: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
  branches?: string[];
  allowedGroups?: string[];
  cls?: string;
  group?: string;
  children?: ParentChild[];
  // eski kayıt fallback alanları (teacher)
  branch?: string;
  extraBranches?: string[];
}

// SQL rol satırını LegacyRec'e çevirir. id = legacyId (parent: phone);
// student.cls = class.legacyId (cuid DEĞİL).
function sqlRecToLegacy(role: string, r: (RoleRow & { phone?: string | null }) | null): LegacyRec | null {
  if (!r) return null;
  const base = { name: r.name || '', phone: r.phone || null, passwordHash: r.passwordHash, mustChangePassword: !!r.mustChangePassword };
  if (role === 'teacher') return { ...base, id: r.legacyId || '', branches: r.branches || [], allowedGroups: r.allowedGroups || [] };
  if (role === 'student') return { ...base, id: r.legacyId || '', cls: r.class?.legacyId || '', group: r.group };
  if (role === 'parent') return { ...base, id: r.phone || '', name: r.name || '', children: ((r.children as ParentChild[] | null) || []) };
  return { ...base, id: r.legacyId || '' }; // accountant | counselor | assistant_director
}

export async function verifyLogin(username: string, password: string, selectedRole?: RoleCategory): Promise<LoginResult> {
  // Katı rol seçimi + akıllı yönlendirme: bilgiler doğru ama seçilen kart hesabın
  // gerçek rol kategorisiyle uyuşmuyorsa doğru girişe yönlendir.
  const gateMismatch = (actualRole: string): LoginFail | null => {
    if (!selectedRole) return null; // eski client — kapı devre dışı (geri uyumlu)
    const actualCat = roleCategory(actualRole);
    if (actualCat === selectedRole) return null;
    return {
      ok: false, status: 403,
      error: `Bu bilgiler ${CATEGORY_LABEL[actualCat]} hesabına ait. Lütfen "${CATEGORY_LABEL[actualCat]}" girişini kullanın.`,
      correctRole: actualCat,
    };
  };

  // Kayıttan oturum payload'ı üret (rol bazlı alanlar).
  const finish = async (role: string, rec: LegacyRec): Promise<LoginResult> => {
    const gate = gateMismatch(role);
    if (gate) return gate;

    // Modül geçidi (veli): veli paneli çok sayıda paylaşılan uca yayılır →
    // kaldıraç login'de: kurum veli modülünü kapattıysa veli hiç giriş yapamaz.
    if (role === 'parent') {
      const { getOrgConfig } = await import('./config');
      const mods = await getOrgConfig('modules');
      if (mods.veli === false) return { ok: false, status: 403, error: 'Veli girişi bu kurumda kapalı' };
    }

    let payload: Session;
    if (role === 'teacher') {
      const branches = Array.isArray(rec.branches) ? rec.branches
        : [rec.branch, ...(rec.extraBranches || [])].filter((b): b is string => Boolean(b)); // eski kayıt fallback
      payload = { role: 'teacher', id: rec.id, name: rec.name, branches, allowedGroups: rec.allowedGroups || [], mustChangePassword: !!rec.mustChangePassword };
    } else if (role === 'student') {
      payload = { role: 'student', id: rec.id, name: rec.name, cls: rec.cls, group: rec.group, mustChangePassword: !!rec.mustChangePassword };
    } else if (role === 'parent') {
      const children = Array.isArray(rec.children) ? rec.children : [];
      // Veli adı: kayıttaki gerçek ad. Header her zaman dolu → ad yoksa türetme;
      // parentName SADECE gerçek ad (boşsa panel karşılaması gösterilmez).
      const realName = rec.name || '';
      const headerName = realName || (children.length === 1 ? `${children[0].name} (Veli)` : 'Veli');
      payload = { role: 'parent', id: rec.id, name: headerName, parentName: realName, children, mustChangePassword: !!rec.mustChangePassword };
    } else if (role === 'assistant_director') {
      // Müdür yardımcısı: oturumda MÜDÜRLE BİREBİR aynı → role='director'. asst:true
      // yalnız UI etiketi + audit ayrımı; id = kendi legacyId'si.
      payload = { role: 'director', asst: true, id: rec.id, name: rec.name, mustChangePassword: !!rec.mustChangePassword };
    } else { // accountant | counselor
      payload = { role, id: rec.id, name: rec.name, mustChangePassword: !!rec.mustChangePassword };
    }
    return { ok: true, role, payload, phone: rec.phone || null };
  };

  // Org_admin (kurum-geneli, şube-bağımsız).
  const orgAdmin = await tdb().orgAdmin.findFirst({ where: { orgSlug: currentOrg(), username } });
  if (orgAdmin && orgAdmin.username === username) {
    const ok = await bcrypt.compare(password, orgAdmin.passwordHash);
    if (ok) {
      const gate = gateMismatch('org_admin');
      if (gate) return gate;
      return { ok: true, role: 'org_admin', payload: { role: 'org_admin', id: 'org_admin', name: orgAdmin.name || undefined }, phone: null };
    }
  }

  // Director.
  const director = await tdb().director.findFirst({ where: { username } });
  if (director && director.username === username) {
    const ok = await bcrypt.compare(password, director.passwordHash);
    if (ok) {
      const gate = gateMismatch('director');
      if (gate) return gate;
      return {
        ok: true, role: 'director',
        payload: { role: 'director', id: 'director', name: director.name },
        phone: (director as { phone?: string | null }).phone || null,
      };
    }
  }

  // Rol tabloları: assistant_director→accountant→counselor→teacher→student, sonra veli.
  const tryRole = async (role: string, sqlRec: RoleRow | null): Promise<LoginResult | null> => {
    const rec = sqlRecToLegacy(role, sqlRec);
    if (!rec) return null;
    const ok = await bcrypt.compare(password, rec.passwordHash);
    if (!ok) return null;
    return finish(role, rec);
  };
  let r: LoginResult | null;
  r = await tryRole('assistant_director', await tdb().assistantDirector.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('accountant', await tdb().accountant.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('counselor', await tdb().counselor.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('teacher', await tdb().teacher.findFirst({ where: { username } })); if (r) return r;
  r = await tryRole('student', await tdb().student.findFirst({ where: { username }, include: { class: { select: { legacyId: true } } } })); if (r) return r;
  // Veli: kullanıcı adı = telefon (ham veya kanonik); kayıtlı phone kanonik.
  const normP = normalizeTurkishMobile(username);
  const phones = [username, normP].filter((p): p is string => Boolean(p));
  const parent = phones.length ? await tdb().parent.findFirst({ where: { phone: { in: phones } } }) : null;
  r = await tryRole('parent', parent); if (r) return r;

  return { ok: false, status: 401, error: 'Kullanıcı adı veya şifre hatalı' };
}

// ── OTP kimliği (yalnız superadmin 2FA + change_password yollarında kullanılır) ──
// Kullanıcı adı + rol kategorisinden hesabın telefonu + push kimliğini bul.
// pushRole/pushId, push aboneliğinin anahtarladığı (session.role, session.id) ile
// BİREBİR eşleşmeli: teacher/student/accountant/counselor → legacyId,
// parent → telefon, director/assistant_director → 'director'.
// (Eski konumu: app/api/otp/verify/route.ts. İnceleme Codex #5: assistant_director
//  telefonluysa 'management' dalında bulunamıyordu → burada açıkça eklendi.)
export interface OtpIdentity { phone: string | null; pushRole: string; pushId: string }

export async function getOtpIdentity(username: string, roleCategory: string): Promise<OtpIdentity | null> {
  if (roleCategory === 'superadmin') {
    const sa = await tdb().superAdmin.findFirst({ where: { username } });
    if (!sa) return null;
    return { phone: sa.phone || null, pushRole: 'superadmin', pushId: 'superadmin' };
  }
  if (roleCategory === 'management') {
    const dir = await tdb().director.findFirst({ where: { username } });
    // NOT: Director modelinde phone kolonu yok → telefonsuz → OTP'ye hiç girmez (push moot).
    if (dir) return { phone: (dir as typeof dir & { phone?: string | null }).phone || null, pushRole: 'director', pushId: 'director' };
    const asst = await tdb().assistantDirector.findFirst({ where: { username } });
    // Müdür yardımcısı push kimliği 'director' pushId'siyle DEĞİL kendi legacyId'siyle
    // eşleşmez — oturumda role='director' ama push aboneliği kendi id'sine (auth payload id=legacyId).
    if (asst) return { phone: asst.phone || null, pushRole: 'director', pushId: asst.legacyId };
    const acc = await tdb().accountant.findFirst({ where: { username } });
    if (acc) return { phone: acc.phone || null, pushRole: 'accountant', pushId: acc.legacyId };
    const cou = await tdb().counselor.findFirst({ where: { username } });
    if (cou) return { phone: cou.phone || null, pushRole: 'counselor', pushId: cou.legacyId };
    return null;
  }
  if (roleCategory === 'parent') {
    const normPhone = normalizeTurkishMobile(username);
    const p = await tdb().parent.findFirst({ where: { phone: normPhone || username } });
    if (!p) return null;
    const ph = normPhone || username;
    return { phone: ph, pushRole: 'parent', pushId: ph };
  }
  const rec = roleCategory === 'teacher'
    ? await tdb().teacher.findFirst({ where: { username } })
    : await tdb().student.findFirst({ where: { username } });
  if (!rec) return null;
  return { phone: rec.phone || null, pushRole: roleCategory, pushId: rec.legacyId };
}
