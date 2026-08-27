import { describe, expect, it } from "vitest";
import { writeFatturapa } from "../src/fatturapa-write";
import type { Invoice } from "../src/model";
import { preset } from "../src/presets";

function totalOf(xml: string): string | undefined {
  return /<ImportoTotaleDocumento>([^<]*)<\/ImportoTotaleDocumento>/.exec(xml)?.[1];
}

describe("ImportoTotaleDocumento (FatturaPA 2.1.1.9)", () => {
  it("is the VAT-inclusive total, not the amount due", () => {
    const base = preset("it-restaurant-b2b-fattura");
    const withPrepayment: Invoice = {
      ...base,
      totals: { ...base.totals, prepaid: "100.00", payable: "358.80" },
    };
    expect(withPrepayment.totals.taxInclusive).toBe("458.80");
    expect(totalOf(writeFatturapa(withPrepayment))).toBe("458.80");
    expect(totalOf(writeFatturapa(withPrepayment))).not.toBe("358.80");
  });

  it("is unchanged for invoices with nothing prepaid", () => {
    const base = preset("it-restaurant-b2b-fattura");
    expect(totalOf(writeFatturapa(base))).toBe(base.totals.taxInclusive);
  });
});
