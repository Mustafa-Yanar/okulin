import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAllConfigs, patchConfigs, CONFIG_KEYS } from '@/lib/config';
import { parseBody, z } from '@/lib/validate';
import { logAudit, actorFrom } from '@/lib/audit';

// Kurum konfigürasyonu uç noktası — müdür "oyun ayarlarını" buradan okur/yazar.
// GET  → kurumun tüm config'i (eksik key'ler default ile dolu).
// PATCH → { patch: { key: value, ... } } yalnız bilinen key'leri günceller.
//
// Yetki: SADECE müdür (director). Config = kurum tercihi; rehber değiştiremez.
// Yalnız SQL (OrgConfig modeli) — yeni özellik, Redis yolu yok.

// PATCH gövdesi: { patch: { <bilinen key>: <herhangi JSON>, ... } }
// Değer şekli her key'e göre değişir (modules: obje, classrooms: dizi) → z.any().
// İçerik doğrulaması config servisinde (CONFIG_KEYS süzgeci + mergeDefault) yapılır.
const PatchSchema = z.object({
  patch: z.record(z.string().max(60), z.any()).refine(
    (obj) => Object.keys(obj).length > 0 && Object.keys(obj).every((k) => CONFIG_KEYS.includes(k)),
    { message: 'Geçersiz veya boş config anahtarı' },
  ),
});

// Okuma: müdür + muhasebeci (muhasebeci gider kategorilerini okur). Değiştirme yalnız müdür.
export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'accountant')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  const config = await getAllConfigs();
  return NextResponse.json(config);
}

export async function PATCH(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.response;

  const keys = Object.keys(parsed.data.patch);
  const config = await patchConfigs(parsed.data.patch);
  await logAudit({
    ...actorFrom(session),
    action: 'config.update',
    detail: `Konfigürasyon güncellendi: ${keys.join(', ')}`,
  });
  return NextResponse.json(config);
}
