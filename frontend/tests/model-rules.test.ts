import { describe, expect, it } from "vitest";
import { checkModel } from "../src/model-rules";
import { setField, type Invoice } from "../src/model";
import { preset } from "../src/presets";

function ruleIds(invoice: Invoice): string[] {
  return checkModel(invoice)
    .map((finding) => finding.ruleId)
    .sort();
}

describe("checkModel", () => {
  it("accepts the two well-formed presets", () => {
    expect(checkModel(preset("it-b2b-sdi"))).toEqual([]);
    expect(checkModel(preset("be-peppol"))).toEqual([]);
  });

  it("reports exactly the four defects of the broken preset", () => {
    expect(ruleIds(preset("broken"))).toEqual(["BR-11", "BR-CO-14", "BR-E-10", "CHANNEL-SDI-PEC"]);
  });

  it("points every finding at the field that carries the defect", () => {
    const byRule = new Map(checkModel(preset("broken")).map((f) => [f.ruleId, f.field]));
    expect(byRule.get("BR-11")).toBe("buyer.address.country");
    expect(byRule.get("BR-CO-14")).toBe("totals.taxAmount");
    expect(byRule.get("BR-E-10")).toBe("vatBreakdown.1.reason");
    expect(byRule.get("CHANNEL-SDI-PEC")).toBe("buyer.channel.pec");
  });

  it("BR-CO-10 flags a line sum that disagrees with BT-106", () => {
    const invoice = setField(preset("be-peppol"), "totals.lineExtension", "1000.00");
    expect(ruleIds(invoice)).toContain("BR-CO-10");
  });

  it("BR-CO-13 flags an inconsistent tax-exclusive total", () => {
    const invoice = setField(preset("be-peppol"), "totals.charge", "10.00");
    expect(ruleIds(invoice)).toContain("BR-CO-13");
  });

  it("BR-CO-15 and BR-CO-16 follow the total with VAT and the amount due", () => {
    const invoice = setField(preset("be-peppol"), "totals.taxInclusive", "1500.00");
    expect(ruleIds(invoice)).toEqual(expect.arrayContaining(["BR-CO-15", "BR-CO-16"]));
  });

  it("BR-CO-17 tolerates one cent but not two", () => {
    const within = setField(preset("be-peppol"), "vatBreakdown.0.taxAmount", "262.51");
    expect(ruleIds(within)).not.toContain("BR-CO-17");
    const beyond = setField(preset("be-peppol"), "vatBreakdown.0.taxAmount", "262.52");
    expect(ruleIds(beyond)).toContain("BR-CO-17");
  });

  it("BR-S-08 compares the breakdown against the lines of the same category and rate", () => {
    const invoice = setField(preset("be-peppol"), "lines.1.netAmount", "300.00");
    expect(ruleIds(invoice)).toContain("BR-S-08");
  });

  it("BR-S-01 flags a line whose category and rate have no breakdown row", () => {
    const invoice = setField(preset("be-peppol"), "lines.1.vat.rate", "6.00");
    expect(ruleIds(invoice)).toContain("BR-S-01");
  });

  it("BR-CO-18 flags a missing VAT breakdown", () => {
    const invoice = setField(preset("be-peppol"), "vatBreakdown", []);
    expect(ruleIds(invoice)).toContain("BR-CO-18");
  });

  it("BR-E-05 flags an exempt line that carries a rate", () => {
    const invoice = setField(preset("it-b2b-sdi"), "lines.2.vat.rate", "22.00");
    expect(ruleIds(invoice)).toContain("BR-E-05");
  });

  it("BR-CO-09 flags a VAT identifier without a country prefix", () => {
    const invoice = setField(preset("be-peppol"), "seller.vatId", "0999999999");
    expect(ruleIds(invoice)).toContain("BR-CO-09");
  });

  it("BR-CO-26 flags a seller with no identifier at all", () => {
    let invoice = setField(preset("be-peppol"), "seller.vatId", undefined);
    invoice = setField(invoice, "seller.legalRegId", undefined);
    invoice = setField(invoice, "seller.taxId", undefined);
    expect(ruleIds(invoice)).toContain("BR-CO-26");
  });

  it("BR-CO-25 wants a due date or payment terms when something is payable", () => {
    let invoice = setField(preset("be-peppol"), "dueDate", undefined);
    invoice = setField(invoice, "payment.terms", undefined);
    expect(ruleIds(invoice)).toContain("BR-CO-25");
  });

  it("BR-3 and BR-5 check the issue date and the currency code", () => {
    let invoice = setField(preset("be-peppol"), "issueDate", "26/08/2026");
    invoice = setField(invoice, "currency", "eur");
    expect(ruleIds(invoice)).toEqual(expect.arrayContaining(["BR-3", "BR-5"]));
  });

  it("CHANNEL-SDI-CODE checks the shape of the destination code", () => {
    const invoice = setField(preset("it-b2b-sdi"), "buyer.channel.codiceDestinatario", "abc");
    expect(ruleIds(invoice)).toContain("CHANNEL-SDI-CODE");
  });

  it("CHANNEL-PEPPOL-ID requires a four-digit EAS prefix", () => {
    const invoice = setField(preset("be-peppol"), "buyer.channel.participantId", "0888888888");
    expect(ruleIds(invoice)).toContain("CHANNEL-PEPPOL-ID");
  });

  it("CHANNEL-EMAIL checks an email channel", () => {
    const invoice = setField(preset("be-peppol"), "buyer.channel", {
      kind: "EMAIL",
      email: "not-an-address",
    });
    expect(ruleIds(invoice)).toContain("CHANNEL-EMAIL");
  });
});
