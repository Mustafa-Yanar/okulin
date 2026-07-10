import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

// CP-SAT Python çözücüsüne (api/solve.py → /solve) auth'lu proxy.
// Auth tek kaynakta (lib/auth.js) kalsın diye Python JWT görmez; burada director
// kontrolü yapılır, sonra shared-secret ile server-to-server forward edilir.

function solverUrl() {
  // Çözücü Google Cloud Run'da (solver-service/README.md). SOLVER_BASE_URL env'i
  // öncelikli; yoksa production'da servisin kalıcı run.app adresine düşer.
  // Lokalde: solver-service README'deki uvicorn komutu (port 8111).
  const base = process.env.SOLVER_BASE_URL
    || (process.env.VERCEL
      ? 'https://okulin-solver-1085762360623.europe-west1.run.app'
      : 'http://localhost:8111');
  return `${base}/solve`;
}

export const POST = withAuth('manage', async (req) => {
  const secret = process.env.SOLVER_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Çözücü yapılandırılmamış (SOLVER_SHARED_SECRET eksik)' }, { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek' }, { status: 400 });
  }
  // Şekil koruması: JSON olarak geçerli ama obje olmayan gövde (string/dizi/null)
  // çözücüye sızarsa Python tarafı 500 üretir — girişte 400 ile kesilir.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
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
    return NextResponse.json({ error: `Çözücüye ulaşılamadı: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
});
