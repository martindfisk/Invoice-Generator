import { describe, expect, it } from "vitest";

import { preset } from "../src/presets";
import { toInvoiceTransaction } from "../src/uapi-map";
import { insertAtPointer } from "../src/uapi-json";
import { companions, coverage, insertBlocker, reachable, suggestedValue } from "../src/uapi-fields";
import type { SpecField, SpecFields } from "../src/uapi-fields-client";

function field(partial: Partial<SpecField> & { pointer: string }): SpecField {
  return {
    kind: "leaf",
    type: "string",
    schema: null,
    required: false,
    optional_ancestor: null,
    constraints: {},
    description: null,
    example: null,
    example_source: null,
    bt: [],
    applicability: {},
    applicable: true,
    variants: {},
    ...partial,
  };
}

function spec(fields: SpecField[], unions: SpecFields["unions"] = []): SpecFields {
  return {
    api_version: "2026-06-01",
    source: "fiskaly.unified-api.all.2026-06-01.yaml",
    source_sha256: "a".repeat(64),
    country: "IT",
    operation: "INVOICE",
    profile: "IT_EI",
    fields,
    unions,
    warnings: [],
  };
}

describe("coverage", () => {
  it("separates populated from available fields", () => {
    const result = coverage(
      spec([
        field({ pointer: "/document/number" }),
        field({ pointer: "/document/series", example: "FT" }),
      ]),
      { document: { number: "IT-INV-0001" } },
      "IT_EI",
    );
    expect(result.populated.map((entry) => entry.pointer)).toEqual(["/document/number"]);
    expect(result.missing.map((entry) => entry.pointer)).toEqual(["/document/series"]);
    expect(result.total).toBe(2);
  });

  it("sets aside what the spec calls not applicable for the profile", () => {
    const result = coverage(
      spec([
        field({
          pointer: "/entries/{i}/data/vat/regime",
          applicability: { IT_EI: { status: "not_applicable", note: "Not applicable" } },
        }),
      ]),
      { entries: [{ data: { vat: {} } }] },
      "IT_EI",
    );
    expect(result.missing).toEqual([]);
    expect(result.notApplicable.map((entry) => entry.pointer)).toEqual([
      "/entries/{i}/data/vat/regime",
    ]);
    expect(result.total).toBe(0);
  });

  it("counts only the union branches the payload actually selected", () => {
    // /payments/{i}/name exists under ONLINE and OTHER. An OUTSTANDING payment must not be told
    // it is missing a field its own branch does not have.
    const fields = [
      field({ pointer: "/payments/{i}/name", variants: { "/payments/{i}": ["ONLINE", "OTHER"] } }),
      field({
        pointer: "/payments/{i}/concept",
        variants: { "/payments/{i}": ["OUTSTANDING"] },
      }),
    ];
    const unions = [
      {
        pointer: "/payments/{i}",
        property_name: "type",
        values: ["ONLINE", "OTHER", "OUTSTANDING"],
      },
    ];
    const result = coverage(
      spec(fields, unions),
      { payments: [{ type: "OUTSTANDING", concept: "INVOICE" }] },
      "IT_EI",
    );
    expect(result.populated.map((entry) => entry.pointer)).toEqual(["/payments/{i}/concept"]);
    expect(result.missing).toEqual([]);
  });

  it("templates array indices so one row covers every line", () => {
    const result = coverage(
      spec([field({ pointer: "/entries/{i}/data/text" })]),
      { entries: [{ data: { text: "a" } }, { data: { text: "b" } }] },
      "IT_EI",
    );
    expect(result.populated).toHaveLength(1);
  });

  it("measures a real preset against the fields it does populate", () => {
    const operation = toInvoiceTransaction(preset("it-b2b-sdi"));
    const result = coverage(
      spec([
        field({ pointer: "/document/number" }),
        field({ pointer: "/recipients/{i}/buyer_id" }),
        field({ pointer: "/recipients/{i}/shipping/name" }),
        field({ pointer: "/entries/{i}/data/product/number" }),
        field({ pointer: "/document/activity_code" }),
      ]),
      operation,
      "IT_EI",
    );
    expect(result.missing.map((entry) => entry.pointer)).toEqual(["/document/activity_code"]);
  });
});

describe("suggestedValue", () => {
  it("prefers the spec example, then an enum, then nothing", () => {
    expect(suggestedValue(field({ pointer: "/a", example: "PO-2025-001234" }))).toBe(
      "PO-2025-001234",
    );
    expect(
      suggestedValue(field({ pointer: "/a", constraints: { enum: ["STANDARD", "GIFT"] } })),
    ).toBe("STANDARD");
    expect(suggestedValue(field({ pointer: "/a" }))).toBeUndefined();
  });
});

describe("companions", () => {
  it("names the required siblings that must arrive with a newly created optional block", () => {
    const name = field({
      pointer: "/tax_representative/name",
      required: true,
      optional_ancestor: "/tax_representative",
      example: "Rappresentante Fiscale S.r.l.",
    });
    const vat = field({
      pointer: "/tax_representative/vat_number",
      required: true,
      optional_ancestor: "/tax_representative",
      example: "01234567897",
    });
    const elsewhere = field({
      pointer: "/document/series",
      required: false,
      optional_ancestor: null,
      example: "FT",
    });
    const derived = coverage(spec([name, vat, elsewhere]), {}, "IT_EI");
    const catalogue = spec([name, vat, elsewhere]);
    expect(companions(catalogue, name, derived).map((entry) => entry.pointer)).toEqual([
      "/tax_representative/vat_number",
    ]);
    expect(companions(catalogue, elsewhere, derived)).toEqual([]);
  });
});

describe("insertAtPointer", () => {
  const text = JSON.stringify(
    { document: { number: "X" }, entries: [{ data: { text: "a" } }], payments: [] },
    null,
    2,
  );

  it("writes a new member and keeps the two-space shape the editor holds", () => {
    const next = insertAtPointer(text, "/document/series", "FT");
    expect(JSON.parse(next).document).toEqual({ number: "X", series: "FT" });
    expect(next.split("\n")[1]).toBe('  "document": {');
  });

  it("creates the intermediate objects an absent optional block needs", () => {
    const next = insertAtPointer(text, "/tax_representative/name", "Rappresentante");
    expect(JSON.parse(next).tax_representative).toEqual({ name: "Rappresentante" });
  });

  it("resolves a templated index to the first existing member", () => {
    const next = insertAtPointer(text, "/entries/{i}/data/product/number", "MAN-1");
    expect(JSON.parse(next).entries[0].data.product).toEqual({ number: "MAN-1" });
  });

  it("never grows an array", () => {
    expect(insertAtPointer(text, "/payments/{i}/concept", "INVOICE")).toBe(text);
  });

  it("leaves text it cannot parse alone", () => {
    expect(insertAtPointer("{ not json", "/document/series", "FT")).toBe("{ not json");
  });

  it("refuses to turn a missing array into an object keyed by index", () => {
    // details.creators is absent, so "{i}" has no member to land on. Creating {"0": ...} would
    // produce a payload the schema rejects, and the panel would report a phantom success.
    const next = insertAtPointer(text, "/details/creators/{i}/name/gender", "DIVERSE");
    expect(next).toBe(text);
  });
});

describe("reachable", () => {
  const operation = { document: {}, entries: [{ data: {} }], payments: [] };

  it("allows a path that only has to create objects", () => {
    expect(reachable(operation, "/tax_representative/name")).toBe(true);
    expect(reachable(operation, "/entries/{i}/data/product/number")).toBe(true);
  });

  it("refuses a path crossing an array that has no member", () => {
    expect(reachable(operation, "/payments/{i}/concept")).toBe(false);
    expect(reachable(operation, "/details/creators/{i}/label")).toBe(false);
  });
});

describe("insertBlocker", () => {
  it("allows a field whose block can be completed", () => {
    const catalogue = spec([field({ pointer: "/document/series", example: "FT" })]);
    const derived = coverage(catalogue, { document: {} }, "IT_EI");
    expect(insertBlocker(catalogue, catalogue.fields[0], derived, { document: {} })).toBeNull();
  });

  it("refuses a branch the payload has not chosen", () => {
    // fiscal_location is an anyOf of France, Portugal and a generic country. Offering members of
    // different arms independently produced country "AD" next to region "AZORES" — invalid.
    const axis = "/entries/{i}/data/vat/fiscal_location";
    const catalogue = spec(
      [
        field({
          pointer: `${axis}/region`,
          variants: { [axis]: ["PT"] },
          constraints: { enum: ["AZORES", "MADEIRA"] },
        }),
      ],
      [{ pointer: axis, property_name: null, values: ["FR", "PT", "#2"] }],
    );
    const operation = { entries: [{ data: { vat: {} } }] };
    const derived = coverage(catalogue, operation, "IT_EI");
    expect(insertBlocker(catalogue, catalogue.fields[0], derived, operation)).toBe(
      "choose the variant in the JSON first",
    );
  });

  it("refuses a field whose new block needs a required sibling it cannot value", () => {
    const catalogue = spec([
      field({
        pointer: "/tax_representative/country",
        optional_ancestor: "/tax_representative",
        constraints: { enum: ["IT"] },
      }),
      field({
        pointer: "/tax_representative/name",
        required: true,
        optional_ancestor: "/tax_representative",
      }),
    ]);
    const derived = coverage(catalogue, {}, "IT_EI");
    expect(insertBlocker(catalogue, catalogue.fields[0], derived, {})).toBe(
      "/tax_representative/name is required and the spec gives no example",
    );
  });

  it("refuses a field whose new block requires an array it cannot build", () => {
    const catalogue = spec([
      field({ pointer: "/details/properties", kind: "map", optional_ancestor: "/details" }),
      field({
        pointer: "/details/creators",
        kind: "group",
        required: true,
        optional_ancestor: "/details",
      }),
    ]);
    const derived = coverage(catalogue, {}, "IT_EI");
    expect(insertBlocker(catalogue, catalogue.fields[0], derived, {})).toBe(
      "/details/creators has to be built by hand first",
    );
  });
});
