import { tdb } from '@/lib/sqldb';
import { currentOrg } from '@/lib/tenant';
import { newId } from '@/lib/id';
import type { Session } from '@/lib/auth';
import { signMobileAccessToken, newRefreshToken, hashRefreshToken, ACCESS_TTL_SEC } from './token';
import { decideRefresh, nextExpiry } from './policy';

// Cihaz oturumu DB katmanı. MobileSession sqldb SKIP'te (org düzeyi kavram, şube-bazlı
// DEĞİL — org_admin '__hq__' ve şube-değiştiren kullanıcı otomatik branch enjeksiyonuyla
// düşerdi). Bu yüzden orgSlug HER sorgu/create'te ELLE yazılır (Plan 1 dersi); branch
// sorgularda FİLTRELENMEZ (org düzeyi). Şube kilidi withMobileAuth'ta claims ile yapılır.
// Çapraz-kurum: orgSlug=currentOrg() koşulu → başka kurum host'una sunulan token bulunamaz.

export interface DeviceInfo {
  installationId?: string;
  deviceName?: string;
  platform?: string;
  ip?: string;
}

export interface MobileTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token saniyesi
  sessionId: string;
}

// Yeni cihaz oturumu aç + ilk token çiftini üret (login sonrası).
// payload org/branch İÇERMELİ (çağıran currentOrg/currentBranch ile doldurur; org_admin
// için branch='__hq__') — access token tenant kilidi + DB satırı bu claim'lere dayanır.
export async function issueMobileSession(payload: Session, device: DeviceInfo): Promise<MobileTokenPair> {
  const sid = newId('ms_');
  const refreshToken = newRefreshToken();
  // SKIP tablosu → orgSlug/branch ELLE (tdb $extends enjekte ETMEZ).
  await tdb().mobileSession.create({
    data: {
      id: sid,
      orgSlug: String(payload.org ?? currentOrg()),
      branch: String(payload.branch ?? 'main'),
      role: payload.role,
      userId: String(payload.id ?? ''),
      payload: payload as object,
      installationId: device.installationId,
      deviceName: device.deviceName,
      platform: device.platform,
      createdIp: device.ip,
      refreshHash: hashRefreshToken(refreshToken),
      expiresAt: nextExpiry(new Date()),
    },
  });
  const accessToken = await signMobileAccessToken(payload, sid);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC, sessionId: sid };
}

// withMobileAuth iptal kontrolü + session-open aktiflik yineleme: sid aktif mi?
// orgSlug=currentOrg() → farklı kurumun sid'i bu host'ta BULUNAMAZ (null → reddet).
export async function loadActiveSession(sid: string): Promise<{ revokedAt: Date | null; expiresAt: Date } | null> {
  return tdb().mobileSession.findFirst({
    where: { id: sid, orgSlug: currentOrg() },
    select: { revokedAt: true, expiresAt: true },
  });
}

// Oturumun bağlı olduğu installationId — logout/cihaz-iptali push bağını koparırken
// kullanılır. orgSlug=currentOrg(): başka kurumun sid'i bu host'ta bulunamaz.
export async function installationIdOf(sid: string): Promise<string | null> {
  const s = await tdb().mobileSession.findFirst({
    where: { id: sid, orgSlug: currentOrg() },
    select: { installationId: true },
  });
  return s?.installationId ?? null;
}

export type RefreshOutcome =
  | { ok: true; pair: MobileTokenPair; payload: Session }
  | { ok: false; status: number; error: string };

// Rotation + reuse detection (karar: lib/mobile/policy.ts).
export async function refreshMobileSession(presentedToken: string): Promise<RefreshOutcome> {
  const org = currentOrg();
  const h = hashRefreshToken(presentedToken);
  const s = await tdb().mobileSession.findFirst({
    where: { orgSlug: org, OR: [{ refreshHash: h }, { prevRefreshHash: h }] },
  });
  if (!s) return { ok: false, status: 401, error: 'Oturum bulunamadı. Yeniden giriş yapın.' };

  const decision = decideRefresh(s, h, new Date());
  if (decision.action === 'revoke') {
    await tdb().mobileSession.updateMany({
      where: { id: s.id, orgSlug: org },
      data: { revokedAt: new Date(), revokedReason: decision.reason },
    });
    return { ok: false, status: 401, error: 'Oturum güvenlik nedeniyle kapatıldı. Yeniden giriş yapın.' };
  }
  if (decision.action === 'reject') {
    return { ok: false, status: 401, error: 'Oturum geçersiz. Yeniden giriş yapın.' };
  }

  // rotate — CAS (optimistic kilit) + doğru prev yazımı (İnceleme Codex #1):
  // Rotasyon DAİMA "mevcut güncel (s.refreshHash) → yeni". CAS koşulu her iki yolda
  // AYNI: refreshHash HÂLÂ s.refreshHash mi (kimse önce rotate etmemiş mi). prev = önceki
  // güncel = s.refreshHash — sunulan h DEĞİL (h yazılsaydı grace yolunda eski token her
  // kullanımda grace'i yeniden açıp süresiz yaşardı + iki eşzamanlı grace ikisi de geçerdi).
  // Bu CAS eşzamanlı/art-arda grace'te tek kazanan bırakır (kaybeden count=0 → 401).
  const now = new Date();
  const refreshToken = newRefreshToken();
  const r = await tdb().mobileSession.updateMany({
    where: { id: s.id, orgSlug: org, refreshHash: s.refreshHash },
    data: {
      refreshHash: hashRefreshToken(refreshToken),
      prevRefreshHash: s.refreshHash, // önceki güncel — sunulan h değil
      rotatedAt: now,
      lastUsedAt: now,
      expiresAt: nextExpiry(now), // kayan pencere: aktif cihaz düşmez
    },
  });
  if (r.count === 0) return { ok: false, status: 401, error: 'Oturum geçersiz. Yeniden giriş yapın.' };

  const payload = s.payload as unknown as Session;
  const accessToken = await signMobileAccessToken(payload, s.id);
  return { ok: true, pair: { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC, sessionId: s.id }, payload };
}

// Tek oturumu iptal (kendi cihazın: logout / cihaz listesinden iptal).
// role+userId koşulu: kullanıcı YALNIZ kendi oturumunu kapatabilir (IDOR koruması).
export async function revokeMobileSession(id: string, role: string, userId: string, reason: string): Promise<boolean> {
  const r = await tdb().mobileSession.updateMany({
    where: { id, orgSlug: currentOrg(), role, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count > 0;
}

// Kullanıcının TÜM oturumlarını iptal (tüm cihazlardan çıkış / şifre değişimi).
export async function revokeMobileSessionsFor(role: string, userId: string, reason: string): Promise<number> {
  const r = await tdb().mobileSession.updateMany({
    where: { orgSlug: currentOrg(), role, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}

// Kullanıcının MEVCUT sid HARİÇ tüm oturumlarını iptal (mobil şifre değişimi — kendi
// oturumu logout olmadan diğer cihazlar düşer). revokeMobileSessionsFor'un "hariç" varyantı.
export async function revokeMobileSessionsExcept(role: string, userId: string, exceptSid: string, reason: string): Promise<number> {
  const r = await tdb().mobileSession.updateMany({
    where: { orgSlug: currentOrg(), role, userId, revokedAt: null, id: { not: exceptSid } },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}

// Mobil şifre değişimi sonrası: diğer oturumları iptal + mevcut oturumun payload'ını
// mustChangePassword:false yap + taze token çifti üret (rotation; prevRefreshHash sıfırlanır
// → grace penceresi kapanır). Client yeni çifti yazar, session state'i günceller.
// Oturum yoksa/kapatılmışsa null. (SKIP tablosu → orgSlug ELLE.)
export async function applyPasswordChange(sid: string, role: string, userId: string): Promise<{ pair: MobileTokenPair; payload: Session } | null> {
  const org = currentOrg();
  await revokeMobileSessionsExcept(role, userId, sid, 'şifre değişti');
  // CAS + retry (İnceleme Codex #1): eşzamanlı /refresh aynı kaydı rotate edebilir; CAS
  // koşulu (refreshHash HÂLÂ okuduğumuz mu) olmadan son-yazan-kazanır → istemciye dönen
  // çift anında geçersiz kalır veya eski refresh reuse sayılıp oturum kapanır. refreshHash'i
  // where'e ekle; kaybedersek (count=0) yeniden oku ve bir kez dene.
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await tdb().mobileSession.findFirst({ where: { id: sid, orgSlug: org } });
    if (!s || s.revokedAt) return null;
    const payload = { ...(s.payload as unknown as Session), mustChangePassword: false };
    const refreshToken = newRefreshToken();
    const now = new Date();
    const r = await tdb().mobileSession.updateMany({
      where: { id: sid, orgSlug: org, revokedAt: null, refreshHash: s.refreshHash }, // CAS
      data: {
        payload: payload as object,
        refreshHash: hashRefreshToken(refreshToken),
        prevRefreshHash: null, // rotation zinciri sıfırlanır (grace kapanır)
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt: nextExpiry(now),
      },
    });
    if (r.count > 0) {
      const accessToken = await signMobileAccessToken(payload, sid);
      return { pair: { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC, sessionId: sid }, payload };
    }
    // CAS kaybı: araya eşzamanlı rotasyon girdi → yeniden oku, tekrar dene (bir kez).
  }
  return null;
}

// İç satır tipi (Date alanlı) — wire tipi api-types.ts'teki DeviceView (string alanlı,
// JSON.stringify Date→ISO çevirir). Ad ayrımı Plan 3 Minor #3.
export interface MobileDeviceRow {
  id: string;
  deviceName: string | null;
  platform: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}

export async function listMobileDevices(role: string, userId: string, currentSid: string): Promise<MobileDeviceRow[]> {
  const rows = await tdb().mobileSession.findMany({
    where: { orgSlug: currentOrg(), role, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    deviceName: r.deviceName,
    platform: r.platform,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    current: r.id === currentSid,
  }));
}
