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

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auditCutoff = cutoff(AUDIT_RETENTION_DAYS);
  const errCutoff = cutoff(ERRLOG_RETENTION_DAYS);

  // Bir tablonun hatası diğerini düşürmesin (best-effort temizlik).
  let auditDeleted = 0;
  let errDeleted = 0;
  try {
    const r = await prisma.auditLog.deleteMany({ where: { at: { lt: auditCutoff } } });
    auditDeleted = r.count;
  } catch (e) {
    console.warn('[cleanup] auditLog temizliği başarısız:', e instanceof Error ? e.message : e);
  }
  try {
    const r = await prisma.errLog.deleteMany({ where: { at: { lt: errCutoff } } });
    errDeleted = r.count;
  } catch (e) {
    console.warn('[cleanup] errLog temizliği başarısız:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true, auditDeleted, errDeleted });
}
