import { describe, expect, it } from "vitest";
import { preset, PRESET_IDS } from "../src/presets";
import {
  UBL_CUSTOMIZATION_ID,
  UBL_INVOICED_OBJECT_TYPE_CODE,
  UBL_MAP,
  UBL_PROFILE_ID,
} from "../src/ubl-map";
import { parseUbl } from "../src/ubl-parse";
import { writeUbl } from "../src/ubl-write";

const XSD_ORDER = [
  "cbc:CustomizationID",
  "cbc:ProfileID",
  "cbc:ID",
  "cbc:IssueDate",
  "cbc:DueDate",
  "cbc:InvoiceTypeCode",
  "cbc:Note",
  "cbc:DocumentCurrencyCode",
  "cbc:BuyerReference",
  "cac:InvoicePeriod",
  "cac:OrderReference",
  "cac:BillingReference",
  "cac:DespatchDocumentReference",
  "cac:ReceiptDocumentReference",
  "cac:StatementDocumentReference",
  "cac:OriginatorDocumentReference",
  "cac:ContractDocumentReference",
  "cac:AdditionalDocumentReference",
  "cac:ProjectReference",
  "cac:AccountingSupplierParty",
  "cac:AccountingCustomerParty",
  "cac:Delivery",
  "cac:PaymentMeans",
  "cac:PaymentTerms",
  "cac:TaxTotal",
  "cac:LegalMonetaryTotal",
  "cac:InvoiceLine",
];

function topLevelNames(xml: string): string[] {
  return [...xml.matchAll(/^ {2}<([A-Za-z:]+)[ />]/gm)].map((match) => match[1]);
}

describe("writeUbl", () => {
  for (const id of PRESET_IDS) {
    it(`matches the golden UBL for "${id}"`, async () => {
      await expect(writeUbl(preset(id))).toMatchFileSnapshot(`./golden/${id}.ubl.xml`);
    });
  }

  it("declares the Peppol BIS Billing 3.0 identifiers", () => {
    const xml = writeUbl(preset("be-peppol"));
    expect(xml).toContain(`<cbc:CustomizationID>${UBL_CUSTOMIZATION_ID}</cbc:CustomizationID>`);
    expect(xml).toContain(`<cbc:ProfileID>${UBL_PROFILE_ID}</cbc:ProfileID>`);
    expect(xml).toContain(
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
    );
  });

  it("keeps the document children in UBL 2.1 XSD order", () => {
    for (const id of PRESET_IDS) {
      const names = topLevelNames(writeUbl(preset(id)));
      const ranks = names.map((name) => XSD_ORDER.indexOf(name));
      expect(ranks).not.toContain(-1);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });

  it("stamps the document currency on every amount", () => {
    const xml = writeUbl(preset("be-peppol"));
    const amounts = [...xml.matchAll(/<cbc:(\w*Amount)( [^>]*)?>/g)];
    expect(amounts.length).toBeGreaterThan(5);
    for (const [, , attrs] of amounts) {
      expect(attrs ?? "").toContain('currencyID="EUR"');
    }
  });

  it("carries the buyer reference and purchase order needed by PEPPOL-EN16931-R003", () => {
    const xml = writeUbl(preset("be-peppol"));
    expect(xml).toContain("<cbc:BuyerReference>BR-2026-77</cbc:BuyerReference>");
    expect(xml).toContain("<cbc:ID>PO-BE-2026-014</cbc:ID>");
  });

  it("puts every document reference at its EN 16931 UBL path", () => {
    const lyon = writeUbl(preset("fr-store-b2b-facturx"));
    expect(lyon).toContain("<cbc:BuyerReference>CHANTIER-2026-118</cbc:BuyerReference>");
    expect(lyon).toContain(
      "<cac:OrderReference>\n    <cbc:ID>BC-2026-0451</cbc:ID>\n" +
        "    <cbc:SalesOrderID>CDE-RM-2026-1187</cbc:SalesOrderID>\n  </cac:OrderReference>",
    );
    expect(lyon).toContain(
      "<cac:DespatchDocumentReference>\n    <cbc:ID>BL-2026-0873</cbc:ID>\n" +
        "  </cac:DespatchDocumentReference>",
    );

    const rome = writeUbl(preset("it-restaurant-b2g-fpa12"));
    expect(rome).toContain(
      "<cac:OriginatorDocumentReference>\n    <cbc:ID>CONV-MIC-2026-0042</cbc:ID>\n" +
        "  </cac:OriginatorDocumentReference>",
    );
    expect(rome).toContain(
      "<cac:ContractDocumentReference>\n    <cbc:ID>CTR-MIC-2026-0088</cbc:ID>\n" +
        "  </cac:ContractDocumentReference>",
    );

    const munich = writeUbl(preset("de-hotel-b2b-zugferd"));
    expect(munich).toContain(
      "<cac:AdditionalDocumentReference>\n    <cbc:ID>FOLIO-2026-004182</cbc:ID>\n" +
        `    <cbc:DocumentTypeCode>${UBL_INVOICED_OBJECT_TYPE_CODE}</cbc:DocumentTypeCode>\n` +
        "  </cac:AdditionalDocumentReference>",
    );
    expect(UBL_INVOICED_OBJECT_TYPE_CODE).toBe("130");

    const commune = writeUbl(preset("fr-store-b2g-chorus"));
    expect(commune).toContain(
      "<cac:ProjectReference>\n    <cbc:ID>GYMNASE-2026</cbc:ID>\n  </cac:ProjectReference>",
    );
  });

  it("never writes a sales order without the purchase order cac:OrderReference requires", () => {
    for (const id of PRESET_IDS) {
      const references = preset(id).references ?? {};
      if (references.salesOrder) expect(references.purchaseOrder, id).toBeTruthy();
    }
  });

  it("reads every reference back out of its own UBL", () => {
    for (const id of PRESET_IDS) {
      const source = preset(id);
      const references = source.references;
      const parsed = parseUbl(writeUbl(source));
      expect(parsed.references, id).toEqual(
        references && {
          ...references,
          despatchAdvice: references.despatchAdvice && {
            number: references.despatchAdvice.number,
          },
        },
      );
    }
  });

  it("emits an exempt line with its VAT breakdown reason", () => {
    const xml = writeUbl(preset("it-b2b-sdi"));
    expect(xml).toContain("<cbc:ID>E</cbc:ID>");
    const reason = preset("it-b2b-sdi").vatBreakdown.find((row) => row.natura === "N3.5")!.reason!;
    const escaped = reason.replace(/'/g, "&apos;");
    expect(xml).toContain(`<cbc:TaxExemptionReason>${escaped}</cbc:TaxExemptionReason>`);
  });

  it("omits empty elements rather than writing blanks", () => {
    const xml = writeUbl(preset("broken"));
    expect(xml).not.toMatch(/<cbc:\w+\/>/);
    expect(xml).not.toContain("<cbc:IdentificationCode></cbc:IdentificationCode>");
  });

  it("only emits element names that exist in the mapping table", () => {
    const declared = new Set(
      UBL_MAP.map((row) => row.path.split("/").pop() ?? "").filter((name) => !name.startsWith("@")),
    );
    const structural = new Set([
      "Invoice",
      "cac:OrderReference",
      "cac:BillingReference",
      "cac:InvoiceDocumentReference",
      "cac:DespatchDocumentReference",
      "cac:OriginatorDocumentReference",
      "cac:ContractDocumentReference",
      "cac:AdditionalDocumentReference",
      "cac:ProjectReference",
      "cac:AccountingSupplierParty",
      "cac:AccountingCustomerParty",
      "cac:Delivery",
      "cac:Party",
      "cac:PartyName",
      "cac:PostalAddress",
      "cac:Country",
      "cac:PartyTaxScheme",
      "cac:PartyLegalEntity",
      "cac:Contact",
      "cac:TaxScheme",
      "cac:PaymentMeans",
      "cac:PayeeFinancialAccount",
      "cac:FinancialInstitutionBranch",
      "cac:PaymentTerms",
      "cac:TaxTotal",
      "cac:TaxSubtotal",
      "cac:TaxCategory",
      "cac:LegalMonetaryTotal",
      "cac:InvoiceLine",
      "cac:Item",
      "cac:ClassifiedTaxCategory",
      "cac:Price",
      "cbc:ID",
    ]);
    for (const id of PRESET_IDS) {
      const emitted = [...writeUbl(preset(id)).matchAll(/<([A-Za-z][\w:]*)[ />]/g)].map(
        (match) => match[1],
      );
      for (const name of emitted) {
        expect(declared.has(name) || structural.has(name)).toBe(true);
      }
    }
  });
});
