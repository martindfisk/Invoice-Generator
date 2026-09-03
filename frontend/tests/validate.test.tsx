import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingsPanel, type FindingRow, type FindingsPanelProps } from "../src/FindingsPanel";
import type { PresetId } from "../src/presets";
import { store } from "../src/store";
import { StageList } from "../src/StepValidate";
import type { Finding, StageResult } from "../src/validation";
import { WorkflowPane } from "../src/WorkflowPane";

const SKIP_NOTE = "Skipped — the XML is not well-formed.";

const XSD_FINDING: Finding = {
  source: "xsd",
  ruleId: "cvc-complex-type.2.4.b",
  severity: "fatal",
  message: "Element Sede is incomplete: required child Nazione is missing.",
  xpath: "/p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede",
  bt: "BT-55",
};

const MODEL_FINDING: Finding = {
  source: "model",
  ruleId: "BR-11",
  severity: "error",
  message: "The buyer postal address needs an ISO 3166-1 alpha-2 country code.",
  field: "buyer.address.country",
  bt: "BT-55",
};

const SDI_FINDING: Finding = {
  source: "sdi-rules",
  ruleId: "00422",
  severity: "warning",
  message: "ImportoTotaleDocumento does not match the sum of the DatiRiepilogo.",
  fpa: "2.1.1.9",
};

const STAGES: StageResult[] = [
  {
    id: "model",
    label: "Model rules",
    status: "failed",
    findings: [MODEL_FINDING],
    durationMs: 3,
  },
  { id: "well-formed", label: "Well-formedness", status: "running", findings: [] },
  {
    id: "xsd",
    label: "XSD schema",
    status: "failed",
    findings: [XSD_FINDING],
    durationMs: 12,
  },
  {
    id: "schematron",
    label: "Schematron (EN 16931 / Peppol)",
    status: "unavailable",
    findings: [],
    note: "The Schematron worker is not wired up yet.",
  },
  {
    id: "sdi-rules",
    label: "SDI business rules",
    status: "failed",
    findings: [SDI_FINDING],
    durationMs: 7,
  },
];

const ROWS: FindingRow[] = [
  {
    key: "model 0",
    finding: MODEL_FINDING,
    field: "buyer.address.country",
    path: "p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede",
    line: 49,
  },
  { key: "xsd 0", finding: XSD_FINDING, path: "p:FatturaElettronica", line: 2 },
  { key: "sdi-rules 0", finding: SDI_FINDING },
];

function stageRow(id: string): HTMLElement {
  const row = document.querySelector(`[data-stage="${id}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`test: no stage row for "${id}"`);
  return row;
}

function panel(over: Partial<FindingsPanelProps> = {}) {
  const props: FindingsPanelProps = {
    stages: STAGES,
    rows: ROWS,
    running: false,
    selectedKey: null,
    onSelect: () => {},
    onEscape: () => {},
    ...over,
  };
  return render(<FindingsPanel {...props} />);
}

async function settled() {
  await waitFor(
    () => {
      const { validation } = store.getState().workflow;
      expect(validation.key).not.toBeNull();
      expect(validation.running).toBe(false);
    },
    { timeout: 4000 },
  );
}

async function validating(presetId: PresetId = "broken") {
  store.dispatch({ type: "choosePreset", presetId, fresh: true });
  store.dispatch({ type: "setPane", pane: "human", show: true });
  store.dispatch({ type: "setPane", pane: "xml", show: false });
  store.dispatch({ type: "goToStep", step: "validate" });
  render(<WorkflowPane />);
  await settled();
}

function option(rule: RegExp | string): HTMLElement {
  return screen.getByRole("option", { name: new RegExp(rule) });
}

describe("stage list", () => {
  afterEach(cleanup);

  it("renders one row per stage with its status, severity counts and duration", () => {
    render(<StageList stages={STAGES} />);
    const rows = within(screen.getByRole("region", { name: "Validation stages" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => row.dataset.stage)).toEqual([
      "model",
      "well-formed",
      "xsd",
      "schematron",
      "sdi-rules",
    ]);

    expect(stageRow("model")).toHaveTextContent("Model rules");
    expect(stageRow("model")).toHaveTextContent("Failed");
    expect(stageRow("model")).toHaveTextContent("1 error");
    expect(stageRow("model")).toHaveTextContent("3 ms");

    expect(stageRow("well-formed")).toHaveTextContent("Running");
    expect(stageRow("well-formed")).not.toHaveTextContent("No findings");

    expect(stageRow("xsd")).toHaveTextContent("Failed");
    expect(stageRow("xsd")).toHaveTextContent("1 fatal");
    expect(stageRow("xsd")).toHaveTextContent("12 ms");

    expect(stageRow("sdi-rules")).toHaveTextContent("1 warning");
    expect(stageRow("well-formed")).toHaveTextContent("Well-formedness");
  });

  it("shows an unavailable stage as not run with its note verbatim, never as passed", () => {
    render(<StageList stages={STAGES} />);
    const row = stageRow("schematron");
    expect(row).toHaveTextContent("Not run");
    expect(row).toHaveTextContent("The Schematron worker is not wired up yet.");
    expect(row).not.toHaveTextContent("Passed");
    expect(row).not.toHaveTextContent("No findings");
    expect(row.dataset.status).toBe("unavailable");
  });
});

describe("findings panel", () => {
  afterEach(cleanup);

  it("lists every finding with its severity, rule id, mapping badge and location", () => {
    panel();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Error");
    expect(options[0]).toHaveTextContent("BR-11");
    expect(options[0]).toHaveTextContent("BT-55");
    expect(options[0]).toHaveTextContent("model");
    expect(options[0]).toHaveTextContent("Sede");
    expect(options[0]).toHaveTextContent("line 49");
    expect(options[1]).toHaveTextContent("Fatal");
    expect(options[2]).toHaveTextContent("Warning");
    expect(options[2]).toHaveTextContent("2.1.1.9");
  });

  it("separates nothing-ran-yet from a clean run and from a run with stages missing", () => {
    const pending: StageResult[] = [
      { id: "model", label: "Model rules", status: "pending", findings: [] },
    ];
    const { rerender } = panel({ stages: pending, rows: [] });
    expect(screen.getByText(/No validation has run on this invoice yet/)).toBeInTheDocument();

    const clean: StageResult[] = [
      { id: "model", label: "Model rules", status: "passed", findings: [] },
    ];
    const props: FindingsPanelProps = {
      stages: clean,
      rows: [],
      running: false,
      selectedKey: null,
      onSelect: () => {},
      onEscape: () => {},
    };
    rerender(<FindingsPanel {...props} />);
    expect(screen.getByText(/No findings from the 1 stage that ran\./)).toBeInTheDocument();
    expect(screen.queryByText(/clean bill of health/)).not.toBeInTheDocument();

    rerender(
      <FindingsPanel
        {...props}
        stages={[...clean, { id: "xsd", label: "XSD schema", status: "unavailable", findings: [] }]}
      />,
    );
    expect(
      screen.getByText(/1 stage could not run, so this is not a clean bill of health/),
    ).toBeInTheDocument();
  });

  it("filters by severity and by stage", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Warning 1" }));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: /00422/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "xsd 1" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(option("BR-11")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "model 1" }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/All 3 findings are hidden by the filters/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Warning 1" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("is a single-stop listbox whose arrow keys move the active option and the selection", () => {
    const onSelect = vi.fn();
    panel({ onSelect });
    const options = screen.getAllByRole("option");
    expect(options.map((item) => item.tabIndex)).toEqual([0, -1, -1]);

    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[1]);
    expect(screen.getAllByRole("option")[1].tabIndex).toBe(0);
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-activedescendant",
      screen.getAllByRole("option")[1].id,
    );

    fireEvent.keyDown(options[1], { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[2]);
    fireEvent.keyDown(options[2], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[2]);
    fireEvent.keyDown(options[2], { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[0]);
  });

  it("clears the selection on Escape", () => {
    const onEscape = vi.fn();
    panel({ onEscape });
    fireEvent.keyDown(screen.getAllByRole("option")[0], { key: "Escape" });
    expect(onEscape).toHaveBeenCalled();
  });
});

describe("validate step", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(cleanup);

  it("runs the pipeline on arrival and lists what it found", async () => {
    await validating();

    expect(stageRow("model")).toHaveTextContent("Failed");
    expect(stageRow("well-formed")).toHaveTextContent("Passed");
    const xsd = store.getState().workflow.validation.stages.find((stage) => stage.id === "xsd");
    expect(xsd?.status).toBe("unavailable");
    expect(stageRow("xsd")).toHaveTextContent("Not run");
    expect(stageRow("xsd")).toHaveTextContent(xsd?.note ?? "no note");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(option("BR-11")).toBeInTheDocument();
  });

  it("selecting a finding publishes the shared selection resolved to a field and an XML path", async () => {
    await validating();
    fireEvent.click(option("BR-11"));

    expect(store.getState().workflow.selection).toMatchObject({
      field: "buyer.address.country",
      source: "finding",
    });
    expect(store.getState().workflow.selection?.path).toMatch(/CessionarioCommittente\/Sede$/);
    expect(option("BR-11")).toHaveAttribute("aria-selected", "true");
    expect(
      within(screen.getByRole("region", { name: "Buyer" })).getByRole("button", {
        name: /^Country code/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the invoice on screen and flags the field a finding points at", async () => {
    await validating();
    expect(screen.getByRole("region", { name: "Invoice viewer" })).toBeInTheDocument();
    const country = within(screen.getByRole("region", { name: "Buyer" })).getByRole("button", {
      name: /^Country code/,
    });
    expect(country).toHaveTextContent("BR-11");
  });

  it("shows the stages after a well-formedness failure as not run, never as passed", async () => {
    await validating();
    act(() => {
      store.dispatch({ type: "editXml", text: "<a><b></a>" });
    });
    await settled();

    expect(stageRow("well-formed")).toHaveTextContent("Failed");
    for (const id of ["xsd", "sdi-rules"]) {
      expect(stageRow(id)).toHaveTextContent("Not run");
      expect(stageRow(id)).toHaveTextContent(SKIP_NOTE);
      expect(stageRow(id)).not.toHaveTextContent("Passed");
    }
    expect(screen.getByRole("option", { name: /XML-WF/ })).toBeInTheDocument();
  });

  it("re-runs after a field edit and drops the finding the edit fixed", async () => {
    await validating();
    expect(option("BR-11")).toBeInTheDocument();

    const country = within(screen.getByRole("region", { name: "Buyer" })).getByRole("button", {
      name: /^Country code/,
    });
    fireEvent.click(country);
    const input = screen.getByRole("textbox", { name: "Country code" });
    fireEvent.change(input, { target: { value: "IT" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.queryByRole("option", { name: /BR-11/ })).not.toBeInTheDocument();
    });
    await settled();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("re-runs the whole pipeline on demand", async () => {
    await validating();
    const first = store.getState().workflow.validation.key;

    fireEvent.click(screen.getByRole("button", { name: "Re-run" }));
    await waitFor(() => {
      expect(store.getState().workflow.validation.key).not.toBe(first);
    });
    await settled();
    expect(stageRow("model")).toHaveTextContent("Failed");
    expect(option("BR-11")).toBeInTheDocument();
  });

  it("swaps in the pipeline of the format the user switches to", async () => {
    await validating();
    expect(stageRow("sdi-rules")).toBeInTheDocument();

    const formats = screen.getByRole("group", { name: "Predicted XML format" });
    fireEvent.click(within(formats).getByRole("button", { name: /Peppol/ }));

    await waitFor(() => {
      expect(document.querySelector('[data-stage="schematron"]')).not.toBeNull();
    });
    expect(store.getState().workflow.formatId).toBe("ubl");
    expect(document.querySelector('[data-stage="sdi-rules"]')).toBeNull();
  });

  it("warns before Send without blocking it", async () => {
    await validating();
    expect(screen.getByText(/sending anyway will likely be rejected/)).toBeInTheDocument();

    const send = screen.getByRole("button", { name: "Send anyway" });
    fireEvent.click(send);
    expect(store.getState().workflow.step).toBe("send");
    expect(screen.getByText(/sending anyway will likely be rejected/)).toBeInTheDocument();
  });
});
