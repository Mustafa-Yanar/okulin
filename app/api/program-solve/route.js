import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

// CP-SAT Python çözücüsüne (api/solve.py → /solve) auth'lu proxy.
// Auth tek kaynakta (lib/auth.js) kalsın diye Python JWT görmez; burada director
// kontrolü yapılır, sonra shared-secret ile server-to-server forward edilir.

function solverUrl() {
  // Production'da kalıcı public domain (okulin.com) kullanılır — proje adına bağlı
  // değil, deployment-protection'a takılmaz. VERCEL_URL deployment-spesifik adresi
  // protection'a takılır (401). Override için SOLVER_BASE_URL env'i (öncelikli).
  const base = process.env.SOLVER_BASE_URL
    || (process.env.VERCEL ? 'https://okulin.com' : 'http://localhost:3000');
  return `${base}/solve`;
}

export const POST = withAuth('manage', async (req) => {
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
});
