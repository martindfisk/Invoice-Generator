---
name: buyer-taxid-fatturapa-evidence
description: fatturapa|buyer.taxId|json severity-correct confirmed — 00417 either-identifier chain and where the "alternativa non esclusiva" prose lives
metadata:
  type: project
---

`fatturapa|buyer.taxId|json` (R2 should-fix, UAPI_PARTIAL_FIELDS) confirmed 2026-09-07. Evidence chain:

- Loss is real but partial: `uapi-map.ts` `identification()` (~line 374) sends ONE identifier — vatId wins, taxId only travels as `{type:"TAX"}` when no vatId. Authored CF lost only when buyer has both.
- Syntax renders it: `fatturapa-map.ts` ~line 274 maps buyer.taxId → `DatiAnagrafici/CodiceFiscale` (fpa 1.4.1.2, BT-46); XSD `DatiAnagraficiCessionarioType` lines 762-768 — IdFiscaleIVA and CodiceFiscale BOTH `minOccurs="0"` (at-least-one is SDI-side, not XSD).
- Not blocking: 00417 requires either — curated in `fatturapa-rules.ts` lines 228-237 (fires only when `!vatId && !taxId`), and FatturaPA's OWN spec says so: Specifiche tecniche V1.4 PDF §1.4 prose "la valorizzazione ... è in alternativa non esclusiva" (CodiceFiscale may be omitted when IdFiscaleIVA valued). No EN 16931 analogy needed.

**Why:** the 00417 either-identifier fact recurs for any buyer-identifier row; knowing the primary-source location avoids web searches.

**How to apply:** the V1.4 PDF (`E-Invoicing-Formats-and-Profiles/Italy FatturaPA/Specifiche_tecniche_del_formato_FatturaPA_V1.4.pdf`) does NOT contain the 004xx scarto codes (elenco controlli is a separate Provvedimento annex) — but its per-field prose carries the requirement semantics. Extract with `pdftotext -layout` (installed at /opt/homebrew/bin). Cessionario section = extracted lines ~494-530. See [[gap-report-severity-taxonomy]].
