# solver-service — CP-SAT çözücüsü (Google Cloud Run)

Ders programı çözücüsünün (OR-Tools CP-SAT) Cloud Run sürümü. Asıl model kodu
`api/solver/` içinde durur (tek kaynak); bu dizin yalnız HTTP sarmalayıcıyı
(FastAPI) içerir. İmaj repo kökündeki `Dockerfile` ile kökten build edilir.

## Mimari

```
Frontend → POST /api/program-solve  [Next.js proxy, director auth]
             → POST {SOLVER_BASE_URL}/solve  [x-internal-secret]
                 → Cloud Run (bu servis)  →  api/solver/model.py (CP-SAT)
```

- `SOLVER_BASE_URL` Vercel env'i Cloud Run URL'ine işaret eder.
- Geri dönüş (rollback): `SOLVER_BASE_URL`'i silmek yeterli → eski Vercel
  Python yolu (`api/solve.py`) devreye girer. Canlı doğrulama bitene kadar
  o yol silinmez.

## Tek seferlik kurulum

```bash
# 1) Giriş (tarayıcı açar)
gcloud auth login

# 2) Proje oluştur + seç (fatura hesabı bağlı olmalı — console.cloud.google.com/billing)
gcloud projects create okulin-solver-prod --name="okulin solver"
gcloud config set project okulin-solver-prod

# 3) Gerekli API'ler
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## Deploy (repo kökünden)

```bash
gcloud run deploy okulin-solver \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --cpu 4 --memory 2Gi \
  --concurrency 1 \
  --timeout 120 \
  --min-instances 0 --max-instances 3 \
  --set-env-vars SOLVER_SHARED_SECRET=<vercel'dekiyle aynı değer>
```

Parametre gerekçeleri:
- **europe-west1 (Belçika):** Tier-1 fiyat bölgesi (ücretsiz kota burada geçerli);
  Vercel fra1'e (Frankfurt) ~10 ms. Frankfurt (europe-west3) Tier-2, kotaya girmez.
- **--concurrency 1:** CP-SAT tüm çekirdekleri kullanır; her solve kendi
  instance'ında koşar. Paralel istekler yeni instance açar (max 3).
- **--min-instances 0:** boşta ölçek sıfır → fatura 0. Cold start ~3-5 sn,
  program oluşturmada önemsiz.
- **--allow-unauthenticated:** kimlik doğrulama uygulama katmanında
  (x-internal-secret, Vercel'deki mimariyle aynı). IAM katmanı eklenmedi ki
  Node proxy değişmesin.
- `SOLVER_SHARED_SECRET` Vercel'deki değerle AYNI olmalı (proxy tek secret yollar).

Deploy sonunda verilen `https://okulin-solver-....run.app` URL'ini Vercel'e yaz:

```bash
vercel env add SOLVER_BASE_URL production   # değer: Cloud Run URL (sonda /solve YOK)
```

## Doğrulama

```bash
# Health check (auth'suz GET serbest)
curl https://<cloud-run-url>/solve
# → {"ok":true,"service":"cp-sat-solver","runtime":"cloud-run"}

# Uçtan uca: testkurs müdürüyle programı oluştur, app/api/program-solve
# yanıtındaki ms alanı ve Cloud Run logları (aşağıda) isteğin geldiğini kanıtlar.
gcloud run services logs read okulin-solver --region europe-west1 --limit 20
```

## Lokal geliştirme

```bash
# repo kökünden; solver paketi ../api'den import edilir (main.py fallback)
.venv-solver/bin/pip install fastapi uvicorn   # bir kez
cd solver-service
SOLVER_SHARED_SECRET=test ../.venv-solver/bin/uvicorn main:app --port 8111
```

## Güncelleme

Model kodu (`api/solver/`) değişince aynı deploy komutunu tekrar çalıştır —
Cloud Build imajı yeniden kurar, trafik yeni revizyona döner. `.gcloudignore`
sayesinde yüklemeye yalnız Dockerfile + api/solver + solver-service girer.
