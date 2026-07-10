// Tenant-scoped Prisma erişimi — lib/db.js (Redis Proxy) deseninin SQL hali.
// tdb() istek bağlamındaki org+branch'i sorgulara OTOMATİK enjekte eder (kurumlar
// birbirinin verisini göremez), tıpkı tenantRedis()'in prefix eklemesi gibi.
//
// Enjeksiyon: create.data + createMany.data + (findMany/findFirst/count/aggregate/
// groupBy/updateMany/deleteMany).where → { orgSlug, branch }. findUnique/update/delete/
// upsert (cuid id ile, global-benzersiz) DOKUNULMAZ; route gerekiyorsa explicit verir.
// SKIP: global tablolar (Org/SuperAdmin) + orgSlug taşımayan çocuk tablolar (parent'tan
// scope alır) — bunlara enjeksiyon HATA verir, o yüzden hariç.
import { prisma } from './prisma';
import { currentOrg, currentBranch } from './tenant';

// orgSlug/branch kolonu OLMAYAN modeller (enjeksiyon yapma):
const SKIP = new Set([
  'Org', 'SuperAdmin', 'Branch', 'OrgAdmin', 'DemoRequest',
  'TeacherPreset', 'Installment', 'BehaviorEntry', 'ExamRow', 'FormResponse',
]);
const SCOPE_WHERE = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
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
          const a = args as { where?: Record<string, unknown>; data?: unknown };
          if (SCOPE_WHERE.has(operation)) {
            args = { ...a, where: { ...(a?.where || {}), orgSlug, branch } } as typeof args;
          } else if (operation === 'create') {
            args = { ...a, data: { ...((a?.data as Record<string, unknown>) || {}), orgSlug, branch } } as typeof args;
          } else if (operation === 'createMany') {
            const d = a?.data;
            const inj = (x: unknown) => ({ ...((x as Record<string, unknown>) || {}), orgSlug, branch });
            args = { ...a, data: Array.isArray(d) ? d.map(inj) : inj(d) } as typeof args;
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

// Tenant-scoped Prisma client. Route'lar `prisma` yerine `tdb()` kullanır.
export function tdb(orgOverride?: string, branchOverride?: string): TenantDb {
  const orgSlug = orgOverride || currentOrg();
  const branch = branchOverride || currentBranch();
  return makeTenantDb(orgSlug, branch);
}

export default tdb;
