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

// ── Bildirim merkezi (inbox — spec §8) ──────────────────────────────────────
// NotificationEvent tam içeriği taşır: push metni jenerikleşse bile (sensitive)
// inbox gerçek title/body gösterir (jenerikleştirme yalnız push'a uygulanır).
export interface InboxItem {
  id: string; // NotificationEvent.id (ne_ önekli) — push data.eventId ile eşleşir
  title: string;
  body: string;
  url: string | null; // web path'i (/?tab=odev vb.) — yönlendirme eşlemesi istemcide
  createdAt: string; // ISO
  read: boolean;
}
export interface InboxListResponse {
  items: InboxItem[];
  nextBefore: string | null; // OPAK sayfalama imleci — aynen geri gönderilir; null = son sayfa
  unreadCount: number;
}
export interface InboxReadRequest {
  eventId?: string;
  all?: boolean;
}
export interface InboxReadResponse {
  ok: true;
  updated: number;
  unreadCount: number;
}

// ── WebView oturum aktarımı (spec §7 — uç Plan 2'den beri canlı, tip şimdi paylaşılıyor) ──
export interface SessionExchangeResponse {
  code: string; // tek kullanımlık, 60 sn, IP-bağlı
  expiresIn: number;
}

// ── Bugün ekranı (screens/today — spec §5.1/§9-1) ───────────────────────────
// Modül kapalıysa ilgili alan null (istemci kartı gizler). date/dayIndex TR günü.
export interface TodayLesson {
  slotId: string;
  slotLabel: string; // "09:45–10:20"
  teacherId: string;
  teacherName: string;
  branch: string;
  subBranch: string;
}
export interface TodayEtut {
  id: string;
  start: string; // "16:30"
  end: string;
  teacherName: string;
  branch: string | null;
  studentName: string | null; // öğretmen görünümünde dolu; öğrenci/veli kendi rezervasyonu
  booked: boolean;
}
export interface TodayOdevItem {
  id: string;
  title: string;
  branch: string;
  dueDate: string; // 'YYYY-MM-DD' veya '' (vadesiz)
  submitted: boolean;
  overdue: boolean; // vadesi geçmiş ve hâlâ teslim edilmemiş (UI kırmızı vurgular)
}
export interface TodayCommon {
  date: string; // YYYY-MM-DD (TR)
  dayLabel: string; // "Cuma"
  weekKey: string; // "2026-W29"
  unreadNotifications: number;
}
export interface StudentToday extends TodayCommon {
  role: 'student';
  lessons: TodayLesson[];
  etuts: TodayEtut[] | null; // etut modülü kapalıysa null
  odev: { pending: number; items: TodayOdevItem[] } | null;
  davranis: { total: number } | null;
  deneme: { name: string; dateLabel: string; toplamNet: number; rank: number; total: number } | null;
}
export interface ParentChildView {
  id: string;
  name: string;
  cls: string;
}
export interface ParentToday extends TodayCommon {
  role: 'parent';
  children: ParentChildView[];
  child: {
    id: string;
    name: string;
    cls: string;
    lessons: TodayLesson[];
    etuts: TodayEtut[] | null;
    odev: { pending: number; items: TodayOdevItem[] } | null;
    finance: {
      netFee: number;
      balance: number;
      nextInstallment: { idx: number; dueDate: string; amount: number } | null;
      overdueCount: number;
    } | null; // finance modülü kapalı veya kayıt yoksa null
  } | null; // çocuk kaydı yoksa null
}
export interface TeacherSlotView {
  slotId: string;
  slotLabel: string;
  type: 'ders' | 'etut';
  cls: string | null; // ders: sınıf; etüt: öğrenci sınıfı
  studentName: string | null; // slot-etüt: öğrenci adı
  branch: string;
}
export interface TeacherToday extends TodayCommon {
  role: 'teacher';
  lessons: TeacherSlotView[]; // bugünün grid'i (ders + dolu slot-etüt), saat sıralı
  etuts: TodayEtut[] | null; // bugünkü serbest etüt şablonları (doluluk görünümü)
}
export interface ManagementToday extends TodayCommon {
  role: 'management'; // director/accountant/counselor/org_admin — native içerik 2. dalga (WebView girişi)
}
export type TodayResponse = StudentToday | ParentToday | TeacherToday | ManagementToday;
