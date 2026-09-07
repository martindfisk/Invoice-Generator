import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSchematron, type SefRef } from "../src/schematron.worker";

type TransformOptions = { stylesheetInternal: unknown; sourceText: string };

const transform = vi.fn((options: TransformOptions) => {
  void options;
  return Promise.resolve({ principalResult: "<svrl/>" });
});
vi.stubGlobal("SaxonJS", { transform });

let served: Record<string, unknown> = {};
const fetchMock = vi.fn((url: string) => {
  const body = served[url];
  if (body === undefined) return Promise.resolve(new Response("missing", { status: 404 }));
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});
vi.stubGlobal("fetch", fetchMock);

function ref(id: string, key: string, url = `/sef/${id}.sef.json?v=${key}`): SefRef {
  return { id, url, key };
}

function lastSheet(): unknown {
  return transform.mock.calls.at(-1)?.[0].stylesheetInternal;
}

beforeEach(() => {
  transform.mockClear();
  fetchMock.mockClear();
  served = {};
});

describe("the SEF cache is keyed by content hash, not by URL", () => {
  it("does not confuse two different SEF bodies served at the same URL", async () => {
    const url = "/sef/replaced.sef.json";
    served = { [url]: { sef: "before the bump" } };
    await runSchematron("<x/>", [ref("replaced", "sha-old", url)]);
    expect(lastSheet()).toEqual({ sef: "before the bump" });

    served = { [url]: { sef: "after the bump" } };
    await runSchematron("<x/>", [ref("replaced", "sha-new", url)]);
    expect(lastSheet()).toEqual({ sef: "after the bump" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses the parsed SEF for the same content hash without refetching", async () => {
    served = { "/sef/same.sef.json?v=sha-same": { sef: "stable" } };
    await runSchematron("<x/>", [ref("same", "sha-same")]);
    await runSchematron("<x/>", [ref("same", "sha-same")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledTimes(2);
  });

  it("requests the SEF through its versioned URL so the HTTP cache cannot serve a stale body", async () => {
    served = { "/sef/busted.sef.json?v=sha-busted": { sef: "busted" } };
    await runSchematron("<x/>", [ref("busted", "sha-busted")]);
    expect(fetchMock).toHaveBeenCalledWith("/sef/busted.sef.json?v=sha-busted");
  });

  it("evicts the least recently used SEF beyond four entries", async () => {
    served = {
      "/sef/lru-a.sef.json?v=ka": { sef: "a" },
      "/sef/lru-b.sef.json?v=kb": { sef: "b" },
      "/sef/lru-c.sef.json?v=kc": { sef: "c" },
      "/sef/lru-d.sef.json?v=kd": { sef: "d" },
      "/sef/lru-e.sef.json?v=ke": { sef: "e" },
    };
    await runSchematron("<x/>", [
      ref("lru-a", "ka"),
      ref("lru-b", "kb"),
      ref("lru-c", "kc"),
      ref("lru-d", "kd"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await runSchematron("<x/>", [ref("lru-a", "ka")]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await runSchematron("<x/>", [ref("lru-e", "ke")]);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await runSchematron("<x/>", [ref("lru-a", "ka")]);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await runSchematron("<x/>", [ref("lru-b", "kb")]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("still accepts a plain rule-set name and keys it by URL", async () => {
    served = { "/sef/legacy.sef.json": { sef: "legacy" } };
    const runs = await runSchematron("<x/>", ["legacy"]);
    expect(runs[0].ruleSet).toBe("legacy");
    expect(lastSheet()).toEqual({ sef: "legacy" });
    await runSchematron("<x/>", ["legacy"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a missing SEF with the make sef hint", async () => {
    await expect(runSchematron("<x/>", [ref("absent", "sha-absent")])).rejects.toThrow(
      /absent\.sef\.json\?v=sha-absent is not available \(404.*make sef/,
    );
  });
});
