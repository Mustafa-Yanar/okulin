import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

// CP-SAT Python çözücüsüne (api/solve.py → /solve) auth'lu proxy.
// Auth tek kaynakta (lib/auth.js) kalsın diye Python JWT görmez; burada director
// kontrolü yapılır, sonra shared-secret ile server-to-server forward edilir.

function solverUrl() {
  // Production alias'ı (cozumetut.vercel.app) deployment-protection'dan muaf;
  // VERCEL_URL deployment-spesifik adresi protection'a takılır (401). Bu yüzden
  // production'da sabit alias, lokalde localhost kullanılır. Override için
  // SOLVER_BASE_URL env'i.
  const base = process.env.SOLVER_BASE_URL
    || (process.env.VERCEL ? 'https://cozumetut.vercel.app' : 'http://localhost:3000');
  return `${base}/solve`;
}

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const secret = process.env.SOLVER_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Çözücü yapılandırılmamış (SOLVER_SHARED_SECRET eksik)' }, { status: 500 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek' }, { status: 400 });
  }

  try {
    const res = await fetch(solverUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ error: 'Çözücü yanıtı okunamadı' }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: `Çözücüye ulaşılamadı: ${e.message}` }, { status: 502 });
  }
}
