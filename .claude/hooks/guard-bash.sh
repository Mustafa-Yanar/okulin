#!/usr/bin/env bash
# okulin PreToolUse/Bash guard — iki koruma:
#  (1) Yıkıcı komutlar: rm -rf, redis FLUSHALL/FLUSHDB, git push --force/-f, git reset --hard
#  (2) Gizli/PII dosya sızıntısı: CLAUDE.local.md / .env.local|production|... / tmp/ commit'e alınması
# stdin'den hook JSON'u okur; eşleşirse permissionDecision=deny döner (komut çalışmaz).
#
# YANLIŞ-POZİTİF KORUMASI: komut taranmadan önce newline'lar düzleştirilir ve TIRNAK İÇİ
# metin çıkarılır → commit mesajı / echo / yorum içindeki tetikleyici kelimeler eşleşmez,
# yalnız gerçekten ÇALIŞTIRILAN komutlar yakalanır.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
scan=$(printf '%s' "$cmd" | tr '\n' ' ' | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$1"
  exit 0
}

# (1) Yıkıcı komutlar
if printf '%s' "$scan" | grep -qiE 'rm[[:space:]]+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)|FLUSHALL|FLUSHDB|git[[:space:]]+push[^|;&]*(--force|[[:space:]]-f([[:space:]]|$))|git[[:space:]]+reset[[:space:]]+--hard'; then
  deny "okulin guard: yikici komut engellendi (rm -rf / redis FLUSH / git push --force / git reset --hard). Gerekliyse terminalden elle calistir."
fi

# (2) Gizli/PII dosya staging (.env.example haric)
if printf '%s' "$scan" | grep -qE 'git[[:space:]]+(add|commit)[^|;&]*(CLAUDE\.local\.md|\.env\.(local|production|development|staging)|\.env([[:space:]]|$)|(^|[[:space:]/])tmp/)'; then
  deny "okulin guard: gizli/PII dosya (CLAUDE.local.md / .env.* / tmp/) commit'e alinmaya calisildi. Gitignore'da kalmali."
fi

exit 0
