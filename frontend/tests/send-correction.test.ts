import { afterEach, describe, expect, it, vi } from "vitest";
import { sendCorrection } from "../src/uapi-client";

const CREATED = { intention_id: "int-1", transaction_id: "txn-2" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sendCorrection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the nested operation to the typed correction endpoint with the reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, CREATED));
    vi.stubGlobal("fetch", fetchMock);

    const started = await sendCorrection(
      {
        persona: "seller",
        country: "IT",
        correctedRecordId: "txn-1",
        operation: { document: { number: "NC-1" } },
        correctionValue: { type: "CORRECTION", record: { id: "txn-1" } },
        reason: "two covers were never served",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      },
      "LIVE",
    );

    expect(started.transport).toBe("backend");
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/invoices/txn-1/correction");
    expect(JSON.parse(String(init.body))).toMatchObject({
      persona: "seller",
      country: "IT",
      operation: { document: { number: "NC-1" } },
      reason: "two covers were never served",
      idempotency_key: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("falls back to the passthrough with the FULL correction value in MOCK when unconfigured", async () => {
    const fetchMock = vi
      .fn()
      // typed endpoint refuses: no system id configured
      .mockResolvedValueOnce(
        jsonResponse(409, { detail: "SELLER_SYSTEM_ID_IT is not set in .env" }),
      )
      // passthrough intention, then transaction
      .mockResolvedValueOnce(jsonResponse(200, { content: { id: "int-9" } }))
      .mockResolvedValueOnce(jsonResponse(200, { content: { id: "txn-9" } }));
    vi.stubGlobal("fetch", fetchMock);

    const correctionValue = {
      type: "CORRECTION",
      record: { id: "txn-1" },
      data: { document: { number: "NC-1" } },
    };
    const started = await sendCorrection(
      {
        persona: "seller",
        country: "IT",
        correctedRecordId: "txn-1",
        operation: correctionValue.data,
        correctionValue,
      },
      "MOCK",
    );

    expect(started.transport).toBe("direct");
    // The passthrough has no server-side wrapping, so the verbatim CORRECTION envelope must be
    // the transaction's operation.
    const transaction = JSON.parse(
      String((fetchMock.mock.calls[2] as [string, RequestInit])[1].body),
    );
    expect(transaction.content.operation).toEqual(correctionValue);
  });

  it("does not swallow the unconfigured 409 in LIVE", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(409, { detail: "SELLER_SYSTEM_ID_IT is not set in .env" })),
    );
    await expect(
      sendCorrection(
        {
          persona: "seller",
          country: "IT",
          correctedRecordId: "txn-1",
          operation: {},
          correctionValue: {},
        },
        "LIVE",
      ),
    ).rejects.toThrow(/is not set in \.env/);
  });
});
