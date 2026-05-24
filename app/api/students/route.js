import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { classToGroup } from '@/lib/constants';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const ids = await redis.smembers('students');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`student:${id}`));
  const results = await pipeline.exec();
  const students = results.filter(Boolean).map(s => ({
    id: s.id, name: s.name, username: s.username, cls: s.cls, group: s.group,
    phone: s.phone || '', parentPhone: s.parentPhone || '',
  }));
  return NextResponse.json(students);
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { name, password, cls, phone, parentPhone } = await req.json();
  if (!name || !password || !cls) {
    return NextResponse.json({ error: 'Tüm alanlar gerekli' }, { status: 400 });
  }

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  const group = classToGroup(cls);
  if (!group) return NextResponse.json({ error: 'Geçersiz sınıf' }, { status: 400 });

  // Aynı isimde öğrenci var mı kontrol et
  const studentIds = await redis.smembers('students');
  if (studentIds && studentIds.length > 0) {
    const pipeline = redis.pipeline();
    studentIds.forEach(sid => pipeline.get(`student:${sid}`));
    const students = await pipeline.exec();
    const exists = students.some(s => s && s.username === username);
    if (exists) {
      return NextResponse.json({ error: 'Bu isimde bir öğrenci zaten kayıtlı' }, { status: 400 });
    }
  }

  const id = makeId();
  const hash = await bcrypt.hash(password, 10);
  const student = { id, name, username, passwordHash: hash, cls, group, phone: phone || '', parentPhone: parentPhone || '' };
  await redis.set(`student:${id}`, student);
  await redis.sadd('students', id);

  return NextResponse.json({ id, name, username, cls, group });
}

export async function PUT(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { id, name, password, cls, phone, parentPhone } = await req.json();
  const student = await redis.get(`student:${id}`);
  if (!student) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  const group = classToGroup(cls) || student.group;
  const updated = { ...student, name, username: name, cls, group };
  if (phone !== undefined) updated.phone = phone || '';
  if (parentPhone !== undefined) updated.parentPhone = parentPhone || '';
  if (password) {
    updated.passwordHash = await bcrypt.hash(password, 10);
  }
  await redis.set(`student:${id}`, updated);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { id, ids } = await req.json();

  // Toplu silme
  if (ids && Array.isArray(ids)) {
    const pipeline = redis.pipeline();
    ids.forEach(sid => {
      pipeline.del(`student:${sid}`);
      pipeline.srem('students', sid);
    });
    await pipeline.exec();
    return NextResponse.json({ ok: true, deleted: ids.length });
  }

  // Tekil silme
  await redis.del(`student:${id}`);
  await redis.srem('students', id);
  return NextResponse.json({ ok: true });
}
