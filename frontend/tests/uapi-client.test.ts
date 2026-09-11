import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorCode, passthrough } from "../src/uapi-client";

describe("errorCode", () => {
  it("reads the structured code out of a backend 409 detail dict", () => {
    const error = new ApiError(409, "no system id for IT", {
      detail: { code: "SYSTEM_ID_MISSING", country: "IT", detail: "no system id for IT" },
    });
    expect(errorCode(error)).toBe("SYSTEM_ID_MISSING");
  });

  it("yields undefined for plain-string details, foreign errors and missing bodies", () => {
    expect(errorCode(new ApiError(409, "conflict", { detail: "a bare string" }))).toBeUndefined();
    expect(errorCode(new ApiError(409, "conflict"))).toBeUndefined();
    expect(errorCode(new ApiError(409, "conflict", { detail: { code: 42 } }))).toBeUndefined();
    expect(errorCode(new Error("not an ApiError"))).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe("passthrough binary responses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("summarises a non-JSON body instead of failing to parse it", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(zip, { status: 200, headers: { "content-type": "application/zip" } }),
        ),
    );
    const summary = await passthrough<{ binary: boolean; content_type: string; bytes: number }>(
      "GET",
      "/files/rec-1.zip",
    );
    expect(summary).toEqual({ binary: true, content_type: "application/zip", bytes: zip.length });
  });

  it("still parses JSON bodies as JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ content: { id: "rec-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(passthrough("GET", "/records/rec-1")).resolves.toEqual({
      content: { id: "rec-1" },
    });
  });
});
