import { prisma } from '@/lib/prisma';
import { currentOrg, currentBranch } from '@/lib/tenant';

// DeviceInstallation katmanı (spec §8): push fan-out'unun (lib/push/outbox.ts
// enqueueNotification) native ayağını doldurur. id = istemci üretimi installationId
// (reklam kimliği değil), (provider,token) global-unique.
//
// Cihaz kurum/hesap DEĞİŞTİREBİLİR (kurumdan ayrıl + başka kurum kodu; aynı cihazda
// başka hesapla login) → satır yeni sahibe/kuruma GEÇER. Bu yüzden erişim base prisma
// ile, orgSlug/branch ELLE yazılır (savePushSubscription çapraz-tenant deseni; tdb()
// olsaydı başka kurumda kalan satır bulunamaz → P2002 patlardı).

export interface RegisterDeviceInput {
  installationId: string;
  platform: 'android' | 'ios';
  token: string;
  appVersion?: string;
}

export type RegisterOutcome = 'ok' | 'conflict';

export async function registerDevice(role: string, userId: string, input: RegisterDeviceInput): Promise<RegisterOutcome> {
  const provider = 'fcm'; // v1 Android; APNs F3'te ayrı provider değeriyle gelir
  const org = currentOrg();

  // Sahiplik sınırı (İnceleme Codex #3): installationId istemci BEYANIDIR — başka
  // kullanıcıya ait bir kaydı yalnız aynı FCM token'ını sunabilen devralabilir
  // (token cihaz-yerel sırdır; aynı cihazda hesap değişiminin doğal kanıtı).
  // Token da farklıysa 'conflict' → route 409 döner, istemci YENİ installationId
  // üretip bir kez tekrar dener (mobile/src/push.ts). Böylece sızmış/tahmin edilmiş
  // bir installationId ile başka hesabın push bağı düşürülemez.
  const existing = await prisma.deviceInstallation.findUnique({ where: { id: input.installationId } });
  const sameOwner = existing != null && existing.role === role && existing.userId === userId && existing.orgSlug === org;
  if (existing && !sameOwner && existing.token !== input.token) return 'conflict';

  // Token devri: aynı (provider,token) BAŞKA installationId'de kaldıysa (sil-kur,
  // cihaz sıfırlama) eski satır ölüdür → sil, yoksa upsert P2002'ye çarpar.
  const clearStaleToken = () =>
    prisma.deviceInstallation.deleteMany({
      where: { provider, token: input.token, id: { not: input.installationId } },
    });
  const data = {
    orgSlug: org,
    branch: currentBranch(),
    role,
    userId,
    platform: input.platform,
    provider,
    token: input.token,
    appVersion: input.appVersion,
  };
  const doUpsert = () =>
    prisma.deviceInstallation.upsert({
      where: { id: input.installationId },
      // enabled: ölü-token disable'ı yeni token'la kayıtta geri açılır
      update: { ...data, enabled: true, lastSeenAt: new Date() },
      create: { id: input.installationId, ...data },
    });

  await clearStaleToken();
  try {
    await doUpsert();
  } catch (e) {
    // Eşzamanlı iki kayıt aynı token'ı yarıştırabilir (deleteMany→upsert aralığı) —
    // (provider,token) unique P2002 üretir; bir kez daha temizle + dene (Codex #14).
    if ((e as { code?: string } | null)?.code !== 'P2002') throw e;
    await clearStaleToken();
    await doUpsert();
  }
  return 'ok';
}

// Bildirimi durdur (spec §8: logout → installation-hesap bağı kalkar). orgSlug+role+
// userId koşulu: kullanıcı YALNIZ kendi kurumundaki kendi bağını koparabilir (IDOR;
// 'director' userId'si her kurumda aynı olduğundan org koşulu ŞART — Codex #4).
// Satır SİLİNİR — sonraki login/register yeniden oluşturur.
export async function unbindInstallation(
  installationId: string | null | undefined,
  role: string,
  userId: string,
): Promise<void> {
  if (!installationId) return;
  await prisma.deviceInstallation.deleteMany({
    where: { id: installationId, orgSlug: currentOrg(), role, userId },
  });
}

// "Tüm cihazlardan çıkış" + hesap silme (purge) için: kullanıcının org'daki tüm bağları.
export async function unbindAllInstallations(role: string, userId: string): Promise<void> {
  await prisma.deviceInstallation.deleteMany({ where: { orgSlug: currentOrg(), role, userId } });
}
