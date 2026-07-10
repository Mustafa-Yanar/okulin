# CP-SAT çözücü — Google Cloud Run imajı.
# Kökten build edilir ki api/solver/ tek kaynak kalsın (Vercel api/solve.py ile paylaşılır).
# Deploy: gcloud run deploy okulin-solver --source .   (detay: solver-service/README.md)
# Vercel bu dosyayı yoksayar; Next.js build'ini etkilemez.
FROM python:3.12-slim

WORKDIR /app

COPY solver-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY api/solver ./solver
COPY solver-service/main.py ./

ENV PYTHONUNBUFFERED=1

CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
