---
name: feedback-doc-ownership-boundaries
description: which docs files this role owns vs. must never hand-edit, per explicit task instructions
metadata:
  type: feedback
---

`docs/handbook/04-mapping-reference.md` is generated (`make handbook`) — never hand-edit it, even
when a task touches the handbook broadly.

`docs/handbook/02-invoice-model.md` uses "seller"/"buyer" to mean the invoice parties (BG-4/BG-7),
which is unrelated to the app's credential-persona concept. Do not "fix" seller/buyer language
there when a task is about credential/persona changes — check what the words refer to before
editing. The same caution applies inside DEMO-SCRIPT.md: it names the invoice's seller/buyer VAT
numbers in Act 1 and the buyer's KBO in Act 4, which are legitimately unrelated to the credentials
setup checklist at the top of the file.

**Why:** a 2026-09-11 task explicitly scoped docs-writer to six files and called out these two
exceptions by name, because a broad "remove persona" find-and-replace would otherwise wrongly
touch invoice-model language.

**How to apply:** before editing any occurrence of seller/buyer/persona in this repo's docs, check
whether the sentence is about invoice parties (BT/BG catalogue) or about API credentials/app
personas — only the latter changes when persona/credential architecture changes.
