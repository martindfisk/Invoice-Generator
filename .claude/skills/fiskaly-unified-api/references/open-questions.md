# Open questions / discrepancies (confirm with fiskaly UAPI team)

| # | Topic | Observation | Status |
|---|---|---|---|
| 1 | Error body field | Spec: `status`; `/reference/error-codes` page: `status_code` | open |
| 2 | Webhooks | Italy docs page mentions webhooks for inbound; Belgium page says polling only; spec has no callbacks | open — treat as polling |
| 3 | TEST delivery | TEST = "no tax-authority transmission, simulated validation": does a Seller→Buyer send surface as `E_INVOICE::RECEPTION` in the Buyer org? | M1 spike (a) |
| 4 | Peppol BIS label | fiskaly generates `en16931-invoice` UBL for BE; confirm `CustomizationID` in the compliance artifact before labelling "Peppol BIS Billing 3.0" | M1 spike (d) |
| 5 | Artifact signing | Is the IT compliance artifact XAdES-signed / CAdES `.p7m`? Drives DiffView normalisation | M1 spike (d) |
| 6 | Token lifetime, rate limits | Not documented; only `429 E_TOO_MANY_REQUESTS` declared | open |
| 7 | `@fiskaly/docs-mcp` | workspace.fiskaly.com/ai-agents/mcp-server prescribes `npx -y @fiskaly/docs-mcp`, but npm returns 404 (checked 2026-08-26); only unofficial `fiskaly-docs-mcp-community` exists. `.mcp.json` deliberately omitted until the official package is published — then add `{"mcpServers":{"fiskaly-docs":{"command":"npx","args":["-y","@fiskaly/docs-mcp"]}}}` and `mcp__fiskaly-docs` to architect + fiskaly-api-integrator tools | open |
| 8 | `SdiDestinationCode` cannot express an Italian B2G recipient | UAPI: `^[A-Z0-9]{7}$`, minLength/maxLength 7. FatturaPA XSD 1.2.3 `CodiceDestinatarioType`: `[A-Z0-9]{6,7}` — **6 characters is the Codice Univoco Ufficio used for public administration (FPA12)**. So a mandated Italian B2G invoice cannot be sent through the UAPI as specified. Found 2026-08-27 by the API-contract validation stage against the `it-restaurant-b2g-fpa12` preset | **open — worth raising with the UAPI team** |
| 9 | `SellerPhone` (E.164) and FatturaPA `Telefono` are in tension | UAPI `SellerPhone`: `^\+[1-9](\s?\d){1,14}$` (requires a leading `+`). FatturaPA `TelefonoType`: `(\p{IsBasicLatin}{5,12})` — **max 12 characters**. A typical Italian number in E.164 (`+39` + 10 digits = 13 chars) satisfies fiskaly and is rejected by the FatturaPA XSD. Only a 7-digit subscriber number fits both. Our presets now use 12-character numbers | open — a real constraint for IT integrators |
