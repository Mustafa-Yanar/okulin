"""Vercel Python serverless function — CP-SAT ders programı çözücüsü.

POST /solve (next.config.js rewrite ile /api/solve'a gelir)
Header: x-internal-secret == SOLVER_SHARED_SECRET (Node proxy'den)
Body:   { classes, teachers, load, maxWeekly, blocks, colKey, group }
Yanıt:  { assigned, unplaced, tLoad, ms }  veya  { error }
"""
import os
import sys
import json
from http.server import BaseHTTPRequestHandler

# solver paketini import edebilmek için bu dizini path'e ekle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from solver.model import solve


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # Shared-secret auth (Node proxy director kontrolünü yaptı)
        expected = os.environ.get('SOLVER_SHARED_SECRET')
        provided = self.headers.get('x-internal-secret')
        if not expected or provided != expected:
            self._send(403, {'error': 'Yetkisiz'})
            return

        try:
            length = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(length) if length > 0 else b'{}'
            payload = json.loads(raw.decode('utf-8'))
        except Exception as e:
            self._send(400, {'error': 'Geçersiz istek: %s' % e})
            return

        try:
            result = solve(payload)
            self._send(200, result)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._send(500, {'error': 'Çözücü hatası: %s' % e})

    def do_GET(self):
        # health check
        self._send(200, {'ok': True, 'service': 'cp-sat-solver'})
