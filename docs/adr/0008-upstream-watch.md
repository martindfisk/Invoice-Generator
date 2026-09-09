# 0008. Monthly upstream watch: detection PRs, manual merge

## Status

Accepted, 2026-09-09.

## Context

The update mechanics were already deterministic — `make spec` self-resolves the latest UAPI CalVer, `tools/fetch_assets.py --update <source>=<version>` bumps the Schematron/XSD pins in `tools/rulesets.json` — but nothing _detected_ when upstream moved. Peppol BIS and XRechnung releases carry compliance effective dates (May/November and January/July calendars), so drift used to be found late; ADR-0004 already noted CEN 1.3.16 waiting on a deliberate bump.

## Decision

- **`.github/workflows/upstream-watch.yml`**, monthly cron + `workflow_dispatch`: a detect job runs the new `tools/check_updates.py`, then one apply leg per changed source creates a branch, applies the update with the existing tools, and opens a PR whose body is a diff report (`tools/update_report.py`: version transition, per-file sha changes, added/removed rule ids from vendor snapshots, the verbatim `schematron:expected` finding diff, in-job verification results, reviewer next-steps). **Merging the PR is the only way an update lands.**
- **One PR per source**, branch `update/{source}-{version}`; a source is skipped while that branch exists, so a rejected update is not re-proposed until the branch is deleted.
- **Detection sources**: GitHub `/releases/latest` for `cen`, `peppol`, `xrechnung` — a source is watched iff it has both `repo` and `tag` in `tools/rulesets.json` (the `repo` key was added for this; deriving it from `urlTemplate` would span two hosts and break silently). Spec CalVers come from `latest_versions()` in `tools/fetch_spec.py` vs `spec/spec.json`. Static sources (ubl, xmldsig, gobl, skeleton, saxon) are skipped automatically.
- **FatturaPA files an issue, not a PR**: it has no release feed (detection is sha drift of the pinned XSD), and a real version bump usually changes the URL path and needs `fatturapa-rules.ts` review.
- **No PAT**: the workflow uses the default `GITHUB_TOKEN`, so `ci.yml` does not auto-trigger on the bot PRs. Instead the watch runs the hard gates itself (`make lint`, `make spec-check`, `make sef-check`, backend pytest) and pastes results into the report; frontend Vitest and `schematron:expected` are captured but non-gating, because the goldens test failing after a rule bump is the designed human step (EXPECTED changes are pasted in with justification). If a hard gate fails, the PR still opens with the failure visible and the run goes red.
- Spec PRs commit `spec/` only — never `frontend/public/sef/manifest.json`, whose timestamps churn on every `make sef` with unchanged inputs. When the hand-dropped all-products spec falls behind the per-country CalVers the report says so prominently; it cannot be fetched, only dropped.

## Consequences

- The first real run opens the pending `cen` 1.3.15 → 1.3.16 PR — that run is the integration test.
- Reviewer workflow per schematron PR: read the report, update EXPECTED + reviewed-version pin, push (which also triggers CI), merge. `xrechnung` bumps may additionally need manual `vars.cius`/bundle-date edits; `peppol` bumps the `title` parenthetical — the report says so per source.
- A monthly run that finds nothing ends green with an empty matrix; `make check-updates` runs the same detection locally.
