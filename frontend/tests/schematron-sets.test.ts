import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSefManifest,
  parseSefManifest,
  resolveRuleSets,
  ruleSetsByOrder,
  SCHEMATRON_RULE_SETS,
  SEF_MANIFEST_URL,
  type SefManifest,
} from "../src/schematron-sets";

function entry(
  id: string,
  version: string,
  formats: string[],
  order: number,
  sha256 = `sha-${id}`,
) {
  return {
    id,
    title: `${id} title`,
    version,
    licence: "EUPL-1.2",
    formats,
    order,
    sourceSha: "src",
    sef: { sha256, bytes: 1, saxonVersion: "SaxonJS 2.7", buildDateTime: "2026-09-01T00:00:00Z" },
  };
}

const MANIFEST: SefManifest = {
  generatedAt: "2026-09-01T00:00:00Z",
  saxonJs: "2.7.0",
  ruleSets: [
    entry("peppol-ubl", "3.0.20", ["ubl"], 1),
    entry("cen-ubl", "1.3.15", ["ubl", "xrechnung"], 0),
    entry("xrechnung-ubl", "2.5.0", ["xrechnung"], 2),
    entry("en16931-cii", "1.3.15", ["cii"], 3),
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveRuleSets", () => {
  it("resolves ids, versioned URLs and content-hash keys from the manifest, in order", () => {
    expect(resolveRuleSets("ubl", MANIFEST)).toEqual([
      {
        id: "cen-ubl",
        url: "/sef/cen-ubl.sef.json?v=sha-cen-ubl",
        key: "sha-cen-ubl",
        version: "1.3.15",
      },
      {
        id: "peppol-ubl",
        url: "/sef/peppol-ubl.sef.json?v=sha-peppol-ubl",
        key: "sha-peppol-ubl",
        version: "3.0.20",
      },
    ]);
    expect(resolveRuleSets("xrechnung", MANIFEST).map((set) => set.id)).toEqual([
      "cen-ubl",
      "xrechnung-ubl",
    ]);
  });

  it("falls back to the built-in list, keyed by URL, without a manifest", () => {
    expect(resolveRuleSets("ubl", null)).toEqual([
      { id: "cen-ubl", url: "/sef/cen-ubl.sef.json", key: "/sef/cen-ubl.sef.json" },
      { id: "peppol-ubl", url: "/sef/peppol-ubl.sef.json", key: "/sef/peppol-ubl.sef.json" },
    ]);
    expect(SCHEMATRON_RULE_SETS.ubl).toEqual(["cen-ubl", "peppol-ubl"]);
  });

  it("falls back when the manifest lists nothing for the format", () => {
    const partial: SefManifest = { ruleSets: [entry("en16931-cii", "1.3.15", ["cii"], 0)] };
    expect(resolveRuleSets("ubl", partial).map((set) => set.id)).toEqual(["cen-ubl", "peppol-ubl"]);
  });

  it("resolves nothing for a format without Schematron", () => {
    expect(resolveRuleSets("fatturapa", MANIFEST)).toEqual([]);
    expect(resolveRuleSets("fatturapa", null)).toEqual([]);
  });
});

describe("loadSefManifest", () => {
  it("loads and orders the manifest", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(MANIFEST), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const manifest = await loadSefManifest();
    expect(fetchMock).toHaveBeenCalledWith(SEF_MANIFEST_URL, { cache: "no-cache" });
    expect(manifest).not.toBeNull();
    expect(ruleSetsByOrder(manifest!).map((set) => set.id)).toEqual([
      "cen-ubl",
      "peppol-ubl",
      "xrechnung-ubl",
      "en16931-cii",
    ]);
  });

  it("returns null on 404 instead of throwing", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("missing", { status: 404 })));
    await expect(loadSefManifest()).resolves.toBeNull();
  });

  it("returns null when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    await expect(loadSefManifest()).resolves.toBeNull();
  });

  it("returns null for a body that is not a manifest", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("not json", { status: 200 })));
    await expect(loadSefManifest()).resolves.toBeNull();
  });
});

describe("parseSefManifest", () => {
  it("rejects shapes without a usable ruleSets array", () => {
    expect(parseSefManifest(null)).toBeNull();
    expect(parseSefManifest({})).toBeNull();
    expect(parseSefManifest({ ruleSets: [] })).toBeNull();
    expect(parseSefManifest({ ruleSets: [{ id: "cen-ubl" }] })).toBeNull();
    expect(parseSefManifest({ valid: true, findings: [] })).toBeNull();
  });

  it("accepts the documented manifest contract", () => {
    expect(parseSefManifest(JSON.parse(JSON.stringify(MANIFEST)))).not.toBeNull();
  });
});
