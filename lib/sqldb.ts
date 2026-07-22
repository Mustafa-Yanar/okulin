// Tenant-scoped Prisma erişimi — lib/db.js (Redis Proxy) deseninin SQL hali.
// tdb() istek bağlamındaki org+branch'i sorgulara OTOMATİK enjekte eder (kurumlar
// birbirinin verisini göremez), tıpkı tenantRedis()'in prefix eklemesi gibi.
//
// Enjeksiyon: tenant kolonu taşıyan TÜM okuma/yazma işlemlerinin where/data alanlarına
// { orgSlug, branch } eklenir. Global-benzersiz cuid tek başına güvenlik sınırı değildir:
// başka kurumun id'si yanlışlıkla/saldırıyla gelirse update/delete/findUnique de reddeder.
// SKIP: global tablolar (Org/SuperAdmin) + orgSlug taşımayan çocuk tablolar (parent'tan
// scope alır) — bunlara enjeksiyon HATA verir, o yüzden hariç.
import { prisma } from './prisma';
import { currentOrg, currentBranch } from './tenant';

// orgSlug/branch kolonu OLMAYAN modeller (enjeksiyon yapma):
const SKIP = new Set([
  'Org', 'SuperAdmin', 'Branch', 'OrgAdmin', 'DemoRequest',
  'TeacherPreset', 'Installment', 'BehaviorEntry', 'ExamRow', 'FormResponse',
  'MobileAppConfig', 'MobileSession',
]);
const SCOPE_WHERE = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy',
  'findUnique', 'findUniqueOrThrow', 'update', 'updateMany', 'delete', 'deleteMany',
]);

export interface TenantScope {
  orgSlug: string;
  branch: string;
}

// İstek bağlamındaki tenant kapsamı (explicit override script/HQ için).
export function tenant(orgOverride?: string, branchOverride?: string): TenantScope {
  return { orgSlug: orgOverride || currentOrg(), branch: branchOverride || currentBranch() };
}

// tdb() dönüş tipi — $extends sonucu; route'lar Prisma model tiplerini aynen görür.
export type TenantDb = ReturnType<typeof makeTenantDb>;

function makeTenantDb(orgSlug: string, branch: string) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (SKIP.has(model)) return query(args);
          // args şekli operasyona göre değişir (where/data) — Prisma'nın $allOperations
          // birleşimi bunu statik ifade edemediği için lokal geniş tip kullanılır.
          const a = args as {
            where?: Record<string, unknown>;
            data?: unknown;
            create?: unknown;
            update?: unknown;
          };
          if (SCOPE_WHERE.has(operation)) {
            const next: typeof a = { ...a, where: { ...(a?.where || {}), orgSlug, branch } };
            if (operation === 'update' || operation === 'updateMany') {
              next.data = { ...((a?.data as Record<string, unknown>) || {}), orgSlug, branch };
            }
            args = next as typeof args;
          } else if (operation === 'create') {
            args = { ...a, data: { ...((a?.data as Record<string, unknown>) || {}), orgSlug, branch } } as typeof args;
          } else if (operation === 'createMany') {
            const d = a?.data;
            const inj = (x: unknown) => ({ ...((x as Record<string, unknown>) || {}), orgSlug, branch });
            args = { ...a, data: Array.isArray(d) ? d.map(inj) : inj(d) } as typeof args;
          } else if (operation === 'upsert') {
            args = {
              ...a,
              where: { ...(a?.where || {}), orgSlug, branch },
              create: { ...((a?.create as Record<string, unknown>) || {}), orgSlug, branch },
              update: { ...((a?.update as Record<string, unknown>) || {}), orgSlug, branch },
            } as typeof args;
          }
          return query(args);
        },
      },
    },
  });
}

// tdb() enjeksiyonu orgSlug+branch'i ÇALIŞMA ANINDA ekler; Prisma'nın create tipi
// bunu bilemez ve alanları zorunlu sayar. Bu yardımcı, enjeksiyonlu create.data'yı
// TEK noktada tipler (her çağrıda ayrı cast yazmak yerine): değerler tdb() sarmalayıcısı
// tarafından sorgu Prisma'ya ulaşmadan doldurulur, dolayısıyla tip iddiası doğrudur.
export function withScope<T>(data: T): T & TenantScope {
  return data as T & TenantScope;
}

// org+branch başına $extends proxy'sini cache'ler. $extends aynı connection pool'u
// paylaşan ince bir proxy döndürür (yeni bağlantı açmaz) ama her istekte yeniden
// kurmak gereksiz iş; kardinalite sınırlı (kurum×şube sayısı), sızıntı yok.
// prisma tekil (lib/prisma) olduğundan cache'lenmiş proxy'ler kalıcı geçerli.
const _tdbCache = new Map<string, TenantDb>();

// Tenant-scoped Prisma client. Route'lar `prisma` yerine `tdb()` kullanır.
export function tdb(orgOverride?: string, branchOverride?: string): TenantDb {
  const orgSlug = orgOverride || currentOrg();
  const branch = branchOverride || currentBranch();
  const key = `${orgSlug} ${branch}`;
  let db = _tdbCache.get(key);
  if (!db) {
    db = makeTenantDb(orgSlug, branch);
    _tdbCache.set(key, db);
  }
  return db;
}

export default tdb;
