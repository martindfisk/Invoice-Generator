---
name: project-conventions
description: Repo-wide working rules for every agent — simplicity, flat structure, dependency discipline, secrets, error handling, confirmation before commits/pushes/uploads, reporting format. Load at the start of any task in this repo.
---

# Project conventions (apply everywhere)

- Solve the problem at hand; no speculative abstractions, feature flags or "future" hooks unless the plan names them (format-plugin seam, mock transport).
- One file per concern; flat folders; split only when a file is hard to follow.
- Dependencies: before adding one, state what it does and why ~10 lines of stdlib cannot; prefer well-maintained libraries; record licence implications.
- Secrets: only in `.env` (git-ignored) or environment; never in code, fixtures, logs, SSE events, docs. Hooks block writes to `.env*` and key files.
- Errors: handle at boundaries (user input, UAPI, file I/O); fail loudly with a clear message; no try/except around internal logic; no silent fallbacks except the documented spec-cache warning.
- Data formats: JSON/YAML for machine data, Markdown for humans; no binary formats unless the standard requires (PDF/A-3 is backlog).
- No comments, docstrings or type-annotation noise added to code you did not change; no backwards-compatibility shims — change the code.
- Git: never commit, push, tag or open PRs unless the user explicitly asks in the current task; never upload to external services without confirmation.
- Scope: touching more than ~3 files outside your ownership or adding a dependency → describe the approach first in your report and stop for confirmation.
- Reports: what was built (files), how it was verified (exact commands + pass/fail lines), what is deferred or open. Facts over adjectives; cite spec/legal versions.
- Regulatory statements always name the legal text and version (e.g. "FatturaPA specs 1.9.1", "Peppol BIS Billing 3.0", "D.Lgs. 127/2015", "Directive 2014/55/EU").
