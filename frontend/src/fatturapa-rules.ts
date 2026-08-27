import { abs, add, cmp, format, isZero, mul, sub } from "./decimal";
import {
  CODICE_DESTINATARIO_LENGTH_B2G,
  FORMATO_TRASMISSIONE_B2G,
  TIPO_DOCUMENTO,
} from "./fatturapa-map";
import { codiceDestinatario, formatoTrasmissione, splitVatId } from "./fatturapa-write";
import type { FieldId, Invoice } from "./model";
import type { Severity } from "./model-rules";

export type SdiFinding = {
  ruleId: string;
  severity: Severity;
  message: string;
  field?: FieldId;
  fpa?: string;
};

export type SdiTransmission = { formatoTrasmissione: string; codiceDestinatario: string };

// 1.1.3 / 1.1.4 are checked against the header of the document that will actually be sent:
// the writer derives FormatoTrasmissione from the destination code, so reading the model back
// would make the pair tautological. Without a header the derived values are used instead.
export type SdiOptions = { receivedOn?: string; transmission?: SdiTransmission };

const AMOUNT_DP = 2;
// "Elenco controlli" tolerances: one euro on the VAT summary arithmetic (00421/00422),
// one cent on a single line (00423).
const EURO = "1.00";
const CENT = "0.01";
const CODICE_DESTINATARIO_LENGTH_B2B = 7;

// Controllo 00471: the transferor and the transferee must differ for these document types.
// (TD21/TD27 require the opposite - controllo 00472 - and are not produced by this app.)
const SELF_BILLING_FORBIDDEN = new Set([
  "TD01",
  "TD02",
  "TD03",
  "TD06",
  "TD16",
  "TD17",
  "TD18",
  "TD19",
  "TD20",
  "TD24",
  "TD25",
  "TD28",
]);

function money(value: string): string {
  return format(value, AMOUNT_DP);
}

function within(left: string, right: string, tolerance: string): boolean {
  return cmp(abs(sub(left, right)), tolerance) <= 0;
}

function finding(
  ruleId: string,
  message: string,
  fpa: string,
  field?: FieldId,
  severity: Severity = "error",
): SdiFinding {
  return { ruleId, severity, message, field, fpa };
}

function summaryKey(rate: string, natura: string | undefined): string {
  return `${money(rate)}|${natura ?? ""}`;
}

function checkLines(invoice: Invoice, findings: SdiFinding[]): void {
  invoice.lines.forEach((line, index) => {
    const rate = line.vat.rate;
    if (isZero(rate) && !line.vat.natura) {
      findings.push(
        finding(
          "00400",
          `Line ${line.id}: AliquotaIVA is 0,00 so Natura (2.2.1.14) is required.`,
          "2.2.1.14",
          `lines.${index}.vat.natura`,
        ),
      );
    }
    if (!isZero(rate) && line.vat.natura) {
      findings.push(
        finding(
          "00401",
          `Line ${line.id}: Natura "${line.vat.natura}" is not allowed with AliquotaIVA ${money(rate)}.`,
          "2.2.1.14",
          `lines.${index}.vat.natura`,
        ),
      );
    }
    if (cmp(rate, "0") < 0 || cmp(rate, "100") > 0) {
      findings.push(
        finding(
          "00424",
          `Line ${line.id}: AliquotaIVA ${money(rate)} is not a percentage between 0,00 and 100,00.`,
          "2.2.1.12",
          `lines.${index}.vat.rate`,
        ),
      );
    }
    const expected = mul(money(line.unitPriceNet), money(line.quantity));
    if (!within(expected, line.netAmount, CENT)) {
      findings.push(
        finding(
          "00423",
          `Line ${line.id}: PrezzoTotale ${money(line.netAmount)} differs from ` +
            `PrezzoUnitario ${money(line.unitPriceNet)} x Quantita ${money(line.quantity)} = ${money(expected)}.`,
          "2.2.1.11",
          `lines.${index}.netAmount`,
        ),
      );
    }
  });
}

function checkSummaries(invoice: Invoice, findings: SdiFinding[]): void {
  const lineTotals = new Map<string, string>();
  for (const line of invoice.lines) {
    const key = summaryKey(line.vat.rate, line.vat.natura);
    lineTotals.set(key, add(lineTotals.get(key) ?? "0", money(line.netAmount)));
  }

  const seen = new Set<string>();
  invoice.vatBreakdown.forEach((row, index) => {
    const key = summaryKey(row.rate, row.natura);
    seen.add(key);
    if (isZero(row.rate) && !row.natura) {
      findings.push(
        finding(
          "00429",
          "DatiRiepilogo with AliquotaIVA 0,00 needs a Natura code (2.2.2.2).",
          "2.2.2.2",
          `vatBreakdown.${index}.natura`,
        ),
      );
    }
    if (!isZero(row.rate) && row.natura) {
      findings.push(
        finding(
          "00430",
          `DatiRiepilogo with AliquotaIVA ${money(row.rate)} must not carry Natura "${row.natura}".`,
          "2.2.2.2",
          `vatBreakdown.${index}.natura`,
        ),
      );
    }
    if (cmp(row.rate, "0") < 0 || cmp(row.rate, "100") > 0) {
      findings.push(
        finding(
          "00424",
          `DatiRiepilogo AliquotaIVA ${money(row.rate)} is not a percentage between 0,00 and 100,00.`,
          "2.2.2.1",
          `vatBreakdown.${index}.rate`,
        ),
      );
    }
    const expectedTax = mul(money(row.taxableAmount), mul(money(row.rate), "0.01"));
    if (!within(expectedTax, row.taxAmount, EURO)) {
      findings.push(
        finding(
          "00421",
          `DatiRiepilogo Imposta ${money(row.taxAmount)} differs by more than 1,00 EUR from ` +
            `ImponibileImporto ${money(row.taxableAmount)} x ${money(row.rate)}% = ${money(expectedTax)}.`,
          "2.2.2.6",
          `vatBreakdown.${index}.taxAmount`,
        ),
      );
    }
    const fromLines = lineTotals.get(key) ?? "0";
    if (!within(fromLines, row.taxableAmount, EURO)) {
      findings.push(
        finding(
          "00422",
          `DatiRiepilogo ImponibileImporto ${money(row.taxableAmount)} differs by more than ` +
            `1,00 EUR from the sum of the matching PrezzoTotale values ${money(fromLines)}.`,
          "2.2.2.5",
          `vatBreakdown.${index}.taxableAmount`,
        ),
      );
    }
  });

  invoice.lines.forEach((line, index) => {
    const key = summaryKey(line.vat.rate, line.vat.natura);
    if (seen.has(key)) return;
    const natura = line.vat.natura ? ` / Natura ${line.vat.natura}` : "";
    findings.push(
      finding(
        "00419",
        `No DatiRiepilogo for AliquotaIVA ${money(line.vat.rate)}${natura}, which line ${line.id} uses.`,
        "2.2.2",
        `lines.${index}.vat.rate`,
      ),
    );
  });
}

function checkDocument(invoice: Invoice, options: SdiOptions, findings: SdiFinding[]): void {
  if (!/\d/.test(invoice.number)) {
    findings.push(
      finding(
        "00425",
        `Numero "${invoice.number}" must contain at least one digit.`,
        "2.1.1.4",
        "number",
      ),
    );
  }
  const receivedOn = options.receivedOn ?? new Date().toISOString().slice(0, 10);
  if (invoice.issueDate > receivedOn) {
    findings.push(
      finding(
        "00403",
        `Data ${invoice.issueDate} is later than the date the invoice reaches SDI (${receivedOn}).`,
        "2.1.1.3",
        "issueDate",
      ),
    );
  }
}

function checkParties(invoice: Invoice, findings: SdiFinding[]): void {
  const buyer = invoice.buyer;
  if (!buyer.vatId && !buyer.taxId) {
    findings.push(
      finding(
        "00417",
        "CessionarioCommittente needs either IdFiscaleIVA (1.4.1.1) or CodiceFiscale (1.4.1.2).",
        "1.4.1.2",
        "buyer.vatId",
      ),
    );
  }

  const tipoDocumento = TIPO_DOCUMENTO[invoice.typeCode];
  if (SELF_BILLING_FORBIDDEN.has(tipoDocumento)) {
    const seller = splitVatId(invoice.seller.vatId, invoice.seller.address.country);
    const customer = splitVatId(buyer.vatId, buyer.address.country);
    const sameVat =
      Boolean(seller.code) && seller.code === customer.code && seller.country === customer.country;
    const sameTax = Boolean(invoice.seller.taxId) && invoice.seller.taxId === buyer.taxId;
    if (sameVat || sameTax) {
      findings.push(
        finding(
          "00471",
          `CedentePrestatore and CessionarioCommittente are the same taxpayer, which ` +
            `${tipoDocumento} does not allow.`,
          "1.4.1.1.2",
          "buyer.vatId",
        ),
      );
    }
  }
}

function checkTransmission(invoice: Invoice, options: SdiOptions, findings: SdiFinding[]): void {
  const country = invoice.buyer.address.country;
  const transmission = options.transmission ?? {
    codiceDestinatario: codiceDestinatario(invoice.buyer.channel, country),
    formatoTrasmissione: formatoTrasmissione(invoice.buyer.channel, country),
  };
  const { codiceDestinatario: codice, formatoTrasmissione: formato } = transmission;
  const expected =
    formato === FORMATO_TRASMISSIONE_B2G
      ? CODICE_DESTINATARIO_LENGTH_B2G
      : CODICE_DESTINATARIO_LENGTH_B2B;
  if (codice.length === expected) return;
  findings.push(
    finding(
      formato === FORMATO_TRASMISSIONE_B2G ? "00426" : "00427",
      `CodiceDestinatario "${codice}" is ${codice.length} characters but ` +
        `FormatoTrasmissione ${formato} requires ${expected}.`,
      "1.1.4",
      "buyer.channel.codiceDestinatario",
    ),
  );
}

export function checkSdi(invoice: Invoice, options: SdiOptions = {}): SdiFinding[] {
  const findings: SdiFinding[] = [];
  checkDocument(invoice, options, findings);
  checkTransmission(invoice, options, findings);
  checkParties(invoice, findings);
  checkLines(invoice, findings);
  checkSummaries(invoice, findings);
  return findings;
}
