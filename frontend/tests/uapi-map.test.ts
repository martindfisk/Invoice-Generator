import { describe, expect, it } from "vitest";
import { preset, PRESET_IDS } from "../src/presets";
import {
  correctionReason,
  exemptionCode,
  fromTaxpayer,
  isCorrection,
  nationalNumber,
  rateCode,
  toCorrectionTransaction,
  toInvoiceTransaction,
  type UapiContext,
  type UapiTaxpayer,
} from "../src/uapi-map";

const REQUIRED_KEYS = [
  "type",
  "document",
  "entries",
  "recipients",
  "payments",
  "breakdown",
  "totals",
];

const IT_CONTEXT: UapiContext = {
  vatRates: [
    { code: "STANDARD", percentage: "22.00", description: "Aliquota ordinaria" },
    { code: "REDUCED_1", percentage: "10.00", description: "Aliquota ridotta" },
    { code: "REDUCED_9", percentage: "20.00", description: "Storica", historic: true },
  ],
  vatExemptions: [
    { code: "CAUSE_7", description: "N3.5 - non imponibili a seguito di dichiarazioni d'intento" },
    { code: "CAUSE_3", description: "N4 - esenti" },
  ],
};

describe("toInvoiceTransaction", () => {
  for (const id of PRESET_IDS) {
    it(`matches the golden operation for "${id}"`, async () => {
      const ctx = preset(id).seller.address.country === "IT" ? IT_CONTEXT : undefined;
      const operation = toInvoiceTransaction(preset(id), ctx);
      await expect(`${JSON.stringify(operation, null, 2)}\n`).toMatchFileSnapshot(
        `./golden/${id}.uapi.json`,
      );
    });
  }

  it("produces every key InvoiceTransaction requires", () => {
    for (const id of PRESET_IDS) {
      const ctx = preset(id).seller.address.country === "IT" ? IT_CONTEXT : undefined;
      const operation = toInvoiceTransaction(preset(id), ctx) as Record<string, unknown>;
      for (const key of REQUIRED_KEYS) expect(operation[key]).toBeDefined();
      expect(operation.type).toBe("INVOICE");
      expect(Array.isArray(operation.entries)).toBe(true);
      expect((operation.entries as unknown[]).length).toBeGreaterThan(0);
      expect((operation.recipients as unknown[]).length).toBe(1);
      expect((operation.payments as unknown[]).length).toBe(1);
    }
  });

  it("writes an RFC 3339 issuing timestamp of exactly 25 characters", () => {
    const operation = toInvoiceTransaction(preset("it-b2b-sdi"), IT_CONTEXT);
    expect(operation.document.issued_at).toBe("2026-08-26T00:00:00+00:00");
    expect(operation.document.issued_at).toHaveLength(25);
    expect(operation.document.number).toMatch(/^[0-9A-Z_/\-.]{1,20}$/);
  });

  it("maps rates through the system's vat_rates and skips historic entries", () => {
    expect(rateCode("22.00", "IT", IT_CONTEXT)).toBe("STANDARD");
    expect(rateCode("10.00", "IT", IT_CONTEXT)).toBe("REDUCED_1");
    expect(() => rateCode("20.00", "IT", IT_CONTEXT)).toThrow(/no VAT rate code for 20%/);
  });

  it("falls back to the documented per-country table without a context", () => {
    expect(rateCode("22", "IT")).toBe("STANDARD");
    expect(rateCode("10.00", "IT")).toBe("REDUCED_1");
    expect(rateCode("21.00", "BE")).toBe("STANDARD");
    expect(rateCode("6.00", "BE")).toBe("REDUCED_2");
    expect(rateCode("19.00", "DE")).toBe("STANDARD");
    expect(rateCode("7.00", "DE")).toBe("REDUCED_1");
    expect(() => rateCode("17.00", "IT")).toThrow(/no VAT rate code for 17%/);
  });

  it("maps Natura to the system's exemption causes, then to the fallback", () => {
    expect(exemptionCode("E", "N3.5", IT_CONTEXT)).toBe("CAUSE_7");
    expect(exemptionCode("E", "N4", IT_CONTEXT)).toBe("CAUSE_3");
    expect(exemptionCode("E", "N3.5")).toBe("NOT_TAXABLE");
    expect(exemptionCode("E", "N4")).toBe("CAUSE_1");
    expect(exemptionCode("O", undefined)).toBe("NOT_SUBJECT");
  });

  it("discriminates entry and breakdown VAT by type", () => {
    const operation = toInvoiceTransaction(preset("it-b2b-sdi"), IT_CONTEXT);
    expect(operation.entries[0].data.vat).toEqual({
      type: "VAT_RATE",
      code: "STANDARD",
      percentage: "22.00",
      amount: "330.00",
      exclusive: "1500.00",
      inclusive: "1830.00",
    });
    expect(operation.entries[2].data.vat).toEqual({
      type: "VAT_EXEMPTION",
      code: "CAUSE_7",
      reason: undefined,
    });
    expect(operation.breakdown[2]).toEqual({
      type: "VAT_EXEMPTION",
      code: "CAUSE_7",
      exclusive: "800.00",
    });
    expect(operation.totals.vat).toEqual({
      amount: "380.00",
      exclusive: "2800.00",
      inclusive: "3180.00",
    });
  });

  it("sends the bare national VAT number, the way both Postman collections do", () => {
    const italian = toInvoiceTransaction(preset("it-restaurant-b2b-fattura"), IT_CONTEXT);
    expect(italian.recipients[0].identification).toEqual({
      type: "VAT",
      number: "03456789012",
    });
    expect(italian.recipients[0].address.country).toBe("IT");

    const belgian = toInvoiceTransaction(preset("be-peppol"));
    expect(belgian.recipients[0].identification).toEqual({ type: "VAT", number: "0888888895" });
    expect(belgian.recipients[0].address.country).toBe("BE");
  });

  it("only strips a prefix that is the recipient's own country", () => {
    expect(nationalNumber("IT03456789012", "IT")).toBe("03456789012");
    expect(nationalNumber("BE0888888895", "BE")).toBe("0888888895");
    expect(nationalNumber("it03456789012", "IT")).toBe("03456789012");
    expect(nationalNumber("IT03456789012", "DE")).toBe("IT03456789012");
    expect(nationalNumber("03456789012", "IT")).toBe("03456789012");
    expect(nationalNumber("IT11111111111", "")).toBe("IT11111111111");
  });

  it("writes the unit of measure and the BT-149 price base quantity", () => {
    const unit = toInvoiceTransaction(preset("it-restaurant-b2b-fattura"), IT_CONTEXT).entries[0]
      .data.unit;
    expect(unit).toEqual({
      quantity: "8.00",
      measure: "C62",
      factor: "1",
      price: { exclusive: "34.00", inclusive: "37.40" },
    });
    for (const id of PRESET_IDS) {
      const ctx = preset(id).seller.address.country === "IT" ? IT_CONTEXT : undefined;
      for (const entry of toInvoiceTransaction(preset(id), ctx).entries) {
        expect(entry.data.unit.factor).toBe("1");
        expect(entry.data.unit.measure).toMatch(/^.{1,32}$/);
        expect(entry.details.concept).toMatch(/^(GOOD|SERVICE)$/);
        expect(entry.data.value.base).toMatch(/^-?\d{1,12}(\.\d{1,8})?$/);
      }
    }
  });

  it("carries the SDI and Peppol channels into recipients[].invoicing", () => {
    expect(toInvoiceTransaction(preset("it-b2b-sdi"), IT_CONTEXT).recipients[0].invoicing).toEqual({
      type: "SDI",
      destination_code: "ABC1234",
      pec: undefined,
    });
    expect(toInvoiceTransaction(preset("be-peppol")).recipients[0].invoicing).toEqual({
      type: "PEPPOL",
      identifier: "0208:0888888895",
    });
  });

  it("turns the payment into an outstanding credit transfer", () => {
    const payment = toInvoiceTransaction(preset("be-peppol")).payments[0];
    expect(payment).toEqual({
      type: "OUTSTANDING",
      concept: "INVOICE",
      details: { amount: "1512.50", currency: "EUR", date: "2026-09-25" },
      instruction: {
        type: "CREDIT_TRANSFER",
        account: "BE68539007547034",
        name: "Ardennes Bureau BV",
        payment_service_provider: "GEBABEBB",
        text: "BE-INV-2026-0007",
      },
    });
  });

  it("degrades to an unknown instruction when the bank details are incomplete", () => {
    const payment = toInvoiceTransaction(preset("broken"), IT_CONTEXT).payments[0];
    expect(payment.instruction.type).toBe("UNKNOWN");
  });

  // components.schemas.ConsumerRecipient, cross-read against the Postman collection's
  // "records (B2C E-Invoice Transmission with pec recipient)" body.
  it("sends a private individual as a CONSUMER recipient with a PersonName", () => {
    const recipient = toInvoiceTransaction(preset("it-restaurant-b2c-pec"), IT_CONTEXT)
      .recipients[0];
    expect(recipient).toEqual({
      type: "CONSUMER",
      name: { gender: "FEMALE", forename: "Giulia", surname: "Bianchi" },
      address: {
        line: { type: "STREET_NUMBER", street: "Via dei Serpenti", number: "42" },
        code: "00184",
        city: "Roma",
        country: "IT",
        region: "RM",
      },
      identification: { type: "TAX", number: "BNCGLI85E41H501P" },
      invoicing: { type: "SDI", destination_code: "0000000", pec: "giulia.bianchi@pec.example.it" },
    });
    expect(recipient).not.toHaveProperty("company_id");
  });

  it("keeps a natural person who holds a VAT id a BUSINESS recipient", () => {
    const base = preset("it-restaurant-b2c-pec");
    const soleTrader = {
      ...base,
      buyer: { ...base.buyer, name: "Giulia Bianchi", vatId: "IT03456789012" },
    };
    const recipient = toInvoiceTransaction(soleTrader, IT_CONTEXT).recipients[0];
    expect(recipient.type).toBe("BUSINESS");
    expect(recipient.name).toBe("Giulia Bianchi");
    expect(recipient.identification).toEqual({ type: "VAT", number: "03456789012" });
  });

  it("sends every other preset as a BUSINESS recipient", () => {
    for (const id of PRESET_IDS) {
      if (id === "it-restaurant-b2c-pec") continue;
      const ctx = preset(id).seller.address.country === "IT" ? IT_CONTEXT : undefined;
      expect(toInvoiceTransaction(preset(id), ctx).recipients[0].type, id).toBe("BUSINESS");
    }
  });
});

describe("toCorrectionTransaction", () => {
  const ORIGINAL_RECORD_ID = "0189f7ea-ae2c-7809-8aeb-b819cf5e9e7f";
  const credit = () => preset("it-restaurant-td04-credit");

  it("recognises the credit note by its EN 16931 type code", () => {
    expect(isCorrection(credit())).toBe(true);
    expect(isCorrection(preset("it-restaurant-b2b-fattura"))).toBe(false);
    expect(credit().typeCode).toBe("381");
  });

  it("wraps the invoice mapping in a CORRECTION against the original record", () => {
    const correction = toCorrectionTransaction(credit(), {
      originalRecordId: ORIGINAL_RECORD_ID,
      reason: "two covers were never served",
    });
    expect(correction.type).toBe("CORRECTION");
    expect(correction.record).toEqual({ id: ORIGINAL_RECORD_ID });
    expect(correction.reason).toBe("two covers were never served");
    expect(correction.data).toEqual(toInvoiceTransaction(credit(), IT_CONTEXT));
    expect(correction.data.type).toBe("INVOICE");
    expect(Object.keys(correction).sort()).toEqual(["data", "reason", "record", "type"]);
  });

  it("never maps a credit note to a plain INVOICE operation", () => {
    const plain = toInvoiceTransaction(credit(), IT_CONTEXT);
    expect(plain.type).toBe("INVOICE");
    const correction = toCorrectionTransaction(credit(), {
      originalRecordId: ORIGINAL_RECORD_ID,
    });
    expect(correction.type).not.toBe(plain.type);
    expect(correction.data.document.references?.preceding_document).toEqual({
      number: "IT-RM-2026-0117",
      issued_at: "2026-08-24",
    });
  });

  it("falls back to the preset's own reason and stays within PlainString128", () => {
    expect(correctionReason(credit())).toBe(
      "Nota di credito a storno parziale della fattura IT-RM-2026-0117",
    );
    const correction = toCorrectionTransaction(credit(), {
      originalRecordId: ORIGINAL_RECORD_ID,
    });
    expect(correction.reason).toBe(correctionReason(credit()));
    expect(correction.reason?.length).toBeLessThanOrEqual(128);

    const long = { ...credit(), note: "x".repeat(400) };
    expect(toCorrectionTransaction(long, { originalRecordId: ORIGINAL_RECORD_ID }).reason).toBe(
      "x".repeat(128),
    );
  });

  it("derives a reason from the preceding invoice when there is no note", () => {
    const withoutNote = { ...credit(), note: undefined };
    expect(correctionReason(withoutNote)).toBe("Correction of invoice IT-RM-2026-0117");
  });

  it("refuses to invent the record id of the invoice being corrected", () => {
    expect(() => toCorrectionTransaction(credit(), { originalRecordId: "" })).toThrow(
      /record id of the invoice being corrected/,
    );
  });
});

describe("fromTaxpayer", () => {
  const taxpayer: UapiTaxpayer = {
    type: "COMPANY",
    name: { legal: "Bottega Alpina S.r.l.", trade: "Bottega Alpina" },
    address: {
      line: { street: "Via Vittorio Veneto", number: "12" },
      code: "20121",
      city: "Milano",
      country: "IT",
      region: "MI",
    },
    fiscalization: {
      type: "IT",
      vat_id_number: "01234567890",
      tax_id_number: "01234567890",
      registration: {
        office: "MI",
        entry: "1234567",
        capital: "10000.00",
        shareholder_status: "MULTIPLE_SHAREHOLDERS",
        liquidation_status: "NOT_IN_LIQUIDATION",
        tax_regime: "ORDINARY",
      },
    },
  };

  it("builds the seller party from an Italian taxpayer", () => {
    expect(fromTaxpayer(taxpayer)).toEqual({
      name: "Bottega Alpina S.r.l.",
      tradeName: "Bottega Alpina",
      vatId: "IT01234567890",
      taxId: "01234567890",
      address: {
        street: "Via Vittorio Veneto",
        number: "12",
        city: "Milano",
        postCode: "20121",
        region: "MI",
        country: "IT",
      },
      it: {
        regimeFiscale: "RF01",
        rea: {
          office: "MI",
          number: "1234567",
          capital: "10000.00",
          soleShareholder: "SM",
          liquidation: "LN",
        },
      },
    });
  });

  it("maps the flat-rate scheme to RF19 and a sole shareholder to SU", () => {
    const party = fromTaxpayer({
      ...taxpayer,
      fiscalization: {
        ...taxpayer.fiscalization,
        registration: {
          ...taxpayer.fiscalization?.registration,
          tax_regime: "FLAT_RATE_SCHEME",
          shareholder_status: "SOLE_SHAREHOLDER",
          liquidation_status: "IN_LIQUIDATION",
        },
      },
    });
    expect(party.it).toEqual({
      regimeFiscale: "RF19",
      rea: {
        office: "MI",
        number: "1234567",
        capital: "10000.00",
        soleShareholder: "SU",
        liquidation: "LS",
      },
    });
  });

  it("leaves the Italian block out for a Belgian taxpayer and prefixes the VAT id", () => {
    const party = fromTaxpayer({
      name: { legal: "Ardennes Bureau BV" },
      address: {
        line: { street: "Rue de la Loi", number: "16" },
        code: "1000",
        city: "Bruxelles",
        country: "BE",
      },
      fiscalization: { type: "BE", vat_id_number: "0999999922", tax_id_number: "0999999922" },
    });
    expect(party.vatId).toBe("BE0999999922");
    expect(party.it).toBeUndefined();
  });
});
