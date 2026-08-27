import { describe, expect, it } from "vitest";
import type { VatBreakdownRow } from "../src/model";
import { preset, PRESET_IDS } from "../src/presets";
import { UBL_CUSTOMIZATION_ID, UBL_MAP, UBL_PROFILE_ID } from "../src/ubl-map";
import { parseUbl } from "../src/ubl-parse";
import { writeUbl } from "../src/ubl-write";
import {
  XRECHNUNG_CUSTOMIZATION_ID,
  XRECHNUNG_LEITWEG_SCHEME,
  XRECHNUNG_MAP,
} from "../src/xrechnung-map";
import { parseXrechnung } from "../src/xrechnung-parse";
import { writeXrechnung } from "../src/xrechnung-write";

const LEITWEG_ID = "991-01234-56";

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

describe("writeXrechnung", () => {
  it('matches the golden XRechnung for "de-hotel-b2g-xrechnung"', async () => {
    await expect(writeXrechnung(preset("de-hotel-b2g-xrechnung"))).toMatchFileSnapshot(
      "./golden/de-hotel-b2g-xrechnung.xrechnung.xml",
    );
  });

  it("declares the XRechnung 3.0.2 CustomizationID and leaves the ProfileID unchanged", () => {
    expect(XRECHNUNG_CUSTOMIZATION_ID).toBe(
      "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
    );
    for (const id of PRESET_IDS) {
      const xml = writeXrechnung(preset(id));
      expect(xml).toContain(
        `<cbc:CustomizationID>${XRECHNUNG_CUSTOMIZATION_ID}</cbc:CustomizationID>`,
      );
      expect(xml).toContain(`<cbc:ProfileID>${UBL_PROFILE_ID}</cbc:ProfileID>`);
      expect(xml).not.toContain(UBL_CUSTOMIZATION_ID);
    }
  });

  it("carries the Leitweg-ID in the mandatory BT-10 buyer reference (BR-DE-15)", () => {
    const source = preset("de-hotel-b2g-xrechnung");
    expect(source.references?.buyerReference).toBe(LEITWEG_ID);
    expect(source.buyer.electronicAddress).toEqual({
      scheme: XRECHNUNG_LEITWEG_SCHEME,
      id: LEITWEG_ID,
    });

    const xml = writeXrechnung(source);
    expect(xml).toContain(`<cbc:BuyerReference>${LEITWEG_ID}</cbc:BuyerReference>`);
    expect(xml).toContain(`<cbc:EndpointID schemeID="0204">${LEITWEG_ID}</cbc:EndpointID>`);
    expect(parseXrechnung(xml).references?.buyerReference).toBe(LEITWEG_ID);
  });

  it("carries the seller contact point, telephone and email required by BR-DE-5/6/7", () => {
    const xml = writeXrechnung(preset("de-hotel-b2g-xrechnung"));
    const contact = /<cac:Contact>[\s\S]*?<\/cac:Contact>/.exec(xml)![0];
    expect(contact).toContain("<cbc:Name>Rechnungswesen</cbc:Name>");
    expect(contact).toContain("<cbc:Telephone>+49 89 5551200</cbc:Telephone>");
    expect(contact).toContain(
      "<cbc:ElectronicMail>rechnung@hotel-isartor.example</cbc:ElectronicMail>",
    );
  });

  it("is the Peppol UBL writer with one line changed, not a copy", () => {
    for (const id of PRESET_IDS) {
      const peppol = writeUbl(preset(id)).split("\n");
      const xrechnung = writeXrechnung(preset(id)).split("\n");
      const differences = peppol
        .map((line, index) => [line, xrechnung[index]])
        .filter(([left, right]) => left !== right);
      expect(differences).toHaveLength(1);
      expect(differences[0][0]).toContain("cbc:CustomizationID");
    }
  });

  it("reuses the UBL mapping paths and only relabels the CIUS-specific terms", () => {
    expect(XRECHNUNG_MAP.map((row) => row.path)).toEqual(UBL_MAP.map((row) => row.path));
    expect(XRECHNUNG_MAP.map((row) => row.field)).toEqual(UBL_MAP.map((row) => row.field));
    const byBt = new Map(XRECHNUNG_MAP.map((row) => [row.bt, row.label]));
    expect(byBt.get("BT-24")).toContain("XRechnung 3.0.2");
    expect(byBt.get("BT-10")).toContain("Leitweg-ID");
    expect(byBt.get("BT-1")).toBe("Invoice number");
  });

  it("parses back into an xrechnung-flavoured invoice", () => {
    const source = preset("de-hotel-b2g-xrechnung");
    const parsed = parseXrechnung(writeXrechnung(source));
    expect(parsed.format).toBe("xrechnung");
    expect(parseUbl(writeXrechnung(source)).format).toBe("ubl");
    expect(parsed.lines).toEqual(source.lines);
    expect(parsed.totals).toEqual(source.totals);
    expect(parsed.vatBreakdown).toEqual(syntaxLevelBreakdown(source.vatBreakdown));
  });
});
