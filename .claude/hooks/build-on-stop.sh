#!/usr/bin/env bash
# okulin Stop hook — kaynak (.js/.jsx/.py) değiştiyse arka planda `npm run build`.
# async+asyncRewake ile çalışır: build GEÇERSE sessiz (model limitine dokunmaz, sadece
# yerel CPU); KIRILIRSA exit 2 ile modeli uyandırıp düzelttirir. Pure-chat turlarında
# (kaynak değişmemişse) hiç build etmez → boşa çalışmaz.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Değişiklik yoksa çık (working tree + staged) — TS göçü sonrası .ts/.tsx dahil
if git diff --quiet -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.py' 2>/dev/null \
   && git diff --cached --quiet -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.py' 2>/dev/null; then
  exit 0
fi

# Başka bir oturum build ediyorsa atla — iki 'next build' aynı .next dizininde
# çakışıp sahte ENOENT kırığı üretiyor (2026-07-10'da yaşandı). O build zaten sonucu raporlar.
if pgrep -f "next build" >/dev/null 2>&1; then
  exit 0
fi

if npm run build >/tmp/okulin-stop-build.log 2>&1; then
  exit 0
fi

echo "okulin Stop hook: 'npm run build' KIRILDI — düzeltilmeli. Log: /tmp/okulin-stop-build.log"
tail -15 /tmp/okulin-stop-build.log 2>/dev/null
exit 2
