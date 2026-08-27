#!/usr/bin/env python3
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
example = {
    m.group(1)
    for m in re.finditer(r"^#?([A-Z][A-Z0-9_]+)=", (ROOT / ".env.example").read_text(), re.M)
}
settings = (ROOT / "backend/app/settings.py")
if not settings.exists():
    sys.exit(0)
used = set(re.findall(r'"([A-Z][A-Z0-9_]+)"', settings.read_text()))
used |= {n.upper() for n in re.findall(r"^\s{4}([a-z][a-z0-9_]+)\s*:", settings.read_text(), re.M)}
missing = sorted(u for u in used if u not in example and u.startswith(("UAPI_", "SELLER_", "BUYER_", "CORS_", "RECORDER_", "POLL_", "LOG_", "RECEPTION_", "ALLOW_")))
if missing:
    print(f".env.example lacks: {', '.join(missing)}")
    sys.exit(1)
print("env-doc   ok (.env.example covers settings.py)")
