import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { classToGroup, classLabel, STUDENT_GROUPS } from '@/lib/constants';

// Tek yön duyuru/bilgilendirme sistemi (hub-spoke). Gönderen: müdür + rehber.
// Alıcı: rol×kapsam ile hedeflenir; rol-içi (veli-veli vb.) YOK. Okundu + push.
// Anahtarlar (tenant-scoped):
//   announcements (set) → id'ler
//   announcement:<id> → {id, title, body, audience, audienceLabel, recipients:[{role,id,name}], recipientCount, sender..., createdAt}
//   announcement:<id>:reads (set) → okuyan id'leri
//   inbox:<role>:<id> (set) → o kullanıcıya hedeflenen duyuru id'leri (fan-out)

const TTL = 60 * 60 * 24 * 365; // 1 yıl
export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

function genId() { return Math.random().toString(36).slice(2, 10); }

const AudienceSchema = z.object({
  role: z.enum(['parent', 'student', 'teacher']),
  scope: z.enum(['all', 'group', 'class', 'selected']),
  group: z.string().max(20).optional(),
  cls: z.string().max(8).optional(),
  ids: z.array(z.string().max(100)).max(3000).optional(),
});

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send'),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4000),
    audience: AudienceSchema,
  }),
  z.object({ action: z.literal('read'), id: zId }),
]);

// Hedef kitleyi çöz → [{role, id, name}]
async function resolveRecipients(audience) {
  const { role, scope, cls, group, ids } = audience;

  if (role === 'parent') {
    const phones = await redis.smembers('parents');
    if (!phones || phones.length === 0) return [];
    const pipe = redis.pipeline();
    phones.forEach(p => pipe.get(`parent:${p}`));
    let recs = (await pipe.exec()).filter(Boolean);
    if (scope === 'selected') recs = recs.filter(r => ids?.includes(r.id));
    else if (scope === 'class') recs = recs.filter(r => (r.children || []).some(c => c.cls === cls));
    else if (scope === 'group') recs = recs.filter(r => (r.children || []).some(c => classToGroup(c.cls) === group));
    return recs.map(r => ({ role: 'parent', id: r.id, name: (r.children || []).map(c => c.name).join(', ') + ' (Veli)' }));
  }

  if (role === 'student') {
    const sids = await redis.smembers('students');
    if (!sids || sids.length === 0) return [];
    const pipe = redis.pipeline();
    sids.forEach(id => pipe.get(`student:${id}`));
    let recs = (await pipe.exec()).filter(Boolean);
    if (scope === 'selected') recs = recs.filter(s => ids?.includes(s.id));
    else if (scope === 'class') recs = recs.filter(s => s.cls === cls);
    else if (scope === 'group') recs = recs.filter(s => s.group === group);
    return recs.map(s => ({ role: 'student', id: s.id, name: s.name }));
  }

  // teacher — şimdilik yalnız 'all' veya 'selected' (branş/sınıf hedefi sonra)
  const tids = await redis.smembers('teachers');
  if (!tids || tids.length === 0) return [];
  const pipe = redis.pipeline();
  tids.forEach(id => pipe.get(`teacher:${id}`));
  let recs = (await pipe.exec()).filter(Boolean);
  if (scope === 'selected') recs = recs.filter(t => ids?.includes(t.id));
  return recs.map(t => ({ role: 'teacher', id: t.id, name: t.name }));
}

function audienceLabel(audience) {
  const roleLbl = { parent: 'Veli', student: 'Öğrenci', teacher: 'Öğretmen' }[audience.role];
  if (audience.scope === 'all') return `Tüm ${roleLbl === 'Veli' ? 'Veliler' : roleLbl === 'Öğrenci' ? 'Öğrenciler' : 'Öğretmenler'}`;
  if (audience.scope === 'group') return `${STUDENT_GROUPS[audience.group]?.label || audience.group} ${roleLbl === 'Veli' ? 'Velileri' : roleLbl + 'leri'}`;
  if (audience.scope === 'class') return `${classLabel(audience.cls)} ${roleLbl === 'Veli' ? 'Velileri' : roleLbl + 'leri'}`;
  return `Seçili ${roleLbl}ler`;
}

// GET — yönetici: gönderdiği duyurular + okunma sayıları; ?id=X → kim okudu detayı.
//       alıcı: kendi gelen kutusu (inbox).
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const detailId = new URL(req.url).searchParams.get('id');

  // Kim okudu detayı (yönetici)
  if (detailId && isManager(session)) {
    const rec = await redis.get(`announcement:${detailId}`);
    if (!rec) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
    const readers = new Set(await redis.smembers(`announcement:${detailId}:reads`) || []);
    const recipients = (rec.recipients || []).map(r => ({ id: r.id, name: r.name, read: readers.has(r.id) }));
    return NextResponse.json({ id: detailId, title: rec.title, recipients });
  }

  if (isManager(session)) {
    const ids = await redis.smembers('announcements');
    if (!ids || ids.length === 0) return NextResponse.json({ announcements: [] });
    const pipe = redis.pipeline();
    ids.forEach(id => { pipe.get(`announcement:${id}`); pipe.scard(`announcement:${id}:reads`); });
    const res = await pipe.exec();
    const list = [];
    ids.forEach((id, i) => {
      const rec = res[i * 2];
      if (!rec) return;
      list.push({ ...rec, readCount: res[i * 2 + 1] || 0 });
    });
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    // body'yi listede kısaltma — composer detayda gösterir
    return NextResponse.json({ announcements: list });
  }

  // Alıcı gelen kutusu
  const inboxIds = await redis.smembers(`inbox:${session.role}:${session.id}`);
  if (!inboxIds || inboxIds.length === 0) return NextResponse.json({ announcements: [] });
  const pipe = redis.pipeline();
  inboxIds.forEach(id => { pipe.get(`announcement:${id}`); pipe.sismember(`announcement:${id}:reads`, session.id); });
  const res = await pipe.exec();
  const list = [];
  inboxIds.forEach((id, i) => {
    const rec = res[i * 2];
    if (!rec) return; // süresi dolmuş / silinmiş → atla
    list.push({
      id: rec.id, title: rec.title, body: rec.body,
      senderName: rec.senderName, createdAt: rec.createdAt,
      read: !!res[i * 2 + 1],
    });
  });
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return NextResponse.json({ announcements: list });
}

export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // Alıcı: duyuruyu okundu işaretler
  if (data.action === 'read') {
    // yalnız kendi inbox'undaki duyuruyu işaretleyebilir
    const inMy = await redis.sismember(`inbox:${session.role}:${session.id}`, data.id);
    if (!inMy) return NextResponse.json({ error: 'Bu duyuru size ait değil' }, { status: 403 });
    await redis.sadd(`announcement:${data.id}:reads`, session.id);
    await redis.expire(`announcement:${data.id}:reads`, TTL);
    return NextResponse.json({ ok: true });
  }

  // Gönder — yalnız müdür + rehber
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const { title, body, audience } = data;
  const recipients = await resolveRecipients(audience);
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'Bu hedefte alıcı yok' }, { status: 400 });
  }

  const id = genId();
  const rec = {
    id, title, body,
    audience, audienceLabel: audienceLabel(audience),
    recipients, recipientCount: recipients.length,
    senderId: session.id, senderName: session.name, senderRole: session.role,
    createdAt: new Date().toISOString(),
  };
  await redis.set(`announcement:${id}`, rec, { ex: TTL });
  await redis.sadd('announcements', id);

  // Fan-out: her alıcının inbox'una ekle
  const pipe = redis.pipeline();
  recipients.forEach(r => pipe.sadd(`inbox:${r.role}:${r.id}`, id));
  await pipe.exec();

  // Push bildirimi (paralel, hata toleranslı)
  const payload = { title: `📢 ${title}`, body: body.slice(0, 120), url: '/', tag: `ann-${id}` };
  await Promise.allSettled(recipients.map(r => sendPushToUser(r.role, r.id, payload)));

  await logAudit({
    ...actorFrom(session),
    action: 'announcement.send',
    target: { type: 'announcement', id, name: title },
    detail: `Duyuru gönderildi: "${title}" → ${rec.audienceLabel} (${recipients.length} kişi)`,
  });

  return NextResponse.json({ ok: true, id, recipientCount: recipients.length });
}

// DELETE ?id=X — yönetici duyuruyu siler
export async function DELETE(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });
  const rec = await redis.get(`announcement:${id}`);
  if (!rec) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });

  // inbox referanslarını temizle
  const pipe = redis.pipeline();
  (rec.recipients || []).forEach(r => pipe.srem(`inbox:${r.role}:${r.id}`, id));
  await pipe.exec();
  await redis.del(`announcement:${id}`);
  await redis.del(`announcement:${id}:reads`);
  await redis.srem('announcements', id);

  return NextResponse.json({ ok: true });
}
