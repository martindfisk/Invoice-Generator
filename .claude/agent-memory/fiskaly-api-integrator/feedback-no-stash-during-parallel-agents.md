---
name: no-stash-during-parallel-agents
description: Never git stash/pop for baseline comparisons while sibling agents edit the repo concurrently
metadata:
  type: feedback
---

Do not use `git stash` / `git stash pop` to compare against a pre-change baseline in this repo.

**Why:** During the 2026-09-01 onboarding task, a sibling agent was deleting `frontend/tests/golden/fr-store-*` concurrently. `git stash` swept _their_ in-flight deletions into my stash, temporarily resurrecting the files (pytest collected 7 phantom tests), and only `stash pop` restored their state. It popped cleanly that time; a conflict would have corrupted another agent's work.

**How to apply:** When a before/after comparison is needed, diff collected test ids or copy the specific files to the scratchpad instead. Expect test counts to drift when tasks mention another agent working in parallel (e.g. `test_golden_xsd.py` parametrizes over `frontend/tests/golden/`, so frontend preset removals change the backend-collected count).
