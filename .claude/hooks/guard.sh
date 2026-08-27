#!/usr/bin/env bash
# PreToolUse guard for Edit|Write: refuse to write secret-bearing files. Exit 2 blocks the tool call.
set -u
FILE=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null) || exit 0
[ -n "$FILE" ] || exit 0
BASE=$(basename "$FILE")
case "$BASE" in
  .env.example) exit 0 ;;
  .env|.env.*) echo "Blocked: $BASE holds credentials; edit it by hand." >&2; exit 2 ;;
  *.pem|*.key|*.p12|*.pfx) echo "Blocked: key material ($BASE) must not be written by the agent." >&2; exit 2 ;;
esac
exit 0
