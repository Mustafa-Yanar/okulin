import { tdb } from '@/lib/sqldb';
import { prisma } from '@/lib/prisma';
import { currentOrg } from '@/lib/tenant';

// Hesap SİLİNİRKEN mobil erişimin tamamı kapanır (F1 launch-blocker, Plan 2 devri):
// 1) aktif MobileSession'lar revoke → access token withMobileAuth iptal kontrolüyle
//    ANINDA ölür, refresh de çalışmaz;
// 2) DeviceInstallation bağları silinir → push fan-out cihazı artık bulamaz.
//
// BİLİNÇLİ FAIL-LOUD (şifre-sıfırlamadaki try/catch best-effort'tan sapma): silme
// akışında purge SİLMEDEN ÖNCE çağrılır; purge düşerse silme de durur (500) — aktif
// mobil oturumu kalmış "silinmiş" kullanıcı oluşmaz, retry ikisini de tekrar dener.
//
// Toplu silme (bulkDeleteStudents 2000 id'ye kadar) tek sorguda: userId IN (...).
// Rol eşlemesi çağıranın sorumluluğu: assistant_director hesabı mobil oturumda
// role='director' taşır (userId = kendi legacyId'si — gerçek müdürün userId'si
// 'director' string'i olduğundan çakışmaz). Veli hesabı öğrenci silmede İPTAL
// EDİLMEZ (telefon-bazlı, başka çocukları olabilir — plan ADR'si).
export async function purgeMobileAccess(role: string, userIds: string[], reason: string): Promise<void> {
  if (userIds.length === 0) return;
  // MobileSession sqldb SKIP'te → orgSlug ELLE (Plan 2 deseni).
  await tdb().mobileSession.updateMany({
    where: { orgSlug: currentOrg(), role, userId: { in: userIds }, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  // DeviceInstallation çapraz-tenant deseni gereği base prisma + orgSlug ELLE
  // (bkz lib/mobile/devices.ts başlık yorumu).
  await prisma.deviceInstallation.deleteMany({
    where: { orgSlug: currentOrg(), role, userId: { in: userIds } },
  });
}
