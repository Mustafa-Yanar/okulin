#!/usr/bin/env bash
# okulin Stop hook — kaynak (.js/.jsx/.py) değiştiyse arka planda `npm run build`.
# async+asyncRewake ile çalışır: build GEÇERSE sessiz (model limitine dokunmaz, sadece
# yerel CPU); KIRILIRSA exit 2 ile modeli uyandırıp düzelttirir. Pure-chat turlarında
# (kaynak değişmemişse) hiç build etmez → boşa çalışmaz.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Değişiklik yoksa çık (working tree + staged)
if git diff --quiet -- '*.js' '*.jsx' '*.py' 2>/dev/null \
   && git diff --cached --quiet -- '*.js' '*.jsx' '*.py' 2>/dev/null; then
  exit 0
fi

if npm run build >/tmp/okulin-stop-build.log 2>&1; then
  exit 0
fi

echo "okulin Stop hook: 'npm run build' KIRILDI — düzeltilmeli. Log: /tmp/okulin-stop-build.log"
tail -15 /tmp/okulin-stop-build.log 2>/dev/null
exit 2
