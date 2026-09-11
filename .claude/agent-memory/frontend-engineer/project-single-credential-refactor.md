---
name: single-credential-refactor
description: 2026-09 persona removal — one credential set like a Postman environment, backend persists settings to disk
metadata:
  type: project
---

Around 2026-09-11 the buyer/seller credential-persona concept was removed app-wide: one credential set (Postman-environment style), `PersonaSwitch.tsx` deleted, `store.setPersona` gone, `ProvisionRequest`/`getOnboardingStatus`/`clearCredentials` lost their persona parameter, `Config.systems` replaced `Config.personas`, recipients settings (sdi_destination_code / peppol_id) deleted. Backend now persists UI-saved settings to `backend/.uapi-settings.json` (git-ignored, survives restarts); `CredentialState.source` is "stored" | "env" | "none"; DELETE credentials overrides `.env` authoritatively. Backend gates: PUT mode "live" → 409 without credentials; key/secret must be set together (400).

**Why:** simplification — the two-persona setup duplicated every settings/onboarding surface and the "settings lost on restart" caveat was fixed server-side.

**How to apply:** never reintroduce persona props/copy in settings/onboarding UI ("seller"/"buyer" remain valid only as invoice parties in the domain model). The live-host confirm checkbox applies only when environment === "live"; LIVE mode on TEST environment applies directly and the backend's 409 message is surfaced verbatim. During the refactor window, `tests/` still referenced old shapes (entity-tree.test.tsx imported PersonaTree) — repo-wide tsc noise in tests/ was expected and owned by qa.
