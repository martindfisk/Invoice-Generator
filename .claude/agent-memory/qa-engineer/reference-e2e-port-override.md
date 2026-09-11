---
name: reference-e2e-port-override
description: How to run make e2e locally when the docker stack holds port 8000
metadata:
  type: reference
---

A long-lived docker-compose stack (`invoicegenerator-backend-1`) often holds `:8000` on this
machine (it may serve a stale image — its `/api/config` shape can lag the code). `docker stop`
is blocked by the permission classifier here. Instead, `playwright.config.ts` ports are
env-overridable (added 2026-09-11): run

```
cd frontend && E2E_BACKEND_PORT=8001 npx playwright test
```

The frontend webServer passes `BACKEND_URL` to the vite proxy, and the backend webServer env
uses `UAPI_SYSTEM_ID_{IT,BE,DE}` / `UAPI_TAXPAYER_ID_*` (the old `SELLER_*` names are ignored
by settings.py — if sends silently take the passthrough fallback, check these first). Full
suite: 38 tests, ~25 s.
