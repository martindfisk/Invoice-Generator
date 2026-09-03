import { describe, expect, it } from "vitest";

import { fieldPresence, missingCount } from "../src/field-presence";
import { getFormat } from "../src/formats";
import { allFields } from "../src/field-registry";
import { preset } from "../src/presets";
import { buildOperation, indexJson, stringifyOperation } from "../src/uapi-json";
import { buildFieldIndex } from "../src/xml-locate";

function inputFor(id: Parameters<typeof preset>[0]) {
  const invoice = preset(id);
  const format = getFormat(invoice.format);
  const operation = buildOperation(invoice);
  return {
    invoice,
    format,
    fields: buildFieldIndex(invoice, format.map),
    jsonIndex: indexJson(stringifyOperation(operation.value)),
    jsonPrefix: operation.prefix,
  };
}

function byStructure(field: string, id: Parameters<typeof preset>[0] = "it-b2b-sdi") {
  const presence = fieldPresence(field as never, inputFor(id));
  return Object.fromEntries(presence.map((entry) => [entry.structure, entry]));
}

describe("fieldPresence", () => {
  it("reports a field every structure carries", () => {
    const found = byStructure("number");
    expect(found.human?.present).toBe(true);
    expect(found.json?.present).toBe(true);
    expect(found.xml?.present).toBe(true);
    expect(found.json?.detail).toBe("/document/number");
    expect(missingCount(Object.values(found))).toBe(0);
  });

  it("names the reason a field never reaches the operation", () => {
    // The seller is the commissioned taxpayer, not something the payload authors — the strip
    // quotes the same reason uapi-map.ts already declares rather than inventing wording.
    const found = byStructure("seller.name");
    expect(found.human?.present).toBe(true);
    expect(found.json?.present).toBe(false);
    expect(found.json?.reason).toMatch(/taxpayer resource/);
  });

  it("reports a field the chosen format renders no element for", () => {
    // BT-19 rides on the operation but no writer here emits it, so the XML column is the gap.
    const found = byStructure("uapi.buyerAccountingRef");
    expect(found.xml?.present).toBe(false);
    expect(found.xml?.reason).toMatch(/renders no element/);
  });

  it("flags a pointer the gateway accepts but does not render", () => {
    // recipients[].buyer_id is in the payload and produced no FatturaPA element in the capture.
    const found = byStructure("uapi.buyer.buyerId");
    expect(found.json?.present).toBe(true);
    expect(found.json?.reason).toMatch(/not rendered/i);
  });

  it("counts a Belgian invoice's Italian-only field as absent everywhere but the model", () => {
    // The app models CUP; Peppol UBL renders no element for it and the operation cannot carry it.
    // Model presence must come from the registry, or this reads as "we never heard of CUP".
    const found = byStructure("it.cup", "be-peppol");
    expect(found.human?.present).toBe(true);
    expect(found.json?.present).toBe(false);
    expect(found.xml?.present).toBe(false);
    expect(missingCount(Object.values(found))).toBe(2);
  });

  it("keeps the three structures independent", () => {
    // Model presence used to be `entry.rows.length > 0` and XML presence `entry.path !== undefined`.
    // MappingRow.path is non-optional and pathForRows() returns undefined only for zero rows, so the
    // two were the same predicate and the strip had a column that could never disagree.
    const input = inputFor("be-peppol");
    const vectors = { human: [] as boolean[], json: [] as boolean[], xml: [] as boolean[] };
    for (const spec of allFields()) {
      for (const entry of fieldPresence(spec.field, input)) {
        vectors[entry.structure].push(entry.present);
      }
    }
    const differs = (a: boolean[], b: boolean[]) => a.filter((v, i) => v !== b[i]).length;
    expect(differs(vectors.human, vectors.xml)).toBeGreaterThan(3);
    expect(differs(vectors.human, vectors.json)).toBeGreaterThan(3);
    expect(differs(vectors.json, vectors.xml)).toBeGreaterThan(3);
  });
});
