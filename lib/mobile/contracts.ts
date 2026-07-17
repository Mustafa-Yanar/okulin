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

export const PushRegisterSchema = z.object({
  installationId: z.string().min(8).max(100),
  platform: z.enum(['android', 'ios']),
  token: z.string().min(10).max(4096),
  appVersion: z.string().max(20).optional(),
});

export const PushUnregisterSchema = z.object({
  installationId: z.string().min(8).max(100),
});

// Inbox okundu işaretleme: tek event VEYA tümü (yalnız biri).
export const InboxReadSchema = z
  .object({
    eventId: z.string().min(1).max(64).optional(),
    all: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.eventId) !== Boolean(d.all), { message: 'eventId veya all (yalnız biri) gerekli' });

// Etüt rezervasyon (mobil — yalnız öğrenci kendini yazar; studentId GÖNDERİLMEZ,
// server session.id kullanır). weekKey opsiyonel (yoksa server trToday).
export const ReserveEtutSchema = z.object({
  teacherId: z.string().min(1).max(100),
  etutId: z.string().min(1).max(100),
  branch: z.string().max(60).optional(),
  // W01-W53 (İnceleme Codex #11): W00/W99 gibi biçimsel-geçerli ama anlamsız haftalar reddedilir.
  weekKey: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/).optional(),
});
export const CancelEtutSchema = z.object({
  teacherId: z.string().min(1).max(100),
  etutId: z.string().min(1).max(100),
});

// Ödev teslim (mobil — yalnız öğrenci; id + opsiyonel not + done). studentId/cls
// GÖNDERİLMEZ (server session'dan). done:false = teslimi geri al.
export const OdevSubmitSchema = z.object({
  id: z.string().min(1).max(100),
  note: z.string().max(1000).optional(),
  done: z.boolean().optional(),
});
