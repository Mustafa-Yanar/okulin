import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z } from '@/lib/validate';
import { encryptSecret } from '@/lib/payment/crypto';

export const runtime = 'nodejs'; // crypto

// Kurumun (şubenin) online ödeme yapılandırması — tenant-scoped `payment:config`.
// Gizli anahtarlar (key/salt) ŞİFRELİ saklanır; GET ASLA düz secret döndürmez.

const CONFIG_KEY = 'payment:config';

function isEnabled(cfg) {
  return !!(cfg && cfg.active && cfg.merchantId && cfg.keyEnc && cfg.saltEnc);
}

const ConfigSchema = z.object({
  merchantId: z.string().max(50).optional(),
  merchantKey: z.string().max(300).optional(),
  merchantSalt: z.string().max(300).optional(),
  testMode: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const cfg = await redis.get(CONFIG_KEY);

  // Müdür dışındaki roller (veli vb.) yalnız "açık mı" bilgisini görür.
  if (session.role !== 'director') {
    return NextResponse.json({ enabled: isEnabled(cfg) });
  }

  // Müdür: maskeli config (secret yok, yalnız "tanımlı mı" bayrakları).
  return NextResponse.json({
    provider: cfg?.provider || 'paytr',
    merchantId: cfg?.merchantId || '',
    hasKey: !!cfg?.keyEnc,
    hasSalt: !!cfg?.saltEnc,
    testMode: cfg?.testMode ?? true,
    active: !!cfg?.active,
    enabled: isEnabled(cfg),
  });
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, ConfigSchema);
  if (!parsed.ok) return parsed.response;
  const { merchantId, merchantKey, merchantSalt, testMode, active } = parsed.data;

  const existing = (await redis.get(CONFIG_KEY)) || { provider: 'paytr' };
  const next = { ...existing, provider: 'paytr' };

  if (merchantId !== undefined) next.merchantId = merchantId.trim();
  // Secret yalnız DOLU gelince güncellenir → düzenlemede boş bırakınca eskisi korunur.
  if (merchantKey) next.keyEnc = encryptSecret(merchantKey.trim());
  if (merchantSalt) next.saltEnc = encryptSecret(merchantSalt.trim());
  if (testMode !== undefined) next.testMode = testMode;
  if (active !== undefined) next.active = active;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = session.name;

  await redis.set(CONFIG_KEY, next);
  await logAudit({
    ...actorFrom(session),
    action: 'payment.configUpdate',
    target: { type: 'org', id: 'payment', name: 'Online Ödeme' },
    detail: `Online ödeme yapılandırması güncellendi (PayTR, ${next.active ? 'aktif' : 'pasif'}, ${next.testMode ? 'test' : 'canlı'}).`,
  });

  return NextResponse.json({
    ok: true,
    config: {
      provider: 'paytr',
      merchantId: next.merchantId || '',
      hasKey: !!next.keyEnc,
      hasSalt: !!next.saltEnc,
      testMode: next.testMode ?? true,
      active: !!next.active,
      enabled: isEnabled(next),
    },
  });
}
