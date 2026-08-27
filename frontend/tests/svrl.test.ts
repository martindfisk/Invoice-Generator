import { describe, expect, it } from "vitest";
import { normaliseLocation, parseSvrl, severityOf } from "../src/svrl";
import { indexXml, rangeForPath } from "../src/xml-locate";
import goldenUbl from "./golden/broken.ubl.xml?raw";

const INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const CAC_NS = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const CBC_NS = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

// Verbatim shapes produced by SaxonJS 2.7: the first three come from the ISO Schematron
// skeleton (CEN / Peppol), the last two from SchXslt (KoSIT XRechnung 2.5.0).
const SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<svrl:schematron-output xmlns:cac="${CAC_NS}" xmlns:cbc="${CBC_NS}" xmlns:svrl="http://purl.oclc.org/dsdl/svrl" xmlns:ubl="${INVOICE_NS}" title="EN16931 model bound to UBL">
   <svrl:active-pattern document="" id="UBL-model" name="UBL-model"/>
   <svrl:fired-rule context="/ubl:Invoice | /cn:CreditNote"/>
   <svrl:fired-rule context="cac:AccountingSupplierParty"/>
   <svrl:failed-assert test="normalize-space(cac:Country/cbc:IdentificationCode) != ''" id="BR-11" flag="fatal" location="/*:Invoice[namespace-uri()='${INVOICE_NS}'][1]/*:AccountingCustomerParty[namespace-uri()='${CAC_NS}'][1]/*:Party[namespace-uri()='${CAC_NS}'][1]/*:PostalAddress[namespace-uri()='${CAC_NS}'][1]">
      <svrl:text>[BR-11]-The Buyer postal address shall contain a Buyer country code (BT-55).</svrl:text>
   </svrl:failed-assert>
   <svrl:failed-assert test="count(cbc:Note) &lt;= 1" id="BR-E-10" flag="warning" location="/*:Invoice[namespace-uri()='${INVOICE_NS}'][1]/*:TaxTotal[namespace-uri()='${CAC_NS}'][1]/*:TaxSubtotal[namespace-uri()='${CAC_NS}'][2]/*:TaxCategory[namespace-uri()='${CAC_NS}'][1]">
      <svrl:text>
        [BR-E-10]-An Invoice that contains a VAT breakdown group (BG-23) with a VAT category
        code (BT-118) "Exempt from VAT" shall have a VAT exemption reason.
      </svrl:text>
   </svrl:failed-assert>
   <svrl:successful-report test="cbc:TaxCurrencyCode" id="PEPPOL-EN16931-R053" location="/*:Invoice[namespace-uri()='${INVOICE_NS}'][1]/*:LegalMonetaryTotal[namespace-uri()='${CAC_NS}'][1]">
      <svrl:text>Only one tax total with tax subtotals MUST be provided.</svrl:text>
   </svrl:successful-report>
   <svrl:failed-assert location="/Q{${INVOICE_NS}}Invoice[1]" flag="warning" id="BR-DE-21" test="cbc:CustomizationID = $XR-CIUS-ID">
      <svrl:text>[BR-DE-21] Das Element "Specification identifier" (BT-24) soll syntaktisch der Kennung des Standards XRechnung entsprechen.</svrl:text>
   </svrl:failed-assert>
   <svrl:failed-assert location="/Q{${INVOICE_NS}}Invoice[1]/Q{${CAC_NS}}PaymentMeans[1]" flag="information" id="BR-DE-TMP-32" test="cac:Delivery/cbc:ActualDeliveryDate">
      <svrl:text>[BR-DE-TMP-32] Eine Rechnung sollte ein Liefer-/Leistungsdatum enthalten.</svrl:text>
   </svrl:failed-assert>
</svrl:schematron-output>`;

describe("normaliseLocation", () => {
  it("turns the ISO skeleton form into the project's prefixed path", () => {
    expect(
      normaliseLocation(
        `/*:Invoice[namespace-uri()='${INVOICE_NS}'][1]/*:LegalMonetaryTotal[namespace-uri()='${CAC_NS}'][1]`,
      ),
    ).toBe("Invoice/cac:LegalMonetaryTotal");
  });

  it("turns the SchXslt Q{} form into the project's prefixed path", () => {
    expect(normaliseLocation(`/Q{${INVOICE_NS}}Invoice[1]/Q{${CAC_NS}}PaymentMeans[1]`)).toBe(
      "Invoice/cac:PaymentMeans",
    );
  });

  it("rebases Saxon's 1-based position on the 0-based occurrence xml-locate uses", () => {
    expect(
      normaliseLocation(`/Q{${INVOICE_NS}}Invoice[1]/Q{${CAC_NS}}InvoiceLine[2]/Q{${CBC_NS}}ID[1]`),
    ).toBe("Invoice/cac:InvoiceLine[1]/cbc:ID");
    expect(normaliseLocation(`/Q{${INVOICE_NS}}Invoice[1]/Q{${CAC_NS}}InvoiceLine[1]`)).toBe(
      "Invoice/cac:InvoiceLine",
    );
  });

  it("does not split on the slashes inside a namespace URI", () => {
    expect(
      normaliseLocation(
        "/*:FatturaElettronica[namespace-uri()='http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2'][1]/*:FatturaElettronicaBody[namespace-uri()=''][1]",
      ),
    ).toBe("p:FatturaElettronica/FatturaElettronicaBody");
  });

  it("keeps CII prefixes and unknown namespaces readable", () => {
    expect(
      normaliseLocation(
        "/Q{urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100}CrossIndustryInvoice[1]/Q{urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100}IncludedSupplyChainTradeLineItem[3]",
      ),
    ).toBe("rsm:CrossIndustryInvoice/ram:IncludedSupplyChainTradeLineItem[2]");
    expect(normaliseLocation("/Q{urn:example:nope}Thing[1]")).toBe("Thing");
  });

  it("passes an attribute step through", () => {
    expect(normaliseLocation(`/Q{${INVOICE_NS}}Invoice[1]/@versione`)).toBe("Invoice/@versione");
  });

  it("returns nothing for an empty or unparseable location", () => {
    expect(normaliseLocation(undefined)).toBeUndefined();
    expect(normaliseLocation("")).toBeUndefined();
    expect(normaliseLocation("/*[self::a or self::b]")).toBeUndefined();
  });
});

describe("severityOf", () => {
  it("maps the SVRL flag, defaulting to error", () => {
    expect(severityOf("fatal")).toBe("fatal");
    expect(severityOf("warning")).toBe("warning");
    expect(severityOf("information")).toBe("info");
    expect(severityOf(null)).toBe("error");
    expect(severityOf("something-else")).toBe("error");
  });
});

describe("parseSvrl", () => {
  const findings = parseSvrl(SAMPLE);

  it("reads every failed assert and successful report in document order", () => {
    expect(findings.map((finding) => finding.ruleId)).toEqual([
      "BR-11",
      "BR-E-10",
      "PEPPOL-EN16931-R053",
      "BR-DE-21",
      "BR-DE-TMP-32",
    ]);
    expect(findings.map((finding) => finding.kind)).toEqual([
      "failed-assert",
      "failed-assert",
      "successful-report",
      "failed-assert",
      "failed-assert",
    ]);
  });

  it("carries rule id, severity, message, test and normalised path", () => {
    expect(findings[0]).toMatchObject({
      ruleId: "BR-11",
      severity: "fatal",
      message: "[BR-11]-The Buyer postal address shall contain a Buyer country code (BT-55).",
      test: "normalize-space(cac:Country/cbc:IdentificationCode) != ''",
      xpath: "Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress",
    });
    expect(findings[1].severity).toBe("warning");
    expect(findings[1].xpath).toBe("Invoice/cac:TaxTotal/cac:TaxSubtotal[1]/cac:TaxCategory");
    expect(findings[1].message).toMatch(/^\[BR-E-10\]-An Invoice .* exemption reason\.$/);
    expect(findings[2].severity).toBe("error");
    expect(findings[4].severity).toBe("info");
  });

  it("rejects an SVRL document that is not well-formed", () => {
    expect(() => parseSvrl("<svrl:schematron-output>")).toThrow(/not well-formed/);
  });

  it("resolves a normalised location back to a character range in the invoice", () => {
    const index = indexXml(goldenUbl);
    for (const finding of findings.slice(0, 3)) {
      expect(
        rangeForPath(index, finding.xpath),
        `${finding.ruleId} -> ${finding.xpath}`,
      ).toBeDefined();
    }
    const range = rangeForPath(index, findings[0].xpath);
    expect(goldenUbl.slice(range?.from ?? 0, range?.to ?? 0)).toContain("<cac:PostalAddress>");
  });
});
