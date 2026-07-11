import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Günlük saklama (retention) temizliği cron'u.
// Redis'te AuditLog/ErrLog kayıtlarının TTL'i vardı (audit 90g, errlog 30g); SQL'e
// göçünce TTL kalktı → tablolar sınırsız birikiyordu. Bu cron eski kayıtları siler.
//
// tdb() DEĞİL, base `prisma`: retention zaman-bazlı GLOBAL bir bakım işi, tenant
// verisi değil. tdb() orgSlug/branch'e scope'lar → yalnız DEFAULT_ORG temizlenirdi;
// biz TÜM kurumların (testkurs + akyazicozum + ...) eski loglarını silmek istiyoruz.
// Silme yalnız `at < cutoff` zamanına bakar, kurum ayrımı yapmaz — kasıtlı.
//
// Bilinçli withAuth istisnası: cron ucu — oturum yok, CRON_SECRET Bearer doğrulanır.

export const runtime = 'nodejs'; // Prisma Node çalışma zamanı gerektirir

const AUDIT_RETENTION_DAYS = 90; // lib/audit.ts eski Redis TTL'i
const ERRLOG_RETENTION_DAYS = 30; // lib/errlog.ts eski Redis TTL'i
// NotifLog = "bir kez bildir" idempotency kaydı (att:<date>:<sid>, deneme:<examId>:<phone>).
// dedupeKey geçmiş tarihe/sınava bağlı → süre geçince bir daha kontrol edilmez, ölü ağırlık.
// 90 gün fazlasıyla güvenli (aynı gün/sınav 90 gün sonra tekrar bildirilmez).
const NOTIFLOG_RETENTION_DAYS = 90;

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Bir tabloyu cutoff'tan eski kayıtlardan best-effort temizler (hatası diğerlerini düşürmez).
async function purge(label: string, fn: () => Promise<{ count: number }>): Promise<number> {
  try {
    const r = await fn();
    return r.count;
  } catch (e) {
    console.warn(`[cleanup] ${label} temizliği başarısız:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auditDeleted = await purge('auditLog',
    () => prisma.auditLog.deleteMany({ where: { at: { lt: cutoff(AUDIT_RETENTION_DAYS) } } }));
  const errDeleted = await purge('errLog',
    () => prisma.errLog.deleteMany({ where: { at: { lt: cutoff(ERRLOG_RETENTION_DAYS) } } }));
  const notifDeleted = await purge('notifLog',
    () => prisma.notifLog.deleteMany({ where: { at: { lt: cutoff(NOTIFLOG_RETENTION_DAYS) } } }));

  return NextResponse.json({ ok: true, auditDeleted, errDeleted, notifDeleted });
}
