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
  'Org', 'SuperAdmin',
  'TeacherPreset', 'Installment', 'BehaviorEntry', 'ExamRow', 'FormResponse',
]);
const SCOPE_WHERE = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);

// İstek bağlamındaki tenant kapsamı (explicit override script/HQ için).
export function tenant(orgOverride, branchOverride) {
  return { orgSlug: orgOverride || currentOrg(), branch: branchOverride || currentBranch() };
}

// Tenant-scoped Prisma client. Route'lar `prisma` yerine `tdb()` kullanır.
export function tdb(orgOverride, branchOverride) {
  const orgSlug = orgOverride || currentOrg();
  const branch = branchOverride || currentBranch();
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (SKIP.has(model)) return query(args);
          if (SCOPE_WHERE.has(operation)) {
            args = { ...args, where: { ...(args?.where || {}), orgSlug, branch } };
          } else if (operation === 'create') {
            args = { ...args, data: { ...(args?.data || {}), orgSlug, branch } };
          } else if (operation === 'createMany') {
            const d = args?.data;
            const inj = (x) => ({ ...x, orgSlug, branch });
            args = { ...args, data: Array.isArray(d) ? d.map(inj) : inj(d) };
          }
          return query(args);
        },
      },
    },
  });
}

export default tdb;
