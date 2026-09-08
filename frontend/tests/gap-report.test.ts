import { describe, expect, it } from "vitest";

import { allFields, catalogEntry, formatCarries } from "../src/field-registry";
import {
  CSV_COLUMNS,
  GAP_INPUTS,
  MANDATED,
  gapInputs,
  gapRows,
  gapSummary,
  modelGaps,
  presetContradictions,
  summaryOf,
  toCsv,
  type GapRow,
} from "../src/gap-report";
import { pointerForField } from "../src/uapi-json";
import { ACCOUNT_SUPPLIED_FIELDS, UAPI_LOSSY_FIELDS, UAPI_PARTIAL_FIELDS } from "../src/uapi-map";

const ROWS = gapRows();
const REGISTRY = new Set(allFields().map((spec) => spec.field));

// Every reason must be quoted, never paraphrased: either a key of a declared table or one of the
// three sentences this generator owns, which gap-check pins byte-for-byte.
const OWN_REASONS = new Set(gapInputs().declaredReasons["gap-report.ts"]);
const DECLARED = new Set([
  ...Object.keys(UAPI_LOSSY_FIELDS),
  ...Object.keys(UAPI_PARTIAL_FIELDS),
  ...OWN_REASONS,
]);

describe("gap rows", () => {
  it("stays within a band a team can triage, and fails loudly above it", () => {
    // 312 today. The band is wide enough to absorb a preset or a mapping row; a jump past 500 means
    // a filter is wrong, not that the codebase got worse.
    expect(ROWS.length).toBeGreaterThan(150);
    expect(ROWS.length).toBeLessThan(500);
    const summary = gapSummary(ROWS);
    expect(summary.causes).toBeGreaterThan(5);
    expect(summary.causes).toBeLessThan(60);
  });

  it("gives every row a unique id and emits them already sorted", () => {
    const ids = ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ROWS.map((row) => row.id)).toEqual(gapRows().map((row) => row.id));
    for (const row of ROWS) {
      const key = row.missingFrom === "model" ? row.belongsAt : row.field;
      expect(row.id).toBe(`${row.format}|${key}|${row.missingFrom}`);
    }
  });

  it("only reports the syntax each country actually files", () => {
    const scoped = new Set(MANDATED.map((entry) => entry.format));
    for (const row of ROWS) expect(scoped.has(row.format)).toBe(true);
  });

  it("names a real model field, except for spec orphans which by definition have none", () => {
    for (const row of ROWS) {
      if (row.missingFrom === "model") expect(row.field).toBe("");
      else expect(REGISTRY.has(row.field as never), row.id).toBe(true);
    }
  });

  it("resolves every business term against the catalogue", () => {
    for (const row of ROWS) {
      if (row.bt === null) continue;
      const entry = catalogEntry(row.bt);
      expect(entry, `${row.id} cites ${row.bt}`).toBeDefined();
      expect(row.bg).toBe(entry?.group ?? null);
      expect(row.cardinality).toBe(entry?.cardinality ?? null);
    }
  });

  it("quotes every reason verbatim from a declared table", () => {
    for (const row of ROWS) expect(DECLARED.has(row.reason), `${row.id}: ${row.reason}`).toBe(true);
  });

  it("never claims a gap that does not exist", () => {
    for (const row of ROWS) {
      if (row.missingFrom !== "xml") continue;
      expect(formatCarries(row.format, row.field as never), row.id).toBe(false);
    }
    for (const row of ROWS) {
      if (row.missingFrom !== "json") continue;
      // A json gap is either no pointer at all, or a pointer the loss tables declare lossy.
      const pointer = pointerForField(row.field as never, "");
      const declared = DECLARED.has(row.reason);
      expect(pointer === undefined || declared, row.id).toBe(true);
    }
  });

  it("reserves blocking for a mandatory term a CIUS syntax cannot render", () => {
    // FatturaPA is a national format, not a CIUS of EN 16931, so EN cardinality does not bind it.
    for (const row of ROWS.filter((entry) => entry.severity === "blocking")) {
      expect(row.format, row.id).not.toBe("fatturapa");
      expect(row.missingFrom, row.id).toBe("xml");
      expect(row.cardinality?.startsWith("1"), row.id).toBe(true);
      expect(row.source).toMatch(/R1$/);
    }
  });

  it("does not call a platform-supplied field blocking, whatever its cardinality", () => {
    // BT-3 is derived by fiskaly and the seller identity comes from the commissioned Taxpayer.
    // Both are mandatory terms whose absence from the *payload* is by design; calling them
    // blocking buried the seven rows that genuinely are. Their reason names the cause, so the
    // assertion is on the reason, not on a field-name prefix.
    const byDesign = ROWS.filter(
      (row) =>
        row.reason.includes("taxpayer resource") || row.reason.includes("derived by fiskaly"),
    );
    expect(byDesign.length).toBeGreaterThan(5);
    for (const row of byDesign) expect(row.severity, row.id).not.toBe("blocking");
  });

  it("says a syntax is unobserved rather than leaving the evidence blank", () => {
    for (const row of ROWS) {
      if (row.evidence?.startsWith("Derived:")) continue;
      if (row.format === "fatturapa") {
        expect(row.evidence === null || !row.evidence.startsWith("Unobserved")).toBe(true);
      } else {
        expect(row.evidence, row.id).toMatch(/^Unobserved: no transmission capture exists/);
      }
    }
  });

  it("grades account-supplied seller fields as derived, not as lost data", () => {
    // The spec's own Taxpayer/System schemas prove the seller (BG-4) is mastered on the account
    // and derived per invoice — every such field is a note naming its source, never should-fix.
    const seller = ROWS.filter((row) => row.reason.startsWith("The seller (BG-4)"));
    expect(seller.length).toBeGreaterThan(0);
    for (const row of seller) {
      const supplied = ACCOUNT_SUPPLIED_FIELDS[row.field] !== undefined;
      if (supplied) {
        expect(row.severity, row.id).toBe("note");
        expect(row.source, row.id).toContain("R4");
        expect(row.evidence, row.id).toMatch(/^Derived: fiskaly fills this from/);
        expect(row.evidence, row.id).toContain(ACCOUNT_SUPPLIED_FIELDS[row.field]);
      } else {
        // BT-30: only the Italian fiscalization has a registry-identifier slot, so the datum
        // genuinely has no home for the German and Belgian paths.
        expect(["seller.legalRegId", "seller.legalRegScheme"], row.id).toContain(row.field);
        expect(row.severity, row.id).toBe("should-fix");
      }
    }
  });

  it("grades the automated stamp duty as derived, and CUP/CIG as the real losses they are", () => {
    // DatiBollo is fiskaly's own computation (VAT-exempt total >= EUR 77.47, DPR 642/1972);
    // CUP and CIG are authored identifiers nothing supplies.
    const extras = ROWS.filter(
      (row) => row.reason.startsWith("The Italian document extras") && row.missingFrom === "json",
    );
    expect(extras.map((row) => row.field).sort()).toEqual([
      "it.bollo.amount",
      "it.bollo.virtuale",
      "it.cig",
      "it.cup",
    ]);
    for (const row of extras) {
      if (row.field.startsWith("it.bollo")) {
        expect(row.severity, row.id).toBe("note");
        expect(row.source, row.id).toContain("R4");
        expect(row.evidence, row.id).toMatch(/^Derived: fiskaly adds DatiBollo automatically/);
        expect(row.evidence, row.id).toContain("77.47");
      } else {
        expect(row.severity, row.id).toBe("should-fix");
      }
    }
  });

  it("only declares account sources for fields the seller loss-table actually lists", () => {
    const sellerReason = Object.keys(UAPI_LOSSY_FIELDS).find((reason) =>
      reason.startsWith("The seller (BG-4)"),
    )!;
    const declared = new Set<string>(UAPI_LOSSY_FIELDS[sellerReason]);
    for (const field of Object.keys(ACCOUNT_SUPPLIED_FIELDS)) {
      expect(declared.has(field), field).toBe(true);
    }
  });

  it("agrees with the live per-field verdict on every preset", () => {
    expect(presetContradictions(ROWS)).toEqual([]);
  });
});

describe("csv", () => {
  const parse = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted && char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(cell);
        cell = "";
      } else cell += char;
    }
    cells.push(cell);
    return cells;
  };

  it("round-trips every row through the header the importer reads", () => {
    const lines = toCsv(ROWS).trimEnd().split("\n");
    expect(parse(lines[0]!)).toEqual([...CSV_COLUMNS]);
    expect(lines).toHaveLength(ROWS.length + 1);
    const first = parse(lines[1]!);
    const row = ROWS[0] as GapRow;
    expect(first[0]).toBe(summaryOf(row));
    expect(first[1]).toBe(row.id);
    expect(first[CSV_COLUMNS.indexOf("reason")]).toBe(row.reason);
  });

  it("escapes the prose that carries commas and quotes", () => {
    const commas = ROWS.filter((row) => row.reason.includes(","));
    expect(commas.length).toBeGreaterThan(0);
    const csv = toCsv(commas.slice(0, 1));
    expect(csv.split("\n")[1]?.startsWith('"')).toBe(false);
    expect(csv).toContain(`"${commas[0]!.reason}"`);
  });
});

describe("inputs dumped for the Python checks", () => {
  it("names the files the report was folded from", () => {
    expect(GAP_INPUTS.length).toBeGreaterThan(5);
    for (const input of GAP_INPUTS) expect(input).toMatch(/\.(ts|json)$|spec\//);
  });

  it("dumps the truths gap-check would otherwise re-implement in Python", () => {
    const inputs = gapInputs();
    expect(inputs.modelFields).toContain("number");
    expect(Object.keys(inputs.pointerFields).length).toBeGreaterThan(50);
    expect(inputs.derivedPaths.length).toBe(13);
    expect(Object.keys(inputs.mappingPaths).sort()).toEqual(
      [...new Set(MANDATED.map((entry) => entry.format))].sort(),
    );
    for (const rows of Object.values(inputs.mappingPaths)) {
      expect(rows.length).toBeGreaterThan(40);
      expect(rows[0]).toHaveProperty("path");
    }
  });
});

describe("modelGaps", () => {
  it("emits one row per field and format, never both a json and an xml row", () => {
    const seen = new Map<string, string>();
    for (const row of modelGaps()) {
      const key = `${row.format}|${row.field}`;
      expect(seen.has(key), `${key} counted twice`).toBe(false);
      seen.set(key, row.missingFrom);
    }
  });
});
