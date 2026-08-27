import { abs, add, cmp, eq, format, percentOf, sub, sum } from "./decimal";
import type { FieldId, Invoice, VatCategory } from "./model";

export type Severity = "fatal" | "error" | "warning" | "info";

export type Finding = {
  source: "model";
  ruleId: string;
  severity: Severity;
  message: string;
  field?: FieldId;
};

const AMOUNT_DP = 2;
const TAX_TOLERANCE = "0.01";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;
const SDI_CODE = /^[A-Z0-9]{6,7}$/;
const PEPPOL_ID = /^[0-9]{4}:[a-zA-Z0-9._/, -]{1,59}$/;

const SUM_RULE: Record<VatCategory, string> = {
  S: "BR-S-08",
  Z: "BR-Z-08",
  E: "BR-E-08",
  AE: "BR-AE-08",
  K: "BR-IC-08",
  G: "BR-G-08",
  O: "BR-O-08",
};

const REASON_RULE: Record<string, string> = {
  E: "BR-E-10",
  AE: "BR-AE-10",
  K: "BR-IC-10",
  G: "BR-G-10",
  O: "BR-O-10",
};

const PRESENCE_RULE: Record<VatCategory, string> = {
  S: "BR-S-01",
  Z: "BR-Z-01",
  E: "BR-E-01",
  AE: "BR-AE-01",
  K: "BR-IC-01",
  G: "BR-G-01",
  O: "BR-O-01",
};

const RATE_RULE: Record<VatCategory, string> = {
  S: "BR-S-05",
  Z: "BR-Z-05",
  E: "BR-E-05",
  AE: "BR-AE-05",
  K: "BR-IC-05",
  G: "BR-G-05",
  O: "BR-O-05",
};

function finding(ruleId: string, severity: Severity, message: string, field?: FieldId): Finding {
  return { source: "model", ruleId, severity, message, field };
}

function money(value: string): string {
  return format(value, AMOUNT_DP);
}

function breakdownKey(row: { category: VatCategory; rate: string }): string {
  return `${row.category}|${money(row.rate)}`;
}

function checkTotals(invoice: Invoice, findings: Finding[]): void {
  const totals = invoice.totals;
  const lineSum = money(sum(invoice.lines.map((line) => line.netAmount)));
  if (!eq(lineSum, totals.lineExtension)) {
    findings.push(
      finding(
        "BR-CO-10",
        "error",
        `Sum of invoice line net amounts (BT-106) is ${money(totals.lineExtension)} but the lines add up to ${lineSum}.`,
        "totals.lineExtension",
      ),
    );
  }

  const expectedExclusive = money(
    add(sub(totals.lineExtension, totals.allowance ?? "0"), totals.charge ?? "0"),
  );
  if (!eq(expectedExclusive, totals.taxExclusive)) {
    findings.push(
      finding(
        "BR-CO-13",
        "error",
        `Invoice total without VAT (BT-109) is ${money(totals.taxExclusive)} but BT-106 - BT-107 + BT-108 is ${expectedExclusive}.`,
        "totals.taxExclusive",
      ),
    );
  }

  const breakdownTax = money(sum(invoice.vatBreakdown.map((row) => row.taxAmount)));
  if (!eq(breakdownTax, totals.taxAmount)) {
    findings.push(
      finding(
        "BR-CO-14",
        "error",
        `Invoice total VAT amount (BT-110) is ${money(totals.taxAmount)} but the VAT breakdown adds up to ${breakdownTax}.`,
        "totals.taxAmount",
      ),
    );
  }

  const expectedInclusive = money(add(totals.taxExclusive, totals.taxAmount));
  if (!eq(expectedInclusive, totals.taxInclusive)) {
    findings.push(
      finding(
        "BR-CO-15",
        "error",
        `Invoice total with VAT (BT-112) is ${money(totals.taxInclusive)} but BT-109 + BT-110 is ${expectedInclusive}.`,
        "totals.taxInclusive",
      ),
    );
  }

  const expectedPayable = money(
    add(sub(totals.taxInclusive, totals.prepaid ?? "0"), totals.rounding ?? "0"),
  );
  if (!eq(expectedPayable, totals.payable)) {
    findings.push(
      finding(
        "BR-CO-16",
        "error",
        `Amount due for payment (BT-115) is ${money(totals.payable)} but BT-112 - BT-113 + BT-114 is ${expectedPayable}.`,
        "totals.payable",
      ),
    );
  }
}

function checkBreakdown(invoice: Invoice, findings: Finding[]): void {
  if (invoice.vatBreakdown.length === 0) {
    findings.push(
      finding(
        "BR-CO-18",
        "error",
        "An invoice needs at least one VAT breakdown group (BG-23).",
        "vatBreakdown",
      ),
    );
    return;
  }

  invoice.vatBreakdown.forEach((row, index) => {
    const expected = money(percentOf(row.taxableAmount, row.rate));
    if (cmp(abs(sub(expected, row.taxAmount)), TAX_TOLERANCE) === 1) {
      findings.push(
        finding(
          "BR-CO-17",
          "error",
          `VAT category tax amount (BT-117) is ${money(row.taxAmount)} but ${money(row.taxableAmount)} x ${money(row.rate)}% is ${expected}.`,
          `vatBreakdown.${index}.taxAmount`,
        ),
      );
    }

    const reasonRule = REASON_RULE[row.category];
    if (reasonRule && !row.reason && !row.vatexCode) {
      findings.push(
        finding(
          reasonRule,
          "error",
          `VAT category ${row.category} needs an exemption reason (BT-120) or reason code (BT-121).`,
          `vatBreakdown.${index}.reason`,
        ),
      );
    }
  });

  const lineTotals = new Map<string, string>();
  for (const line of invoice.lines) {
    const key = breakdownKey(line.vat);
    lineTotals.set(key, add(lineTotals.get(key) ?? "0", line.netAmount));
  }

  const seen = new Set<string>();
  invoice.vatBreakdown.forEach((row, index) => {
    const key = breakdownKey(row);
    seen.add(key);
    const linesTotal = money(lineTotals.get(key) ?? "0");
    if (!eq(linesTotal, row.taxableAmount)) {
      findings.push(
        finding(
          SUM_RULE[row.category],
          "error",
          `VAT category taxable amount (BT-116) for ${row.category} at ${money(row.rate)}% is ${money(row.taxableAmount)} but the matching lines add up to ${linesTotal}.`,
          `vatBreakdown.${index}.taxableAmount`,
        ),
      );
    }
  });

  invoice.lines.forEach((line, index) => {
    if (seen.has(breakdownKey(line.vat))) return;
    findings.push(
      finding(
        PRESENCE_RULE[line.vat.category],
        "error",
        `Line ${line.id} uses VAT category ${line.vat.category} at ${money(line.vat.rate)}% but there is no matching VAT breakdown group.`,
        `lines.${index}.vat.category`,
      ),
    );
  });
}

function checkChannel(invoice: Invoice, findings: Finding[]): void {
  const channel = invoice.buyer.channel;
  if (channel.kind === "SDI") {
    if (!SDI_CODE.test(channel.codiceDestinatario)) {
      findings.push(
        finding(
          "CHANNEL-SDI-CODE",
          "error",
          `SDI destination code "${channel.codiceDestinatario}" must be 6 (FPA12) or 7 (FPR12) upper-case alphanumeric characters.`,
          "buyer.channel.codiceDestinatario",
        ),
      );
    }
    if (channel.codiceDestinatario === "0000000" && !channel.pec) {
      findings.push(
        finding(
          "CHANNEL-SDI-PEC",
          "error",
          'Destination code "0000000" requires a PEC address for delivery.',
          "buyer.channel.pec",
        ),
      );
    }
    return;
  }
  if (channel.kind === "PEPPOL") {
    if (!PEPPOL_ID.test(channel.participantId)) {
      findings.push(
        finding(
          "CHANNEL-PEPPOL-ID",
          "error",
          `Peppol participant identifier "${channel.participantId}" must be <4-digit EAS>:<value>.`,
          "buyer.channel.participantId",
        ),
      );
    }
    return;
  }
  if (!channel.email.includes("@")) {
    findings.push(
      finding(
        "CHANNEL-EMAIL",
        "error",
        `"${channel.email}" is not an email address.`,
        "buyer.channel.email",
      ),
    );
  }
}

function checkDocument(invoice: Invoice, findings: Finding[]): void {
  if (!invoice.number) {
    findings.push(finding("BR-2", "error", "An invoice needs an invoice number (BT-1).", "number"));
  }
  if (!ISO_DATE.test(invoice.issueDate)) {
    findings.push(
      finding(
        "BR-3",
        "error",
        `Invoice issue date (BT-2) "${invoice.issueDate}" is not an ISO 8601 date (YYYY-MM-DD).`,
        "issueDate",
      ),
    );
  }
  if (invoice.dueDate !== undefined && !ISO_DATE.test(invoice.dueDate)) {
    findings.push(
      finding(
        "BR-CO-25",
        "error",
        `Payment due date (BT-9) "${invoice.dueDate}" is not an ISO 8601 date (YYYY-MM-DD).`,
        "dueDate",
      ),
    );
  }
  if (
    invoice.dueDate !== undefined &&
    ISO_DATE.test(invoice.dueDate) &&
    ISO_DATE.test(invoice.issueDate) &&
    invoice.dueDate < invoice.issueDate
  ) {
    findings.push(
      finding(
        "BR-CO-25",
        "warning",
        `Payment due date (BT-9) ${invoice.dueDate} is before the issue date ${invoice.issueDate}.`,
        "dueDate",
      ),
    );
  }
  if (!CURRENCY.test(invoice.currency)) {
    findings.push(
      finding(
        "BR-5",
        "error",
        `Invoice currency code (BT-5) "${invoice.currency}" is not an ISO 4217 alpha-3 code.`,
        "currency",
      ),
    );
  }
  if (cmp(invoice.totals.payable, "0") === 1 && !invoice.dueDate && !invoice.payment.terms) {
    findings.push(
      finding(
        "BR-CO-25",
        "error",
        "An amount due for payment (BT-115) greater than zero needs a due date (BT-9) or payment terms (BT-20).",
        "dueDate",
      ),
    );
  }
}

function checkParties(invoice: Invoice, findings: Finding[]): void {
  if (!invoice.seller.vatId && !invoice.seller.legalRegId && !invoice.seller.taxId) {
    findings.push(
      finding(
        "BR-CO-26",
        "error",
        "The seller needs a VAT identifier (BT-31), a legal registration identifier (BT-30) or a tax registration identifier (BT-32).",
        "seller.vatId",
      ),
    );
  }
  for (const [role, party] of [
    ["seller", invoice.seller],
    ["buyer", invoice.buyer],
  ] as const) {
    if (!COUNTRY.test(party.address.country)) {
      findings.push(
        finding(
          role === "seller" ? "BR-09" : "BR-11",
          "error",
          `The ${role} postal address needs an ISO 3166-1 alpha-2 country code.`,
          `${role}.address.country`,
        ),
      );
    }
    if (party.vatId && !COUNTRY.test(party.vatId.slice(0, 2))) {
      findings.push(
        finding(
          "BR-CO-09",
          "error",
          `The ${role} VAT identifier "${party.vatId}" must start with an ISO 3166-1 alpha-2 country code.`,
          `${role}.vatId`,
        ),
      );
    }
  }
}

// EN 16931 knows no consumer: BR-CO-26 asks the *seller* for an identifier and no rule asks the
// buyer for a VAT id, so a private individual needs no exemption from anything here. What a natural
// person does need is the identifier that replaces the missing partita IVA. A natural person who
// holds one is a sole trader, not a consumer, and is deliberately left alone.
function checkNaturalPerson(invoice: Invoice, findings: Finding[]): void {
  const person = invoice.buyer.person;
  if (!person) return;
  if (!invoice.buyer.vatId && !invoice.buyer.taxId) {
    findings.push(
      finding(
        "CONSUMER-TAX-ID",
        "error",
        "A buyer who is a private individual needs a tax registration identifier (codice fiscale): FatturaPA carries it in CessionarioCommittente/DatiAnagrafici/CodiceFiscale and SDI check 00417 accepts nothing else once IdFiscaleIVA is absent.",
        "buyer.taxId",
      ),
    );
  }
  if (invoice.buyer.name !== `${person.forename} ${person.surname}`) {
    findings.push(
      finding(
        "PERSON-NAME",
        "warning",
        `Buyer name (BT-44) "${invoice.buyer.name}" is not "${person.forename} ${person.surname}". FatturaPA writes Nome and Cognome instead of Denominazione for a natural person, so reading the XML back rebuilds BT-44 from those two.`,
        "buyer.name",
      ),
    );
  }
}

function checkCategoryRates(invoice: Invoice, findings: Finding[]): void {
  invoice.lines.forEach((line, index) => {
    const zeroRated = line.vat.category !== "S";
    if (zeroRated && !eq(line.vat.rate, "0")) {
      findings.push(
        finding(
          RATE_RULE[line.vat.category],
          "error",
          `Line ${line.id} uses VAT category ${line.vat.category}, which requires a zero rate, but carries ${money(line.vat.rate)}%.`,
          `lines.${index}.vat.rate`,
        ),
      );
    }
    if (!zeroRated && eq(line.vat.rate, "0")) {
      findings.push(
        finding(
          RATE_RULE.S,
          "error",
          `Line ${line.id} uses VAT category S, which requires a rate greater than zero.`,
          `lines.${index}.vat.rate`,
        ),
      );
    }
  });
}

export function checkModel(invoice: Invoice): Finding[] {
  const findings: Finding[] = [];
  checkDocument(invoice, findings);
  checkParties(invoice, findings);
  checkNaturalPerson(invoice, findings);
  checkTotals(invoice, findings);
  checkBreakdown(invoice, findings);
  checkCategoryRates(invoice, findings);
  checkChannel(invoice, findings);
  return findings;
}
