// Prisma client tekil örneği (Next.js dev hot-reload'da çoklu bağlantı kurmasın diye
// global'de HAM client saklanır; export edilen, decimal-normalize katmanlı türevidir).
//
// decimal-to-number katmanı (Float→Decimal para göçü, 2026-07-23): para kolonları
// Decimal(12,2) — sonuçlardaki Prisma.Decimal değerleri number'a çevrilir ki tüm
// uygulama + API JSON sözleşmesi (web/mobil number bekler) değişmeden kalsın.
// TABANA kurulur: tdb (lib/sqldb) bu client üstüne zincirlenir, backup route ham
// client kullanır — ikisi de miras alır. Yalnız para taşıyabilen kök modellerin
// sonuçları yürünür (MONEY_WALK_MODELS — perf). NOT: $queryRaw bu hook'tan geçmez;
// para tablolarında raw SQL YOK (denetimle kanıtlı) ve eklenmemeli.
import { PrismaClient } from '@prisma/client';
import { decimalToNumberDeep, MONEY_WALK_MODELS } from './decimal-normalize';

const globalForPrisma = globalThis as typeof globalThis & { __okulinPrismaRaw?: PrismaClient };

const rawPrisma = globalForPrisma.__okulinPrismaRaw ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__okulinPrismaRaw = rawPrisma;
}

export const prisma = rawPrisma.$extends({
  name: 'decimal-to-number',
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        const result = await query(args);
        return MONEY_WALK_MODELS.has(model) ? decimalToNumberDeep(result) : result;
      },
    },
  },
});

export default prisma;
