# 0009. Single account, persisted settings, two modes

## Status

Accepted, 2026-09-11. Amends [ADR-0005](0005-session-credentials-from-the-ui.md): credentials are still entered in the UI and never echoed back, but they now persist server-side instead of living in process memory. Everything reception-related was already removed on 2026-09-03; this ADR removes its last remnant, the buyer persona.

## Context

The tool's job narrowed to "open it for a demo and test sending invoices". Three things fought that: the buyer persona (a receive-era leftover that had become a hard gate — the settings dialog's LIVE switch demanded a buyer key the docs called optional); settings that evaporated on every backend restart or hot-reload; and two axes both named LIVE (transport mode vs. fiskaly host), which produced a red production banner in MOCK and an alarming-looking badge in the normal demo state.

## Decision

- **One account.** The seller/buyer persona concept is gone end to end: one credential set (`UAPI_API_KEY`/`UAPI_API_SECRET`), one `UapiClient`, no `X-Persona`, no persona in `CallRecord`, no per-persona settings or onboarding. The invoice's seller/buyer _parties_ (BG-4/BG-7) are unrelated and unchanged.
- **Settings persist like a Postman environment.** `SettingsStore` (`backend/app/store.py`) writes UI-saved values — environment, credentials, per-country system/taxpayer ids, mode, and the minted bearer token — to git-ignored `backend/.uapi-settings.json` (chmod 600, atomic writes). They survive restarts. A key present in the file is authoritative, an explicit null means "cleared" (so the UI can override or clear `.env` values); an absent key falls back to `.env`, which is bootstrap only. Ids created during the journey (guided provisioning) and the minted token are taken over into the file automatically. Key usage is monitored through other channels; persisting the key on the operator's machine is an accepted trade-off, and the browser still never sees a secret.
- **Two modes.** MOCK = on-device fixture replay. LIVE = real calls against whichever fiskaly host the stored environment credentials point at. The header shows one badge — `MOCK`, `LIVE · TEST API`, or `LIVE · PRODUCTION` — and the red banner is reserved for LIVE mode on the production host.
- Live mode with missing credentials is no longer a boot error (`validate_live` removed): the credentials may arrive from the dialog, and every call fails loudly at the point of use.

## Consequences

- Step zero of a live demo is: paste one key, pick TEST, switch to LIVE — once. A restart changes nothing.
- `backend/.uapi-settings.json` holds a real API key on disk. Delete the file to reset; never commit it (git-ignored, and the guard hook does not manage it — it is written only by the running backend).
- The old `SELLER_*`/`BUYER_*` env vars are gone without aliases; `.env` files must be updated to `UAPI_*`.
- ADR-0005's "lost on restart" and "seller-only LIVE gate" statements are superseded; its write-only/fingerprint contract stands.
