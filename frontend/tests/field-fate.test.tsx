import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FateEntry } from "../src/field-fate";
import { JsonView } from "../src/JsonView";
import type { FormatId } from "../src/model";
import { ValidationRulesSection } from "../src/SettingsDialog";
import { StageList } from "../src/StepValidate";
import { store } from "../src/store";
import { indexJson } from "../src/uapi-json";
import { emptyRun } from "../src/validation";
import { composeOperation } from "../src/workflow";
import { WorkflowPane } from "../src/WorkflowPane";

const ENTRIES: Record<string, FateEntry> = {
  "/totals": {
    pointer: "/totals",
    fate: "discarded",
    element: "DatiRiepilogo",
    note: "DatiRiepilogo is recomputed server-side.",
  },
  "/seller/name": {
    pointer: "/seller/name",
    fate: "not-rendered",
    note: "Contatti has no name element.",
  },
  "/document/number": {
    pointer: "/document/number",
    fate: "mapped",
    element: "Numero",
    note: "Reaches the XML as Numero.",
  },
};

vi.mock("../src/field-fate", async (importOriginal) => {
  const module = await importOriginal<typeof import("../src/field-fate")>();
  return {
    ...module,
    fateEntry: (formatId: FormatId, pointer: string): FateEntry | undefined => {
      if (formatId !== "fatturapa") return undefined;
      const entry = ENTRIES[pointer];
      return entry && entry.fate !== "mapped" ? entry : undefined;
    },
  };
});

function jsonPane(): HTMLElement {
  return screen.getByRole("tabpanel", { name: "fiskaly JSON view" });
}

function markCount(): number {
  return Number(jsonPane().getAttribute("data-fate-marks"));
}

describe("field-fate annotations in the JSON pane", () => {
  beforeEach(() => {
    localStorage.clear();
    store.dispatch({ type: "choosePreset", presetId: "it-b2b-sdi" });
    store.dispatch({ type: "setView", view: "json" });
  });
  afterEach(cleanup);

  it("marks a discarded member on its own line and carries the note in the tooltip", () => {
    const text = '{\n  "totals": {\n    "vat": "22.00"\n  }\n}';
    const range = indexJson(text).byPointer.get("/totals");
    if (!range) throw new Error("test: /totals not indexed");
    render(
      <JsonView
        text={text}
        label="fate fixture"
        annotations={[
          {
            from: range.from,
            to: range.to,
            kind: "discarded",
            title: "discarded · DatiRiepilogo — DatiRiepilogo is recomputed server-side.",
          },
        ]}
      />,
    );
    const marks = [...document.querySelectorAll(".cm-fate.cm-fate-discarded")];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].getAttribute("title")).toContain("DatiRiepilogo is recomputed server-side.");
    expect(marks.map((mark) => mark.textContent).join("")).toBe('"totals": {');
  });

  it("renders no marker without annotations", () => {
    render(<JsonView text='{\n  "number": "F-1"\n}' label="fate fixture" annotations={[]} />);
    expect(document.querySelector(".cm-fate")).toBeNull();
  });

  it("annotates exactly the non-mapped pointers of the FatturaPA operation", () => {
    render(<WorkflowPane />);
    expect(store.getState().workflow.formatId).toBe("fatturapa");

    const index = indexJson(composeOperation(store.getState().workflow).text);
    expect(index.byPointer.has("/document/number")).toBe(true);
    const expected = [...index.byPointer.keys()].filter(
      (pointer) => ENTRIES[pointer] && ENTRIES[pointer].fate !== "mapped",
    ).length;
    expect(expected).toBeGreaterThan(0);
    expect(markCount()).toBe(expected);
  });

  it("toggles the annotations off and back on", () => {
    render(<WorkflowPane />);
    expect(markCount()).toBeGreaterThan(0);

    fireEvent.click(within(jsonPane()).getByRole("button", { name: "Hide fate marks" }));
    expect(markCount()).toBe(0);
    expect(document.querySelector(".cm-fate")).toBeNull();

    fireEvent.click(within(jsonPane()).getByRole("button", { name: "Show fate marks" }));
    expect(markCount()).toBeGreaterThan(0);
  });

  it("shows the totals and seller notices for FatturaPA", () => {
    render(<WorkflowPane />);
    const pane = jsonPane();
    expect(pane.querySelector("[data-fate-notice='totals']")).toHaveTextContent(
      /breakdown and totals are discarded/,
    );
    expect(pane.querySelector("[data-fate-notice='totals']")).toHaveTextContent(
      /schema still requires both/,
    );
    expect(pane.querySelector("[data-fate-notice='seller']")).toHaveTextContent(
      /Only seller\.phone and seller\.email reach the XML; seller\.name does not/,
    );
  });

  it.each(["ubl", "cii"] as FormatId[])(
    "keeps the Italy-only evidence away from %s — no notices, no marks",
    (formatId) => {
      render(<WorkflowPane />);
      act(() => store.dispatch({ type: "setFormat", formatId }));
      const pane = jsonPane();
      expect(pane.querySelector("[data-fate-notice='totals']")).toBeNull();
      expect(pane.querySelector("[data-fate-notice='seller']")).toBeNull();
      expect(markCount()).toBe(0);
    },
  );
});

describe("the Validate step's totals claim", () => {
  afterEach(cleanup);

  it("says a FatturaPA totals finding does not predict rejection", () => {
    render(<StageList stages={emptyRun("fatturapa")} formatId="fatturapa" />);
    const note = document.querySelector("[data-fate-note='document-tier']");
    expect(note).toHaveTextContent(/does not predict rejection/);
    expect(note).toHaveTextContent(/recomputes DatiRiepilogo before transmitting/);
  });

  it.each(["ubl", "cii"] as FormatId[])("makes no such claim for %s", (formatId) => {
    render(<StageList stages={emptyRun(formatId)} formatId={formatId} />);
    expect(document.querySelector("[data-fate-note='document-tier']")).toBeNull();
  });

  it("makes no such claim when the format is unknown", () => {
    render(<StageList stages={emptyRun("ubl")} />);
    expect(document.querySelector("[data-fate-note='document-tier']")).toBeNull();
  });
});

describe("provenance in Settings", () => {
  afterEach(cleanup);

  it("points at docs/reference/fatturapa with the capture date", async () => {
    render(<ValidationRulesSection />);
    const provenance = await screen.findByText(/docs\/reference\/fatturapa/);
    expect(provenance).toHaveTextContent("captured 2026-08-25");
  });
});
