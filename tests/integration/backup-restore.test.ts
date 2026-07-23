import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { snapshotSql } from '@/lib/backup/sql-snapshot';

const runFile = promisify(execFile);
const RESTORE_SCHEMA = 'okulin_restore_drill';
let tempDir: string | null = null;
let targetClient: PrismaClient | null = null;

function targetUrl() {
  const raw = process.env.DATABASE_POSTGRES_PRISMA_URL;
  if (!raw) throw new Error('Test veritabanı adresi yok');
  const url = new URL(raw);
  url.searchParams.set('schema', RESTORE_SCHEMA);
  return url.toString();
}

function targetEnv(url: string) {
  return {
    ...process.env,
    DATABASE_POSTGRES_PRISMA_URL: url,
    DATABASE_POSTGRES_URL_NON_POOLING: url,
    DATABASE_URL: url,
    DATABASE_URL_UNPOOLED: url,
    OKULIN_TEST_DB_GUARDED: 'YES',
    OKULIN_SQL_RESTORE_CONFIRMED: 'LOCAL_RESTORE_DRILL_CONFIRMED',
  };
}

function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return JSON.stringify((value as { toNumber: () => number }).toNumber());
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function tableSignatures(tables: Record<string, unknown[]>) {
  return Object.fromEntries(Object.entries(tables).sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => {
    const canonical = rows.map(stable).sort().join('\n');
    return [name, { count: rows.length, sha256: createHash('sha256').update(canonical).digest('hex') }];
  }));
}

async function readAll(client: PrismaClient) {
  const tables: Record<string, unknown[]> = {};
  const dynamic = client as unknown as Record<string, { findMany: () => Promise<unknown[]> }>;
  for (const model of Prisma.dmmf.datamodel.models) {
    const prop = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    tables[model.name] = await dynamic[prop].findMany();
  }
  return tables;
}

async function restore(file: string, url: string) {
  return runFile(process.execPath, ['scripts/restore-sql.mjs', `--file=${file}`, '--write', '--flush'], {
    cwd: process.cwd(), env: targetEnv(url), maxBuffer: 4 * 1024 * 1024,
  });
}

afterAll(async () => {
  await targetClient?.$disconnect();
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${RESTORE_SCHEMA}" CASCADE`);
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe('SQL yedek geri-yükleme tatbikatı', () => {
  it('50 tabloyu izole şemaya eksiksiz yükler; bozuk yedekte tüm işlemi geri alır', async () => {
    const source = await snapshotSql();
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name).sort();
    expect(Object.keys(source.tables).sort()).toEqual(modelNames);
    expect(source.total).toBe(Object.values(source.tables).reduce((sum, rows) => sum + rows.length, 0));

    tempDir = await mkdtemp(path.join(os.tmpdir(), 'okulin-restore-drill-'));
    const goodFile = path.join(tempDir, 'good.json');
    const goodPayload = JSON.parse(JSON.stringify({
      snapshotAt: new Date().toISOString(), rowCount: source.total, format: 'sql-v1', tables: source.tables,
    }));
    await writeFile(goodFile, JSON.stringify(goodPayload));

    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${RESTORE_SCHEMA}" CASCADE`);
    const url = targetUrl();
    const { OKULIN_SQL_RESTORE_CONFIRMED: _confirmation, ...blockedEnv } = targetEnv(url);
    await expect(runFile(process.execPath, ['scripts/restore-sql.mjs', `--file=${goodFile}`, '--write', '--flush'], {
      cwd: process.cwd(), env: blockedEnv, maxBuffer: 4 * 1024 * 1024,
    })).rejects.toThrow();

    await runFile(path.join(process.cwd(), 'node_modules/.bin/prisma'), ['db', 'push', '--skip-generate'], {
      cwd: process.cwd(), env: targetEnv(url), maxBuffer: 4 * 1024 * 1024,
    });
    await restore(goodFile, url);

    targetClient = new PrismaClient({ datasources: { db: { url } } });
    const restored = await readAll(targetClient);
    const expectedSignatures = tableSignatures(source.tables);
    expect(tableSignatures(restored)).toEqual(expectedSignatures);

    // Fault injection: Student FK'sini boz. Restore önce flush yapsa bile transaction
    // başarısız olduğunda hedefin önceki, eksiksiz hali aynen kalmalıdır.
    const brokenPayload = JSON.parse(JSON.stringify(goodPayload));
    brokenPayload.tables.Student[0].classId = 'olmayan-sinif';
    const brokenFile = path.join(tempDir, 'broken.json');
    await writeFile(brokenFile, JSON.stringify(brokenPayload));
    await expect(restore(brokenFile, url)).rejects.toThrow();

    const afterFailure = await readAll(targetClient);
    expect(tableSignatures(afterFailure)).toEqual(expectedSignatures);
  }, 120_000);
});
