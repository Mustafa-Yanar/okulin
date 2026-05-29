import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'crypto';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { getWeekKey, initWeekForTeacher } from '@/lib/slots';
import { normalizeTeacher } from '@/lib/teacherMigrate';
import { logAudit, actorFrom } from '@/lib/audit';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const ids = await redis.smembers('teachers');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`teacher:${id}`));
  const results = await pipeline.exec();
  const teachers = results.filter(Boolean).map(normalizeTeacher).map(t => ({
    id: t.id, name: t.name, username: t.username, branches: t.branches || [],
    allowedGroups: t.allowedGroups || [], photoUrl: t.photoUrl || '',
    offDays: t.offDays || [],
  }));
  return NextResponse.json(teachers);
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { name, password, branches, allowedGroups, photoUrl } = await req.json();
  if (!name || !password || !branches?.length) {
    return NextResponse.json({ error: 'İsim, şifre ve en az bir branş gerekli' }, { status: 400 });
  }

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  // Aynı isimde öğretmen var mı kontrol et
  const teacherIds = await redis.smembers('teachers');
  if (teacherIds && teacherIds.length > 0) {
    const pipeline = redis.pipeline();
    teacherIds.forEach(tid => pipeline.get(`teacher:${tid}`));
    const teachers = await pipeline.exec();
    const exists = teachers.some(t => t && t.username === username);
    if (exists) {
      return NextResponse.json({ error: 'Bu isimde bir öğretmen zaten kayıtlı' }, { status: 400 });
    }
  }

  const id = makeId();
  const hash = await bcrypt.hash(password, 10);
  const teacher = {
    id, name, username, passwordHash: hash, branches,
    allowedGroups: allowedGroups || [], photoUrl: photoUrl || '',
    mustChangePassword: true,  // ilk girişte öğretmen kendi şifresini belirleyecek
  };
  await redis.set(`teacher:${id}`, teacher);
  await redis.sadd('teachers', id);

  // Initialize current week slots
  const weekKey = getWeekKey();
  await initWeekForTeacher(id, weekKey);

  return NextResponse.json({ id, name, username, branches, allowedGroups: teacher.allowedGroups, photoUrl: teacher.photoUrl });
}

export async function PUT(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const body = await req.json();

  // Özel aksiyon: bir günü izin/aktif yap. Şablonda o güne ait tüm entry'leri siler.
  if (body.action === 'toggle_off_day') {
    const { id, dayIndex, off } = body;
    const teacher = await redis.get(`teacher:${id}`);
    if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

    const offDays = new Set(teacher.offDays || []);
    if (off) offDays.add(dayIndex);
    else offDays.delete(dayIndex);

    const updated = { ...teacher, offDays: Array.from(offDays).sort() };

    // İzin günü olduysa: o günün şablon entry'lerini sil
    if (off) {
      const program = await redis.get(`program:${id}`);
      if (program && program[String(dayIndex)]) {
        delete program[String(dayIndex)];
        await redis.set(`program:${id}`, program);
      }
    }

    await redis.set(`teacher:${id}`, updated);

    // Bu haftayı ve sonraki 2 haftayı yeniden init et
    const cw = getWeekKey();
    await initWeekForTeacher(id, cw);
    return NextResponse.json({ ok: true, offDays: updated.offDays });
  }

  const { id, name, password, branches, allowedGroups, photoUrl } = body;
  const teacher = await redis.get(`teacher:${id}`);
  if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

  const updated = {
    ...teacher, name, username: name,
    branches: branches !== undefined ? branches : (teacher.branches || []),
    allowedGroups: allowedGroups || teacher.allowedGroups,
    photoUrl: photoUrl !== undefined ? photoUrl : teacher.photoUrl,
  };
  delete updated.branch;        // eski şema alanlarını temizle
  delete updated.extraBranches;
  if (password) {
    updated.passwordHash = await bcrypt.hash(password, 10);
  }
  await redis.set(`teacher:${id}`, updated);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { id } = await req.json();
  const teacher = await redis.get(`teacher:${id}`);
  await redis.del(`teacher:${id}`);
  await redis.srem('teachers', id);
  await logAudit({
    ...actorFrom(session),
    action: 'teacher.delete',
    target: { type: 'teacher', id, name: teacher?.name || id },
    detail: `Öğretmen silindi: ${teacher?.name || id}`,
  });
  return NextResponse.json({ ok: true });
}
