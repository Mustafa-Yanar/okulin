#!/usr/bin/env bash
# okulin PostToolUse/Edit|Write: değişen .js/.jsx dosyasına eslint --fix (non-blocking).
# Auto-fix yapabildiğini düzeltir; yapamadığı (exhaustive-deps, no-img vb.) warning kalır.
# Her zaman exit 0 — düzenleme akışını ASLA bloklamaz.
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null)
case "$f" in
  *.js|*.jsx)
    [ -n "$f" ] && [ -f "$f" ] && \
      "${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/eslint" --fix "$f" >/dev/null 2>&1
    ;;
esac
exit 0
