import { describe, expect, it } from "vitest";
import { annotateKnownDefects, ibanChecksumRemainder, isValidIban } from "../src/known-defects";
import { preset } from "../src/presets";
import type { Finding } from "../src/validation";

const brDe19: Finding = {
  source: "schematron",
  ruleId: "BR-DE-19",
  severity: "error",
  message: '"Payment account identifier" (BT-84) soll eine korrekte IBAN enthalten',
};

describe("iban checksum", () => {
  it("accepts real IBANs that IEEE-754 arithmetic rejects", () => {
    expect(ibanChecksumRemainder("DE89370400440532013000")).toBe(1n);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(Number("370400440532013000131489") % 97).not.toBe(1);
  });

  it("rejects a corrupted IBAN", () => {
    expect(isValidIban("DE88370400440532013000")).toBe(false);
  });

  it("ignores spacing and case", () => {
    expect(isValidIban("de89 3704 0044 0532 0130 00")).toBe(true);
  });

  it("returns null for something that is not an IBAN", () => {
    expect(ibanChecksumRemainder("not-an-iban")).toBeNull();
  });
});

describe("annotateKnownDefects", () => {
  it("downgrades the IBAN rule when the IBAN is provably valid", () => {
    const invoice = { ...preset("de-hotel-b2g-xrechnung") };
    expect(isValidIban(invoice.payment.iban ?? "")).toBe(true);
    const [annotated] = annotateKnownDefects([brDe19], invoice);
    expect(annotated.severity).toBe("info");
    expect(annotated.message).toContain("false positive");
    expect(annotated.message).toContain("SaxonJS");
  });

  it("leaves the finding alone when the IBAN really is wrong", () => {
    const invoice = preset("de-hotel-b2g-xrechnung");
    const broken = { ...invoice, payment: { ...invoice.payment, iban: "DE88370400440532013000" } };
    expect(annotateKnownDefects([brDe19], broken)[0].severity).toBe("error");
  });

  it("does not touch unrelated rules", () => {
    const other: Finding = { ...brDe19, ruleId: "BR-CO-14" };
    expect(annotateKnownDefects([other], preset("de-hotel-b2g-xrechnung"))[0].severity).toBe(
      "error",
    );
  });
});
