// /api/mobile/v1 İSTEK + YANIT tipleri — mobil istemciyle paylaşılan TEK KAYNAK.
// KURAL: Bu dosya import İÇERMEZ (saf tipler). mobile/src/api/types.ts'e
// scripts/sync-mobile-api-types.mjs birebir kopyalar; drift'i
// lib/mobile/api-types.sync.test.ts denetler. Değiştirince `npm run mobile:types` koş.
// Route yanıt gövdeleri bu tiplere UYMALI (mevcutlar Plan 2'den birebir çıkarıldı).

export type MobileRoleCategory = 'student' | 'parent' | 'teacher' | 'management';
export type MobilePlatform = 'android' | 'ios';

// Hata zarfı: her uçta { error } + doğru HTTP status (repo standardı).
export interface ApiErrorBody {
  error: string;
  correctRole?: MobileRoleCategory; // login rol-kapısı yönlendirmesi
}

export interface ResolveOrgRequest {
  code: string;
}
export interface ResolveOrgResponse {
  ok: true;
  orgSlug: string;
  branch: string;
  name: string;
  shortName: string;
  logoUrl: string; // boş string olabilir
  themeColor: string; // #rrggbb
  canonicalHost: string; // istemci YALNIZ buna bağlanır (spec §6/3)
  active: true;
}

export interface BootstrapResponse {
  minSupportedVersion: string;
  recommendedVersion: string;
  maintenance: { active: boolean; message: string | null };
  flags: Record<string, boolean>;
  serverTime: string;
  org: {
    slug: string;
    branch: string;
    name: string;
    shortName: string;
    logoUrl: string;
    themeColor: string;
    active: boolean;
    modules: Record<string, boolean>;
  } | null; // apex'te null (kurum sızdırılmaz)
}

// Oturum payload'ı (web Session paritesi — rol-özel alanlar var).
export interface MobileSessionInfo {
  role: string;
  id: string;
  name?: string;
  org: string;
  branch: string;
  mustChangePassword?: boolean;
  [k: string]: unknown; // rol-özel: cls, group, branches, children, asst...
}

export interface LoginRequest {
  username: string;
  password: string;
  role?: MobileRoleCategory;
  installationId?: string;
  deviceName?: string;
  platform?: MobilePlatform;
}
export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token saniyesi
  sessionId: string;
  session: MobileSessionInfo;
}
export interface RefreshRequest {
  refreshToken: string;
}

export interface MeResponse {
  session: MobileSessionInfo;
}

export interface DeviceView {
  id: string;
  deviceName: string | null;
  platform: string | null;
  createdAt: string; // ISO
  lastUsedAt: string; // ISO
  current: boolean;
}
export interface DevicesResponse {
  devices: DeviceView[];
}
export interface DeviceRevokeRequest {
  sessionId?: string;
  all?: boolean;
}
export interface DeviceRevokeResponse {
  ok: true;
  revoked: number;
}

export interface PushRegisterRequest {
  installationId: string;
  platform: MobilePlatform;
  token: string;
  appVersion?: string;
}
export interface PushUnregisterRequest {
  installationId: string;
}

export interface OkResponse {
  ok: true;
}
