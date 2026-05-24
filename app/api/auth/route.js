import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/redis';
import { getSession, setSession, clearSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  const directorExists = await redis.exists('director');
  return NextResponse.json({ session, directorExists: !!directorExists });
}

export async function POST(req) {
  const { action, username, password, newPassword, targetId, targetRole, name } = await req.json();

  if (action === 'login') {
    // Try director
    const director = await redis.get('director');
    if (director && director.username === username) {
      const ok = await bcrypt.compare(password, director.passwordHash);
      if (ok) {
        const res = NextResponse.json({ role: 'director', name: director.name });
        await setSession(res, { role: 'director', id: 'director', name: director.name });
        return res;
      }
    }

    // Try accountant
    const accountantIds = await redis.smembers('accountants');
    if (accountantIds && accountantIds.length > 0) {
      const pipeline = redis.pipeline();
      accountantIds.forEach(aid => pipeline.get(`accountant:${aid}`));
      const accountants = await pipeline.exec();
      for (const a of accountants) {
        if (a && a.username === username) {
          const ok = await bcrypt.compare(password, a.passwordHash);
          if (ok) {
            const res = NextResponse.json({ role: 'accountant', id: a.id, name: a.name });
            await setSession(res, { role: 'accountant', id: a.id, name: a.name });
            return res;
          }
        }
      }
    }


    // Try teacher
    const teacherIds = await redis.smembers('teachers');
    if (teacherIds && teacherIds.length > 0) {
      const pipeline = redis.pipeline();
      teacherIds.forEach(tid => pipeline.get(`teacher:${tid}`));
      const teachers = await pipeline.exec();
      for (const t of teachers) {
        if (t && t.username === username) {
          const ok = await bcrypt.compare(password, t.passwordHash);
          if (ok) {
            const branches = Array.isArray(t.branches) ? t.branches
              : [t.branch, ...(t.extraBranches || [])].filter(Boolean); // eski kayıt fallback
            const res = NextResponse.json({ role: 'teacher', id: t.id, name: t.name, branches, allowedGroups: t.allowedGroups || [] });
            await setSession(res, { role: 'teacher', id: t.id, name: t.name, branches, allowedGroups: t.allowedGroups || [] });
            return res;
          }
        }
      }
    }

    // Try student
    const studentIds = await redis.smembers('students');
    if (studentIds && studentIds.length > 0) {
      const pipeline = redis.pipeline();
      studentIds.forEach(sid => pipeline.get(`student:${sid}`));
      const students = await pipeline.exec();
      for (const s of students) {
        if (s && s.username === username) {
          const ok = await bcrypt.compare(password, s.passwordHash);
          if (ok) {
            const res = NextResponse.json({ role: 'student', id: s.id, name: s.name, cls: s.cls, group: s.group });
            await setSession(res, { role: 'student', id: s.id, name: s.name, cls: s.cls, group: s.group });
            return res;
          }
        }
      }
    }

    return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı' }, { status: 401 });
  }

  if (action === 'setup_director') {
    const exists = await redis.exists('director');
    if (exists) return NextResponse.json({ error: 'Müdür zaten kayıtlı' }, { status: 400 });
    const hash = await bcrypt.hash(password, 10);
    const directorName = name || 'Müdür';
    await redis.set('director', { username, passwordHash: hash, name: directorName });
    const res = NextResponse.json({ ok: true });
    await setSession(res, { role: 'director', id: 'director', name: directorName });
    return res;
  }

  if (action === 'update_director_name') {
    const session = await getSession();
    if (!session || session.role !== 'director') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    const director = await redis.get('director');
    if (!director) return NextResponse.json({ error: 'Müdür bulunamadı' }, { status: 404 });
    await redis.set('director', { ...director, name });
    const res = NextResponse.json({ ok: true });
    await setSession(res, { role: 'director', id: 'director', name });
    return res;
  }

  if (action === 'logout') {
    const res = NextResponse.json({ ok: true });
    await clearSession(res);
    return res;
  }

  // Kendi şifresini değiştir (mevcut şifre doğrulanır)
  if (action === 'change_password') {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

    if (session.role === 'teacher') {
      const t = await redis.get(`teacher:${session.id}`);
      if (!t) return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
      const ok = await bcrypt.compare(password, t.passwordHash);
      if (!ok) return NextResponse.json({ error: 'Mevcut şifre hatalı' }, { status: 400 });
      await redis.set(`teacher:${session.id}`, { ...t, passwordHash: await bcrypt.hash(newPassword, 10) });
      return NextResponse.json({ ok: true });
    }

    if (session.role === 'student') {
      const s = await redis.get(`student:${session.id}`);
      if (!s) return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 });
      const ok = await bcrypt.compare(password, s.passwordHash);
      if (!ok) return NextResponse.json({ error: 'Mevcut şifre hatalı' }, { status: 400 });
      await redis.set(`student:${session.id}`, { ...s, passwordHash: await bcrypt.hash(newPassword, 10) });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Müdür başkasının şifresini sıfırlar
  if (action === 'reset_password') {
    const session = await getSession();
    if (!session || session.role !== 'director') {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    if (targetRole === 'teacher') {
      const t = await redis.get(`teacher:${targetId}`);
      if (!t) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
      await redis.set(`teacher:${targetId}`, { ...t, passwordHash: hash });
      return NextResponse.json({ ok: true });
    }

    if (targetRole === 'student') {
      const s = await redis.get(`student:${targetId}`);
      if (!s) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });
      await redis.set(`student:${targetId}`, { ...s, passwordHash: hash });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Geçersiz hedef' }, { status: 400 });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
}
