import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type DynamicDelegate = { findMany?: () => Promise<unknown[]> };
type DynamicDb = Record<string, DynamicDelegate | undefined>;

async function readAllTables(db: unknown) {
  const models = Prisma.dmmf.datamodel.models.map((model) => model.name);
  const tables: Record<string, unknown[]> = {};
  let total = 0;
  const dynamic = db as DynamicDb;

  for (const name of models) {
    const prop = name.charAt(0).toLowerCase() + name.slice(1);
    if (typeof dynamic[prop]?.findMany !== 'function') continue;
    const rows = await dynamic[prop]!.findMany!();
    tables[name] = rows;
    total += rows.length;
  }
  return { tables, total };
}

// Tüm tablolar AYNI repeatable-read snapshot'ından okunur. Aksi halde örneğin Finance
// okunduktan sonra gelen bir ödeme Installment/PayOrder tablolarına yansıyıp yedeğin kendi
// içinde farklı anları temsil etmesine yol açabilir.
export async function snapshotSql() {
  return prisma.$transaction(
    async (tx) => readAllTables(tx),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
}
