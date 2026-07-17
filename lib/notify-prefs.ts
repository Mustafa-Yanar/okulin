import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import type { NotifCategory } from '@/lib/mobile/api-types';

// Bildirim kategori tercihi servisi (spec §5.1). Kategori tag önekinden türetilir
// (şemaya alan eklemeden); tercih NotificationPreference tablosunda (yalnız susturulanlar).
// guvenlik kategorisi asla susturulamaz (koddan zorlanır).

export const NOTIF_CATEGORY_LABELS: Record<NotifCategory, string> = {
  devamsizlik: 'Devamsızlık',
  odev: 'Ödev',
  davranis: 'Davranış',
  deneme: 'Deneme sonucu',
  duyuru: 'Duyuru',
  form: 'Form/anket',
  takvim: 'Takvim',
  odeme: 'Ödeme',
  guvenlik: 'Güvenlik',
};

// tag öneki → kategori (saf). Bilinmeyen/boş → null (İnceleme Codex #6/Gemini #3:
// 'duyuru' dönmek, kullanıcı duyuruyu susturunca bilinmeyen/gelecek/test tag'lerini de
// susturuyordu; null → isPushMuted DAİMA false = gerçek fail-open, bildirim asla susmaz).
export function categoryOf(tag: string | null | undefined): NotifCategory | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith('devamsizlik')) return 'devamsizlik';
  if (t.startsWith('odev')) return 'odev';
  if (t.startsWith('davranis')) return 'davranis';
  if (t.startsWith('deneme')) return 'deneme';
  if (t.startsWith('ann')) return 'duyuru';
  if (t.startsWith('form')) return 'form';
  if (t.startsWith('etkinlik')) return 'takvim';
  if (t.startsWith('odeme')) return 'odeme';
  if (t.startsWith('yeni-cihaz')) return 'guvenlik';
  return null;
}

// Bir rolün ALABİLECEĞİ (dolayısıyla toggle edebileceği) kategoriler — push hedeflerinden
// türetildi (bkz sendPushToUser envanteri). guvenlik HİÇBİR role dahil değil (susturulamaz).
export function categoriesForRole(role: string): NotifCategory[] {
  switch (role) {
    case 'student':
      return ['odev', 'davranis', 'duyuru', 'form', 'takvim'];
    case 'parent':
      return ['devamsizlik', 'deneme', 'odeme', 'duyuru', 'form', 'takvim'];
    case 'teacher':
      return ['duyuru', 'form'];
    default:
      return ['duyuru']; // director/accountant/counselor/org_admin — yalnız duyuru
  }
}

// Kullanıcının SUSTURDUĞU kategoriler (enabled=false satırları). tdb() tenant-scoped.
export async function getMutedCategories(role: string, userId: string): Promise<Set<NotifCategory>> {
  const rows = await tdb().notificationPreference.findMany({
    where: { role, userId, enabled: false },
    select: { category: true },
  });
  return new Set(rows.map((r) => r.category as NotifCategory));
}

// Tercih yaz — ATOMİK upsert (İnceleme Codex #7/Gemini #2: findFirst+create eşzamanlı ilk
// toggle'da P2002 500 üretiyordu). tdb() upsert'e orgSlug/branch ENJEKTE ETMEZ (sqldb.ts:7
// "upsert dokunulmaz") → composite where + create'e ELLE yaz. guvenlik susturulamaz.
export async function setPref(role: string, userId: string, category: NotifCategory, enabled: boolean): Promise<void> {
  if (category === 'guvenlik') return;
  const orgSlug = currentOrg();
  const branch = currentBranch();
  await tdb().notificationPreference.upsert({
    where: { orgSlug_branch_role_userId_category: { orgSlug, branch, role, userId, category } },
    update: { enabled },
    create: { orgSlug, branch, role, userId, category, enabled },
  });
}

// Fan-out kararı: bu tag'in kategorisi bu kullanıcı için susturulmuş mu? bilinmeyen (null)
// ve guvenlik DAİMA gider (fail-open).
export async function isPushMuted(role: string, userId: string, tag: string | null | undefined): Promise<boolean> {
  const category = categoryOf(tag);
  if (category === null || category === 'guvenlik') return false;
  const muted = await getMutedCategories(role, userId);
  return muted.has(category);
}
