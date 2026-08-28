---
name: formatter-hook-strips-unused-imports
description: PostToolUse hook runs ruff --fix on backend edits and deletes imports that are not yet used
metadata:
  type: project
---

The repo's PostToolUse hook reformats backend files after every Write/Edit and removes unused imports (ruff --fix behaviour).

**Why:** Observed 2026-08-28: adding `from app.collections import load_collections` to routes.py before adding the endpoints that use it caused the hook to silently strip the import, producing F821 later.

**How to apply:** When editing backend files, add new endpoints/usages first (or in the same edit as the import), or re-check the import block after the hook runs before assuming the edit stuck.
