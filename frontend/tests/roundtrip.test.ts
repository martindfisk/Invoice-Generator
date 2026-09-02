import { describe, expect, it } from "vitest";
import { FORMAT_IDS, getFormat } from "../src/formats";
import {
  getField,
  resolveField,
  type FormatId,
  type Invoice,
  type MappingRow,
  type VatBreakdownRow,
} from "../src/model";
import { preset, PRESET_IDS, type PresetId } from "../src/presets";

function syntaxLevelBreakdown(rows: VatBreakdownRow[]) {
  return rows.map((row) => ({
    category: row.category,
    rate: row.rate,
    taxableAmount: row.taxableAmount,
    taxAmount: row.taxAmount,
    vatexCode: row.vatexCode,
    reason: row.reason,
  }));
}

function expandedFields(invoice: Invoice, rows: MappingRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.field) continue;
    if (!row.field.includes("{i}")) {
      ids.add(row.field);
      continue;
    }
    const count = row.field.startsWith("lines.")
      ? invoice.lines.length
      : invoice.vatBreakdown.length;
    for (let index = 0; index < count; index += 1) ids.add(resolveField(row.field, index));
  }
  return [...ids].sort();
}

function carriedValues(invoice: Invoice, ids: string[]): Record<string, unknown> {
  return Object.fromEntries(ids.map((id) => [id, getField(invoice, id)]));
}

function roundTrip(id: PresetId, format: FormatId) {
  const plugin = getFormat(format);
  const source = preset(id);
  const parsed = plugin.parse(plugin.write(source));
  const ids = expandedFields(source, plugin.map).filter(
    (field) => getField(source, field) !== undefined,
  );
  return { source, parsed, ids };
}

describe("serialise -> parse round trip", () => {
  for (const format of FORMAT_IDS) {
    for (const id of PRESET_IDS) {
      it(`keeps every mapped field of "${id}" through ${format}`, () => {
        const { source, parsed, ids } = roundTrip(id, format);
        expect(ids.length).toBeGreaterThan(20);
        expect(carriedValues(parsed, ids)).toEqual(carriedValues(source, ids));
      });
    }
  }

  it("rebuilds the Italian invoice from its own FatturaPA output", () => {
    const source = preset("it-b2b-sdi");
    const parsed = getFormat("fatturapa").parse(getFormat("fatturapa").write(source));
    expect(parsed.format).toBe("fatturapa");
    expect(parsed.vatBreakdown).toEqual(source.vatBreakdown);
    expect(parsed.totals).toEqual(source.totals);
    expect(parsed.buyer.channel).toEqual(source.buyer.channel);
    expect(parsed.seller.it).toEqual(source.seller.it);
    expect(parsed.lines[2].it).toEqual(source.lines[2].it);
    expect(parsed.lines.map((line) => line.vat)).toEqual(source.lines.map((line) => line.vat));
  });

  it("rebuilds the Belgian invoice from its own UBL output", () => {
    const source = preset("be-peppol");
    const parsed = getFormat("ubl").parse(getFormat("ubl").write(source));
    expect(parsed.format).toBe("ubl");
    expect(parsed.lines).toEqual(source.lines);
    expect(parsed.vatBreakdown).toEqual(source.vatBreakdown);
    expect(parsed.totals).toEqual(source.totals);
    expect(parsed.seller).toEqual(source.seller);
    expect(parsed.buyer.channel).toEqual(source.buyer.channel);
    expect(parsed.references).toEqual(source.references);
  });

  it("rebuilds the German hotel invoice from its own CII output", () => {
    const source = preset("de-hotel-b2b-zugferd");
    const parsed = getFormat("cii").parse(getFormat("cii").write(source));
    expect(parsed.format).toBe("cii");
    expect(parsed.lines).toEqual(source.lines);
    expect(parsed.vatBreakdown).toEqual(syntaxLevelBreakdown(source.vatBreakdown));
    expect(parsed.totals).toEqual(source.totals);
    expect(parsed.seller).toEqual(source.seller);
    expect(parsed.buyer.address).toEqual(source.buyer.address);
    expect(parsed.references).toEqual({ ...source.references, precedingInvoice: undefined });
    expect(parsed.issueDate).toBe(source.issueDate);
    expect(parsed.dueDate).toBe(source.dueDate);
  });

  it("keeps the TD04 link to the original invoice through FatturaPA and CII", () => {
    const source = preset("it-restaurant-td04-credit");
    for (const format of ["fatturapa", "cii"] as const) {
      const plugin = getFormat(format);
      const parsed = plugin.parse(plugin.write(source));
      expect(parsed.typeCode).toBe("381");
      expect(parsed.references?.precedingInvoice).toEqual(source.references?.precedingInvoice);
    }
  });

  it("keeps every mapped document reference through its own format", () => {
    const carried: Record<FormatId, string[]> = {
      ubl: [],
      xrechnung: [],
      cii: [],
      fatturapa: [],
    };
    for (const format of FORMAT_IDS) {
      for (const id of PRESET_IDS) {
        const { source, parsed, ids } = roundTrip(id, format);
        const references = ids.filter((field) => field.startsWith("references."));
        expect(references.length, `${id} has no mapped reference in ${format}`).toBeGreaterThan(0);
        carried[format].push(...references);
        expect(carriedValues(parsed, references)).toEqual(carriedValues(source, references));
      }
    }
    for (const format of FORMAT_IDS) {
      expect(new Set(carried[format]).size, `${format} carries too few references`).toBeGreaterThan(
        3,
      );
    }
    expect(new Set(carried.ubl)).toContain("references.invoicedObject");
    expect(new Set(carried.fatturapa)).toContain("references.tenderOrLot");
  });

  it("keeps the sales order, despatch advice and project through the formats that map them", () => {
    // No preset carries these three references, so the round trip for BT-14, BT-16 and BT-11
    // is pinned on an augmented invoice instead.
    const base = preset("be-peppol");
    const source: Invoice = {
      ...base,
      references: {
        ...base.references,
        salesOrder: "SO-2026-0042",
        despatchAdvice: { number: "DA-2026-0087", issueDate: "2026-08-25" },
        project: "PRJ-2026-01",
      },
    };
    for (const format of ["ubl", "xrechnung", "cii"] as const) {
      const plugin = getFormat(format);
      const parsed = plugin.parse(plugin.write(source));
      expect(parsed.references?.salesOrder, format).toBe("SO-2026-0042");
      expect(parsed.references?.despatchAdvice?.number, format).toBe("DA-2026-0087");
      expect(parsed.references?.project, format).toBe("PRJ-2026-01");
    }
    const fatturapa = getFormat("fatturapa");
    const parsed = fatturapa.parse(fatturapa.write(source));
    expect(parsed.references?.despatchAdvice).toEqual({
      number: "DA-2026-0087",
      issueDate: "2026-08-25",
    });
  });

  it("keeps the Italian stamp duty, CUP and CIG through FatturaPA", () => {
    const bollo = getFormat("fatturapa");
    const b2b = bollo.parse(bollo.write(preset("it-restaurant-b2b-fattura")));
    expect(b2b.it).toEqual({ bollo: { virtuale: "SI", amount: "2.00" } });
    const b2g = bollo.parse(bollo.write(preset("it-restaurant-b2g-fpa12")));
    expect(b2g.it).toEqual({ cup: "J51B26000120001", cig: "B12C3D4E5F" });
  });

  it("keeps the deliberate defects of the broken preset visible after a round trip", () => {
    const parsed = getFormat("ubl").parse(getFormat("ubl").write(preset("broken")));
    expect(parsed.buyer.address.country).toBe("");
    expect(parsed.totals.taxAmount).toBe("210.00");
    expect(parsed.vatBreakdown[1].reason).toBeUndefined();
  });

  it("survives XML metacharacters in text values", () => {
    const source = { ...preset("be-peppol") };
    source.lines = source.lines.map((line, index) =>
      index === 0 ? { ...line, name: "Ampersand & <tag> \"quoted\" 'apostrophe'" } : line,
    );
    const parsed = getFormat("ubl").parse(getFormat("ubl").write(source));
    expect(parsed.lines[0].name).toBe("Ampersand & <tag> \"quoted\" 'apostrophe'");
  });

  it("rejects XML that is not the expected document", () => {
    expect(() => getFormat("ubl").parse("<CreditNote/>")).toThrow(/expected an <Invoice> root/);
    expect(() => getFormat("fatturapa").parse("<Invoice/>")).toThrow(
      /expected a <FatturaElettronica> root/,
    );
    expect(() => getFormat("ubl").parse("<Invoice>")).toThrow(/ubl-parse/);
    expect(() => getFormat("cii").parse("<Invoice/>")).toThrow(
      /expected a <CrossIndustryInvoice> root/,
    );
    expect(() => getFormat("xrechnung").parse("<CreditNote/>")).toThrow(
      /expected an <Invoice> root/,
    );
  });
});
