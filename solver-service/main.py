"""Cloud Run CP-SAT ders programı çözücüsü — FastAPI servisi.

POST /solve  Header: x-internal-secret == SOLVER_SHARED_SECRET (Node proxy'den)
GET  /solve  health check (ayrıca /healthz)
Body/yanıt sözleşmesi api/solve.py (Vercel) ile birebir aynı; Node proxy
SOLVER_BASE_URL env'i ile iki backend arasında anahtarlanır.
"""
import hmac
import os
import sys

# Docker imajında solver paketi main.py'nin yanına kopyalanır (kök Dockerfile).
# Lokal geliştirmede paket api/solver'da durur — oradan import et.
try:
    from solver.model import solve
except ImportError:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api'))
    from solver.model import solve

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def _authorized(request: Request) -> bool:
    expected = os.environ.get('SOLVER_SHARED_SECRET') or ''
    provided = request.headers.get('x-internal-secret') or ''
    return bool(expected) and hmac.compare_digest(provided, expected)


@app.get('/solve')
@app.get('/healthz')
def health():
    return {'ok': True, 'service': 'cp-sat-solver', 'runtime': 'cloud-run'}


@app.post('/solve')
async def solve_route(request: Request):
    if not _authorized(request):
        return JSONResponse({'error': 'Yetkisiz'}, status_code=403)

    try:
        payload = await request.json()
    except Exception as e:
        return JSONResponse({'error': 'Geçersiz istek: %s' % e}, status_code=400)

    try:
        # solve() CPU-bound senkron iş; threadpool'da koşturup event loop'u
        # serbest bırakıyoruz ki health check'ler solve sırasında yanıt alsın.
        result = await run_in_threadpool(solve, payload)
        return JSONResponse(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({'error': 'Çözücü hatası: %s' % e}, status_code=500)
