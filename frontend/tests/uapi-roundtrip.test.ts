import { describe, expect, it } from "vitest";
import { allFields, genericField } from "../src/field-registry";
import type { Invoice } from "../src/model";
import { preset, PRESET_IDS, type PresetId } from "../src/presets";
import {
  fieldForPointer,
  fromInvoiceTransaction,
  invoiceOperation,
  prefixedVatId,
  toCorrectionTransaction,
  toInvoiceTransaction,
  UAPI_DERIVED_PATHS,
  UAPI_LOSSY_FIELD_IDS,
  UAPI_LOSSY_FIELDS,
  UAPI_PARTIAL_FIELD_IDS,
  UAPI_POINTER_FIELDS,
  type UapiContext,
} from "../src/uapi-map";

// `format` is the browser's syntax choice, not an EN 16931 business term, so it has no registry
// entry; every other model field the warning names must be one the Compose form can show.
const MODEL_FIELDS = new Set<string>([...allFields().map((spec) => spec.field), "format"]);

function leaves(value: unknown, path: string, into: Map<string, unknown>): void {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => leaves(item, `${path}.${index}`, into));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      leaves(item, path ? `${path}.${key}` : key, into);
    return;
  }
  into.set(path, value);
}

function modelDiff(actual: Invoice, expected: Invoice): string[] {
  const left = new Map<string, unknown>();
  const right = new Map<string, unknown>();
  leaves(actual, "", left);
  leaves(expected, "", right);
  const paths = new Set([...left.keys(), ...right.keys()]);
  return [...paths]
    .filter((path) => left.get(path) !== right.get(path))
    .map(genericField)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
}

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

function contextFor(id: PresetId): UapiContext | undefined {
  return preset(id).seller.address.country === "IT" ? IT_CONTEXT : undefined;
}

function roundTrip(id: PresetId): Invoice {
  const base = preset(id);
  const ctx = contextFor(id);
  return fromInvoiceTransaction(toInvoiceTransaction(base, ctx), base, ctx);
}

describe("fromInvoiceTransaction round trip", () => {
  for (const id of PRESET_IDS) {
    it(`restores "${id}" from its own operation`, () => {
      expect(roundTrip(id)).toEqual(preset(id));
      expect(modelDiff(roundTrip(id), preset(id))).toEqual([]);
    });
  }

  it("survives a JSON serialise/parse in between, the way the editor does", () => {
    for (const id of PRESET_IDS) {
      const base = preset(id);
      const ctx = contextFor(id);
      const json = JSON.parse(JSON.stringify(toInvoiceTransaction(base, ctx)));
      expect(fromInvoiceTransaction(json, base, ctx)).toEqual(base);
    }
  });

  it("unwraps a CORRECTION and never stores its runtime record id", () => {
    const base = preset("it-restaurant-td04-credit");
    const correction = toCorrectionTransaction(
      base,
      { originalRecordId: "0189f7ea-ae2c-7809-8aeb-b819cf5e9e7f" },
      IT_CONTEXT,
    );
    const invoice = fromInvoiceTransaction(correction, base, IT_CONTEXT);
    expect(invoice).toEqual(base);
    expect(invoice.typeCode).toBe("381");
    expect(JSON.stringify(invoice)).not.toContain("0189f7ea");
    expect(invoiceOperation(correction).type).toBe("INVOICE");
  });

  it("takes the type code from the operation type, not from the base", () => {
    const base = preset("it-b2b-sdi");
    const correction = toCorrectionTransaction(
      { ...base, typeCode: "381" },
      { originalRecordId: "0189f7ea-ae2c-7809-8aeb-b819cf5e9e7f" },
      IT_CONTEXT,
    );
    expect(fromInvoiceTransaction(correction, base, IT_CONTEXT).typeCode).toBe("381");
    expect(
      fromInvoiceTransaction(toInvoiceTransaction(base, IT_CONTEXT), base, IT_CONTEXT).typeCode,
    ).toBe("380");
  });
});

describe("fromInvoiceTransaction edits", () => {
  const base = preset("it-b2b-sdi");
  const operation = () => toInvoiceTransaction(base, IT_CONTEXT);

  it("carries a changed document number, issue date and due date into the model", () => {
    const edited = operation();
    edited.document.number = "IT-INV-0099";
    edited.document.issued_at = "2026-09-01T00:00:00+00:00";
    edited.payments[0].details.date = "2026-10-01";
    const invoice = fromInvoiceTransaction(edited, base, IT_CONTEXT);
    expect(invoice.number).toBe("IT-INV-0099");
    expect(invoice.issueDate).toBe("2026-09-01");
    expect(invoice.dueDate).toBe("2026-10-01");
  });

  it("re-prefixes a bare national number with the recipient's country", () => {
    const edited = operation();
    edited.recipients[0].identification = { type: "VAT", number: "01234567890" };
    expect(fromInvoiceTransaction(edited, base, IT_CONTEXT).buyer.vatId).toBe("IT01234567890");
  });

  it("only re-prefixes what nationalNumber would have stripped", () => {
    expect(prefixedVatId("03456789012", "IT")).toBe("IT03456789012");
    expect(prefixedVatId("0888888895", "BE")).toBe("BE0888888895");
    expect(prefixedVatId("IT03456789012", "IT")).toBe("IT03456789012");
    expect(prefixedVatId("IT03456789012", "DE")).toBe("IT03456789012");
    expect(prefixedVatId("IT11111111111", "")).toBe("IT11111111111");
    expect(prefixedVatId("", "IT")).toBe("");
  });

  it("switches the identification type and drops the identifier it replaces", () => {
    const edited = operation();
    edited.recipients[0].identification = { type: "TAX", number: "RSSMRA80A01H501U" };
    const invoice = fromInvoiceTransaction(edited, base, IT_CONTEXT);
    expect(invoice.buyer.vatId).toBeUndefined();
    expect(invoice.buyer.taxId).toBe("RSSMRA80A01H501U");
  });

  it("turns a changed rate percentage into the model rate", () => {
    const edited = operation();
    edited.entries[0].data.vat = {
      type: "VAT_RATE",
      code: "REDUCED_1",
      percentage: "10.00",
      amount: "150.00",
      exclusive: "1500.00",
      inclusive: "1650.00",
    };
    const line = fromInvoiceTransaction(edited, base, IT_CONTEXT).lines[0];
    expect(line.vat).toEqual({ category: "S", rate: "10.00" });
  });

  it("keeps Natura while the exemption code is the one the base produces", () => {
    const invoice = fromInvoiceTransaction(operation(), base, IT_CONTEXT);
    expect(invoice.lines[2].vat).toEqual({ category: "E", rate: "0.00", natura: "N3.5" });
    expect(invoice.vatBreakdown[2].natura).toBe("N3.5");
  });

  it("falls back to the EN 16931 category when the exemption code is changed", () => {
    const edited = operation();
    edited.entries[2].data.vat = { type: "VAT_EXEMPTION", code: "NOT_SUBJECT", reason: "art. 7" };
    const line = fromInvoiceTransaction(edited, base, IT_CONTEXT).lines[2];
    expect(line.vat).toEqual({ category: "O", rate: "0.00", reason: "art. 7" });
    expect(line.vat.natura).toBeUndefined();
  });

  it("maps VAT_REVERSE_CHARGE onto category AE", () => {
    const edited = operation();
    edited.entries[0].data.vat = { type: "VAT_REVERSE_CHARGE" };
    edited.breakdown[0] = { type: "VAT_REVERSE_CHARGE", exclusive: "1500.00" };
    const invoice = fromInvoiceTransaction(edited, base, IT_CONTEXT);
    expect(invoice.lines[0].vat.category).toBe("AE");
    expect(invoice.vatBreakdown[0]).toEqual({
      category: "AE",
      rate: "22.00",
      taxableAmount: "1500.00",
      taxAmount: "0.00",
      esigibilita: "I",
    });
  });

  it("reads the net unit price out of unit.price.exclusive", () => {
    const edited = operation();
    edited.entries[0].data.unit.price = { exclusive: "175.00", inclusive: "213.50" };
    edited.entries[0].data.value.base = "1750.00";
    const line = fromInvoiceTransaction(edited, base, IT_CONTEXT).lines[0];
    expect(line.unitPriceNet).toBe("175.00");
    expect(line.netAmount).toBe("1750.00");
  });

  it("uses details.concept for the unit code only when measure is absent", () => {
    const edited = operation();
    delete edited.entries[1].data.unit.measure;
    edited.entries[1].details.concept = "SERVICE";
    expect(fromInvoiceTransaction(edited, base, IT_CONTEXT).lines[1].unitCode).toBe("HUR");

    const kept = operation();
    kept.entries[1].details.concept = "SERVICE";
    expect(fromInvoiceTransaction(kept, base, IT_CONTEXT).lines[1].unitCode).toBe("H87");
  });

  it("rebuilds the SDI, Peppol and email channels from recipients[].invoicing", () => {
    const sdi = operation();
    sdi.recipients[0].invoicing = { type: "SDI", destination_code: "0000000", pec: "a@pec.it" };
    expect(fromInvoiceTransaction(sdi, base, IT_CONTEXT).buyer.channel).toEqual({
      kind: "SDI",
      codiceDestinatario: "0000000",
      pec: "a@pec.it",
    });

    const peppol = operation();
    peppol.recipients[0].invoicing = { type: "PEPPOL", identifier: "0208:0888888895" };
    expect(fromInvoiceTransaction(peppol, base, IT_CONTEXT).buyer.channel).toEqual({
      kind: "PEPPOL",
      participantId: "0208:0888888895",
    });

    const email = operation();
    email.recipients[0].invoicing = {
      type: "EMAIL",
      email: "billing@example.de",
      format: "XRECHNUNG_V3",
    };
    expect(fromInvoiceTransaction(email, base, IT_CONTEXT).buyer.channel).toEqual({
      kind: "EMAIL",
      email: "billing@example.de",
      format: "XRECHNUNG_V3",
    });
  });

  it("reads the bank details back out of a CREDIT_TRANSFER instruction", () => {
    const edited = operation();
    edited.payments[0].instruction = {
      type: "CREDIT_TRANSFER",
      account: "IT60X0542811101000000123456",
      name: "Nuovo Beneficiario",
      payment_service_provider: "UNCRITMM",
      text: "REF-9",
    };
    const payment = fromInvoiceTransaction(edited, base, IT_CONTEXT).payment;
    expect(payment.accountName).toBe("Nuovo Beneficiario");
    expect(payment.bic).toBe("UNCRITMM");
    expect(payment.remittanceInformation).toBe("REF-9");
  });

  it("keeps the base bank details when the instruction is UNKNOWN", () => {
    const edited = operation();
    edited.payments[0].instruction = { type: "UNKNOWN", text: base.payment.terms };
    const payment = fromInvoiceTransaction(edited, base, IT_CONTEXT).payment;
    expect(payment.iban).toBe(base.payment.iban);
    expect(payment.remittanceInformation).toBe(base.payment.remittanceInformation);
  });
});

describe("UAPI_LOSSY_FIELDS", () => {
  it("lists exactly the model fields the operation cannot carry", () => {
    expect(UAPI_LOSSY_FIELD_IDS).toEqual([
      "format",
      "typeCode",
      "references.salesOrder",
      "references.invoicedObject",
      "references.despatchAdvice.issueDate",
      "it.bollo.virtuale",
      "it.bollo.amount",
      "it.cup",
      "it.cig",
      "seller.name",
      "seller.tradeName",
      "seller.person.forename",
      "seller.person.surname",
      "seller.person.gender",
      "seller.vatId",
      "seller.taxId",
      "seller.legalRegId",
      "seller.legalRegScheme",
      "seller.electronicAddress.scheme",
      "seller.electronicAddress.id",
      "seller.address.street",
      "seller.address.number",
      "seller.address.city",
      "seller.address.postCode",
      "seller.address.region",
      "seller.address.country",
      "seller.it.regimeFiscale",
      "seller.it.rea.office",
      "seller.it.rea.number",
      "seller.it.rea.capital",
      "seller.it.rea.soleShareholder",
      "seller.it.rea.liquidation",
      "buyer.tradeName",
      "buyer.legalRegScheme",
      "buyer.electronicAddress.scheme",
      "buyer.electronicAddress.id",
      "buyer.contact.name",
      "buyer.contact.phone",
      "buyer.contact.email",
      "lines.{i}.vat.natura",
      "lines.{i}.vat.vatexCode",
      "vatBreakdown.{i}.natura",
      "vatBreakdown.{i}.vatexCode",
      "vatBreakdown.{i}.esigibilita",
      "lines.{i}.it.altriDatiGestionali.tipoDato",
      "lines.{i}.it.altriDatiGestionali.riferimentoTesto",
      "lines.{i}.it.altriDatiGestionali.riferimentoNumero",
      "lines.{i}.it.altriDatiGestionali.riferimentoData",
      "payment.meansCode",
      "payment.meansText",
      "payment.italianMeansCode",
      "payment.conditions",
      "totals.lineExtension",
      "totals.allowance",
      "totals.charge",
      "totals.prepaid",
      "totals.rounding",
    ]);
  });

  it("names only fields the Compose form can show", () => {
    for (const field of [...UAPI_LOSSY_FIELD_IDS, ...UAPI_PARTIAL_FIELD_IDS]) {
      expect(MODEL_FIELDS).toContain(field);
    }
  });

  it("never claims a field the operation unconditionally carries", () => {
    const carried = new Set(Object.values(UAPI_POINTER_FIELDS).map(genericField));
    for (const field of UAPI_LOSSY_FIELD_IDS) expect(carried).not.toContain(field);
  });

  it("gives every entry a reason an integrator can act on", () => {
    for (const [reason, fields] of Object.entries(UAPI_LOSSY_FIELDS)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(fields.length).toBeGreaterThan(0);
    }
    expect(new Set(UAPI_LOSSY_FIELD_IDS).size).toBe(UAPI_LOSSY_FIELD_IDS.length);
    expect(UAPI_LOSSY_FIELD_IDS.filter((f) => UAPI_PARTIAL_FIELD_IDS.includes(f))).toEqual([]);
  });

  it("lists the operation fields the model cannot store either", () => {
    expect(UAPI_DERIVED_PATHS).toContain("entries[].details.concept");
    expect(UAPI_DERIVED_PATHS).toContain("entries[].data.vat.code");
    expect(UAPI_DERIVED_PATHS).toContain("entries[].data.unit.price.inclusive");
  });

  it("proves the lossy fields really are lost, not merely declared", () => {
    const base = preset("it-restaurant-b2b-fattura");
    const json = JSON.stringify(toInvoiceTransaction(base, IT_CONTEXT));
    expect(json).not.toContain(base.seller.vatId ?? "@@");
    expect(json).not.toContain(base.buyer.tradeName ?? "@@");
    expect(json).not.toContain("N3.5");
    expect(json).not.toContain(base.payment.italianMeansCode ?? "@@");
    expect(json).not.toContain('"lineExtension"');
  });

  // The one preset that populates every lossy group: the whole invoice still comes back, and it
  // comes back only because the base supplies these fields — an edited JSON cannot change them.
  // `note` is deliberately absent: BT-22 rides on document.text, so it is restored from the
  // operation rather than from the base. `delivery.date` stays in the diff because BT-72 travels
  // inside recipients[].shipping, and this preset sets no delivery address to hang it on — the
  // partial-carry case UAPI_PARTIAL_FIELDS declares.
  it("restores a preset that populates every lossy group, from the base alone", () => {
    const base = preset("de-hotel-b2g-xrechnung");
    const stripped: Invoice = {
      ...base,
      note: undefined,
      delivery: undefined,
      it: undefined,
      references: { ...base.references, invoicedObject: undefined },
      totals: { ...base.totals, lineExtension: "0.00" },
    };
    const operation = toInvoiceTransaction(base);
    expect(modelDiff(fromInvoiceTransaction(operation, stripped), base).sort()).toEqual(
      ["delivery.date", "references.invoicedObject", "totals.lineExtension"].sort(),
    );
  });
});

describe("fieldForPointer", () => {
  it("maps a schema pointer back to the field the Compose form shows", () => {
    expect(fieldForPointer("/document/number")).toBe("number");
    expect(fieldForPointer("/entries/2/data/unit/price/exclusive")).toBe("lines.2.unitPriceNet");
    expect(fieldForPointer("/entries/0/details/number")).toBe("lines.0.id");
    expect(fieldForPointer("/breakdown/1/percentage")).toBe("vatBreakdown.1.rate");
    expect(fieldForPointer("/recipients/0/address/country")).toBe("buyer.address.country");
    expect(fieldForPointer("/payments/0/instruction/account")).toBe("payment.iban");
    expect(fieldForPointer("/totals/vat/inclusive")).toBe("totals.taxInclusive");
    expect(fieldForPointer("/seller/email")).toBe("seller.contact.email");
  });

  it("looks through the CORRECTION wrapper", () => {
    expect(fieldForPointer("/data/entries/1/data/text")).toBe("lines.1.name");
    expect(fieldForPointer("/data/document/number")).toBe("number");
  });

  it("returns nothing rather than a neighbouring field", () => {
    expect(fieldForPointer("")).toBeUndefined();
    expect(fieldForPointer("/entries/0/data/unit/factor")).toBeUndefined();
    expect(fieldForPointer("/entries/0/details/concept")).toBeUndefined();
    expect(fieldForPointer("/record/id")).toBeUndefined();
    expect(fieldForPointer("/tax_representative/name")).toBeUndefined();
  });

  it("only names fields the model actually has", () => {
    // Operation-only fields (lines.{i}.uapi.*, uapi.*) are deliberately kept out of the Compose
    // form, so the registry does not list them — but they are real model paths and must address
    // a pointer, or the Mapper cannot highlight them across panes.
    const known = new Set(allFields().map((spec) => spec.field));
    // `uapi.*` and `lines.{i}.uapi.*` are the operation-only escape hatch: real model paths that
    // the Compose form deliberately does not render, so the registry does not list them.
    const operationOnly = /^(uapi\.|lines\.\{i\}\.uapi\.)/;
    for (const field of Object.values(UAPI_POINTER_FIELDS)) {
      expect(known.has(field) || operationOnly.test(field), field).toBe(true);
    }
  });
});
