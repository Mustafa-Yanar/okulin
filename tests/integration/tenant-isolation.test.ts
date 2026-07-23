import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { tdb, withScope } from '@/lib/sqldb';
import { runWithTenant } from '@/lib/tenant';
import { setPref } from '@/lib/notify-prefs';

const cleanupIds: string[] = [];

afterAll(async () => {
  if (cleanupIds.length) await prisma.student.deleteMany({ where: { id: { in: cleanupIds } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: 'integration_pref_user' } });
  await prisma.$disconnect();
});

describe('kurumlar arası veri izolasyonu', () => {
  it('aynı sorgu yalnız aktif kurumun öğrencisini görür', async () => {
    const testkurs = await runWithTenant('testkurs', 'main', () => tdb().student.findMany());
    const digerkurs = await runWithTenant('digerkurs', 'main', () => tdb().student.findMany());

    expect(testkurs.length).toBeGreaterThanOrEqual(2);
    expect(digerkurs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(testkurs.map((row) => row.orgSlug))).toEqual(new Set(['testkurs']));
    expect(new Set(digerkurs.map((row) => row.orgSlug))).toEqual(new Set(['digerkurs']));
  });

  it('create içindeki sahte kurum alanlarını aktif kapsamla ezer', async () => {
    const created = await runWithTenant('testkurs', 'main', () => tdb().student.create({
      data: withScope({
        id: 'student_scope_override_test',
        orgSlug: 'digerkurs',
        branch: 'yanlis-sube',
        legacyId: 'scope_override',
        name: 'Kapsam Test Öğrencisi',
        username: 'scope_override',
        passwordHash: 'yalniz-test',
        group: 'ortaokul',
      }),
    }));
    cleanupIds.push(created.id);

    expect(created.orgSlug).toBe('testkurs');
    expect(created.branch).toBe('main');
  });

  it('başka kurumun global kimliğiyle tekil okuma, güncelleme ve silmeyi reddeder', async () => {
    const foreign = await prisma.student.findFirstOrThrow({ where: { orgSlug: 'digerkurs' } });

    const visible = await runWithTenant('testkurs', 'main', () =>
      tdb().student.findUnique({ where: { id: foreign.id } }));
    expect(visible).toBeNull();

    await expect(runWithTenant('testkurs', 'main', () =>
      tdb().student.update({ where: { id: foreign.id }, data: { name: 'YANLIŞ GÜNCELLEME' } })))
      .rejects.toMatchObject({ code: 'P2025' });

    await expect(runWithTenant('testkurs', 'main', () =>
      tdb().student.delete({ where: { id: foreign.id } })))
      .rejects.toMatchObject({ code: 'P2025' });

    const unchanged = await prisma.student.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(unchanged.name).toBe('İkinci Test Öğrencisi');
  });

  it('toplu güncelleme de yabancı kurum satırına dokunmaz', async () => {
    const foreign = await prisma.student.findFirstOrThrow({ where: { orgSlug: 'digerkurs' } });
    const result = await runWithTenant('testkurs', 'main', () =>
      tdb().student.updateMany({ where: { id: foreign.id }, data: { name: 'YANLIŞ TOPLU GÜNCELLEME' } }));

    expect(result.count).toBe(0);
    const unchanged = await prisma.student.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(unchanged.name).toBe('İkinci Test Öğrencisi');
  });

  it('aynı kurumda findUnique, update ve upsert normal çalışmayı sürdürür', async () => {
    const config = await runWithTenant('testkurs', 'main', () => tdb().tenantConfig.findUnique({
      where: { orgSlug_branch: { orgSlug: 'testkurs', branch: 'main' } },
    }));
    expect(config?.orgSlug).toBe('testkurs');

    const own = await prisma.student.findFirstOrThrow({ where: { orgSlug: 'testkurs', legacyId: 's_101_1' } });
    const updated = await runWithTenant('testkurs', 'main', () => tdb().student.update({
      where: { id: own.id },
      data: { name: own.name, orgSlug: 'digerkurs', branch: 'yanlis-sube' },
    }));
    expect(updated).toMatchObject({ orgSlug: 'testkurs', branch: 'main' });

    await runWithTenant('testkurs', 'main', () => setPref('student', 'integration_pref_user', 'duyuru', false));
    await runWithTenant('testkurs', 'main', () => setPref('student', 'integration_pref_user', 'duyuru', true));
    const pref = await prisma.notificationPreference.findFirstOrThrow({ where: { userId: 'integration_pref_user' } });
    expect(pref).toMatchObject({ orgSlug: 'testkurs', branch: 'main', enabled: true });
  });
});
