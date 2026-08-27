import type { Invoice } from "./model";
import type { Finding } from "./validation";

const IBAN_CHECKSUM_RULES = new Set(["BR-DE-19", "DE-R-019"]);

const A_CODE = "A".charCodeAt(0);

export function normaliseIban(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function ibanChecksumRemainder(value: string): bigint | null {
  const iban = normaliseIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(iban)) return null;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let digits = "";
  for (const character of rearranged) {
    if (character >= "0" && character <= "9") {
      digits += character;
      continue;
    }
    digits += String(character.charCodeAt(0) - A_CODE + 10);
  }
  return BigInt(digits) % 97n;
}

export function isValidIban(value: string): boolean {
  return ibanChecksumRemainder(value) === 1n;
}

const SAXON_NOTE =
  "Verified independently with exact integer arithmetic: this IBAN's ISO 13616 remainder is 1, " +
  "so it is valid. SaxonJS 2.7 evaluates xs:integer mod in IEEE-754 doubles, which loses precision " +
  "above 2^53 and makes this rule misfire on most real IBANs. Reported as a known engine defect, " +
  "not a problem with the invoice.";

export function annotateKnownDefects(findings: Finding[], invoice: Invoice): Finding[] {
  const iban = invoice.payment?.iban;
  if (!iban || !isValidIban(iban)) return findings;
  return findings.map((finding) => {
    if (!IBAN_CHECKSUM_RULES.has(finding.ruleId)) return finding;
    return {
      ...finding,
      severity: "info",
      message: `${finding.message} — false positive. ${SAXON_NOTE}`,
    };
  });
}
