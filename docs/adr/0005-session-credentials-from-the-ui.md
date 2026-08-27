# 0005. API credentials configurable from the UI, held in backend memory

## Status

Accepted — 2026-08-27. Supersedes the credential handling described in the approved plan.

## Context

The plan settled credentials early: a thin FastAPI proxy reads the fiskaly API key and secret from a git-ignored `.env`, and **the browser never sees secrets**. That is the right default for a demo run from one laptop, but it makes the tool awkward as a _testing_ tool. Pointing it at a different organisation, rotating a key, or handing it to a colleague all meant editing a dotfile and restarting the backend — and nothing in the UI told you which credentials were actually in use.

The alternatives considered at planning time were: `.env` only; credentials typed in the browser and kept in `sessionStorage`, sent per request; or both, with a per-session UI override.

## Decision

**Credentials are entered in a settings dialog, posted once to the proxy, and held in backend memory for the life of the process.** Specifically:

- The browser keeps nothing. Not `localStorage`, not `sessionStorage`, not the store, not the URL. After a save the field shows only a masked fingerprint the backend returns.
- The backend never writes them to disk and never returns them. `GET /api/settings` exposes `{configured, source, fingerprint}` per persona, where `source` is `session | env | none` and the fingerprint is the first four characters of the **key** plus `***` — derived from the key only, never the secret, and not reversible.
- `.env` remains the fallback when nothing is configured in the session, so the existing local-first flow is untouched.
- Credentials, system identifiers and the base URL resolve **at call time** through a `SessionStore` that layers session values over `.env`. A per-persona revision counter invalidates the cached bearer token and retargets the `httpx` client when either changes.
- **LIVE is guarded.** `environment: "live"` is refused with a 409 unless the request carries `confirm_live: true`, and the UI additionally requires a deliberate confirmation plus a persistent banner. Records created in LIVE cannot be recalled.
- MOCK mode requires no credentials at all, so the offline demo path is unaffected.

## Alternatives considered

- **Keep `.env` only.** Rejected — it is what made the tool clumsy for its stated second purpose, and it left the active credentials invisible.
- **Credentials in `sessionStorage`, sent per request** (Postman-style). Rejected — the secret would live in the page and be readable by any script running there, and it would appear in request bodies the API-call pane renders. It would have let several colleagues share one hosted backend with their own keys, which this decision gives up; see Consequences.
- **A "save to `.env`" button.** Rejected for now — a browser form writing secrets to disk is a bigger step than it looks, and the repo's own `PreToolUse` hook blocks agent writes to `.env` for the same reason. Easy to add later if surviving a restart matters more than not persisting.

## Consequences

- Credentials survive a page reload but are **lost when the backend restarts**. That is the deliberate trade for never persisting them.
- The store is **process-global, not per-browser-session**. On one laptop that is exactly right. If this is ever hosted for several people, two users would share whatever credentials were last saved — so hosting requires either per-session scoping or going back to `.env`. Recorded here because the local-first design makes it easy to forget.
- Three properties are enforced by test rather than by inspection, because this is the one feature where a mistake leaks a credential:
  - the plaintext key and secret appear nowhere in `GET /api/calls` (the pane renders request bodies and generates cURL, so it is the obvious leak path);
  - `.env` is byte-unchanged after a save;
  - changing a key re-issues the token — otherwise the previous token keeps working and the tool would report success while using credentials you thought you had replaced.
- `api_version` stays `.env`-only, and there is no free-text base-URL field — only the TEST/LIVE choice — so a typo cannot silently point the tool at an unintended host.
