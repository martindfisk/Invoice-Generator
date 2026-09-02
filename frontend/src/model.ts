export type FormatId = "ubl" | "xrechnung" | "cii" | "fatturapa";

export type FieldId = string;

export type MappingRow = {
  field: FieldId;
  path: string;
  bt?: string;
  fpa?: string;
  label: string;
};

export type Address = {
  street: string;
  number?: string;
  city: string;
  postCode: string;
  region?: string;
  country: string;
};

export type Contact = {
  name?: string;
  phone?: string;
  email?: string;
};

export type ElectronicAddress = {
  scheme: string;
  id: string;
};

export type ItalianRegistration = {
  office: string;
  number: string;
  capital?: string;
  soleShareholder?: "SU" | "SM";
  liquidation: "LS" | "LN";
};

export type ItalianParty = {
  regimeFiscale: string;
  rea?: ItalianRegistration;
};

export type Gender = "MALE" | "FEMALE" | "DIVERSE";

// A party that is a natural person rather than a company. EN 16931 has no such distinction — BT-27
// and BT-44 are a single name — so `name` stays the one carrier of the business term and `person`
// is the structured view the formats that do distinguish need: FatturaPA `Anagrafica` chooses
// between `Denominazione` and `Nome` + `Cognome` (XSD 1.2.3 AnagraficaType), and the fiskaly UAPI
// splits `Recipient` into `BusinessRecipient` (a string name) and `ConsumerRecipient` (PersonName
// with forename, surname and gender). `gender` has no counterpart in any XML syntax here.
export type Person = {
  forename: string;
  surname: string;
  gender?: Gender;
};

export type Party = {
  name: string;
  tradeName?: string;
  person?: Person;
  vatId?: string;
  taxId?: string;
  legalRegId?: string;
  legalRegScheme?: string;
  electronicAddress?: ElectronicAddress;
  address: Address;
  contact?: Contact;
  it?: ItalianParty;
};

export type Channel =
  | { kind: "SDI"; codiceDestinatario: string; pec?: string }
  | { kind: "PEPPOL"; participantId: string }
  | { kind: "EMAIL"; email: string; format?: "ZUGFERD_V2" | "XRECHNUNG_V3" };

export type Buyer = Party & { channel: Channel };

export type Delivery = {
  date?: string;
};

export type VatCategory = "S" | "Z" | "E" | "AE" | "K" | "G" | "O";

export type Vat = {
  category: VatCategory;
  rate: string;
  natura?: string;
  vatexCode?: string;
  reason?: string;
};

export type ManagementData = {
  tipoDato: string;
  riferimentoTesto?: string;
  riferimentoNumero?: string;
  riferimentoData?: string;
};

export type ItalianLine = {
  altriDatiGestionali?: ManagementData;
};

export type ItalianStampDuty = {
  virtuale: "SI";
  amount: string;
};

export type ItalianDocument = {
  bollo?: ItalianStampDuty;
  cup?: string;
  cig?: string;
};

// Fields the fiskaly UAPI accepts that none of the XML writers here render. They ride on the
// operation so the Compose JSON shows the payload surface the API really has, and they are kept
// out of the mapping tables on purpose: emitting them into the predicted XML would claim a
// rendering no writer performs, and for FatturaPA the captured response in
// docs/reference/fatturapa/ shows the gateway produces no element for several of them. Same
// escape-hatch shape as the `it` members above.
export type UapiLineExtras = {
  allowance?: string; // BT-136 → entries[].data.value.discount
  surcharge?: string; // BT-141 → entries[].data.value.surcharge
  itemNumber?: string; // BT-155/BT-157 → entries[].data.product.number
  itemCode?: string; // BT-158 → entries[].data.product.code
  purpose?: "STANDARD" | "GIFT";
  regulatory?: string;
  label?: string;
};

export type UapiBuyerExtras = {
  buyerId?: string; // BT-46 → recipients[].buyer_id
  origin?: "NATIONAL" | "INTERNATIONAL";
};

export type UapiDeliveryExtras = {
  name?: string; // BT-70 → recipients[].shipping.name
  address?: Address; // BG-15 → recipients[].shipping.address
};

export type UapiExtras = {
  series?: string;
  activityCode?: string;
  operationDate?: string;
  buyerAccountingRef?: string; // BT-19 → document.references.buyer_routing
  buyer?: UapiBuyerExtras;
  delivery?: UapiDeliveryExtras;
};

export type Line = {
  id: string;
  name: string;
  description?: string;
  quantity: string;
  unitCode: string;
  unitPriceNet: string;
  netAmount: string;
  vat: Vat;
  it?: ItalianLine;
  uapi?: UapiLineExtras;
};

export type VatBreakdownRow = {
  category: VatCategory;
  rate: string;
  taxableAmount: string;
  taxAmount: string;
  natura?: string;
  vatexCode?: string;
  reason?: string;
  esigibilita?: "I" | "D" | "S";
};

export type Payment = {
  meansCode: string;
  meansText?: string;
  italianMeansCode?: string;
  conditions?: "TP01" | "TP02" | "TP03";
  terms?: string;
  iban?: string;
  accountName?: string;
  bic?: string;
  remittanceInformation?: string;
};

export type Totals = {
  lineExtension: string;
  allowance?: string;
  charge?: string;
  taxExclusive: string;
  taxAmount: string;
  taxInclusive: string;
  prepaid?: string;
  rounding?: string;
  payable: string;
};

export type DocumentReference = {
  number: string;
  issueDate?: string;
};

export type References = {
  buyerReference?: string;
  project?: string;
  contract?: string;
  purchaseOrder?: string;
  salesOrder?: string;
  despatchAdvice?: DocumentReference;
  tenderOrLot?: string;
  invoicedObject?: string;
  precedingInvoice?: DocumentReference;
};

export type Invoice = {
  format: FormatId;
  number: string;
  issueDate: string;
  dueDate?: string;
  typeCode: "380" | "381";
  currency: string;
  note?: string;
  references?: References;
  it?: ItalianDocument;
  seller: Party;
  buyer: Buyer;
  delivery?: Delivery;
  lines: Line[];
  vatBreakdown: VatBreakdownRow[];
  payment: Payment;
  totals: Totals;
  uapi?: UapiExtras;
};

export function getField(invoice: Invoice, id: FieldId): unknown {
  let current: unknown = invoice;
  for (const key of id.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function assign(target: unknown, keys: string[], value: unknown): unknown {
  const [key, ...rest] = keys;
  if (Array.isArray(target)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`model: "${key}" is not an array index`);
    }
    const next = [...(target as unknown[])];
    next[index] = rest.length === 0 ? value : assign(next[index], rest, value);
    return next;
  }
  if (target !== undefined && target !== null && typeof target !== "object") {
    throw new Error(`model: cannot set "${key}" on a ${typeof target}`);
  }
  const base = (target ?? {}) as Record<string, unknown>;
  return { ...base, [key]: rest.length === 0 ? value : assign(base[key], rest, value) };
}

export function setField(invoice: Invoice, id: FieldId, value: unknown): Invoice {
  const keys = id.split(".");
  if (keys.length === 0 || keys[0] === "") {
    throw new Error(`model: "${id}" is not a field id`);
  }
  return assign(invoice, keys, value) as Invoice;
}

export function resolveField(field: FieldId, index: number): FieldId {
  return field.replace("{i}", String(index));
}
