import { add, format, parse as canonical, percentOf } from "./decimal";
import type {
  Buyer,
  Channel,
  FieldId,
  Invoice,
  Line,
  Party,
  Payment,
  References,
  Totals,
  Vat,
  VatBreakdownRow,
  VatCategory,
  UapiExtras,
  UapiLineExtras,
} from "./model";

const AMOUNT_DP = 2;
const RATE_DP = 2;
const UNIT_FACTOR = "1";
const REASON_MAX = 128;
const CREDIT_NOTE_TYPE_CODE = "381";
const ZERO = "0.00";
const SERVICE_UNIT = "HUR";
const DEFAULT_UNIT = "C62";

export type UapiVatRate = {
  code: string;
  percentage: string;
  description?: string;
  historic?: boolean;
};

export type UapiVatExemption = { code: string; description?: string };

export type UapiContext = {
  vatRates?: UapiVatRate[];
  vatExemptions?: UapiVatExemption[];
};

export type UapiVat =
  | {
      type: "VAT_RATE";
      code: string;
      percentage: string;
      amount: string;
      exclusive: string;
      inclusive: string;
    }
  | { type: "VAT_EXEMPTION"; code: string; reason?: string }
  | { type: "VAT_REVERSE_CHARGE" };

export type UapiBreakdownEntry =
  | {
      type: "VAT_RATE";
      code: string;
      percentage: string;
      amount: string;
      exclusive: string;
      inclusive: string;
    }
  | { type: "VAT_EXEMPTION"; code: string; exclusive: string }
  | { type: "VAT_REVERSE_CHARGE"; exclusive: string };

export type UapiEntry = {
  type: "SALE";
  data: {
    type: "ITEM";
    text: string;
    unit: {
      quantity: string;
      measure?: string;
      factor?: string;
      price: { exclusive: string; inclusive: string };
    };
    value: { base: string; discount?: string; surcharge?: string };
    vat: UapiVat;
    product?: UapiProduct;
  };
  details: {
    concept: "GOOD" | "SERVICE";
    description?: string;
    number?: string;
    purpose?: "STANDARD" | "GIFT";
    regulatory?: string;
    label?: string;
  };
};

export type UapiProduct = {
  type: "OTHER";
  number: string;
  code?: string;
  details: { name: string };
};

export type UapiShipping = { address: UapiAddress; name?: string; date?: string };

export type UapiAddress = {
  line: { type: "STREET_NUMBER"; street: string; number: string };
  code: string;
  city: string;
  country: string;
  region?: string;
};

export type UapiInvoicing =
  | { type: "SDI"; destination_code: string; pec?: string }
  | { type: "PEPPOL"; identifier: string }
  | { type: "EMAIL"; email: string; format?: "ZUGFERD_V2" | "XRECHNUNG_V3" };

export type UapiIdentification = { type: "VAT" | "TAX" | "OTHER"; number: string };

// components.schemas.PersonName (2026-06-01) requires gender, forename and surname; prefix, infix
// and suffix are optional and the model has no home for them. PersonGender is DIVERSE|FEMALE|MALE,
// so a model person without a stated gender is sent as DIVERSE rather than omitting a required key.
export type UapiPersonName = {
  gender: "MALE" | "FEMALE" | "DIVERSE";
  forename: string;
  surname: string;
};

export type UapiBusinessRecipient = {
  type: "BUSINESS";
  name: string;
  address: UapiAddress;
  buyer_id?: string;
  company_id?: string;
  origin?: "NATIONAL" | "INTERNATIONAL";
  shipping?: UapiShipping;
  identification: UapiIdentification;
  invoicing: UapiInvoicing;
};

// components.schemas.ConsumerRecipient (2026-06-01) requires type, name and address; identification
// and invoicing are optional there, but an Italian B2C e-invoice needs both — the codice fiscale as
// a TAX identification and an SDI invoicing block. There is no company_id on a consumer.
export type UapiConsumerRecipient = {
  type: "CONSUMER";
  name: UapiPersonName;
  address: UapiAddress;
  identification: UapiIdentification;
  invoicing: UapiInvoicing;
};

export type UapiRecipient = UapiBusinessRecipient | UapiConsumerRecipient;

export type UapiPaymentInstruction =
  | {
      type: "CREDIT_TRANSFER";
      account: string;
      name: string;
      payment_service_provider: string;
      text?: string;
    }
  | { type: "UNKNOWN"; text?: string };

export type UapiPayment = {
  type: "OUTSTANDING";
  details: { amount: string; currency: string; date?: string };
  concept: "INVOICE";
  instruction: UapiPaymentInstruction;
};

export type UapiDocument = {
  number: string;
  series?: string;
  activity_code?: string;
  operation_date?: string;
  issued_at: string;
  text?: string;
  payment_terms?: string;
  references?: {
    buyer?: string;
    buyer_routing?: string;
    project?: string;
    contract?: string;
    purchase_order?: string;
    despatch_advice?: string;
    tender?: string;
    preceding_document?: { number: string; issued_at?: string };
  };
};

export type InvoiceTransaction = {
  type: "INVOICE";
  document: UapiDocument;
  entries: UapiEntry[];
  recipients: UapiRecipient[];
  payments: UapiPayment[];
  breakdown: UapiBreakdownEntry[];
  totals: { vat: { amount: string; exclusive: string; inclusive: string } };
  seller?: { name?: string; phone?: string; email?: string };
};

export type CorrectionTransaction = {
  type: "CORRECTION";
  record: { id: string };
  reason?: string;
  data: InvoiceTransaction;
};

export type CorrectionOptions = { originalRecordId: string; reason?: string };

export const FALLBACK_VAT_RATES: Record<string, Record<string, string>> = {
  IT: { "22": "STANDARD", "10": "REDUCED_1", "5": "REDUCED_2", "4": "REDUCED_3" },
  BE: { "21": "STANDARD", "12": "REDUCED_1", "6": "REDUCED_2" },
  DE: { "19": "STANDARD", "7": "REDUCED_1" },
};

export const FALLBACK_VAT_EXEMPTIONS: Record<string, string> = {
  N1: "NOT_SUBJECT",
  "N2.1": "NOT_SUBJECT",
  "N2.2": "NOT_SUBJECT",
  "N3.1": "NOT_TAXABLE",
  "N3.2": "NOT_TAXABLE",
  "N3.3": "NOT_TAXABLE",
  "N3.4": "NOT_TAXABLE",
  "N3.5": "NOT_TAXABLE",
  "N3.6": "NOT_TAXABLE",
  N4: "CAUSE_1",
  N5: "CAUSE_2",
  N7: "NOT_TAXABLE",
};

export const FALLBACK_CATEGORY_EXEMPTIONS: Record<VatCategory, string> = {
  S: "NOT_SUBJECT",
  Z: "NOT_TAXABLE",
  E: "CAUSE_1",
  AE: "NOT_SUBJECT",
  K: "NOT_TAXABLE",
  G: "NOT_TAXABLE",
  O: "NOT_SUBJECT",
};

export const ITALIAN_TAX_REGIMES: Record<string, string> = {
  ORDINARY: "RF01",
  FLAT_RATE_SCHEME: "RF19",
};

function money(value: string): string {
  return format(value, AMOUNT_DP);
}

function percentage(rate: string): string {
  return format(rate, RATE_DP);
}

export function rateCode(rate: string, country: string, ctx?: UapiContext): string {
  const wanted = canonical(rate);
  const configured = ctx?.vatRates?.find(
    (entry) => entry.historic !== true && canonical(entry.percentage) === wanted,
  );
  if (configured) return configured.code;
  const fallback = FALLBACK_VAT_RATES[country]?.[wanted];
  if (fallback) return fallback;
  throw new Error(
    `uapi-map: no VAT rate code for ${wanted}% in ${country}; pass the system's vat_rates in the context`,
  );
}

export function exemptionCode(
  category: VatCategory,
  natura: string | undefined,
  ctx?: UapiContext,
): string {
  if (natura) {
    const configured = ctx?.vatExemptions?.find((entry) =>
      (entry.description ?? "").toUpperCase().includes(natura.toUpperCase()),
    );
    if (configured) return configured.code;
    const fallback = FALLBACK_VAT_EXEMPTIONS[natura];
    if (fallback) return fallback;
  }
  return FALLBACK_CATEGORY_EXEMPTIONS[category];
}

function lineVat(line: Line, country: string, ctx?: UapiContext): UapiVat {
  if (line.vat.category === "AE") return { type: "VAT_REVERSE_CHARGE" };
  if (line.vat.category !== "S") {
    return {
      type: "VAT_EXEMPTION",
      code: exemptionCode(line.vat.category, line.vat.natura, ctx),
      reason: line.vat.reason,
    };
  }
  const amount = money(percentOf(line.netAmount, line.vat.rate));
  return {
    type: "VAT_RATE",
    code: rateCode(line.vat.rate, country, ctx),
    percentage: percentage(line.vat.rate),
    amount,
    exclusive: money(line.netAmount),
    inclusive: money(add(line.netAmount, amount)),
  };
}

function breakdownEntry(
  row: VatBreakdownRow,
  country: string,
  ctx?: UapiContext,
): UapiBreakdownEntry {
  if (row.category === "AE") {
    return { type: "VAT_REVERSE_CHARGE", exclusive: money(row.taxableAmount) };
  }
  if (row.category !== "S") {
    return {
      type: "VAT_EXEMPTION",
      code: exemptionCode(row.category, row.natura, ctx),
      exclusive: money(row.taxableAmount),
    };
  }
  return {
    type: "VAT_RATE",
    code: rateCode(row.rate, country, ctx),
    percentage: percentage(row.rate),
    amount: money(row.taxAmount),
    exclusive: money(row.taxableAmount),
    inclusive: money(add(row.taxableAmount, row.taxAmount)),
  };
}

function entry(line: Line, country: string, ctx?: UapiContext): UapiEntry {
  const inclusive =
    line.vat.category === "S"
      ? money(add(line.unitPriceNet, percentOf(line.unitPriceNet, line.vat.rate)))
      : money(line.unitPriceNet);
  return {
    type: "SALE",
    data: {
      type: "ITEM",
      text: line.name,
      unit: {
        quantity: money(line.quantity),
        measure: line.unitCode || undefined,
        factor: UNIT_FACTOR,
        price: { exclusive: money(line.unitPriceNet), inclusive },
      },
      value: {
        base: money(line.netAmount),
        discount: line.uapi?.allowance,
        surcharge: line.uapi?.surcharge,
      },
      vat: lineVat(line, country, ctx),
      product: product(line),
    },
    details: {
      concept: line.unitCode === "HUR" ? "SERVICE" : "GOOD",
      description: line.description,
      number: line.id,
      purpose: line.uapi?.purpose,
      regulatory: line.uapi?.regulatory,
      label: line.uapi?.label,
    },
  };
}

function invoicing(channel: Channel): UapiInvoicing {
  if (channel.kind === "SDI") {
    return { type: "SDI", destination_code: channel.codiceDestinatario, pec: channel.pec };
  }
  if (channel.kind === "PEPPOL") {
    return { type: "PEPPOL", identifier: channel.participantId };
  }
  return { type: "EMAIL", email: channel.email, format: channel.format };
}

export function nationalNumber(identifier: string, country: string): string {
  const prefix = identifier.slice(0, 2).toUpperCase();
  return country && prefix === country.toUpperCase() ? identifier.slice(2) : identifier;
}

function identification(buyer: Invoice["buyer"]): UapiIdentification {
  if (buyer.vatId) {
    return { type: "VAT", number: nationalNumber(buyer.vatId, buyer.address.country) };
  }
  if (buyer.taxId) return { type: "TAX", number: buyer.taxId };
  return { type: "OTHER", number: buyer.legalRegId ?? "" };
}

function recipientAddress(buyer: Invoice["buyer"]): UapiAddress {
  return {
    line: {
      type: "STREET_NUMBER",
      street: buyer.address.street,
      number: buyer.address.number ?? "",
    },
    code: buyer.address.postCode,
    city: buyer.address.city,
    country: buyer.address.country,
    region: buyer.address.region,
  };
}

// A buyer that is a natural person *without* a VAT id is a consumer and becomes a
// ConsumerRecipient: PersonName instead of a legal name, no company_id, and the codice fiscale as a
// TAX identification. A natural person who does hold a partita IVA is a sole trader, not a
// consumer, and stays a BusinessRecipient under the name FatturaPA writes as Nome + Cognome.
// The spec's own description of ConsumerRecipient still reads "Not supported yet." and Recipient
// says "Must be of type `BUSINESS`" — but the FatturaPA side of B2C is real, so the mapping is
// written here and the caveat is documented rather than the shape being left out.
function recipient(invoice: Invoice): UapiRecipient {
  const buyer = invoice.buyer;
  const person = buyer.vatId ? undefined : buyer.person;
  if (person) {
    return {
      type: "CONSUMER",
      name: {
        gender: person.gender ?? "DIVERSE",
        forename: person.forename,
        surname: person.surname,
      },
      address: recipientAddress(buyer),
      identification: identification(buyer),
      invoicing: invoicing(buyer.channel),
    };
  }
  return {
    type: "BUSINESS",
    name: buyer.name,
    address: recipientAddress(buyer),
    buyer_id: invoice.uapi?.buyer?.buyerId,
    company_id: buyer.legalRegId,
    origin: invoice.uapi?.buyer?.origin,
    shipping: shipping(invoice),
    identification: identification(buyer),
    invoicing: invoicing(buyer.channel),
  };
}

// Shipping requires an address, so BT-72 (delivery.date) and BT-70 can only ride along once
// BG-15 is present. Without an address the block is omitted entirely rather than sent partial.
function shipping(invoice: Invoice): UapiShipping | undefined {
  const address = invoice.uapi?.delivery?.address;
  if (!address) return undefined;
  return {
    address: {
      line: { type: "STREET_NUMBER", street: address.street, number: address.number ?? "" },
      code: address.postCode,
      city: address.city,
      country: address.country,
      region: address.region,
    },
    name: invoice.uapi?.delivery?.name,
    date: invoice.delivery?.date,
  };
}

function product(line: Line): UapiProduct | undefined {
  if (!line.uapi?.itemNumber) return undefined;
  return {
    type: "OTHER",
    number: line.uapi.itemNumber,
    code: line.uapi.itemCode,
    details: { name: line.name },
  };
}

function payment(invoice: Invoice): UapiPayment {
  const { iban, accountName, bic } = invoice.payment;
  const instruction: UapiPaymentInstruction =
    iban && accountName && bic
      ? {
          type: "CREDIT_TRANSFER",
          account: iban,
          name: accountName,
          payment_service_provider: bic,
          text: invoice.payment.remittanceInformation,
        }
      : // Only the remittance reference: the terms travel separately at document.payment_terms
        // (BT-20), and folding them into text made a reference equal to the terms ambiguous.
        { type: "UNKNOWN", text: invoice.payment.remittanceInformation };
  return {
    type: "OUTSTANDING",
    details: {
      amount: money(invoice.totals.payable),
      currency: invoice.currency,
      date: invoice.dueDate,
    },
    concept: "INVOICE",
    instruction,
  };
}

function documentReferences(invoice: Invoice): UapiDocument["references"] {
  const references = invoice.references ?? {};
  const value = {
    buyer: references.buyerReference,
    buyer_routing: invoice.uapi?.buyerAccountingRef,
    project: references.project,
    contract: references.contract,
    purchase_order: references.purchaseOrder,
    despatch_advice: references.despatchAdvice?.number,
    tender: references.tenderOrLot,
    preceding_document: references.precedingInvoice
      ? {
          number: references.precedingInvoice.number,
          issued_at: references.precedingInvoice.issueDate,
        }
      : undefined,
  };
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function seller(contact: Party["contact"]): InvoiceTransaction["seller"] {
  if (!contact) return undefined;
  // Seller declares minProperties: 1, so a contact whose three fields are all unset has to be
  // omitted rather than sent as an empty object the API would reject.
  const block = { name: contact.name, phone: contact.phone, email: contact.email };
  return Object.values(block).some((value) => value) ? block : undefined;
}

export function toInvoiceTransaction(invoice: Invoice, ctx?: UapiContext): InvoiceTransaction {
  const country = invoice.seller.address.country;
  const contact = invoice.seller.contact;
  return {
    type: "INVOICE",
    document: {
      number: invoice.number,
      series: invoice.uapi?.series,
      activity_code: invoice.uapi?.activityCode,
      operation_date: invoice.uapi?.operationDate,
      issued_at: `${invoice.issueDate}T00:00:00+00:00`,
      text: invoice.note || undefined,
      payment_terms: invoice.payment.terms,
      references: documentReferences(invoice),
    },
    entries: invoice.lines.map((line) => entry(line, country, ctx)),
    recipients: [recipient(invoice)],
    payments: [payment(invoice)],
    breakdown: invoice.vatBreakdown.map((row) => breakdownEntry(row, country, ctx)),
    totals: {
      vat: {
        amount: money(invoice.totals.taxAmount),
        exclusive: money(invoice.totals.taxExclusive),
        inclusive: money(invoice.totals.taxInclusive),
      },
    },
    seller: seller(contact),
  };
}

export function isCorrection(invoice: Invoice): boolean {
  return invoice.typeCode === CREDIT_NOTE_TYPE_CODE;
}

export function correctionReason(invoice: Invoice): string | undefined {
  const preceding = invoice.references?.precedingInvoice;
  const text = invoice.note ?? (preceding && `Correction of invoice ${preceding.number}`);
  return text?.slice(0, REASON_MAX);
}

export function toCorrectionTransaction(
  invoice: Invoice,
  options: CorrectionOptions,
  ctx?: UapiContext,
): CorrectionTransaction {
  if (!options.originalRecordId) {
    throw new Error(
      "uapi-map: toCorrectionTransaction needs the record id of the invoice being corrected; " +
        "it is runtime state from the earlier TRANSACTION::INVOICE and cannot be derived",
    );
  }
  return {
    type: "CORRECTION",
    record: { id: options.originalRecordId },
    reason: (options.reason ?? correctionReason(invoice))?.slice(0, REASON_MAX),
    data: toInvoiceTransaction(invoice, ctx),
  };
}

export type UapiOperation = InvoiceTransaction | CorrectionTransaction;

// Model fields a TRANSACTION::INVOICE operation has no room for, keyed by the reason. Editing
// the JSON can never set them, so fromInvoiceTransaction copies them from the base invoice and
// the Compose editor warns before an edit — the same honesty the XML editor already applies.
export const UAPI_LOSSY_FIELDS: Record<string, FieldId[]> = {
  "The syntax is chosen by fiskaly from the recipient's channel and the taxpayer's country, not by the operation":
    ["format"],
  "BT-3 is derived by fiskaly; the operation only distinguishes INVOICE from CORRECTION": [
    "typeCode",
  ],
  "document.references carries neither BT-14 nor BT-18, and despatch_advice is a bare number without BT-16's date":
    ["references.salesOrder", "references.invoicedObject", "references.despatchAdvice.issueDate"],
  "The Italian document extras (bollo virtuale, CUP, CIG) have no counterpart in the operation": [
    "it.bollo.virtuale",
    "it.bollo.amount",
    "it.cup",
    "it.cig",
  ],
  "The seller (BG-4) comes from the taxpayer resource; the operation carries only the contact point (BG-6)":
    [
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
    ],
  // BT-49 is deliberately absent from this list: the buyer's electronic address is carried as the
  // routing identifier under recipients[].invoicing — identifier for PEPPOL, destination_code for
  // SDI, email for EMAIL — which is the same datum as buyer.channel.participantId.
  "BusinessRecipient has no trading name, no ISO 6523 scheme for company_id and no contact group": [
    "buyer.tradeName",
    "buyer.legalRegScheme",
    "buyer.contact.name",
    "buyer.contact.phone",
    "buyer.contact.email",
  ],
  "rateCode/exemptionCode are many-to-one: the SystemVatRateCode and SystemVatExemptionCode enums cannot express Natura or a VATEX code":
    [
      "lines.{i}.vat.natura",
      "lines.{i}.vat.vatexCode",
      "vatBreakdown.{i}.natura",
      "vatBreakdown.{i}.vatexCode",
    ],
  "esigibilita (FatturaPA EsigibilitaIVA) has no counterpart in the VAT breakdown": [
    "vatBreakdown.{i}.esigibilita",
  ],
  "AltriDatiGestionali has no counterpart in the operation": [
    "lines.{i}.it.altriDatiGestionali.tipoDato",
    "lines.{i}.it.altriDatiGestionali.riferimentoTesto",
    "lines.{i}.it.altriDatiGestionali.riferimentoNumero",
    "lines.{i}.it.altriDatiGestionali.riferimentoData",
  ],
  "The payment instruction is a bank transfer or nothing; ModalitaPagamento and the FatturaPA payment conditions are not carried":
    ["payment.italianMeansCode", "payment.conditions"],
  "totals.vat is a three-value VAT summary; the EN 16931 document-level sums and adjustments are not carried":
    [
      "totals.lineExtension",
      "totals.allowance",
      "totals.charge",
      "totals.prepaid",
      "totals.rounding",
    ],
};

/**
 * What becomes of a field the operation cannot carry.
 *
 * "Not carried" is not the same as "not in the document". fiskaly derives BT-3, takes the seller
 * identity from the commissioned Taxpayer, recomputes the VAT summary and defaults the payment
 * method — all of those still appear in the XML it transmits. Others genuinely never arrive.
 * The predicted XML has to tell the two apart, or it shows elements fiskaly will not produce.
 *
 * `platform` — fiskaly supplies it; the element appears, though the value may be its own.
 * `lost`     — nothing supplies it; the element will not be in the transmitted document.
 * `unknown`  — no evidence either way. Rendered, and listed for review rather than guessed at.
 *
 * Keyed by the reason itself so the two tables cannot drift; a test asserts the key sets match.
 */
/**
 * Model fields that are two names for one datum.
 *
 * BT-49 is the buyer's electronic address. The model spells it both as `buyer.electronicAddress`
 * and, in routing form, as `buyer.channel` — the Peppol participant id, the SDI destination code
 * or the delivery email. A syntax that writes one has written the other, so reporting the unwritten
 * spelling as a missing business term is an artefact of the model, not a gap in the mapping.
 */
export const SAME_DATUM: Record<string, string[]> = {
  "buyer.electronicAddress.id": [
    "buyer.channel.participantId",
    "buyer.channel.codiceDestinatario",
    "buyer.channel.email",
  ],
  "buyer.electronicAddress.scheme": ["buyer.channel.participantId"],
  // FatturaPA renders the VAT category as Natura, and its mapping rows are tagged BT-118 and
  // BT-151 accordingly; categoryForNatura() converts between the two spellings. A syntax that
  // writes Natura has written the category.
  "vatBreakdown.{i}.category": ["vatBreakdown.{i}.natura"],
  "lines.{i}.vat.category": ["lines.{i}.vat.natura"],
  // BT-120 travels at line level: /entries/{i}/data/vat/reason is the spec's own BT-120 carrier
  // and fiskaly recomputes the breakdown from the lines, so the per-line reason is the only
  // viable carrier of the exemption reason (2026-09 gap audit, docs/gaps/verdicts.json). The
  // residue — no per-breakdown override; aggregation of differing per-line reasons is fiskaly's,
  // unobserved — is a property of the recompute, not a missing pointer.
  "vatBreakdown.{i}.reason": ["lines.{i}.vat.reason"],
};

export type LossKind = "platform" | "lost" | "unknown";

export const LOSS_KIND: Record<string, LossKind> = {
  "The syntax is chosen by fiskaly from the recipient's channel and the taxpayer's country, not by the operation":
    "platform",
  "BT-3 is derived by fiskaly; the operation only distinguishes INVOICE from CORRECTION":
    "platform",
  "document.references carries neither BT-14 nor BT-18, and despatch_advice is a bare number without BT-16's date":
    "lost",
  // Bundles fields with different fates: CUP and CIG really are lost (nothing supplies them),
  // while DatiBollo is added by fiskaly once the VAT-exempt total reaches EUR 77.47 — see
  // RULE_DERIVED_FIELDS, which regrades the bollo rows in the gap report. The kind stays "lost"
  // so the predicted XML remains conservative: the predictor does not model the threshold, and
  // CUP/CIG must not be rendered.
  "The Italian document extras (bollo virtuale, CUP, CIG) have no counterpart in the operation":
    "lost",
  "The seller (BG-4) comes from the taxpayer resource; the operation carries only the contact point (BG-6)":
    "platform",
  // Bundles fields with different fates, so nothing here is suppressed: the trading name and the
  // contact group really are lost, but the buyer's EAS address (BT-49) is carried as the Peppol
  // participant id inside recipients[].invoicing, and dropping it would make the predicted UBL
  // fail Peppol's own mandatory-endpoint rule. Split the reason before classifying it.
  "BusinessRecipient has no trading name, no ISO 6523 scheme for company_id and no contact group":
    "lost",
  "rateCode/exemptionCode are many-to-one: the SystemVatRateCode and SystemVatExemptionCode enums cannot express Natura or a VATEX code":
    "platform",
  "esigibilita (FatturaPA EsigibilitaIVA) has no counterpart in the VAT breakdown": "unknown",
  "AltriDatiGestionali has no counterpart in the operation": "lost",
  "The payment instruction is a bank transfer or nothing; ModalitaPagamento and the FatturaPA payment conditions are not carried":
    "platform",
  "totals.vat is a three-value VAT summary; the EN 16931 document-level sums and adjustments are not carried":
    "platform",
};

export const UAPI_LOSSY_FIELD_IDS: FieldId[] = Object.values(UAPI_LOSSY_FIELDS).flat();

/**
 * Where fiskaly actually takes each seller (BG-4) datum from: the account resources, per the
 * spec's own schemas — `POST /taxpayers` masters the company identity (CompanyName, Address,
 * CompanyFiscalization incl. the Italian REA registration), and the seller's Peppol endpoint
 * (BT-34) comes from the commissioned System's registration. These fields are provided, just
 * not per invoice — so their absence from the operation is by design, not data loss.
 *
 * Deliberately absent: `seller.legalRegId` / `seller.legalRegScheme` (BT-30) — only the Italian
 * fiscalization carries a registry identifier (`registration/company_id`); the German and
 * Belgian taxpayer schemas have no slot for it, so for those paths the datum really has no home.
 */
export const ACCOUNT_SUPPLIED_FIELDS: Record<string, string> = {
  "seller.name": "Taxpayer /name/legal",
  "seller.tradeName": "Taxpayer /name/trade",
  "seller.person.forename": "Taxpayer::INDIVIDUAL /name/person/forename",
  "seller.person.surname": "Taxpayer::INDIVIDUAL /name/person/surname",
  "seller.person.gender": "Taxpayer::INDIVIDUAL /name/person/gender",
  "seller.vatId": "Taxpayer /fiscalization/vat_id_number",
  "seller.taxId": "Taxpayer /fiscalization/tax_id_number",
  "seller.address.street": "Taxpayer /address/line",
  "seller.address.number": "Taxpayer /address/line",
  "seller.address.city": "Taxpayer /address/city",
  "seller.address.postCode": "Taxpayer /address/code",
  "seller.address.region": "Taxpayer /address/region",
  "seller.address.country": "Taxpayer /address/country",
  "seller.electronicAddress.id":
    "System::E_INVOICE_SERVICE annotations.peppol_id (Peppol registration)",
  "seller.electronicAddress.scheme":
    "System::E_INVOICE_SERVICE annotations.peppol_id (Peppol registration)",
  "seller.it.regimeFiscale": "Taxpayer /fiscalization/registration/tax_regime (IT)",
  "seller.it.rea.office": "Taxpayer /fiscalization/registration/office (IT)",
  "seller.it.rea.number": "Taxpayer /fiscalization/registration/entry (IT)",
  "seller.it.rea.capital": "Taxpayer /fiscalization/registration/capital (IT)",
  "seller.it.rea.soleShareholder": "Taxpayer /fiscalization/registration/shareholder_status (IT)",
  "seller.it.rea.liquidation": "Taxpayer /fiscalization/registration/liquidation_status (IT)",
};

/**
 * Fields fiskaly computes per invoice from the document itself — no input carries them because
 * the platform applies the rule. Keyed by model field; the value is the rule, cited, and becomes
 * the row's evidence in the gap report.
 *
 * The Italian stamp duty is the one entry so far: DatiBollo (BolloVirtuale/ImportoBollo) is added
 * automatically once the invoice's VAT-exempt amounts reach EUR 77.47 — imposta di bollo of
 * EUR 2.00 per DPR 642/1972 (tariffa art. 13), assolvimento virtuale per DM 17 giugno 2014 —
 * so an operation-level field would only invite values that contradict the computation.
 */
export const RULE_DERIVED_FIELDS: Record<string, string> = {
  "it.bollo.virtuale":
    "fiskaly adds DatiBollo automatically once the invoice's VAT-exempt amounts reach EUR 77.47 " +
    "(imposta di bollo EUR 2.00, DPR 642/1972 tariffa art. 13; bollo virtuale per DM 17 giugno 2014)",
  "it.bollo.amount":
    "fiskaly adds DatiBollo automatically once the invoice's VAT-exempt amounts reach EUR 77.47 " +
    "(imposta di bollo EUR 2.00, DPR 642/1972 tariffa art. 13; bollo virtuale per DM 17 giugno 2014)",
};

// Fields the operation carries for some shapes and drops for others. They survive the round trip
// because the base supplies them, but an edit only reaches the model in the shape named here.
export const UAPI_PARTIAL_FIELDS: Record<string, FieldId[]> = {
  "Only a VAT_RATE row has a percentage; an exemption or reverse-charge row carries none": [
    "lines.{i}.vat.rate",
    "vatBreakdown.{i}.rate",
  ],
  "identification names one identifier, so a buyer with a VAT id sends only that; its codice fiscale is preserved but not editable through the JSON":
    ["buyer.taxId"],
  "Only a CONSUMER recipient carries a PersonName; a BUSINESS recipient has one legal name and no forename, surname or gender":
    ["buyer.person.forename", "buyer.person.surname", "buyer.person.gender"],
  "The bank details only travel inside a CREDIT_TRANSFER instruction": [
    "payment.iban",
    "payment.accountName",
    "payment.bic",
  ],
  "details.number is optional; without it the entry's position becomes the line id": [
    "lines.{i}.id",
  ],
  "BT-72 only travels inside recipients[].shipping, which requires BG-15: without a delivery address there is nowhere to put it":
    ["delivery.date"],
};

export const UAPI_PARTIAL_FIELD_IDS: FieldId[] = Object.values(UAPI_PARTIAL_FIELDS).flat();

// The other direction: operation fields fromInvoiceTransaction cannot store, because they are
// projections the model computes rather than data it holds. Editing them in the JSON is undone
// on the next toInvoiceTransaction.
export const UAPI_DERIVED_PATHS: string[] = [
  "entries[].data.unit.factor",
  "entries[].data.unit.price.inclusive",
  "entries[].data.vat.code",
  "entries[].data.vat.amount",
  "entries[].data.vat.exclusive",
  "entries[].data.vat.inclusive",
  "entries[].details.concept",
  "breakdown[].code",
  "breakdown[].inclusive",
  "payments[].type",
  "payments[].concept",
  "recipients[].type",
  "recipients[].identification.type",
];

const EXEMPTION_CATEGORIES: Record<string, VatCategory> = {
  NOT_SUBJECT: "O",
  NOT_TAXABLE: "Z",
};

export function prefixedVatId(number: string, country: string): string {
  if (!number || !country) return number;
  const upper = country.toUpperCase();
  if (number.slice(0, 2).toUpperCase() === upper) return number;
  return /^[A-Za-z]{2}/.test(number) ? number : `${upper}${number}`;
}

type UapiVatFacts = { type: string; percentage?: string; code?: string; reason?: string };

// The forward map projects (category, natura) onto one SystemVatExemptionCode and (rate) onto
// one SystemVatRateCode, both many-to-one. When the code in the JSON is still the one the base
// invoice produces, the base row is returned untouched so Natura and VATEX survive; only a code
// the user actually changed falls through to the coarse EN 16931 category below.
function vatFacts(entry: UapiVatFacts, base: Vat | undefined, ctx?: UapiContext): Vat {
  if (entry.type === "VAT_REVERSE_CHARGE") {
    return base?.category === "AE" ? base : { category: "AE", rate: base?.rate ?? ZERO };
  }
  if (entry.type === "VAT_RATE") {
    const percentage = entry.percentage ?? base?.rate ?? ZERO;
    if (base?.category === "S" && canonical(base.rate) === canonical(percentage)) return base;
    return { category: "S", rate: percentage };
  }
  const code = entry.code ?? "";
  const reusable =
    base &&
    base.category !== "S" &&
    base.category !== "AE" &&
    exemptionCode(base.category, base.natura, ctx) === code;
  if (reusable) {
    return entry.reason === undefined || entry.reason === base.reason
      ? base
      : { ...base, reason: entry.reason };
  }
  return { category: EXEMPTION_CATEGORIES[code] ?? "E", rate: ZERO, reason: entry.reason };
}

function lineFrom(
  entry: UapiEntry,
  base: Line | undefined,
  index: number,
  ctx?: UapiContext,
): Line {
  const unit = entry.data.unit;
  const measure =
    unit.measure ?? (entry.details.concept === "SERVICE" ? SERVICE_UNIT : base?.unitCode);
  return {
    id: entry.details.number ?? base?.id ?? String(index + 1),
    name: entry.data.text,
    description: entry.details.description,
    quantity: unit.quantity,
    unitCode: measure ?? DEFAULT_UNIT,
    unitPriceNet: unit.price.exclusive,
    netAmount: entry.data.value.base,
    vat: vatFacts(entry.data.vat, base?.vat, ctx),
    it: base?.it,
    uapi: lineExtrasFrom(entry),
  };
}

function lineExtrasFrom(entry: UapiEntry): UapiLineExtras | undefined {
  const value: UapiLineExtras = {
    allowance: entry.data.value.discount,
    surcharge: entry.data.value.surcharge,
    itemNumber: entry.data.product?.number,
    itemCode: entry.data.product?.code,
    purpose: entry.details.purpose,
    regulatory: entry.details.regulatory,
    label: entry.details.label,
  };
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function extrasFrom(operation: InvoiceTransaction): UapiExtras | undefined {
  const recipient = operation.recipients[0];
  const business = recipient?.type === "BUSINESS" ? recipient : undefined;
  const ship = business?.shipping;
  const buyer =
    business && (business.buyer_id !== undefined || business.origin !== undefined)
      ? { buyerId: business.buyer_id, origin: business.origin }
      : undefined;
  const value: UapiExtras = {
    series: operation.document.series,
    activityCode: operation.document.activity_code,
    operationDate: operation.document.operation_date,
    buyerAccountingRef: operation.document.references?.buyer_routing,
    buyer,
    delivery: ship
      ? {
          name: ship.name,
          address: {
            street: ship.address.line.street,
            number: ship.address.line.number || undefined,
            city: ship.address.city,
            postCode: ship.address.code,
            region: ship.address.region,
            country: ship.address.country,
          },
        }
      : undefined,
  };
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function breakdownFrom(
  entry: UapiBreakdownEntry,
  base: VatBreakdownRow | undefined,
  ctx?: UapiContext,
): VatBreakdownRow {
  return {
    ...vatFacts(entry, base, ctx),
    taxableAmount: entry.exclusive,
    taxAmount: entry.type === "VAT_RATE" ? entry.amount : ZERO,
    esigibilita: base?.esigibilita,
  };
}

function channelFrom(invoicing: UapiInvoicing | undefined, base: Channel): Channel {
  if (!invoicing) return base;
  if (invoicing.type === "SDI") {
    return {
      kind: "SDI",
      codiceDestinatario: invoicing.destination_code,
      pec: invoicing.pec || undefined,
    };
  }
  if (invoicing.type === "PEPPOL") return { kind: "PEPPOL", participantId: invoicing.identifier };
  return { kind: "EMAIL", email: invoicing.email, format: invoicing.format };
}

// The forward map picks one identification: VAT if the buyer has a VAT id, else TAX, else OTHER.
// A payload that names TAX or OTHER therefore asserts there is no VAT id, and keeping the base's
// would silently undo the edit; a payload that names VAT says nothing about the codice fiscale,
// which the base keeps.
function buyerFrom(recipient: UapiRecipient | undefined, base: Buyer): Buyer {
  if (!recipient) return base;
  const address = recipient.address;
  const country = address.country;
  const identification = recipient.identification;
  const isVat = identification?.type === "VAT";
  const isTax = identification?.type === "TAX";
  const isOther = identification?.type === "OTHER";
  const naming =
    recipient.type === "CONSUMER"
      ? {
          name: `${recipient.name.forename} ${recipient.name.surname}`,
          person: {
            forename: recipient.name.forename,
            surname: recipient.name.surname,
            gender: recipient.name.gender,
          },
          legalRegId: undefined,
        }
      : {
          name: recipient.name,
          person: base.person,
          legalRegId:
            recipient.company_id || (isOther ? identification.number || undefined : undefined),
        };
  return {
    ...base,
    ...naming,
    vatId: isVat ? prefixedVatId(identification.number, country) : undefined,
    taxId: isTax ? identification.number : isVat ? base.taxId : undefined,
    address: {
      street: address.line.street,
      number: address.line.number || undefined,
      city: address.city,
      postCode: address.code,
      region: address.region || undefined,
      country,
    },
    channel: channelFrom(recipient.invoicing, base.channel),
  };
}

function sellerFrom(operation: InvoiceTransaction, base: Party): Party {
  const seller = operation.seller;
  return {
    ...base,
    contact: seller ? { name: seller.name, phone: seller.phone, email: seller.email } : undefined,
  };
}

function referencesFrom(
  operation: InvoiceTransaction,
  base: References | undefined,
): References | undefined {
  const refs = operation.document.references;
  const preceding = refs?.preceding_document;
  const value: References = {
    buyerReference: refs?.buyer,
    project: refs?.project,
    contract: refs?.contract,
    purchaseOrder: refs?.purchase_order,
    salesOrder: base?.salesOrder,
    despatchAdvice: refs?.despatch_advice
      ? { number: refs.despatch_advice, issueDate: base?.despatchAdvice?.issueDate }
      : undefined,
    tenderOrLot: refs?.tender,
    invoicedObject: base?.invoicedObject,
    precedingInvoice: preceding
      ? { number: preceding.number, issueDate: preceding.issued_at }
      : undefined,
  };
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function paymentFrom(operation: InvoiceTransaction, base: Payment): Payment {
  const instruction = operation.payments[0]?.instruction;
  const terms = operation.document.payment_terms;
  const transfer = instruction?.type === "CREDIT_TRANSFER" ? instruction : undefined;
  return {
    ...base,
    terms,
    iban: transfer ? transfer.account : base.iban,
    accountName: transfer ? transfer.name : base.accountName,
    bic: transfer ? transfer.payment_service_provider : base.bic,
    // instruction.text is BT-83 on every instruction shape; an instruction without text means
    // the reference was removed, not that the base should resurrect it.
    remittanceInformation: instruction ? instruction.text : base.remittanceInformation,
  };
}

function totalsFrom(operation: InvoiceTransaction, base: Totals): Totals {
  const vat = operation.totals.vat;
  return {
    ...base,
    taxExclusive: vat.exclusive,
    taxAmount: vat.amount,
    taxInclusive: vat.inclusive,
    payable: operation.payments[0]?.details.amount ?? base.payable,
  };
}

export function invoiceOperation(operation: UapiOperation): InvoiceTransaction {
  return operation.type === "CORRECTION" ? operation.data : operation;
}

export function fromInvoiceTransaction(
  operation: UapiOperation,
  base: Invoice,
  ctx?: UapiContext,
): Invoice {
  // operation.record.id on a CORRECTION is the id of the earlier TRANSACTION::INVOICE record —
  // runtime state from a previous call, deliberately not stored on the model.
  const invoice = invoiceOperation(operation);
  const payment = invoice.payments[0];
  return {
    ...base,
    number: invoice.document.number,
    note: invoice.document.text ?? base.note,
    issueDate: invoice.document.issued_at?.slice(0, 10) ?? base.issueDate,
    dueDate: payment?.details.date,
    typeCode: operation.type === "CORRECTION" ? CREDIT_NOTE_TYPE_CODE : base.typeCode,
    currency: payment?.details.currency ?? base.currency,
    references: referencesFrom(invoice, base.references),
    seller: sellerFrom(invoice, base.seller),
    buyer: buyerFrom(invoice.recipients[0], base.buyer),
    lines: invoice.entries.map((entry, index) => lineFrom(entry, base.lines[index], index, ctx)),
    vatBreakdown: invoice.breakdown.map((entry, index) =>
      breakdownFrom(entry, base.vatBreakdown[index], ctx),
    ),
    payment: paymentFrom(invoice, base.payment),
    totals: totalsFrom(invoice, base.totals),
    delivery: deliveryFrom(invoice, base.delivery),
    uapi: extrasFrom(invoice),
  };
}

function deliveryFrom(
  operation: InvoiceTransaction,
  base: Invoice["delivery"],
): Invoice["delivery"] {
  const recipient = operation.recipients[0];
  const shipped = recipient?.type === "BUSINESS" ? recipient.shipping : undefined;
  if (!shipped) return base;
  return shipped.date ? { date: shipped.date } : undefined;
}

export type UapiTaxpayerRegistration = {
  office?: string;
  entry?: string;
  capital?: string;
  shareholder_status?: string;
  liquidation_status?: string;
  tax_regime?: string;
};

export type UapiTaxpayer = {
  type?: string;
  name?: { legal?: string; trade?: string };
  address?: {
    line?: { street?: string; number?: string };
    code?: string;
    city?: string;
    country?: string;
    region?: string;
  };
  country?: string;
  vat_number?: string;
  fiscalization?: {
    type?: string;
    vat_id_number?: string;
    tax_id_number?: string;
    registration?: UapiTaxpayerRegistration;
  };
};

export function fromTaxpayer(taxpayer: UapiTaxpayer): Party {
  const fiscalization = taxpayer.fiscalization;
  const country = taxpayer.address?.country ?? taxpayer.country ?? fiscalization?.type ?? "";
  const vatNumber = fiscalization?.vat_id_number ?? taxpayer.vat_number;
  const vatId = vatNumber
    ? /^[A-Za-z]{2}/.test(vatNumber)
      ? vatNumber.toUpperCase()
      : `${country}${vatNumber}`
    : undefined;
  const registration = fiscalization?.registration;
  return {
    name: taxpayer.name?.legal ?? "",
    tradeName: taxpayer.name?.trade,
    vatId,
    taxId: fiscalization?.tax_id_number,
    address: {
      street: taxpayer.address?.line?.street ?? "",
      number: taxpayer.address?.line?.number,
      city: taxpayer.address?.city ?? "",
      postCode: taxpayer.address?.code ?? "",
      region: taxpayer.address?.region,
      country,
    },
    it:
      fiscalization?.type === "IT"
        ? {
            regimeFiscale: ITALIAN_TAX_REGIMES[registration?.tax_regime ?? "ORDINARY"] ?? "RF01",
            rea:
              registration?.office && registration.entry
                ? {
                    office: registration.office,
                    number: registration.entry,
                    capital: registration.capital,
                    soleShareholder:
                      registration.shareholder_status === "SOLE_SHAREHOLDER" ? "SU" : "SM",
                    liquidation: registration.liquidation_status === "IN_LIQUIDATION" ? "LS" : "LN",
                  }
                : undefined,
          }
        : undefined,
  };
}

// JSON Pointers into an InvoiceTransaction, mapped back to the model field a schema error should
// highlight. `{i}` stands for an array index the pointer supplies. Only pointers with a genuine
// model home are listed; a pointer that resolves to nothing leaves the finding unfielded rather
// than pointing at a neighbouring field.
export const UAPI_POINTER_FIELDS: Record<string, FieldId> = {
  "/document/series": "uapi.series",
  "/document/activity_code": "uapi.activityCode",
  "/document/operation_date": "uapi.operationDate",
  "/document/references/buyer_routing": "uapi.buyerAccountingRef",
  "/entries/{i}/data/value/discount": "lines.{i}.uapi.allowance",
  "/entries/{i}/data/value/surcharge": "lines.{i}.uapi.surcharge",
  "/entries/{i}/data/product/number": "lines.{i}.uapi.itemNumber",
  "/entries/{i}/data/product/code": "lines.{i}.uapi.itemCode",
  "/entries/{i}/details/purpose": "lines.{i}.uapi.purpose",
  "/entries/{i}/details/regulatory": "lines.{i}.uapi.regulatory",
  "/entries/{i}/details/label": "lines.{i}.uapi.label",
  "/recipients/{i}/buyer_id": "uapi.buyer.buyerId",
  "/recipients/{i}/origin": "uapi.buyer.origin",
  "/recipients/{i}/shipping/name": "uapi.delivery.name",
  "/recipients/{i}/shipping/address/line/street": "uapi.delivery.address.street",
  "/recipients/{i}/shipping/address/line/number": "uapi.delivery.address.number",
  "/recipients/{i}/shipping/address/city": "uapi.delivery.address.city",
  "/recipients/{i}/shipping/address/code": "uapi.delivery.address.postCode",
  "/recipients/{i}/shipping/address/region": "uapi.delivery.address.region",
  "/recipients/{i}/shipping/address/country": "uapi.delivery.address.country",
  "/recipients/{i}/shipping/date": "delivery.date",
  "/document/number": "number",
  "/document/text": "note",
  "/payments/{i}/type": "payment.meansCode",
  "/payments/{i}/name": "payment.meansText",
  "/document/issued_at": "issueDate",
  "/document/payment_terms": "payment.terms",
  "/document/references/buyer": "references.buyerReference",
  "/document/references/project": "references.project",
  "/document/references/contract": "references.contract",
  "/document/references/purchase_order": "references.purchaseOrder",
  "/document/references/despatch_advice": "references.despatchAdvice.number",
  "/document/references/tender": "references.tenderOrLot",
  "/document/references/preceding_document/number": "references.precedingInvoice.number",
  "/document/references/preceding_document/issued_at": "references.precedingInvoice.issueDate",
  "/entries/{i}/data/text": "lines.{i}.name",
  "/entries/{i}/data/unit/quantity": "lines.{i}.quantity",
  "/entries/{i}/data/unit/measure": "lines.{i}.unitCode",
  "/entries/{i}/data/unit/price/exclusive": "lines.{i}.unitPriceNet",
  "/entries/{i}/data/value/base": "lines.{i}.netAmount",
  "/entries/{i}/data/vat/code": "lines.{i}.vat.category",
  "/entries/{i}/data/vat/percentage": "lines.{i}.vat.rate",
  "/entries/{i}/data/vat/reason": "lines.{i}.vat.reason",
  "/entries/{i}/details/description": "lines.{i}.description",
  "/entries/{i}/details/number": "lines.{i}.id",
  "/recipients/{i}/name": "buyer.name",
  "/recipients/{i}/name/forename": "buyer.person.forename",
  "/recipients/{i}/name/surname": "buyer.person.surname",
  "/recipients/{i}/name/gender": "buyer.person.gender",
  "/recipients/{i}/company_id": "buyer.legalRegId",
  "/recipients/{i}/identification/number": "buyer.vatId",
  "/recipients/{i}/address/line/street": "buyer.address.street",
  "/recipients/{i}/address/line/number": "buyer.address.number",
  "/recipients/{i}/address/city": "buyer.address.city",
  "/recipients/{i}/address/code": "buyer.address.postCode",
  "/recipients/{i}/address/region": "buyer.address.region",
  "/recipients/{i}/address/country": "buyer.address.country",
  "/recipients/{i}/invoicing/destination_code": "buyer.channel.codiceDestinatario",
  "/recipients/{i}/invoicing/pec": "buyer.channel.pec",
  "/recipients/{i}/invoicing/identifier": "buyer.channel.participantId",
  "/recipients/{i}/invoicing/email": "buyer.channel.email",
  "/recipients/{i}/invoicing/format": "buyer.channel.format",
  "/payments/{i}/details/amount": "totals.payable",
  "/payments/{i}/details/currency": "currency",
  "/payments/{i}/details/date": "dueDate",
  "/payments/{i}/instruction/account": "payment.iban",
  "/payments/{i}/instruction/name": "payment.accountName",
  "/payments/{i}/instruction/payment_service_provider": "payment.bic",
  "/payments/{i}/instruction/text": "payment.remittanceInformation",
  "/breakdown/{i}/code": "vatBreakdown.{i}.category",
  "/breakdown/{i}/percentage": "vatBreakdown.{i}.rate",
  "/breakdown/{i}/amount": "vatBreakdown.{i}.taxAmount",
  "/breakdown/{i}/exclusive": "vatBreakdown.{i}.taxableAmount",
  "/totals/vat/amount": "totals.taxAmount",
  "/totals/vat/exclusive": "totals.taxExclusive",
  "/totals/vat/inclusive": "totals.taxInclusive",
  "/seller/name": "seller.contact.name",
  "/seller/phone": "seller.contact.phone",
  "/seller/email": "seller.contact.email",
};

const INDEX_SEGMENT = /^\d+$/;

// Normalises an RFC 6901 pointer into an InvoiceTransaction to the `{i}` template form every
// pointer-keyed table uses (UAPI_POINTER_FIELDS here, FATTURAPA_FATES in uapi-field-fate.ts):
// the CORRECTION `data` wrapper is stripped and each numeric segment becomes `{i}`, with the
// original indices returned alongside.
export function pointerTemplate(
  pointer: string,
): { template: string; indices: string[] } | undefined {
  if (!pointer.startsWith("/")) return undefined;
  // A CORRECTION wraps the invoice in `data`, so its pointers carry one extra segment.
  const path = pointer.startsWith("/data/") ? pointer.slice("/data".length) : pointer;
  const indices: string[] = [];
  const template = path
    .split("/")
    .map((segment) => {
      if (!INDEX_SEGMENT.test(segment)) return segment;
      indices.push(segment);
      return "{i}";
    })
    .join("/");
  return { template, indices };
}

export function fieldForPointer(pointer: string): FieldId | undefined {
  const parsed = pointerTemplate(pointer);
  if (!parsed) return undefined;
  const field = UAPI_POINTER_FIELDS[parsed.template];
  if (!field) return undefined;
  const { indices } = parsed;
  return field.includes("{i}") && indices.length ? field.replace("{i}", indices[0]) : field;
}
