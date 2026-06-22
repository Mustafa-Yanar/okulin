// Prisma client tekil örneği (Next.js dev hot-reload'da çoklu bağlantı kurmasın diye
// global'de saklanır). Henüz hiçbir route bunu import ETMİYOR — Faz 2'de tenant-scoped
// sarmalayıcıyla (lib/db.js Proxy'sinin SQL hali) birlikte devreye girecek.
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__okulinPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__okulinPrisma = prisma;
}

export default prisma;
