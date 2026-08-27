import { describe, expect, it } from "vitest";
import catalogJson from "../src/bt-catalog.json?raw";
import { CII_MAP } from "../src/cii-map";
import { FATTURAPA_MAP } from "../src/fatturapa-map";
import { UBL_MAP } from "../src/ubl-map";

type CatalogEntry = {
  id: string;
  group: string;
  name: string;
  description: string;
  cardinality: string;
  datatype: string;
};

const catalog: CatalogEntry[] = JSON.parse(catalogJson);

const byId = new Map(catalog.map((entry) => [entry.id, entry]));

describe("bt-catalog.json", () => {
  it("holds the full EN 16931 business term table", () => {
    expect(catalog.length).toBeGreaterThan(150);
    expect(byId.get("BT-1")).toMatchObject({
      group: "BG-0",
      name: "Invoice number",
      cardinality: "1..1",
      datatype: "Identifier",
    });
    expect(byId.get("BG-23")?.name).toBe("VAT BREAKDOWN");
    expect(byId.get("BT-131")?.group).toBe("BG-25");
  });

  it("gives every entry an id, a group, a name and a cardinality", () => {
    for (const entry of catalog) {
      expect(entry.id).toMatch(/^(BG|BT)-\d+(\.\d+)?$/);
      expect(entry.group).toMatch(/^BG-\d+$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.cardinality).toMatch(/^\d\.\.[\dn]$/);
    }
  });

  it("covers every business term referenced by the mapping tables", () => {
    const referenced = [...UBL_MAP, ...CII_MAP, ...FATTURAPA_MAP]
      .map((row) => row.bt)
      .filter((bt): bt is string => Boolean(bt))
      .map((bt) => /^(BT-\d+)/.exec(bt)?.[1] ?? bt);
    expect(referenced.length).toBeGreaterThan(50);
    for (const bt of new Set(referenced)) {
      expect(byId.has(bt), `${bt} is missing from bt-catalog.json`).toBe(true);
    }
  });
});
