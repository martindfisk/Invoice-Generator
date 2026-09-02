import { describe, expect, it } from "vitest";
import type { FormatId } from "../src/model";
import { preset, PRESET_IDS } from "../src/presets";
import { FATTURAPA_FATES, fateFor } from "../src/uapi-field-fate";
import { toInvoiceTransaction } from "../src/uapi-map";

const FATES = ["mapped", "not-rendered", "discarded", "platform"] as const;

describe("FATTURAPA_FATES", () => {
  it("is a well-formed table: unique template pointers, sentence notes, one of four fates", () => {
    const pointers = FATTURAPA_FATES.map((entry) => entry.pointer);
    expect(new Set(pointers).size).toBe(pointers.length);
    for (const entry of FATTURAPA_FATES) {
      expect(entry.pointer.startsWith("/")).toBe(true);
      // Repeated groups are keyed as templates; concrete indices belong to the caller.
      expect(entry.pointer).not.toMatch(/\/\d+(\/|$)/);
      expect(FATES).toContain(entry.fate);
      // The note is shown to a user: a sentence, not a keyword.
      expect(entry.note.length).toBeGreaterThan(30);
      expect(entry.note.endsWith(".")).toBe(true);
    }
  });

  it("names the XML element for every mapped fate and none for not-rendered", () => {
    for (const entry of FATTURAPA_FATES) {
      if (entry.fate === "mapped") expect(entry.element, entry.pointer).toBeTruthy();
      if (entry.fate === "not-rendered") expect(entry.element, entry.pointer).toBeUndefined();
    }
  });

  it("records the headline facts: breakdown and totals are discarded yet schema-required", () => {
    for (const pointer of ["/breakdown", "/totals"]) {
      const entry = fateFor("fatturapa", pointer);
      expect(entry?.fate).toBe("discarded");
      expect(entry?.note).toMatch(/recomputed/i);
      expect(entry?.note).toMatch(/requires? /i);
      expect(entry?.note).toMatch(/must be sent/i);
    }
  });

  it("records that the seller is platform data and only the contact point is request-authored", () => {
    expect(fateFor("fatturapa", "/seller")?.fate).toBe("platform");
    expect(fateFor("fatturapa", "/seller")?.note).toMatch(/Taxpayer/);
    expect(fateFor("fatturapa", "/seller/name")?.fate).toBe("not-rendered");
    expect(fateFor("fatturapa", "/seller/phone")?.fate).toBe("mapped");
    expect(fateFor("fatturapa", "/seller/email")?.fate).toBe("mapped");
    expect(fateFor("fatturapa", "/tax_representative")?.fate).toBe("not-rendered");
  });

  it("records that MP and TP codes are platform-derived and unreachable from the model", () => {
    const modalita = fateFor("fatturapa", "/payments/0/instruction/type");
    expect(modalita?.fate).toBe("platform");
    expect(modalita?.element).toBe("DettaglioPagamento/ModalitaPagamento");
    expect(modalita?.note).toMatch(/italianMeansCode/);
    const condizioni = fateFor("fatturapa", "/payments/0/type");
    expect(condizioni?.fate).toBe("platform");
    expect(condizioni?.element).toBe("DatiPagamento/CondizioniPagamento");
    expect(condizioni?.note).toMatch(/payment\.conditions/);
  });

  it("records issued_at as mapped but optional: the spec requires only document.number", () => {
    const entry = fateFor("fatturapa", "/document/issued_at");
    expect(entry?.fate).toBe("mapped");
    expect(entry?.element).toBe("DatiGeneraliDocumento/Data");
    expect(entry?.note).toMatch(/only document\.number/);
    expect(entry?.note).toMatch(/transmission date/);
  });

  it("records unit.measure as free text that did not render, while we keep UN/ECE codes", () => {
    const entry = fateFor("fatturapa", "/entries/0/data/unit/measure");
    expect(entry?.fate).toBe("not-rendered");
    expect(entry?.note).toMatch(/free text/i);
    expect(entry?.note).toMatch(/UN\/ECE/);
  });
});

describe("fateFor", () => {
  it("resolves concrete indices against {i} templates, like fieldForPointer does", () => {
    expect(fateFor("fatturapa", "/entries/0/details/description")?.fate).toBe("discarded");
    expect(fateFor("fatturapa", "/entries/7/details/number")?.fate).toBe("discarded");
    expect(fateFor("fatturapa", "/recipients/0/company_id")?.fate).toBe("not-rendered");
    expect(fateFor("fatturapa", "/recipients/0/buyer_id")?.fate).toBe("not-rendered");
    expect(fateFor("fatturapa", "/payments/0/details/date")?.element).toBe(
      "DettaglioPagamento/DataScadenzaPagamento",
    );
  });

  it("strips the CORRECTION data wrapper", () => {
    expect(fateFor("fatturapa", "/data/breakdown")?.fate).toBe("discarded");
    expect(fateFor("fatturapa", "/data/entries/1/data/text")?.fate).toBe("mapped");
    expect(fateFor("fatturapa", "/data/seller/name")?.fate).toBe("not-rendered");
  });

  it("lets a pointer inherit the fate of its closest listed ancestor", () => {
    expect(fateFor("fatturapa", "/breakdown/0/amount")?.pointer).toBe("/breakdown");
    expect(fateFor("fatturapa", "/totals/vat/inclusive")?.pointer).toBe("/totals");
    expect(fateFor("fatturapa", "/recipients/0/shipping/date")?.fate).toBe("not-rendered");
    expect(fateFor("fatturapa", "/recipients/0/address/region")?.fate).toBe("mapped");
    expect(fateFor("fatturapa", "/tax_representative/vat_number")?.fate).toBe("not-rendered");
    expect(fateFor("fatturapa", "/document/references/preceding_document/number")?.fate).toBe(
      "mapped",
    );
  });

  it("prefers an exact entry over an ancestor", () => {
    // /seller is platform, but its children have their own, different fates.
    expect(fateFor("fatturapa", "/seller/name")?.pointer).toBe("/seller/name");
    expect(fateFor("fatturapa", "/seller/phone")?.pointer).toBe("/seller/phone");
    expect(fateFor("fatturapa", "/entries/0/details/concept")?.pointer).toBe(
      "/entries/{i}/details/concept",
    );
  });

  it("answers undefined where the capture proves nothing", () => {
    // README: project's fate is unknown; despatch_advice is schema-accepted but unproven.
    expect(fateFor("fatturapa", "/document/references/project")).toBeUndefined();
    expect(fateFor("fatturapa", "/document/references/despatch_advice")).toBeUndefined();
    expect(fateFor("fatturapa", "/entries/0/data/unit/factor")).toBeUndefined();
    expect(fateFor("fatturapa", "/recipients/0/invoicing/pec")).toBeUndefined();
    expect(fateFor("fatturapa", "")).toBeUndefined();
    expect(fateFor("fatturapa", "no-slash")).toBeUndefined();
  });

  it("claims nothing for formats the evidence does not cover", () => {
    for (const formatId of ["ubl", "xrechnung", "cii"] as FormatId[]) {
      expect(fateFor(formatId, "/breakdown")).toBeUndefined();
      expect(fateFor(formatId, "/entries/0/details/description")).toBeUndefined();
      expect(fateFor(formatId, "/seller")).toBeUndefined();
    }
  });
});

describe("what we send versus what FatturaPA keeps", () => {
  const operation = toInvoiceTransaction(preset("it-restaurant-b2b-fattura"));

  it("keeps emitting the fields the IT gateway discards or drops — the fate table is the fix", () => {
    // The evidence covers FatturaPA only; the schema accepts these fields and the UBL/CII
    // paths may use them, so the payload must not be trimmed to one syntax's behaviour.
    expect(operation.entries[0].details.description).toBe("8 coperti, sala Traiano");
    expect(operation.entries.map((entry) => entry.details.number)).toEqual(["1", "2", "3"]);
    const recipient = operation.recipients[0];
    expect(recipient.type).toBe("BUSINESS");
    expect(recipient.type === "BUSINESS" && recipient.company_id).toBe("03456789012");
    expect(operation.breakdown.length).toBeGreaterThan(0);
    expect(operation.totals.vat.inclusive).toBe("458.80");

    for (const pointer of [
      "/entries/0/details/description",
      "/entries/0/details/number",
      "/recipients/0/company_id",
      "/breakdown",
      "/totals",
    ]) {
      const fate = fateFor("fatturapa", pointer)?.fate;
      expect(fate === "discarded" || fate === "not-rendered", pointer).toBe(true);
    }
  });

  it("carries BT-136 and BT-141 only when the line sets them", () => {
    // The gap this used to pin is closed: entries[].data.value.discount (BT-136) and .surcharge
    // (BT-141) now ride on lines[].uapi, which no XML writer here renders — so they reach the
    // operation without claiming a rendering. A line that sets neither must serialise to a value
    // block of exactly `base`, or every golden would gain two null keys.
    for (const id of PRESET_IDS) {
      const lines = preset(id).lines;
      toInvoiceTransaction(preset(id)).entries.forEach((entry, index) => {
        const declared = lines[index]?.uapi;
        const keys = Object.keys(JSON.parse(JSON.stringify(entry.data.value)));
        if (declared?.allowance === undefined && declared?.surcharge === undefined) {
          expect(keys, `${id} line ${index}`).toEqual(["base"]);
        } else {
          expect(keys, `${id} line ${index}`).toContain("discount");
        }
      });
    }
    const base = preset("it-b2b-sdi");
    const withAllowance = {
      ...base,
      lines: base.lines.map((line, index) =>
        index === 0 ? { ...line, uapi: { allowance: "15.00", surcharge: "2.50" } } : line,
      ),
    };
    const value = toInvoiceTransaction(withAllowance).entries[0].data.value;
    expect(value.discount).toBe("15.00");
    expect(value.surcharge).toBe("2.50");
  });

  it("keeps the HUR-based concept heuristic that matched the tested consulting line", () => {
    // The tested payload's consulting service carried concept SERVICE; our hour-billed
    // consulting line emits the same. Piece-billed restaurant lines emit GOOD. The capture
    // shows no FatturaPA element depending on concept, so the coarse heuristic has no
    // observable XML consequence on the IT path.
    const consulting = toInvoiceTransaction(preset("it-b2b-sdi"));
    expect(consulting.entries[0].data.unit.measure).toBe("HUR");
    expect(consulting.entries[0].details.concept).toBe("SERVICE");
    expect(operation.entries.map((entry) => entry.details.concept)).toEqual([
      "GOOD",
      "GOOD",
      "GOOD",
    ]);
  });

  it("keeps UN/ECE unit codes although the tested payload used free text", () => {
    expect(operation.entries[0].data.unit.measure).toBe("C62");
  });

  it("keeps sending issued_at although the spec lets it be omitted", () => {
    expect(operation.document.issued_at).toBe("2026-08-24T00:00:00+00:00");
  });
});
