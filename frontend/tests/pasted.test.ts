import { beforeEach, describe, expect, it } from "vitest";
import { getFormat } from "../src/formats";
import { checkModel } from "../src/model-rules";
import {
  blankBase,
  defaultFormat,
  exampleText,
  formatsFor,
  placeholderSeller,
  recipientMismatch,
  sellerNote,
} from "../src/pasted";
import { preset } from "../src/presets";
import { buildOperation, lossyPointers, unwrapPayload } from "../src/uapi-json";
import { fromTaxpayer, type UapiOperation } from "../src/uapi-map";
import {
  freshWorkflow,
  initialWorkflow,
  loadPasted,
  operationBody,
  PASTED_SEND_NOTE,
  persistWorkflow,
  stepLock,
  workflowReducer,
  WORKFLOW_KEY,
  type WorkflowState,
} from "../src/workflow";

function operationOf(id: Parameters<typeof preset>[0]): UapiOperation {
  const built = buildOperation(preset(id), null);
  if (built.error !== null || built.value === null) throw new Error(built.error ?? "no operation");
  return built.value as UapiOperation;
}

function italianText(): string {
  return JSON.stringify(operationOf("it-b2b-sdi"), null, 2);
}

function loaded(text = italianText(), country: "IT" | "BE" | "DE" = "IT"): WorkflowState {
  return workflowReducer(freshWorkflow(), {
    type: "loadPayload",
    text,
    country,
    formatId: defaultFormat(country),
    at: 1,
  });
}

describe("unwrapPayload", () => {
  it("accepts the bare operation, the TRANSACTION record and the whole request body", () => {
    const operation = operationOf("be-peppol");
    expect(unwrapPayload(operation)).toEqual({
      operation,
      prefix: "",
      label: "TRANSACTION::INVOICE",
    });
    const record = { type: "TRANSACTION", record: { id: "int-1" }, operation };
    expect(unwrapPayload(record)).toMatchObject({ operation, prefix: "/operation" });
    expect(unwrapPayload({ content: record })).toMatchObject({
      operation,
      prefix: "/content/operation",
      label: "TRANSACTION::INVOICE",
    });
  });

  it("recognises a correction and names what it refuses", () => {
    const correction = {
      type: "CORRECTION",
      record: { id: "tx-1" },
      data: operationOf("it-restaurant-td04-credit"),
    };
    expect(unwrapPayload(correction).label).toBe("TRANSACTION::CORRECTION");
    expect(() => unwrapPayload({ type: "CORRECTION", record: { id: "x" } })).toThrow(/data/);
    expect(() => unwrapPayload({ type: "INTENTION", operation: { type: "TRANSACTION" } })).toThrow(
      /INTENTION/,
    );
    expect(() => unwrapPayload([])).toThrow(/JSON object/);
    expect(() => unwrapPayload({ hello: "world" })).toThrow(/Not a fiskaly e-invoice payload/);
  });
});

describe("loadPasted", () => {
  it("derives the model from the text alone — nothing from a preset leaks in", () => {
    const { invoice, label, prefix } = loadPasted(italianText(), "IT", "fatturapa");
    const source = preset("it-b2b-sdi");
    expect(label).toBe("TRANSACTION::INVOICE");
    expect(prefix).toBe("");
    expect(invoice.format).toBe("fatturapa");
    expect(invoice.number).toBe(source.number);
    expect(invoice.lines).toHaveLength(source.lines.length);
    expect(invoice.buyer.name).toBe(source.buyer.name);
    // The placeholder seller is the reference scenario's; the operation carries none.
    expect(invoice.seller).toEqual(placeholderSeller("IT"));
    // The blank base has no references, so the ones present come from the text.
    expect(invoice.references?.purchaseOrder).toBe(source.references?.purchaseOrder);
    expect(invoice.references?.invoicedObject).toBeUndefined();
  });

  it("decodes Italian CAUSE codes back to their Natura and category", () => {
    const text = JSON.stringify(operationOf("it-restaurant-reverse-charge"));
    const { invoice } = loadPasted(text, "IT", "fatturapa");
    expect(invoice.lines[0].vat).toMatchObject({ category: "AE", natura: "N6.7", rate: "0.00" });
    expect(invoice.vatBreakdown[0]).toMatchObject({ category: "AE", natura: "N6.7" });
    const intento = loadPasted(italianText(), "IT", "fatturapa").invoice;
    expect(intento.lines[2].vat).toMatchObject({ category: "E", natura: "N3.5" });
  });

  it("decodes the reverse-charge exemption code to AE outside Italy", () => {
    const text = JSON.stringify(operationOf("be-peppol-reverse-charge"));
    const { invoice } = loadPasted(text, "BE", "ubl");
    expect(invoice.lines.every((line) => line.vat.category === "AE")).toBe(true);
    expect(invoice.vatBreakdown[0].category).toBe("AE");
    expect(invoice.vatBreakdown[0].natura).toBeUndefined();
  });

  it("uses the seller and VAT context it is given", () => {
    const seller = fromTaxpayer({
      name: { legal: "Echte Firma GmbH" },
      address: {
        line: { street: "Hauptstrasse", number: "1" },
        code: "80331",
        city: "Muenchen",
        country: "DE",
      },
      vat_number: "DE999999999",
    });
    const text = JSON.stringify(operationOf("de-hotel-reverse-charge"));
    const { invoice } = loadPasted(text, "DE", "cii", seller, {
      country: "DE",
      vatExemptions: [{ code: "CAUSE_9", description: "Reverse charge (§ 13b UStG)" }],
    });
    expect(invoice.seller.name).toBe("Echte Firma GmbH");
    expect(invoice.lines[0].vat.category).toBe("AE");
  });

  it("every format the dialog offers renders the pasted example, and the model rules pass", () => {
    for (const country of ["IT", "BE", "DE"] as const) {
      expect(exampleText(country).length).toBeGreaterThan(100);
      for (const formatId of formatsFor(country)) {
        const { invoice } = loadPasted(exampleText(country), country, formatId);
        expect(() => getFormat(formatId).write(invoice)).not.toThrow();
        expect(checkModel(invoice), `${country}/${formatId} has model findings`).toEqual([]);
        expect(invoice.totals.lineExtension).toBe(invoice.totals.taxExclusive);
      }
    }
    expect(blankBase("BE", "ubl").lines).toEqual([]);
  });
});

describe("lossyPointers", () => {
  it("is empty for a text the model carries back exactly", () => {
    const { invoice } = loadPasted(italianText(), "IT", "fatturapa");
    expect(lossyPointers(invoice, JSON.parse(italianText()), "")).toEqual([]);
  });

  it("names the keys the predicted XML cannot reflect, at the prefix they sit under", () => {
    const operation = operationOf("it-b2b-sdi") as unknown as Record<string, unknown>;
    const edited = {
      ...operation,
      document: { ...(operation.document as object), vendor_note: "x" },
    };
    const body = { content: { type: "TRANSACTION", record: { id: "int-1" }, operation: edited } };
    const text = JSON.stringify(body);
    const { invoice, prefix } = loadPasted(text, "IT", "fatturapa");
    expect(prefix).toBe("/content/operation");
    const lost = lossyPointers(invoice, operationBody(text, prefix), "");
    expect(lost).toEqual(["/document/vendor_note"]);
  });
});

describe("recipientMismatch", () => {
  it("warns when the recipient block belongs to another country", () => {
    expect(recipientMismatch(operationOf("it-b2b-sdi"), "IT")).toBeNull();
    expect(recipientMismatch(operationOf("it-b2b-sdi"), "BE")).toMatch(/SDI/);
    expect(recipientMismatch(operationOf("be-peppol"), "IT")).toMatch(/SDI/);
    expect(recipientMismatch(operationOf("be-peppol"), "DE")).toMatch(/0208/);
    expect(recipientMismatch(operationOf("de-hotel-b2g-xrechnung"), "BE")).toMatch(/0204/);
    expect(recipientMismatch(operationOf("de-hotel-b2g-xrechnung"), "DE")).toBeNull();
    expect(recipientMismatch(operationOf("de-hotel-b2b-zugferd"), "DE")).toBeNull();
  });
});

describe("workflow reducer with a pasted payload", () => {
  beforeEach(() => localStorage.clear());

  it("loads the text verbatim as the JSON edit and opens the Mapper", () => {
    const state = loaded();
    expect(state.step).toBe("mapper");
    expect(state.presetId).toBeNull();
    expect(state.pasted).toMatchObject({
      country: "IT",
      formatId: "fatturapa",
      label: "TRANSACTION::INVOICE",
      prefix: "",
      sellerSource: "placeholder",
      at: 1,
    });
    expect(state.edit.json).toBe(italianText());
    expect(state.edit.source).toBe("json");
    expect(state.edit.jsonLossy).toBe(false);
    expect(state.invoice?.number).toBe(preset("it-b2b-sdi").number);
  });

  it("refuses a text that is not a payload and keeps the state", () => {
    const before = freshWorkflow();
    expect(
      workflowReducer(before, {
        type: "loadPayload",
        text: "{",
        country: "IT",
        formatId: "fatturapa",
      }),
    ).toBe(before);
    expect(
      workflowReducer(before, {
        type: "loadPayload",
        text: JSON.stringify({ type: "INTENTION" }),
        country: "IT",
        formatId: "fatturapa",
      }),
    ).toBe(before);
  });

  it("unlocks Mapper and Validate but keeps Send locked with the reason", () => {
    const state = loaded();
    expect(stepLock(state, "mapper")).toBeUndefined();
    expect(stepLock(state, "validate")).toBeUndefined();
    expect(stepLock(state, "send")).toBe(PASTED_SEND_NOTE);
    expect(workflowReducer(state, { type: "goToStep", step: "send" }).step).toBe("mapper");
    expect(workflowReducer(state, { type: "goToStep", step: "validate" }).step).toBe("validate");
  });

  it("ignores field and XML edits — the JSON pane is the single source", () => {
    const state = loaded();
    expect(workflowReducer(state, { type: "editField", field: "number", value: "X" })).toBe(state);
    expect(workflowReducer(state, { type: "editXml", text: "<broken" })).toBe(state);
  });

  it("re-derives the model from an edited JSON and keeps the pasted text in sync", () => {
    const state = loaded();
    const edited = italianText().replace(preset("it-b2b-sdi").number, "PASTED-0002");
    const next = workflowReducer(state, { type: "editJson", text: edited });
    expect(next.invoice?.number).toBe("PASTED-0002");
    expect(next.pasted?.text).toBe(edited);
    expect(next.edit.json).toBe(edited);
    expect(next.edit.jsonError).toBeNull();
    // Still the placeholder seller: an edit never resurrects anything from a preset.
    expect(next.invoice?.seller).toEqual(placeholderSeller("IT"));
  });

  it("applies the account lookup — seller and VAT context — without touching the text", () => {
    const state = loaded();
    const seller = { ...placeholderSeller("IT"), name: "Taxpayer S.r.l." };
    const next = workflowReducer(state, {
      type: "pastedLookup",
      seller,
      source: "taxpayer",
      ctx: { country: "IT", vatRates: [] },
      note: null,
    });
    expect(next.invoice?.seller.name).toBe("Taxpayer S.r.l.");
    expect(next.pasted?.sellerSource).toBe("taxpayer");
    expect(next.pasted?.sellerName).toBe("Taxpayer S.r.l.");
    expect(next.pasted?.text).toBe(italianText());
    expect(sellerNote("taxpayer", seller, "IT")).toMatch(/your fiskaly taxpayer/);
    const fallback = workflowReducer(state, {
      type: "pastedLookup",
      source: "placeholder",
      ctx: { country: "IT" },
      note: "MOCK",
    });
    expect(fallback.pasted?.sellerSource).toBe("placeholder");
    expect(fallback.pasted?.lookupNote).toBe("MOCK");
  });

  it("choosing a preset replaces the paste, and pasting replaces the preset", () => {
    const state = loaded();
    const chosen = workflowReducer(state, { type: "choosePreset", presetId: "be-peppol" });
    expect(chosen.pasted).toBeNull();
    expect(chosen.presetId).toBe("be-peppol");
    const back = workflowReducer(chosen, {
      type: "loadPayload",
      text: italianText(),
      country: "IT",
      formatId: "fatturapa",
    });
    expect(back.presetId).toBeNull();
    expect(back.pasted?.country).toBe("IT");
  });

  it("persists the paste and rebuilds it from the text on reload", () => {
    const state = workflowReducer(loaded(), { type: "goToStep", step: "validate" });
    persistWorkflow(state);
    const raw = JSON.parse(localStorage.getItem(WORKFLOW_KEY) ?? "{}") as { pasted?: unknown };
    expect(raw.pasted).toMatchObject({ country: "IT", text: italianText() });
    const restored = initialWorkflow();
    expect(restored.pasted).toMatchObject({ country: "IT", formatId: "fatturapa", at: 1 });
    expect(restored.presetId).toBeNull();
    expect(restored.step).toBe("validate");
    expect(restored.edit.json).toBe(italianText());
    expect(restored.invoice?.number).toBe(state.invoice?.number);
  });

  it("keeps a looked-up seller across the reload but never lands on Send", () => {
    const seller = { ...placeholderSeller("IT"), name: "Taxpayer S.r.l." };
    const state = workflowReducer(loaded(), {
      type: "pastedLookup",
      seller,
      source: "taxpayer",
      ctx: { country: "IT" },
      note: null,
    });
    persistWorkflow({ ...state, step: "send" });
    const restored = initialWorkflow();
    expect(restored.invoice?.seller.name).toBe("Taxpayer S.r.l.");
    expect(restored.pasted?.sellerSource).toBe("taxpayer");
    expect(restored.step).toBe("validate");
  });

  it("drops a saved paste whose country or format is unknown", () => {
    localStorage.setItem(
      WORKFLOW_KEY,
      JSON.stringify({
        step: "mapper",
        presetId: null,
        pasted: { text: italianText(), country: "FR", formatId: "fatturapa" },
      }),
    );
    expect(initialWorkflow().pasted).toBeNull();
  });
});
