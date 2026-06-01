import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { rawRedis, currentOrg, currentBranch } from '@/lib/tenant';
import { getSession, canReadStudent } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { decryptSecret } from '@/lib/payment/crypto';
import { getProvider } from '@/lib/payment';

export const runtime = 'nodejs'; // crypto + fetch

// Veli online ödeme başlatır: taksit seç → PayTR token → iframe URL.
// Asıl kredilendirme PayTR callback'inde (server-to-server) yapılır; bu uç yalnız
// ödeme oturumunu kurar ve global `payorder:<oid>` kaydı yazar (callback yönlendirme).

const StartSchema = z.object({
  studentId: zId,
  installmentIdx: z.coerce.number().int().min(0).max(1000),
});

function newMerchantOid() {
  return 'et' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function POST(req) {
  const session = await getSession();
  const parsed = await parseBody(req, StartSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, installmentIdx } = parsed.data;

  // Yetki: veli yalnız kendi çocuğu için ödeme başlatabilir.
  if (!session || session.role !== 'parent' || !canReadStudent(session, studentId)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Tenant ödeme yapılandırması
  const cfg = await redis.get('payment:config');
  if (!cfg || !cfg.active || !cfg.merchantId || !cfg.keyEnc || !cfg.saltEnc) {
    return NextResponse.json({ error: 'Online ödeme bu kurumda aktif değil' }, { status: 400 });
  }

  // Finans kaydı + taksit doğrulama
  const finance = await redis.get(`finance:${studentId}`);
  const inst = finance?.installments?.[installmentIdx];
  if (!inst) return NextResponse.json({ error: 'Taksit bulunamadı' }, { status: 404 });
  if (inst.paid) return NextResponse.json({ error: 'Bu taksit zaten ödenmiş' }, { status: 400 });
  const amountTL = parseFloat(inst.amount) || 0;
  if (amountTL <= 0) return NextResponse.json({ error: 'Geçersiz taksit tutarı' }, { status: 400 });
  const amountKurus = Math.round(amountTL * 100);

  // Gizli anahtarları çöz
  let key, salt;
  try {
    key = decryptSecret(cfg.keyEnc);
    salt = decryptSecret(cfg.saltEnc);
  } catch {
    return NextResponse.json({ error: 'Ödeme yapılandırması okunamadı (anahtar)' }, { status: 500 });
  }

  const org = currentOrg();
  const branch = currentBranch();
  const merchantOid = newMerchantOid();
  const childName = (session.children || []).find(c => (c.id || c) === studentId)?.name || finance.studentName || 'Öğrenci';

  // Global order kaydı — callback bunu okuyup doğru kuruma yazar (host'a güvenmez).
  await rawRedis.set(`payorder:${merchantOid}`, {
    org, branch, studentId, installmentIdx,
    amountTL, amountKurus,
    studentName: childName,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }, { ex: 60 * 60 * 24 * 7 }); // 7 gün

  const origin = new URL(req.url).origin;
  const reqIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';

  const provider = getProvider(cfg.provider || 'paytr');
  const result = await provider.createToken({
    config: { merchantId: cfg.merchantId, key, salt, testMode: cfg.testMode ?? true },
    order: { merchantOid, amountKurus, basketName: `${childName} - taksit ödemesi` },
    buyer: { name: session.name || 'Veli', phone: session.id || '', email: '', address: '-' },
    reqIp,
    okUrl: `${origin}/odeme/sonuc?status=ok`,
    failUrl: `${origin}/odeme/sonuc?status=fail`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason || 'Ödeme başlatılamadı' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, iframeUrl: result.iframeUrl, merchantOid });
}
