import { NextResponse } from 'next/server';
import { sendPushToUser } from '@/lib/push';
import { tdb } from '@/lib/sqldb';

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

  // Öğrenci + finans/taksit verisini çek. rows: [{ name, parentPhone, installments }]
  const studs = await tdb().student.findMany({ include: { finance: { include: { installments: true } } } });
  const rows = studs.map(s => ({ name: s.name, parentPhone: s.parentPhone, installments: s.finance?.installments || [] }));
  if (rows.length === 0) return NextResponse.json({ ok: true, parents: 0, devices: 0 });

  const today = todayISO();
  // Vadesi gelmiş ödenmemiş taksitleri veliye (telefon) göre grupla — bir veliye tek push
  const byParent = {}; // phone -> [{name, amount}]
  for (const r of rows) {
    if (!r.parentPhone || !Array.isArray(r.installments)) continue;
    const overdue = r.installments.filter(inst => !inst.paid && inst.dueDate && inst.dueDate <= today);
    if (overdue.length === 0) continue;
    const amount = overdue.reduce((sum, inst) => sum + (parseFloat(inst.amount) || 0), 0);
    if (amount <= 0) continue;
    if (!byParent[r.parentPhone]) byParent[r.parentPhone] = [];
    byParent[r.parentPhone].push({ name: r.name, amount });
  }

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
