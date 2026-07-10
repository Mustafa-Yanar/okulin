import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z } from '@/lib/validate';
import { encryptSecret } from '@/lib/payment/crypto';
import type { PaymentConfigData } from '@/lib/payment';
import { tdb, withScope } from '@/lib/sqldb';

// payment:config okuma/yazma (TenantConfig.paymentConfig).
async function readPaymentConfig(): Promise<PaymentConfigData | null> {
  const tc = await tdb().tenantConfig.findFirst();
  return (tc?.paymentConfig as PaymentConfigData | null) || null;
}
async function writePaymentConfig(cfg: PaymentConfigData): Promise<void> {
  const tc = await tdb().tenantConfig.findFirst();
  if (tc) await tdb().tenantConfig.update({ where: { orgSlug_branch: { orgSlug: tc.orgSlug, branch: tc.branch } }, data: { paymentConfig: cfg as object } });
  else await tdb().tenantConfig.create({ data: withScope({ paymentConfig: cfg as object }) });
}

export const runtime = 'nodejs'; // crypto

// Kurumun (şubenin) online ödeme yapılandırması — tenant-scoped `payment:config`.
// Gizli anahtarlar (key/salt) ŞİFRELİ saklanır; GET ASLA düz secret döndürmez.

function isEnabled(cfg: PaymentConfigData | null | undefined): boolean {
  return !!(cfg && cfg.active && cfg.merchantId && cfg.keyEnc && cfg.saltEnc);
}

const ConfigSchema = z.object({
  merchantId: z.string().max(50).optional(),
  merchantKey: z.string().max(300).optional(),
  merchantSalt: z.string().max(300).optional(),
  testMode: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
});

// Bilinçli inline rol dallanması: müdür maskeli config, diğer roller yalnız enabled bayrağı.
export const GET = withAuth(async (_req, _ctx, session) => {
  const cfg = await readPaymentConfig();

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
});

export const POST = withAuth(['director'], async (req, _ctx, session) => {
  const parsed = await parseBody(req, ConfigSchema);
  if (!parsed.ok) return parsed.response;
  const { merchantId, merchantKey, merchantSalt, testMode, active } = parsed.data;

  const existing = (await readPaymentConfig()) || { provider: 'paytr' };
  const next: PaymentConfigData = { ...existing, provider: 'paytr' };

  if (merchantId !== undefined) next.merchantId = merchantId.trim();
  // Secret yalnız DOLU gelince güncellenir → düzenlemede boş bırakınca eskisi korunur.
  if (merchantKey) next.keyEnc = encryptSecret(merchantKey.trim());
  if (merchantSalt) next.saltEnc = encryptSecret(merchantSalt.trim());
  if (testMode !== undefined) next.testMode = testMode;
  if (active !== undefined) next.active = active;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = session.name;

  await writePaymentConfig(next);
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
});
