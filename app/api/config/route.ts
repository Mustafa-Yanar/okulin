import { NextResponse } from 'next/server';
import { withAuth, canManage } from '@/lib/auth';
import { getAllConfigs, patchConfigs, CONFIG_KEYS } from '@/lib/config';
import { parseBody, z } from '@/lib/validate';
import { logAudit, actorFrom } from '@/lib/audit';

// Kurum konfigürasyonu uç noktası — müdür "oyun ayarlarını" buradan okur/yazar.
// GET  → kurumun tüm config'i (eksik key'ler default ile dolu).
// PATCH → { patch: { key: value, ... } } yalnız bilinen key'leri günceller.
//
// Yetki: müdür her şeyi yazar. Rehber (counselor) ders-programı sekmesini kullandığı
// için okuyabilir ve YALNIZ programPlan anahtarını yazabilir (readOnly değilse).
// Yalnız SQL (OrgConfig modeli) — yeni özellik, Redis yolu yok.

// Rehberin yazmasına izin verilen anahtarlar — kurum tercihi değil operasyonel plan.
const COUNSELOR_WRITABLE_KEYS = ['programPlan'];

// PATCH gövdesi: { patch: { <bilinen key>: <herhangi JSON>, ... } }
// Değer şekli her key'e göre değişir (modules: obje, expenseCategories: dizi) → z.any().
// İçerik doğrulaması config servisinde (CONFIG_KEYS süzgeci + mergeDefault) yapılır.
const PatchSchema = z.object({
  patch: z.record(z.string().max(60), z.any()).refine(
    (obj) => Object.keys(obj).length > 0 && Object.keys(obj).every((k) => (CONFIG_KEYS as string[]).includes(k)),
    { message: 'Geçersiz veya boş config anahtarı' },
  ),
});

// Okuma: müdür + muhasebeci (gider kategorileri) + rehber (programPlan).
export const GET = withAuth(['director', 'accountant', 'counselor'], async () => {
  const config = await getAllConfigs();
  return NextResponse.json(config);
});

// Yazma: müdür + rehber (rehber yalnız programPlan, aşağıda kısıtlanır).
// Bilinçli inline rol dallanması: rehberin yazabileceği anahtar kümesi istek gövdesine bağlı.
export const PATCH = withAuth(['director', 'counselor'], async (req, ctx, session) => {
  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.response;

  const keys = Object.keys(parsed.data.patch);
  if (session.role === 'counselor') {
    const onlyPlan = keys.every((k) => COUNSELOR_WRITABLE_KEYS.includes(k));
    if (!onlyPlan || !(await canManage(session))) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
  }
  const config = await patchConfigs(parsed.data.patch);
  await logAudit({
    ...actorFrom(session),
    action: 'config.update',
    detail: `Konfigürasyon güncellendi: ${keys.join(', ')}`,
  });
  return NextResponse.json(config);
});
