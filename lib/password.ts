import bcrypt from 'bcryptjs';
import { tdb } from '@/lib/sqldb';

// Şifre değiştirme servisi (web change_password + mobil change-password ortak). Mevcut
// şifre doğrulanır, yeni hash yazılır, mustChangePassword:false. Oturum iptali/cookie
// yenileme ÇAĞIRANA ait (web: setSession + revoke tüm; mobil: applyPasswordChange).
// Rol→Prisma delegesi statik ifade edilemez (route'taki updatePasswordFor ile aynı cast).
export type ChangePasswordResult = { ok: true } | { ok: false; status: number; error: string };

export async function changePasswordFor(
  roleKey: string,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const db = tdb() as unknown as Record<string, {
    findFirst: (a: { where: Record<string, string> }) => Promise<{ id: string; passwordHash: string } | null>;
    update: (a: { where: { id: string }; data: { passwordHash: string; mustChangePassword: boolean } }) => Promise<unknown>;
  }>;
  const rec = roleKey === 'parent'
    ? await db.parent.findFirst({ where: { phone: userId } })
    : await db[roleKey].findFirst({ where: { legacyId: userId } });
  if (!rec) return { ok: false, status: 404, error: 'Kullanıcı bulunamadı' };
  const ok = await bcrypt.compare(currentPassword, rec.passwordHash);
  if (!ok) return { ok: false, status: 400, error: 'Mevcut şifre hatalı' };
  const newHash = await bcrypt.hash(newPassword, 10);
  await db[roleKey].update({ where: { id: rec.id }, data: { passwordHash: newHash, mustChangePassword: false } });
  return { ok: true };
}
