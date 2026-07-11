// Kurum konfigürasyonu servisi — "oyun ayarları" key-value motoru.
//
// İLKE: config eksikse VARSAYILAN davranış. Hiçbir kurum config girmeden mevcut
// Çözüm Dershanesi davranışıyla BİREBİR çalışır (geriye uyumluluk). Bir key ancak
// müdür Ayarlar > Konfigürasyon'dan değiştirince DB'ye yazılır.
//
// Depolama: OrgConfig (orgSlug+branch+key → value Json). TenantConfig'ten AYRI —
// o operasyonel state, bu kullanıcı TERCİHİ. Tenant scope EXPLICIT geçilir (tdb
// upsert'e enjeksiyon yapmaz), finance.js deseniyle aynı.
//
// İlgili: lib/constants.js (sabit varsayılanların kaynağı) · kurum-konfigurasyonu memo.

import { prisma } from '@/lib/prisma';
import { tenant } from '@/lib/sqldb';

// ── VARSAYILANLAR ─────────────────────────────────────────────────────────────
// Her config key'inin DB'de değeri yoksa kullanılacak değer. Bu obje "kurum hiçbir
// şey seçmezse sistem nasıl davranır" sözleşmesidir. Yeni key eklerken BURAYA da ekle.
export const CONFIG_DEFAULTS = {
  // Modül aç/kapa — false = modül UI'dan gizlenir / API reddeder.
  modules: {
    etut: true,        // etüt rezervasyon sistemi
    finance: true,     // muhasebe / finans
    crm: true,         // aday öğrenci hunisi
    lms: true,         // kütüphane (kaynak)
    duyuru: true,      // duyuru sistemi
    veli: true,        // veli paneli
    deneme: true,      // deneme / optik analiz
    davranis: true,    // davranış puanlama
    odev: true,        // ödev takip
  },

  // Ders programı oluşturucu planı (ProgramOlusturucu). Müdürün girdiği haftalık
  // ders yükü tablosu + gruplama desenleri + sınıf-gün saat limitleri sekme
  // değişiminde kaybolmasın diye burada saklanır. load: {colKey: {ders: saat}},
  // grouping: {colKey: {ders: "3-2-2"}}, dayLimits: {cls: {gün: saat}}.
  // load boş obje = henüz kaydedilmemiş → UI tüm değerleri 0 başlatır.
  programPlan: {
    load: {} as Record<string, Record<string, number>>,
    grouping: {} as Record<string, Record<string, string>>,
    dayLimits: {} as Record<string, Record<string, number>>,
    maxWeekly: 40,
  },

  // Muhasebe gider kategorileri. lib/constants.js EXPENSE_CATEGORIES'in eşi.
  // "Diğer" daima sonda tutulur (UI + API normalize eder).
  expenseCategories: [
    'Kira', 'Faturalar', 'Kırtasiye & Malzeme', 'Vergi & SGK',
    'Bakım & Onarım', 'Reklam & Pazarlama', 'Diğer',
  ],

  // Etüt kuralları.
  etut: {
    // Öğrenci kendi etüt rezervasyonunu yapabilir mi. false = yalnız müdür/rehber
    // dağıtır; öğrenci panelinde rezervasyon butonu gizlenir + API öğrenci POST'unu reddeder.
    studentSelfBooking: true,

    // Öğrenci iptal kilidi: etüt başlamasına bu kadar SAAT kala öğrenci kendi
    // rezervasyonunu iptal edemez. 0 = kilit yok (her zaman iptal). Müdür/rehber/
    // öğretmen bu kilitten MUAF (operasyonel esneklik).
    cancelLockHours: 0,

    // Öğrenci haftalık maksimum etüt sayısı. 0 = sınırsız. Yalnız öğrenci
    // self-booking'e uygulanır; müdür/rehber dağıtımı limitten muaf.
    maxWeeklyPerStudent: 0,
  },

  // Rol yetki kısıtları. "Müdür rol yetkilerini bile değiştirebilmeli" vizyonunun
  // ilk adımı: rehber (counselor) salt-okunur modu. İleride eylem-bazlı ince ayar
  // (canManageStudents vb.) bu objeye eklenecek — şema değişmeden (key-value store).
  permissions: {
    counselor: {
      // true = rehber HİÇBİR yönetimsel mutasyon yapamaz (öğrenci/öğretmen/program/
      // slot/kaynak ekle-sil-düzenle hepsi 403). Rehberin ÇEKİRDEK işi MUAF kalır:
      // rehberlik notu, deneme/optik girişi, hedef belirleme, yoklama (zaten öğretmen).
      // false = mevcut davranış (rehber = müdür eksi finans).
      readOnly: false,
    },
    accountant: {
      // true = muhasebeci KAYIT akışını kullanabilir: öğrenci ekleme/düzenleme +
      // ön kayıt (CRM). Kayıt masası senaryosu: veli gelir, muhasebeci ön kayıttan
      // ödeme planına kadar tek başına bitirir. Silme ve diğer yönetimsel yüzeyler
      // KAPALI kalır. false = yalnız finans (eski davranış). Müdür Ayarlar'dan kapatır.
      intake: true,
    },
  },
};

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;
export type ConfigValue<K extends ConfigKey> = (typeof CONFIG_DEFAULTS)[K];

// Bilinen config key'leri — PATCH yalnız bunları kabul eder (rastgele key yazılamaz).
export const CONFIG_KEYS = Object.keys(CONFIG_DEFAULTS) as ConfigKey[];

// ── OKUMA ───────────────────────────────────────────────────────────────────

// Tek bir config key'ini getir. DB'de yoksa CONFIG_DEFAULTS[key] döner.
// Obje tipli key'lerde (modules gibi) default ile DERİN birleştirme yapılır:
// kurum yalnız bir alt-anahtarı değiştirmişse kalan alt-anahtarlar default kalır.
export async function getOrgConfig<K extends ConfigKey>(key: K, orgOverride?: string, branchOverride?: string): Promise<ConfigValue<K>> {
  const def = CONFIG_DEFAULTS[key];
  const { orgSlug, branch } = tenant(orgOverride, branchOverride);
  const row = await prisma.orgConfig.findUnique({
    where: { orgSlug_branch_key: { orgSlug, branch, key } },
  });
  if (!row) return def;
  return mergeDefault(def, row.value) as ConfigValue<K>;
}

// Kurumun TÜM config'ini getir (frontend tek istekte okur). Eksik key'ler default'la
// doldurulur → dönen obje her zaman tam (CONFIG_KEYS hepsini içerir).
export async function getAllConfigs(orgOverride?: string, branchOverride?: string): Promise<typeof CONFIG_DEFAULTS> {
  const { orgSlug, branch } = tenant(orgOverride, branchOverride);
  const rows = await prisma.orgConfig.findMany({ where: { orgSlug, branch } });
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out: Partial<Record<ConfigKey, unknown>> = {};
  for (const key of CONFIG_KEYS) {
    out[key] = (key in stored) ? mergeDefault(CONFIG_DEFAULTS[key], stored[key]) : CONFIG_DEFAULTS[key];
  }
  return out as typeof CONFIG_DEFAULTS;
}

// ── YAZMA ─────────────────────────────────────────────────────────────────────

// Tek key'i yaz (upsert). Bilinmeyen key reddedilir.
export async function setOrgConfig<K extends ConfigKey>(key: K, value: unknown, orgOverride?: string, branchOverride?: string): Promise<ConfigValue<K>> {
  if (!CONFIG_KEYS.includes(key)) throw new Error(`Bilinmeyen config anahtarı: ${key}`);
  const { orgSlug, branch } = tenant(orgOverride, branchOverride);
  await prisma.orgConfig.upsert({
    where: { orgSlug_branch_key: { orgSlug, branch, key } },
    update: { value: value as object },
    create: { orgSlug, branch, key, value: value as object },
  });
  return getOrgConfig(key, orgOverride, branchOverride);
}

// Birden çok key'i tek seferde yaz. patch: { key: value, ... }. Bilinmeyen key atlanır.
export async function patchConfigs(patch: Record<string, unknown>, orgOverride?: string, branchOverride?: string): Promise<typeof CONFIG_DEFAULTS> {
  const { orgSlug, branch } = tenant(orgOverride, branchOverride);
  const entries = Object.entries(patch).filter(([k]) => (CONFIG_KEYS as string[]).includes(k));
  for (const [key, value] of entries) {
    await prisma.orgConfig.upsert({
      where: { orgSlug_branch_key: { orgSlug, branch, key } },
      update: { value: value as object },
      create: { orgSlug, branch, key, value: value as object },
    });
  }
  return getAllConfigs(orgOverride, branchOverride);
}

// ── YARDIMCI ──────────────────────────────────────────────────────────────────

// Düz obje default'larını sığ-derin birleştir: stored alt-anahtarları default'un
// üzerine yazar, eksikler default'tan gelir. Dizi/primitive ise stored'u olduğu gibi al.
function mergeDefault(def: unknown, stored: unknown): unknown {
  if (Array.isArray(def) || Array.isArray(stored)) return stored ?? def;
  if (def && typeof def === 'object' && stored && typeof stored === 'object') {
    return { ...def, ...stored };
  }
  return stored ?? def;
}
