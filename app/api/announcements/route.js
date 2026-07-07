import { NextResponse } from 'next/server';
import { getSession, isManager } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { classToGroup, classLabel, STUDENT_GROUPS } from '@/lib/constants';
import { getClasses, getClass } from '@/lib/classes';
import { tdb } from '@/lib/sqldb';

// Tek yön duyuru/bilgilendirme sistemi (hub-spoke). Gönderen: müdür + rehber.
// Alıcı: rol×kapsam ile hedeflenir; rol-içi (veli-veli vb.) YOK. Okundu + push.

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

import { newId as genId } from '@/lib/id';

const AudienceSchema = z.object({
  role: z.enum(['parent', 'student', 'teacher']),
  scope: z.enum(['all', 'group', 'class', 'selected']),
  group: z.string().max(20).optional(),
  cls: z.string().max(60).optional(), // şube id (özel şube 's_xxxxxxxx' = 10 krk)
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

  // group scope için şube→grup haritası (registry-aware). Lazımsa hesaplanır.
  const groupMap = async () => new Map((await getClasses()).map(c => [c.id, c.group]));

  if (role === 'parent') {
    const rows = await tdb().parent.findMany();
    let recs = rows.map(p => ({ id: p.phone, children: p.children || [] }));
    if (scope === 'selected') recs = recs.filter(r => ids?.includes(r.id));
    else if (scope === 'class') recs = recs.filter(r => (r.children || []).some(c => c.cls === cls));
    else if (scope === 'group') {
      const groupById = await groupMap();
      recs = recs.filter(r => (r.children || []).some(c => (groupById.get(c.cls) ?? classToGroup(c.cls)) === group));
    }
    return recs.map(r => ({ role: 'parent', id: r.id, name: (r.children || []).map(c => c.name).join(', ') + ' (Veli)' }));
  }

  if (role === 'student') {
    const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
    let recs = rows.map(s => ({ id: s.legacyId, name: s.name, cls: s.class?.legacyId || '', group: s.group }));
    if (scope === 'selected') recs = recs.filter(s => ids?.includes(s.id));
    else if (scope === 'class') recs = recs.filter(s => s.cls === cls);
    else if (scope === 'group') recs = recs.filter(s => s.group === group);
    return recs.map(s => ({ role: 'student', id: s.id, name: s.name }));
  }

  // teacher — şimdilik yalnız 'all' veya 'selected' (branş/sınıf hedefi sonra)
  const rows = await tdb().teacher.findMany();
  let recs = rows.map(t => ({ id: t.legacyId, name: t.name }));
  if (scope === 'selected') recs = recs.filter(t => ids?.includes(t.id));
  return recs.map(t => ({ role: 'teacher', id: t.id, name: t.name }));
}

const GROUP_LABELS = { ilkokul: 'İlkokul', ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };

async function audienceLabel(audience) {
  const roleLbl = { parent: 'Veli', student: 'Öğrenci', teacher: 'Öğretmen' }[audience.role];
  if (audience.scope === 'all') return `Tüm ${roleLbl === 'Veli' ? 'Veliler' : roleLbl === 'Öğrenci' ? 'Öğrenciler' : 'Öğretmenler'}`;
  if (audience.scope === 'group') {
    const gLbl = GROUP_LABELS[audience.group] || STUDENT_GROUPS[audience.group]?.label || audience.group;
    return `${gLbl} ${roleLbl === 'Veli' ? 'Velileri' : roleLbl + 'leri'}`;
  }
  if (audience.scope === 'class') {
    // Şube etiketi registry'den (özel isim); kayıtsızsa classLabel fallback.
    const lbl = (await getClass(audience.cls))?.ad || classLabel(audience.cls);
    return `${lbl} ${roleLbl === 'Veli' ? 'Velileri' : roleLbl + 'leri'}`;
  }
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
    const ann = await tdb().announcement.findFirst({ where: { legacyId: detailId }, include: { recipients: true } });
    if (!ann) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
    const recipients = ann.recipients.map(r => ({ id: r.recipientId, name: r.name, read: r.read }));
    return NextResponse.json({ id: detailId, title: ann.data.title, recipients });
  }

  if (isManager(session)) {
    const rows = await tdb().announcement.findMany({ include: { _count: { select: { recipients: { where: { read: true } } } } } });
    const list = rows.map(r => ({ ...r.data, readCount: r._count.recipients }));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return NextResponse.json({ announcements: list });
  }

  // Alıcı gelen kutusu
  const myRecs = await tdb().announcementRecipient.findMany({
    where: { role: session.role, recipientId: session.id },
    include: { announcement: true },
  });
  const list = myRecs
    .filter(r => r.announcement)
    .map(r => {
      const d = r.announcement.data;
      return { id: d.id, title: d.title, body: d.body, senderName: d.senderName, createdAt: d.createdAt, read: r.read };
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
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
    const ann = await tdb().announcement.findFirst({ where: { legacyId: data.id } });
    if (!ann) return NextResponse.json({ error: 'Bu duyuru size ait değil' }, { status: 403 });
    const r = await tdb().announcementRecipient.updateMany({
      where: { announcementId: ann.id, role: session.role, recipientId: session.id },
      data: { read: true },
    });
    if (r.count === 0) return NextResponse.json({ error: 'Bu duyuru size ait değil' }, { status: 403 });
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
    audience, audienceLabel: await audienceLabel(audience),
    recipients, recipientCount: recipients.length,
    senderId: session.id, senderName: session.name, senderRole: session.role,
    createdAt: new Date().toISOString(),
  };
  // data = içerik (recipients normalize AnnouncementRecipient'a, recipientCount data'da kalır).
  const { recipients: _omit, ...dataNoRecips } = rec;
  const ann = await tdb().announcement.create({ data: { legacyId: id, data: dataNoRecips } });
  if (recipients.length) {
    await tdb().announcementRecipient.createMany({
      data: recipients.map(r => ({ announcementId: ann.id, role: r.role, recipientId: r.id, name: r.name })),
    });
  }

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

  const ann = await tdb().announcement.findFirst({ where: { legacyId: id } });
  if (!ann) return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 });
  await tdb().announcement.delete({ where: { id: ann.id } }); // recipients cascade
  return NextResponse.json({ ok: true });
}
