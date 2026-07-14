import { NextResponse } from 'next/server';
import { sendPushToUser } from '@/lib/push';
import { tdb } from '@/lib/sqldb';
import { listActiveTenants, runWithTenant } from '@/lib/tenant';

// Günlük ödeme hatırlatması cron'u.
// Vadesi gelmiş (dueDate <= bugün) ÖDENMEMİŞ taksiti olan öğrencilerin velilerine push.
// Ödenene kadar her gün tekrar eder (cron günde bir çalışır → doğal günlük tekrar).
// ÇOK-KURUM: aktif tüm kurum×şube üzerinde döner (runWithTenant); içindeki tdb()/
// sendPushToUser o kurumun bağlamına otomatik yönlenir.

export const runtime = 'nodejs'; // web-push Node crypto gerektirir

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmt(n: number) { return (n || 0).toLocaleString('tr-TR'); }

// Tek kurum bağlamında (runWithTenant içinde) vadesi gelen ödeme push'larını gönderir.
async function remindTenant(): Promise<{ parents: number; devices: number }> {
  // Öğrenci + finans/taksit verisini çek. rows: [{ name, parentPhone, installments }]
  const studs = await tdb().student.findMany({ include: { finance: { include: { installments: true } } } });
  const rows = studs.map(s => ({ name: s.name, parentPhone: s.parentPhone, installments: s.finance?.installments || [] }));
  if (rows.length === 0) return { parents: 0, devices: 0 };

  const today = todayISO();
  // Vadesi gelmiş ödenmemiş taksitleri veliye (telefon) göre grupla — bir veliye tek push
  const byParent: Record<string, { name: string; amount: number }[]> = {}; // phone -> [{name, amount}]
  for (const r of rows) {
    if (!r.parentPhone || !Array.isArray(r.installments)) continue;
    const overdue = r.installments.filter(inst => !inst.paid && inst.dueDate && inst.dueDate <= today);
    if (overdue.length === 0) continue;
    const amount = overdue.reduce((sum, inst) => sum + (parseFloat(String(inst.amount)) || 0), 0);
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
        sensitive: true, // kilit ekranında isim+tutar görünmez; detay panelde
      });
      parents++;
      devices += (r && r.sent) || 0;
    } catch { /* tek veli hatası tüm cron'u düşürmesin */ }
  }
  return { parents, devices };
}

// Bilinçli withAuth istisnası: cron ucu — oturum yok, CRON_SECRET Bearer doğrulanır.
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  let parents = 0;
  let devices = 0;
  for (const t of tenants) {
    try {
      const r = await runWithTenant(t.org, t.branch, remindTenant);
      parents += r.parents;
      devices += r.devices;
    } catch { /* bir kurumun hatası diğerlerini düşürmesin */ }
  }

  return NextResponse.json({ ok: true, tenants: tenants.length, parents, devices });
}
