# UAPI choreography as cURL (TEST). `$V` = contents of spec/version.txt, `$T` = bearer.

```bash
curl -s https://test.api.fiskaly.com/tokens -H "X-Api-Version: $V" -H "Content-Type: application/json" \
  -d '{"content":{"type":"API_KEY","key":"'$KEY'","secret":"'$SECRET'"}}'

curl -s https://test.api.fiskaly.com/systems/$SYSTEM_ID -H "X-Api-Version: $V" -H "Authorization: Bearer $T"

curl -s https://test.api.fiskaly.com/records -H "X-Api-Version: $V" -H "Authorization: Bearer $T" \
  -H "X-Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{"content":{"type":"INTENTION","system":{"id":"'$SYSTEM_ID'"},"operation":{"type":"TRANSACTION"}}}'

curl -s https://test.api.fiskaly.com/records -H "X-Api-Version: $V" -H "Authorization: Bearer $T" \
  -H "X-Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d @invoice-transaction.json   # {"content":{"type":"TRANSACTION","record":{"id":"<intention>"},"operation":{"type":"INVOICE",...}}}

curl -s "https://test.api.fiskaly.com/records/$TX" -H "X-Api-Version: $V" -H "Authorization: Bearer $T"           # until content.used_in.id
curl -s "https://test.api.fiskaly.com/records/$TRANSMISSION" -H "X-Api-Version: $V" -H "Authorization: Bearer $T" # until mode=FINISHED
curl -s "https://test.api.fiskaly.com/records/$TRANSMISSION?compliance-artifact" -H "X-Api-Version: $V" -H "Authorization: Bearer $T"
curl -s "https://test.api.fiskaly.com/records?type=E_INVOICE::RECEPTION&system_id=$BUYER_SYSTEM_ID" -H "X-Api-Version: $V" -H "Authorization: Bearer $BUYER_T"
```

Keep `invoice-transaction.json` examples in `backend/fixtures/uapi/` (masked, provenance-stamped). The body shape is defined by `InvoiceTransaction` in `spec/…yaml`; `backend/app/workflow.py` is the executable reference.

## Correction (credit note) — its own intention, its own transmission

```bash
curl -s https://test.api.fiskaly.com/records -H "X-Api-Version: $V" -H "Authorization: Bearer $T" \
  -H "X-Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{"content":{"type":"INTENTION","system":{"id":"'$SYSTEM_ID'"},"operation":{"type":"TRANSACTION"}}}'

curl -s https://test.api.fiskaly.com/records -H "X-Api-Version: $V" -H "Authorization: Bearer $T" \
  -H "X-Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \
  -d '{"content":{"type":"TRANSACTION","record":{"id":"'$CORRECTION_INTENTION'"},
       "operation":{"type":"CORRECTION","record":{"id":"'$ORIGINAL_INVOICE'"},
                    "reason":"credit note","data":{"type":"INVOICE","...":"..."}}}}'
```

## Artifacts — two different documents

```bash
curl -s "$BASE/records/$TRANSMISSION?compliance-artifact"   # the invoice XML fiskaly transmitted
curl -s "$BASE/records/$TRANSMISSION?archive-artifact"      # the Receipt of Transmission (SDI ricevuta)
curl -s "$BASE/files/$TRANSMISSION.zip" -o files.zip        # both, plus record.json
curl -s "$BASE/records?type=TRANSACTION::INVOICE,TRANSACTION::CORRECTION&limit=1"   # paginated listing
```

Source: `spec/fiskaly_e-invoice_it_2026-06-01_postman_collection.json`, folders "records (B2B E-Invoice Transmission with SDI recipient)" and "records (E-Invoice Reception)".
