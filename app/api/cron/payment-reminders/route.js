import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { sendPushToUser } from '@/lib/push';

// Günlük ödeme hatırlatması cron'u.
// Vadesi gelmiş (dueDate <= bugün) ÖDENMEMİŞ taksiti olan öğrencilerin velilerine push.
// Ödenene kadar her gün tekrar eder (cron günde bir çalışır → doğal günlük tekrar).
// NOT: şimdilik DEFAULT_ORG/main kapsamında (mevcut cron deseni, weekly gibi); çok-org cron sonra.
//      sendPushToUser de tenantRedis() (DEFAULT_ORG/main) kullandığından scope uyumlu.

export const runtime = 'nodejs'; // web-push Node crypto gerektirir

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmt(n) { return (n || 0).toLocaleString('tr-TR'); }

export async function GET(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sids = await redis.smembers('students');
  if (!sids || sids.length === 0) return NextResponse.json({ ok: true, parents: 0, devices: 0 });

  // Öğrenci + finans kayıtlarını paralel çek
  const sp = redis.pipeline();
  sids.forEach(id => sp.get(`student:${id}`));
  const students = await sp.exec();

  const fp = redis.pipeline();
  sids.forEach(id => fp.get(`finance:${id}`));
  const finances = await fp.exec();

  const today = todayISO();
  // Vadesi gelmiş ödenmemiş taksitleri veliye (telefon) göre grupla — bir veliye tek push
  const byParent = {}; // phone -> [{name, amount}]
  sids.forEach((id, i) => {
    const s = students[i];
    const f = finances[i];
    if (!s || !s.parentPhone || !f || !Array.isArray(f.installments)) return;
    const overdue = f.installments.filter(inst => !inst.paid && inst.dueDate && inst.dueDate <= today);
    if (overdue.length === 0) return;
    const amount = overdue.reduce((sum, inst) => sum + (parseFloat(inst.amount) || 0), 0);
    if (amount <= 0) return;
    if (!byParent[s.parentPhone]) byParent[s.parentPhone] = [];
    byParent[s.parentPhone].push({ name: s.name, amount });
  });

  let parents = 0;
  let devices = 0;
  for (const [phone, items] of Object.entries(byParent)) {
    const total = items.reduce((s, x) => s + x.amount, 0);
    const names = items.map(x => x.name).join(', ');
    const body = `${names} için vadesi gelen ödeme: ₺${fmt(total)}. Ödemek için panele girin.`;
    try {
      const r = await sendPushToUser('parent', phone, {
        title: 'Ödeme Hatırlatması',
        body,
        url: '/?sekme=odeme',
        tag: 'odeme-hatirlatma',
      });
      parents++;
      devices += (r && r.sent) || 0;
    } catch { /* tek veli hatası tüm cron'u düşürmesin */ }
  }

  return NextResponse.json({ ok: true, parents, devices });
}
