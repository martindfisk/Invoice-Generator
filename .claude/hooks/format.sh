#!/usr/bin/env bash
# PostToolUse formatter for Edit|Write. Best effort, never blocks (always exit 0).
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
FILE=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null) || exit 0
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0
case "$FILE" in
  *.py)
    RUFF="$ROOT/backend/.venv/bin/ruff"
    if [ -x "$RUFF" ]; then
      "$RUFF" format -q "$FILE" >/dev/null 2>&1
      "$RUFF" check -q --fix "$FILE" >/dev/null 2>&1
    fi ;;
  *.ts|*.tsx|*.js|*.mjs|*.css|*.json|*.md)
    PRETTIER="$ROOT/frontend/node_modules/.bin/prettier"
    if [ -x "$PRETTIER" ]; then
      "$PRETTIER" --log-level silent --write "$FILE" >/dev/null 2>&1
    fi ;;
esac
exit 0
