import { describe, expect, it } from "vitest";

import { getFormat } from "../src/formats";
import { getField } from "../src/model";
import { PRESET_IDS, preset } from "../src/presets";
import { carriageOf, lostFields, transmittable, unmatchedFields } from "../src/transmittable";
import { LOSS_KIND, UAPI_LOSSY_FIELDS } from "../src/uapi-map";

describe("LOSS_KIND", () => {
  it("classifies every declared loss, with nothing stale", () => {
    const reasons = Object.keys(UAPI_LOSSY_FIELDS);
    expect(reasons.filter((reason) => !(reason in LOSS_KIND))).toEqual([]);
    expect(Object.keys(LOSS_KIND).filter((key) => !reasons.includes(key))).toEqual([]);
  });

  it("keeps what fiskaly supplies out of the lost bucket", () => {
    // The seller identity comes from the commissioned Taxpayer and BT-3 is derived. Both are
    // uncarried; both still appear in the transmitted document, so neither may be suppressed.
    const supplied = Object.entries(LOSS_KIND).filter(
      ([reason]) => reason.includes("taxpayer resource") || reason.includes("derived by fiskaly"),
    );
    expect(supplied.length).toBe(2);
    for (const [, kind] of supplied) expect(kind).toBe("platform");
  });
});

describe("transmittable", () => {
  it("drops what nothing delivers", () => {
    const invoice = preset("it-b2b-sdi");
    const lost = lostFields(invoice, "fatturapa");
    // The gateway does not implement AltriDatiGestionali, so predicting it is predicting a lie.
    expect(lost.some((field) => field.includes("altriDatiGestionali"))).toBe(true);
    const before = getFormat("fatturapa").write(invoice);
    const after = getFormat("fatturapa").write(transmittable(invoice, "fatturapa"));
    expect(before).toContain("AltriDatiGestionali");
    expect(after).not.toContain("AltriDatiGestionali");
  });

  it("keeps the seller, which fiskaly fills from the taxpayer", () => {
    const invoice = preset("it-b2b-sdi");
    expect(lostFields(invoice, "fatturapa")).not.toContain("seller.name");
    const xml = getFormat("fatturapa").write(transmittable(invoice, "fatturapa"));
    expect(xml).toContain(invoice.seller.name);
  });

  it("never drops the buyer's electronic address from a Peppol document", () => {
    // BT-49 rides on recipients[].invoicing as the participant id. Suppressing it would make the
    // prediction fail Peppol's own mandatory-endpoint rule — a wrong prediction, not a finding.
    for (const id of ["be-peppol", "de-hotel-b2g-xrechnung"] as const) {
      const invoice = preset(id);
      const format = getFormat(invoice.format);
      expect(format.write(transmittable(invoice, format.id))).toContain("EndpointID");
    }
  });

  it("leaves every preset still writable after stripping", () => {
    for (const id of PRESET_IDS) {
      const invoice = preset(id);
      const format = getFormat(invoice.format);
      expect(() => format.write(transmittable(invoice, format.id))).not.toThrow();
    }
  });
});

describe("unmatchedFields", () => {
  it("lists only fields this invoice actually renders", () => {
    const invoice = preset("it-b2b-sdi");
    for (const entry of unmatchedFields(invoice, "fatturapa")) {
      const value = getField(invoice, entry.field);
      expect(value, entry.field).not.toBe(undefined);
      expect(value, entry.field).not.toBe("");
    }
  });

  it("never lists something it also suppresses", () => {
    for (const id of PRESET_IDS) {
      const invoice = preset(id);
      const format = getFormat(invoice.format).id;
      const lost = new Set(lostFields(invoice, format));
      for (const entry of unmatchedFields(invoice, format)) {
        expect(lost.has(entry.field), `${id}: ${entry.field}`).toBe(false);
      }
    }
  });

  it("carries a reason for every entry", () => {
    const invoice = preset("de-hotel-b2g-xrechnung");
    const entries = unmatchedFields(invoice, "xrechnung");
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.why.length).toBeGreaterThan(20);
  });
});

describe("carriageOf", () => {
  it("separates carried, platform-supplied and unclassified", () => {
    const invoice = preset("it-b2b-sdi");
    expect(carriageOf("number", invoice)).toBe("carried");
    expect(carriageOf("note", invoice)).toBe("carried");
    expect(carriageOf("seller.name", invoice)).toBe("platform");
    // CUP is only populated on the public-administration preset, and lossyGroups narrows to
    // fields an invoice actually carries.
    expect(carriageOf("it.cup", preset("it-restaurant-b2g-fpa12"))).toBe("lost");
  });
});
