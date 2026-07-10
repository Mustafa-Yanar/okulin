import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { normalizeTeacher, type LegacyTeacherLike } from '@/lib/teacherMigrate';

// Tek seferlik: tüm öğretmenleri eski şemadan (branch + extraBranches) yeni
// şemaya (branches[]) çevirir. Director-only.
export const POST = withAuth(['director'], async () => {

  const ids = await redis.smembers('teachers');
  if (!ids || ids.length === 0) return NextResponse.json({ ok: true, migrated: 0, total: 0 });

  let migrated = 0;
  const results: object[] = [];
  for (const id of ids) {
    const t = await redis.get<LegacyTeacherLike>(`teacher:${id}`);
    if (!t) continue;
    if (Array.isArray(t.branches)) { results.push({ id, name: t.name, branches: t.branches, skipped: true }); continue; }
    const norm = normalizeTeacher(t);
    await redis.set(`teacher:${id}`, norm);
    migrated++;
    results.push({ id, name: norm.name, branches: norm.branches });
  }

  return NextResponse.json({ ok: true, migrated, total: ids.length, results });
});
