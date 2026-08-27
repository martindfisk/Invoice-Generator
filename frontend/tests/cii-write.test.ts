import { describe, expect, it } from "vitest";
import {
  CII_GUIDELINE_ID,
  CII_INVOICED_OBJECT_TYPE_CODE,
  CII_MAP,
  CII_TENDER_TYPE_CODE,
  ciiDate,
  isoDate,
} from "../src/cii-map";
import { parseCii } from "../src/cii-parse";
import { writeCii } from "../src/cii-write";
import { preset, PRESET_IDS } from "../src/presets";

const CII_GOLDEN_PRESETS = ["de-hotel-b2b-zugferd", "fr-store-b2b-facturx"] as const;

const SEQUENCES: Record<string, string[]> = {
  CrossIndustryInvoice: [
    "ExchangedDocumentContext",
    "ExchangedDocument",
    "SupplyChainTradeTransaction",
  ],
  ExchangedDocumentContext: [
    "BusinessProcessSpecifiedDocumentContextParameter",
    "GuidelineSpecifiedDocumentContextParameter",
  ],
  GuidelineSpecifiedDocumentContextParameter: ["ID"],
  ExchangedDocument: ["ID", "TypeCode", "IssueDateTime", "IncludedNote"],
  IncludedNote: ["Content", "SubjectCode"],
  IssueDateTime: ["DateTimeString"],
  DueDateDateTime: ["DateTimeString"],
  FormattedIssueDateTime: ["DateTimeString"],
  SupplyChainTradeTransaction: [
    "IncludedSupplyChainTradeLineItem",
    "ApplicableHeaderTradeAgreement",
    "ApplicableHeaderTradeDelivery",
    "ApplicableHeaderTradeSettlement",
  ],
  IncludedSupplyChainTradeLineItem: [
    "AssociatedDocumentLineDocument",
    "SpecifiedTradeProduct",
    "SpecifiedLineTradeAgreement",
    "SpecifiedLineTradeDelivery",
    "SpecifiedLineTradeSettlement",
  ],
  AssociatedDocumentLineDocument: ["LineID", "IncludedNote"],
  SpecifiedTradeProduct: [
    "GlobalID",
    "SellerAssignedID",
    "BuyerAssignedID",
    "Name",
    "Description",
    "ApplicableProductCharacteristic",
    "DesignatedProductClassification",
    "OriginTradeCountry",
  ],
  SpecifiedLineTradeAgreement: [
    "BuyerOrderReferencedDocument",
    "GrossPriceProductTradePrice",
    "NetPriceProductTradePrice",
  ],
  NetPriceProductTradePrice: ["ChargeAmount", "BasisQuantity", "AppliedTradeAllowanceCharge"],
  SpecifiedLineTradeDelivery: ["BilledQuantity"],
  SpecifiedLineTradeSettlement: [
    "ApplicableTradeTax",
    "BillingSpecifiedPeriod",
    "SpecifiedTradeAllowanceCharge",
    "SpecifiedTradeSettlementLineMonetarySummation",
    "AdditionalReferencedDocument",
    "ReceivableSpecifiedTradeAccountingAccount",
  ],
  ApplicableTradeTax: [
    "CalculatedAmount",
    "TypeCode",
    "ExemptionReason",
    "BasisAmount",
    "CategoryCode",
    "ExemptionReasonCode",
    "TaxPointDate",
    "DueDateTypeCode",
    "RateApplicablePercent",
  ],
  SpecifiedTradeSettlementLineMonetarySummation: ["LineTotalAmount"],
  ApplicableHeaderTradeAgreement: [
    "BuyerReference",
    "SellerTradeParty",
    "BuyerTradeParty",
    "SellerTaxRepresentativeTradeParty",
    "SellerOrderReferencedDocument",
    "BuyerOrderReferencedDocument",
    "ContractReferencedDocument",
    "AdditionalReferencedDocument",
    "SpecifiedProcuringProject",
  ],
  SellerTradeParty: [
    "ID",
    "GlobalID",
    "Name",
    "Description",
    "SpecifiedLegalOrganization",
    "DefinedTradeContact",
    "PostalTradeAddress",
    "URIUniversalCommunication",
    "SpecifiedTaxRegistration",
  ],
  BuyerTradeParty: [
    "ID",
    "GlobalID",
    "Name",
    "Description",
    "SpecifiedLegalOrganization",
    "DefinedTradeContact",
    "PostalTradeAddress",
    "URIUniversalCommunication",
    "SpecifiedTaxRegistration",
  ],
  SpecifiedLegalOrganization: ["ID", "TradingBusinessName"],
  DefinedTradeContact: [
    "PersonName",
    "DepartmentName",
    "TelephoneUniversalCommunication",
    "EmailURIUniversalCommunication",
  ],
  TelephoneUniversalCommunication: ["URIID", "CompleteNumber"],
  EmailURIUniversalCommunication: ["URIID", "CompleteNumber"],
  URIUniversalCommunication: ["URIID", "CompleteNumber"],
  PostalTradeAddress: [
    "PostcodeCode",
    "LineOne",
    "LineTwo",
    "LineThree",
    "CityName",
    "CountryID",
    "CountrySubDivisionName",
  ],
  SpecifiedTaxRegistration: ["ID"],
  SellerOrderReferencedDocument: [
    "IssuerAssignedID",
    "URIID",
    "LineID",
    "TypeCode",
    "Name",
    "AttachmentBinaryObject",
    "ReferenceTypeCode",
    "FormattedIssueDateTime",
  ],
  AdditionalReferencedDocument: [
    "IssuerAssignedID",
    "URIID",
    "LineID",
    "TypeCode",
    "Name",
    "AttachmentBinaryObject",
    "ReferenceTypeCode",
    "FormattedIssueDateTime",
  ],
  DespatchAdviceReferencedDocument: [
    "IssuerAssignedID",
    "URIID",
    "LineID",
    "TypeCode",
    "Name",
    "AttachmentBinaryObject",
    "ReferenceTypeCode",
    "FormattedIssueDateTime",
  ],
  SpecifiedProcuringProject: ["ID", "Name"],
  BuyerOrderReferencedDocument: [
    "IssuerAssignedID",
    "URIID",
    "LineID",
    "TypeCode",
    "Name",
    "AttachmentBinaryObject",
    "ReferenceTypeCode",
    "FormattedIssueDateTime",
  ],
  ContractReferencedDocument: [
    "IssuerAssignedID",
    "URIID",
    "LineID",
    "TypeCode",
    "Name",
    "AttachmentBinaryObject",
    "ReferenceTypeCode",
    "FormattedIssueDateTime",
  ],
  InvoiceReferencedDocument: [
    "IssuerAssignedID",
    "URIID",
    "LineID",
    "TypeCode",
    "Name",
    "AttachmentBinaryObject",
    "ReferenceTypeCode",
    "FormattedIssueDateTime",
  ],
  ApplicableHeaderTradeDelivery: [
    "ShipToTradeParty",
    "ActualDeliverySupplyChainEvent",
    "DespatchAdviceReferencedDocument",
    "ReceivingAdviceReferencedDocument",
  ],
  ApplicableHeaderTradeSettlement: [
    "CreditorReferenceID",
    "PaymentReference",
    "TaxCurrencyCode",
    "InvoiceCurrencyCode",
    "PayeeTradeParty",
    "SpecifiedTradeSettlementPaymentMeans",
    "ApplicableTradeTax",
    "BillingSpecifiedPeriod",
    "SpecifiedTradeAllowanceCharge",
    "SpecifiedTradePaymentTerms",
    "SpecifiedTradeSettlementHeaderMonetarySummation",
    "InvoiceReferencedDocument",
    "ReceivableSpecifiedTradeAccountingAccount",
  ],
  SpecifiedTradeSettlementPaymentMeans: [
    "TypeCode",
    "Information",
    "ApplicableTradeSettlementFinancialCard",
    "PayerPartyDebtorFinancialAccount",
    "PayeePartyCreditorFinancialAccount",
    "PayeeSpecifiedCreditorFinancialInstitution",
  ],
  PayeePartyCreditorFinancialAccount: ["IBANID", "AccountName", "ProprietaryID"],
  PayeeSpecifiedCreditorFinancialInstitution: ["BICID"],
  SpecifiedTradePaymentTerms: ["Description", "DueDateDateTime", "DirectDebitMandateID"],
  SpecifiedTradeSettlementHeaderMonetarySummation: [
    "LineTotalAmount",
    "ChargeTotalAmount",
    "AllowanceTotalAmount",
    "TaxBasisTotalAmount",
    "TaxTotalAmount",
    "RoundingAmount",
    "GrandTotalAmount",
    "TotalPrepaidAmount",
    "DuePayableAmount",
  ],
};

const STRUCTURAL = new Set([
  "rsm:CrossIndustryInvoice",
  "rsm:ExchangedDocumentContext",
  "rsm:ExchangedDocument",
  "rsm:SupplyChainTradeTransaction",
  "ram:GuidelineSpecifiedDocumentContextParameter",
  "ram:IssueDateTime",
  "ram:IncludedNote",
  "ram:IncludedSupplyChainTradeLineItem",
  "ram:AssociatedDocumentLineDocument",
  "ram:SpecifiedTradeProduct",
  "ram:SpecifiedLineTradeAgreement",
  "ram:NetPriceProductTradePrice",
  "ram:SpecifiedLineTradeDelivery",
  "ram:SpecifiedLineTradeSettlement",
  "ram:ApplicableTradeTax",
  "ram:TypeCode",
  "ram:SpecifiedTradeSettlementLineMonetarySummation",
  "ram:ApplicableHeaderTradeAgreement",
  "ram:SellerTradeParty",
  "ram:BuyerTradeParty",
  "ram:SpecifiedLegalOrganization",
  "ram:DefinedTradeContact",
  "ram:TelephoneUniversalCommunication",
  "ram:EmailURIUniversalCommunication",
  "ram:PostalTradeAddress",
  "ram:URIUniversalCommunication",
  "ram:SpecifiedTaxRegistration",
  "ram:SellerOrderReferencedDocument",
  "ram:BuyerOrderReferencedDocument",
  "ram:ContractReferencedDocument",
  "ram:AdditionalReferencedDocument",
  "ram:SpecifiedProcuringProject",
  "ram:DespatchAdviceReferencedDocument",
  "ram:ApplicableHeaderTradeDelivery",
  "ram:ApplicableHeaderTradeSettlement",
  "ram:SpecifiedTradeSettlementPaymentMeans",
  "ram:PayeePartyCreditorFinancialAccount",
  "ram:PayeeSpecifiedCreditorFinancialInstitution",
  "ram:SpecifiedTradePaymentTerms",
  "ram:DueDateDateTime",
  "ram:SpecifiedTradeSettlementHeaderMonetarySummation",
  "ram:InvoiceReferencedDocument",
  "ram:FormattedIssueDateTime",
]);

function elements(xml: string): Element[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const all: Element[] = [];
  const walk = (element: Element) => {
    all.push(element);
    for (const child of Array.from(element.children)) walk(child);
  };
  walk(document.documentElement);
  return all;
}

function expectOrdered(element: Element): void {
  const sequence = SEQUENCES[element.localName];
  if (!sequence) return;
  const ranks = Array.from(element.children).map((child) => sequence.indexOf(child.localName));
  expect(ranks, `${element.localName} has an unexpected child`).not.toContain(-1);
  expect(
    [...ranks].sort((a, b) => a - b),
    `${element.localName} children out of order`,
  ).toEqual(ranks);
}

describe("writeCii", () => {
  for (const id of CII_GOLDEN_PRESETS) {
    it(`matches the golden CII for "${id}"`, async () => {
      await expect(writeCii(preset(id))).toMatchFileSnapshot(`./golden/${id}.cii.xml`);
    });
  }

  it("declares the CII D16B namespaces and the EN 16931 guideline identifier", () => {
    const xml = writeCii(preset("de-hotel-b2b-zugferd"));
    expect(xml).toContain(
      '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
    );
    expect(xml).toContain(
      'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
    );
    expect(xml).toContain(
      'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"',
    );
    expect(xml).toContain(`<ram:ID>${CII_GUIDELINE_ID}</ram:ID>`);
    expect(CII_GUIDELINE_ID).toBe("urn:cen.eu:en16931:2017");
  });

  it("keeps every group in the Factur-X 1.08 EN16931 XSD sequence order", () => {
    for (const id of PRESET_IDS) {
      for (const element of elements(writeCii(preset(id)))) expectOrdered(element);
    }
  });

  it("writes dates as UN/EDIFACT format 102 and reads them back as ISO 8601", () => {
    const xml = writeCii(preset("de-hotel-b2b-zugferd"));
    expect(xml).toContain('<udt:DateTimeString format="102">20260826</udt:DateTimeString>');
    expect(xml).toContain('<udt:DateTimeString format="102">20260909</udt:DateTimeString>');
    expect(ciiDate("2026-08-26")).toBe("20260826");
    expect(isoDate("20260826")).toBe("2026-08-26");
    expect(parseCii(xml).issueDate).toBe("2026-08-26");
  });

  it("stamps a currency only on the total VAT amount, as EN 16931 CII requires", () => {
    const xml = writeCii(preset("fr-store-b2b-facturx"));
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">114.40</ram:TaxTotalAmount>');
    expect([...xml.matchAll(/currencyID=/g)]).toHaveLength(1);
  });

  it("splits the seller VAT and tax registrations by schemeID VA and FC", () => {
    const xml = writeCii(preset("it-b2b-sdi"));
    expect(xml).toContain('<ram:ID schemeID="VA">IT01234567890</ram:ID>');
    expect(xml).toContain('<ram:ID schemeID="FC">01234567890</ram:ID>');
    const parsed = parseCii(xml);
    expect(parsed.seller.vatId).toBe("IT01234567890");
    expect(parsed.seller.taxId).toBe("01234567890");
  });

  it("carries the German 7% and 19% breakdown with a line-level tax category", () => {
    const xml = writeCii(preset("de-hotel-b2b-zugferd"));
    expect(xml).toContain("<ram:RateApplicablePercent>7.00</ram:RateApplicablePercent>");
    expect(xml).toContain("<ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>");
    expect(xml).toContain('<ram:BilledQuantity unitCode="DAY">3.00</ram:BilledQuantity>');
    expect([...xml.matchAll(/<ram:CategoryCode>S<\/ram:CategoryCode>/g)]).toHaveLength(4);
  });

  it("puts the French buyer SIRET in the legal organisation with ISO 6523 scheme 0002", () => {
    const xml = writeCii(preset("fr-store-b2b-facturx"));
    expect(xml).toContain('<ram:ID schemeID="0002">84217605900023</ram:ID>');
    expect(xml).toContain('<ram:URIID schemeID="0009">84217605900023</ram:URIID>');
  });

  it("emits an exemption reason before the basis amount and the code after the category", () => {
    const xml = writeCii(preset("it-restaurant-b2b-fattura"));
    const blocks = [...xml.matchAll(/<ram:ApplicableTradeTax>[\s\S]*?<\/ram:ApplicableTradeTax>/g)]
      .map((match) => match[0])
      .filter(
        (block) =>
          block.includes("<ram:CategoryCode>E</ram:CategoryCode>") &&
          block.includes("<ram:BasisAmount>"),
      );
    expect(blocks).toHaveLength(1);
    const [exempt] = blocks;
    expect(exempt.indexOf("<ram:ExemptionReason>")).toBeGreaterThan(-1);
    expect(exempt.indexOf("<ram:ExemptionReason>")).toBeLessThan(
      exempt.indexOf("<ram:BasisAmount>"),
    );
    expect(exempt.indexOf("<ram:TypeCode>")).toBeLessThan(exempt.indexOf("<ram:ExemptionReason>"));
    expect(exempt.indexOf("<ram:CategoryCode>")).toBeLessThan(
      exempt.indexOf("<ram:RateApplicablePercent>"),
    );
  });

  it("keeps the mandatory delivery group, empty when there is no despatch advice", () => {
    expect(preset("be-peppol").references?.despatchAdvice).toBeUndefined();
    expect(writeCii(preset("be-peppol"))).toContain("<ram:ApplicableHeaderTradeDelivery/>");
  });

  it("puts every document reference at its EN 16931 CII path", () => {
    const lyon = writeCii(preset("fr-store-b2b-facturx"));
    expect(lyon).toContain("<ram:BuyerReference>CHANTIER-2026-118</ram:BuyerReference>");
    expect(lyon).toContain(
      "<ram:SellerOrderReferencedDocument>\n        " +
        "<ram:IssuerAssignedID>CDE-RM-2026-1187</ram:IssuerAssignedID>\n" +
        "      </ram:SellerOrderReferencedDocument>",
    );
    expect(lyon).toContain(
      "<ram:BuyerOrderReferencedDocument>\n        " +
        "<ram:IssuerAssignedID>BC-2026-0451</ram:IssuerAssignedID>\n" +
        "      </ram:BuyerOrderReferencedDocument>",
    );
    expect(lyon).toContain(
      "<ram:ApplicableHeaderTradeDelivery>\n      <ram:DespatchAdviceReferencedDocument>\n" +
        "        <ram:IssuerAssignedID>BL-2026-0873</ram:IssuerAssignedID>\n" +
        "      </ram:DespatchAdviceReferencedDocument>\n" +
        "    </ram:ApplicableHeaderTradeDelivery>",
    );

    const munich = writeCii(preset("de-hotel-b2b-zugferd"));
    expect(munich).toContain(
      "<ram:AdditionalReferencedDocument>\n        " +
        "<ram:IssuerAssignedID>FOLIO-2026-004182</ram:IssuerAssignedID>\n" +
        `        <ram:TypeCode>${CII_INVOICED_OBJECT_TYPE_CODE}</ram:TypeCode>\n` +
        "      </ram:AdditionalReferencedDocument>",
    );

    const rome = writeCii(preset("it-restaurant-b2g-fpa12"));
    expect(rome).toContain(
      "<ram:AdditionalReferencedDocument>\n        " +
        "<ram:IssuerAssignedID>CONV-MIC-2026-0042</ram:IssuerAssignedID>\n" +
        `        <ram:TypeCode>${CII_TENDER_TYPE_CODE}</ram:TypeCode>\n` +
        "      </ram:AdditionalReferencedDocument>",
    );

    const commune = writeCii(preset("fr-store-b2g-chorus"));
    expect(commune).toContain(
      "<ram:SpecifiedProcuringProject>\n        <ram:ID>GYMNASE-2026</ram:ID>\n" +
        "        <ram:Name>GYMNASE-2026</ram:Name>\n      </ram:SpecifiedProcuringProject>",
    );
  });

  it("reads every reference back out of its own CII", () => {
    for (const id of PRESET_IDS) {
      const references = preset(id).references;
      const parsed = parseCii(writeCii(preset(id)));
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

  it("only emits element names that exist in the mapping table", () => {
    const declared = new Set(
      CII_MAP.map((row) => row.path.split("/").pop() ?? "")
        .filter((name) => !name.startsWith("@"))
        .map((name) => name.replace(/\[[^\]]*\]/g, "")),
    );
    for (const id of PRESET_IDS) {
      const emitted = [...writeCii(preset(id)).matchAll(/<([A-Za-z][\w:]*)[ />]/g)].map(
        (match) => match[1],
      );
      expect(emitted.length).toBeGreaterThan(30);
      for (const name of emitted) {
        expect(declared.has(name) || STRUCTURAL.has(name), `${name} is not mapped`).toBe(true);
      }
    }
  });

  it("rejects XML that is not a CrossIndustryInvoice", () => {
    expect(() => parseCii("<Invoice/>")).toThrow(/expected a <CrossIndustryInvoice> root/);
    expect(() => parseCii("<rsm:CrossIndustryInvoice>")).toThrow(/cii-parse/);
  });
});
