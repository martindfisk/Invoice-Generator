import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFormat } from "../src/formats";
import type { Invoice } from "../src/model";
import { listPresets, preset } from "../src/presets";
import { store } from "../src/store";
import {
  buildOperation,
  fieldForPointer,
  indexJson,
  pointerAtOffset,
  pointerForField,
  pointerRange,
  stringifyOperation,
} from "../src/uapi-json";
import { toInvoiceTransaction } from "../src/uapi-map";
import type { Finding, StageResult } from "../src/validation";
import { composeOperation } from "../src/workflow";
import { WorkflowPane } from "../src/WorkflowPane";

const first = listPresets()[0];

function invoice(): Invoice {
  const held = store.getState().workflow.invoice;
  if (!held) throw new Error("test: no invoice loaded");
  return held;
}

function operationText(): string {
  return composeOperation(store.getState().workflow).text;
}

function jsonPane(): HTMLElement {
  return screen.getByRole("tabpanel", { name: "fiskaly JSON view" });
}

function paneText(pane: HTMLElement): string {
  const content = pane.querySelector(".cm-content");
  if (!content) throw new Error("test: no editor in this pane");
  return content.textContent ?? "";
}

// CodeMirror only renders the lines in view, so long documents are read from the editor state.
function paneDoc(pane: HTMLElement): string {
  const view = EditorView.findFromDOM(pane.querySelector(".cm-editor") as HTMLElement);
  if (!view) throw new Error("test: no editor in this pane");
  return view.state.doc.toString();
}

function edited(change: (operation: Record<string, unknown>) => void): string {
  const operation = JSON.parse(operationText()) as Record<string, unknown>;
  change(operation);
  return JSON.stringify(operation, null, 2);
}

describe("compose — the fiskaly JSON pane", () => {
  beforeEach(() => {
    localStorage.clear();
    store.dispatch({ type: "choosePreset", presetId: first.id });
    store.dispatch({ type: "setView", view: "split" });
  });
  afterEach(cleanup);

  it("renders the exact operation Send would post", () => {
    render(<WorkflowPane />);

    const composed = composeOperation(store.getState().workflow);
    expect(composed.value).toEqual(toInvoiceTransaction(invoice()));
    expect(composed.text).toBe(stringifyOperation(toInvoiceTransaction(invoice())));
    expect(composed.label).toBe("TRANSACTION::INVOICE");

    const text = paneText(jsonPane());
    expect(text).toContain(`"number": "${invoice().number}"`);
    expect(text).toContain('"type": "INVOICE"');
  });

  it("says the JSON is the artifact and the XML only a prediction", () => {
    render(<WorkflowPane />);
    expect(
      within(jsonPane()).getByText(/The Unified API accepts this JSON, not XML/),
    ).toBeInTheDocument();

    act(() => store.dispatch({ type: "setView", view: "xml" }));
    expect(screen.getByText(/what this browser expects fiskaly to generate/)).toBeInTheDocument();
  });

  it("names the values the operation cannot carry, taken from the mapping's own list", () => {
    render(<WorkflowPane />);
    const caveat = jsonPane().querySelector("[data-uncarried-by-operation]");
    expect(caveat).not.toBeNull();
    expect(Number(caveat?.getAttribute("data-uncarried-by-operation"))).toBeGreaterThan(0);
    expect(within(jsonPane()).getByText(/comes from the taxpayer resource/)).toBeInTheDocument();
  });

  it("feeds a JSON edit into the fields and the predicted XML", () => {
    render(<WorkflowPane />);
    const before = invoice().number;

    act(() =>
      store.dispatch({
        type: "editJson",
        text: edited((operation) => {
          (operation.document as { number: string }).number = "FROM-THE-JSON";
        }),
      }),
    );

    expect(before).not.toBe("FROM-THE-JSON");
    expect(invoice().number).toBe("FROM-THE-JSON");
    expect(store.getState().workflow.edit).toMatchObject({ source: "json", jsonError: null });
    expect(screen.getByRole("button", { name: /^Invoice number/ })).toHaveTextContent(
      "FROM-THE-JSON",
    );
    expect(getFormat(store.getState().workflow.formatId).write(invoice())).toContain(
      "FROM-THE-JSON",
    );

    act(() => store.dispatch({ type: "setView", view: "xml" }));
    expect(paneDoc(screen.getByRole("tabpanel", { name: "Predicted XML view" }))).toContain(
      "<Numero>FROM-THE-JSON</Numero>",
    );
  });

  it("keeps the last good model and reports the parser on an unparseable JSON edit", () => {
    render(<WorkflowPane />);
    const before = invoice();

    act(() => store.dispatch({ type: "editJson", text: '{"document": ' }));

    expect(invoice()).toBe(before);
    const { edit } = store.getState().workflow;
    expect(edit.json).toBe('{"document": ');
    expect(edit.jsonError).toBeTruthy();
    expect(within(jsonPane()).getByRole("alert")).toHaveTextContent(edit.jsonError ?? "");
    expect(paneDoc(jsonPane())).toBe('{"document": ');
  });

  it("recovers as soon as the JSON parses again", () => {
    render(<WorkflowPane />);
    act(() => store.dispatch({ type: "editJson", text: "{{" }));
    expect(store.getState().workflow.edit.jsonError).toBeTruthy();

    act(() =>
      store.dispatch({
        type: "editJson",
        text: JSON.stringify(toInvoiceTransaction(invoice()), null, 2).replace(
          invoice().number,
          "RECOVERED",
        ),
      }),
    );
    expect(store.getState().workflow.edit.jsonError).toBeNull();
    expect(invoice().number).toBe("RECOVERED");
  });

  it("warns when a field edit drops a JSON edit the model cannot read back", () => {
    render(<WorkflowPane />);

    // entries[].data.vat.inclusive is one of uapi-map's documented derived paths: the model has
    // nowhere to store it, so regenerating the operation drops whatever the user typed.
    act(() =>
      store.dispatch({
        type: "editJson",
        text: edited((operation) => {
          const entries = operation.entries as { data: { vat: Record<string, string> } }[];
          entries[0].data.vat.inclusive = "999.99";
        }),
      }),
    );
    expect(store.getState().workflow.edit.jsonLossy).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /^Invoice number/ }));
    const input = screen.getByRole("textbox", { name: "Invoice number" });
    fireEvent.change(input, { target: { value: "AFTER-THE-JSON-EDIT" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const { edit } = store.getState().workflow;
    expect(edit.jsonLossy).toBe(false);
    expect(edit.json).toBeNull();
    expect(edit.notice).toMatch(/fiskaly JSON you edited by hand/);
    const notice = screen.getAllByRole("alert").find((node) => node.textContent?.includes("JSON"));
    expect(notice).toBeTruthy();
  });

  it("cross-highlights a field into its JSON range", () => {
    render(<WorkflowPane />);

    fireEvent.click(screen.getByRole("button", { name: /^Invoice number/ }));
    expect(store.getState().workflow.selection).toMatchObject({
      field: "number",
      pointer: "/document/number",
      source: "human",
    });
    expect(jsonPane().querySelectorAll(".cm-selected-range")).not.toHaveLength(0);

    const index = indexJson(operationText());
    const range = pointerRange(index, "/document/number");
    expect(range).toBeDefined();
    // The reverse direction: an offset inside that range resolves back to the same field.
    expect(pointerAtOffset(index, (range?.from ?? 0) + 1)).toBe("/document/number");
    expect(fieldForPointer("/document/number")).toBe("number");
  });
});

describe("compose — JSON pointer addressing", () => {
  it("maps model fields onto the operation both ways", () => {
    expect(pointerForField("number")).toBe("/document/number");
    expect(pointerForField("lines.1.netAmount")).toBe("/entries/1/data/value/base");
    expect(pointerForField("buyer.vatId")).toBe("/recipients/0/identification/number");
    expect(pointerForField("seller.it.regimeFiscale")).toBeUndefined();
    expect(fieldForPointer("/entries/2/data/text")).toBe("lines.2.name");
    expect(fieldForPointer("/entries/2/data/unit/price/exclusive")).toBe("lines.2.unitPriceNet");
    expect(fieldForPointer("/entries/2/data/unit")).toBeUndefined();
    expect(fieldForPointer("/nothing/here")).toBeUndefined();
  });

  it("addresses a correction body under /data", () => {
    const credit = preset("it-restaurant-td04-credit");
    const correction = buildOperation(credit, "rec-1");
    expect(correction.prefix).toBe("/data");
    expect(correction.label).toBe("TRANSACTION::CORRECTION");
    const index = indexJson(stringifyOperation(correction.value));
    expect(pointerRange(index, pointerForField("number", "/data"))).toBeDefined();
    expect(fieldForPointer("/data/document/number", "/data")).toBe("number");
  });

  it("shows the invoice body while the record id of the original is still unknown", () => {
    const credit = preset("it-restaurant-td04-credit");
    const pending = buildOperation(credit, null);
    expect(pending.correctionPending).toBe(true);
    expect(pending.prefix).toBe("");
    expect(pending.error).toBeNull();
  });

  it("returns no ranges for text that is not JSON", () => {
    expect(indexJson("{ not json").ranges).toHaveLength(0);
    expect(pointerRange(indexJson(""), "/document/number")).toBeUndefined();
  });
});

const CONTRACT_FINDING: Finding = {
  source: "uapi-schema",
  ruleId: "uapi/required",
  severity: "error",
  message: "'destination_code' is a required property",
  pointer: "/recipients/0/invoicing/destination_code",
};

const CONTRACT_STAGE_RESULT: StageResult = {
  id: "uapi-schema",
  label: "fiskaly API contract",
  status: "failed",
  findings: [CONTRACT_FINDING],
};

describe("validate — a contract finding lands in the JSON", () => {
  beforeEach(() => {
    localStorage.clear();
    store.dispatch({ type: "choosePreset", presetId: "it-b2b-sdi" });
    store.dispatch({ type: "setView", view: "human" });
    store.dispatch({ type: "goToStep", step: "validate" });
    store.dispatch({
      type: "validationStarted",
      key: "test-run",
      stages: [CONTRACT_STAGE_RESULT],
    });
  });
  afterEach(cleanup);

  it("heads the pipeline with the fiskaly contract and labels the XML tier as a prediction", () => {
    render(<WorkflowPane />);
    const pipeline = screen.getByRole("region", { name: "Validation stages" });
    const tiers = pipeline.querySelectorAll("[data-tier]");
    expect([...tiers].map((tier) => tier.getAttribute("data-tier"))).toEqual([
      "contract",
      "document",
    ]);
    expect(
      within(pipeline).getByRole("heading", { name: "fiskaly API contract" }),
    ).toBeInTheDocument();
    expect(
      within(pipeline).getByText(/A pass here is not fiskaly accepting anything/),
    ).toBeInTheDocument();
  });

  it("opens the JSON pane and highlights the offending range when the finding is clicked", () => {
    render(<WorkflowPane />);
    expect(screen.queryByRole("tabpanel", { name: "fiskaly JSON view" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /uapi\/required/ }));

    expect(store.getState().workflow.selection).toMatchObject({
      pointer: "/recipients/0/invoicing/destination_code",
      field: "buyer.channel.codiceDestinatario",
      source: "finding",
    });
    expect(store.getState().workflow.view).toBe("split");
    expect(jsonPane().querySelectorAll(".cm-selected-range")).not.toHaveLength(0);
  });
});
