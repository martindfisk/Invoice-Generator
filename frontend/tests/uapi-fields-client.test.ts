import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSpecFieldsCache,
  loadSpecFields,
  SPEC_FIELDS_ENDPOINT,
} from "../src/uapi-fields-client";

const payload = {
  api_version: "2026-06-01",
  source: "fiskaly.unified-api.all.2026-06-01.yaml",
  source_sha256: "fee9b16d1c7c000000000000000000000000000000000000000000000000abcd",
  country: "IT",
  operation: "INVOICE",
  profile: "IT_EI",
  fields: [
    {
      pointer: "/document/references/purchase_order",
      kind: "leaf",
      type: "string",
      schema: "AlphaNumerical32",
      required: false,
      optional_ancestor: "/document/references",
      constraints: { maxLength: 32 },
      description: "Purchase order reference.",
      example: "PO-2025-001234",
      example_source: "DocumentReferencesPurchaseOrder",
      bt: ["BT-13"],
      applicability: { IT_EI: { status: "applicable", note: null } },
      applicable: true,
      variants: {},
    },
  ],
  unions: [{ pointer: "/entries/{i}", property_name: "type", values: ["SALE"] }],
  warnings: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearSpecFieldsCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ok(body: unknown = payload) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("loadSpecFields", () => {
  it("asks for the requested country and operation", async () => {
    ok();
    const outcome = await loadSpecFields("it", "INVOICE");
    expect(outcome.status).toBe("ok");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith(SPEC_FIELDS_ENDPOINT)).toBe(true);
    expect(url).toContain("country=IT");
    expect(url).toContain("operation=INVOICE");
  });

  it("serves a second read of the same catalogue from memory", async () => {
    ok();
    await loadSpecFields("IT", "INVOICE");
    await loadSpecFields("IT", "INVOICE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadSpecFields("IT", "CORRECTION");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is unavailable, not thrown, when the backend cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const outcome = await loadSpecFields("IT", "INVOICE");
    expect(outcome).toEqual({
      status: "unavailable",
      reason: expect.stringContaining(SPEC_FIELDS_ENDPOINT),
    });
  });

  it("reports the status when the spec is missing on the backend", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "no spec for IT; run: make spec",
      json: async () => ({}),
    });
    const outcome = await loadSpecFields("IT", "INVOICE");
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") {
      expect(outcome.reason).toContain("503");
      expect(outcome.reason).toContain("make spec");
    }
  });

  it("rejects a payload that is not a field catalogue", async () => {
    ok({ fields: [] });
    const outcome = await loadSpecFields("IT", "INVOICE");
    expect(outcome.status).toBe("unavailable");
  });

  it("does not cache a failed read", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await loadSpecFields("IT", "INVOICE");
    ok();
    const outcome = await loadSpecFields("IT", "INVOICE");
    expect(outcome.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
