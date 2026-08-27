import { describe, expect, it } from "vitest";
import { FATTURAPA_MAP } from "../src/fatturapa-map";
import { getFormat } from "../src/formats";
import { preset } from "../src/presets";
import { UBL_MAP } from "../src/ubl-map";
import {
  buildFieldIndex,
  indexXml,
  pathAtOffset,
  rangeForPath,
  type XmlIndex,
} from "../src/xml-locate";
import goldenFatturapa from "./golden/it-b2b-sdi.fatturapa.xml?raw";
import goldenUbl from "./golden/be-peppol.ubl.xml?raw";

function slice(xml: string, index: XmlIndex, path: string): string {
  const range = rangeForPath(index, path);
  if (!range) throw new Error(`no range for ${path}`);
  return xml.slice(range.from, range.to);
}

describe("indexXml", () => {
  const index = indexXml(goldenUbl);

  it("addresses every element by its mapping-table path", () => {
    expect(slice(goldenUbl, index, "Invoice/cbc:ID")).toBe("<cbc:ID>BE-INV-2026-0007</cbc:ID>");
    expect(slice(goldenUbl, index, "Invoice/cbc:IssueDate")).toBe(
      "<cbc:IssueDate>2026-08-26</cbc:IssueDate>",
    );
    expect(
      slice(
        goldenUbl,
        index,
        "Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID",
      ),
    ).toBe("<cbc:CompanyID>BE0999999922</cbc:CompanyID>");
  });

  it("gives a character range, not a whole row", () => {
    const range = rangeForPath(index, "Invoice/cbc:ID");
    const line = goldenUbl.slice(0, range?.from).split("\n").pop();
    expect(line).toBe("  ");
    expect(range?.to).toBeGreaterThan(range?.from ?? 0);
  });

  it("indexes repeated elements with a zero-based occurrence", () => {
    expect(slice(goldenUbl, index, "Invoice/cac:InvoiceLine/cbc:ID")).toBe("<cbc:ID>1</cbc:ID>");
    expect(slice(goldenUbl, index, "Invoice/cac:InvoiceLine[1]/cbc:ID")).toBe("<cbc:ID>2</cbc:ID>");
    expect(slice(goldenUbl, index, "Invoice/cac:InvoiceLine[0]/cbc:ID")).toBe("<cbc:ID>1</cbc:ID>");
  });

  it("indexes attributes separately from their element", () => {
    expect(slice(goldenUbl, index, "Invoice/cac:InvoiceLine/cbc:InvoicedQuantity/@unitCode")).toBe(
      'unitCode="HUR"',
    );
  });

  it("keeps the namespace prefix of the FatturaPA root", () => {
    const fatturapa = indexXml(goldenFatturapa);
    expect(
      slice(
        goldenFatturapa,
        fatturapa,
        "p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/IdFiscaleIVA",
      ),
    ).toContain("<IdCodice>01234567890</IdCodice>");
  });

  it("resolves an offset back to the innermost element path", () => {
    const range = rangeForPath(index, "Invoice/cbc:IssueDate");
    expect(pathAtOffset(index, (range?.from ?? 0) + 3)).toBe("Invoice/cbc:IssueDate");
  });

  it("resolves an offset inside an attribute to the attribute path", () => {
    const range = rangeForPath(index, "Invoice/cac:InvoiceLine/cbc:InvoicedQuantity/@unitCode");
    expect(pathAtOffset(index, (range?.from ?? 0) + 2)).toBe(
      "Invoice/cac:InvoiceLine/cbc:InvoicedQuantity/@unitCode",
    );
  });

  it("returns nothing for a path the document does not carry", () => {
    expect(rangeForPath(index, "Invoice/cbc:Nope")).toBeUndefined();
    expect(rangeForPath(index, undefined)).toBeUndefined();
  });
});

describe("buildFieldIndex", () => {
  const invoice = preset("be-peppol");
  const index = buildFieldIndex(invoice, UBL_MAP);
  const italian = preset("it-b2b-sdi");
  const fpaIndex = buildFieldIndex(italian, FATTURAPA_MAP);

  it("resolves a field to the path of its mapping row", () => {
    expect(index.entry("number")).toMatchObject({ path: "Invoice/cbc:ID", bt: "BT-1" });
  });

  it("expands indexed rows over the invoice collections", () => {
    expect(index.entry("lines.1.netAmount").path).toBe(
      "Invoice/cac:InvoiceLine[1]/cbc:LineExtensionAmount",
    );
    expect(index.entry(`lines.${invoice.lines.length}.netAmount`).path).toBeUndefined();
  });

  it("collapses a group of rows to their common ancestor", () => {
    expect(fpaIndex.entry("seller.vatId")).toMatchObject({
      path: "p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/IdFiscaleIVA",
      bt: "BT-31",
      fpa: "1.2.1.1",
    });
    expect(fpaIndex.entry("seller.address")).toMatchObject({
      path: "p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Sede",
      fpa: "1.2.2",
    });
    expect(fpaIndex.entry("seller.address").bt).toMatch(/^BT-35…40$/);
  });

  it("selects a whole line from the composite field id", () => {
    expect(index.entry("lines.2").path).toBeUndefined();
    expect(index.entry("lines.1").path).toBe("Invoice/cac:InvoiceLine[1]");
    expect(fpaIndex.entry("vatBreakdown.2").path).toBe(
      "p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo[2]",
    );
  });

  it("prefers the row carrying a business term when two blocks share a field", () => {
    expect(fpaIndex.entry("number")).toMatchObject({
      path: "p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/Numero",
      bt: "BT-1",
      fpa: "2.1.1.4",
    });
  });

  it("maps an XML path back to the field it carries", () => {
    expect(index.fieldForPath("Invoice/cbc:ID")).toBe("number");
    expect(index.fieldForPath("Invoice/cac:InvoiceLine[1]/cbc:LineExtensionAmount")).toBe(
      "lines.1.netAmount",
    );
  });

  it("walks into a container and up from an unmapped leaf", () => {
    expect(
      fpaIndex.fieldForPath("p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore"),
    ).toBe("seller.vatId");
    expect(index.fieldForPath("Invoice/cac:InvoiceLine[1]/cac:Item/cbc:Name/nope")).toBe(
      "lines.1.name",
    );
    expect(index.fieldForPath("Nothing")).toBeUndefined();
  });

  it("round trips every mapped field of the golden invoices through the XML index", () => {
    for (const [formatId, map, xml] of [
      ["ubl", UBL_MAP, getFormat("ubl").write(invoice)],
      ["fatturapa", FATTURAPA_MAP, getFormat("fatturapa").write(italian)],
    ] as const) {
      const fields = buildFieldIndex(formatId === "ubl" ? invoice : italian, map);
      const xmlIndex = indexXml(xml);
      const checked = map
        .map((row) => row.field)
        .filter((field) => field && !field.includes("{i}"))
        .map((field) => fields.entry(field))
        .filter((entry) => entry.path && rangeForPath(xmlIndex, entry.path));
      expect(checked.length).toBeGreaterThan(20);
      for (const entry of checked) {
        const path = entry.path as string;
        const range = rangeForPath(xmlIndex, path);
        expect(pathAtOffset(xmlIndex, (range?.from ?? 0) + 1)?.startsWith(path)).toBe(true);
      }
    }
  });
});
