import { z, zName, zPassword } from '@/lib/validate';

// /api/mobile/v1 İSTEK sözleşmeleri — tek kaynak. Mobil istemcinin tipli API
// katmanı (Plan 3) bu şemalardan üretilecek; route'lar parseBody ile doğrular.
// superadmin BİLEREK yok (mobilde üretilmez).

export const MobileRoleEnum = z.enum(['student', 'parent', 'teacher', 'management']);

export const ResolveOrgSchema = z.object({ code: z.string().min(1).max(20) });

export const MobileLoginSchema = z.object({
  username: zName,
  password: zPassword,
  role: MobileRoleEnum.optional(),
  installationId: z.string().max(100).optional(),
  deviceName: z.string().max(120).optional(),
  platform: z.enum(['android', 'ios']).optional(),
});

export const MobileRefreshSchema = z.object({ refreshToken: z.string().min(20).max(300) });

export const MobileDeviceRevokeSchema = z
  .object({ sessionId: z.string().max(100).optional(), all: z.boolean().optional() })
  .refine((d) => d.sessionId || d.all, 'sessionId veya all gerekli');

export const MobileConfigUpdateSchema = z.object({
  minSupportedVersion: z.string().max(20).optional(),
  recommendedVersion: z.string().max(20).optional(),
  maintenance: z.boolean().optional(),
  maintenanceMessage: z.string().max(500).nullable().optional(),
  flags: z.record(z.boolean()).optional(),
});
