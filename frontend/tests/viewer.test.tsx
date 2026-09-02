import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FORMATS } from "../src/formats";
import { listPresets, preset } from "../src/presets";
import { store } from "../src/store";
import { WorkflowPane } from "../src/WorkflowPane";
import { STEPS } from "../src/workflow";

const first = listPresets()[0];

function stepButton(label: string): HTMLElement {
  const stepper = screen.getByRole("list");
  return within(stepper).getByRole("button", { name: new RegExp(`${label}$`) });
}

function presetCard(id: string): HTMLElement {
  const picker = screen.getByRole("region", { name: "Preset picker" });
  const card = picker.querySelector<HTMLElement>(`[data-preset="${id}"]`);
  if (!card) throw new Error(`no preset card for ${id}`);
  return card;
}

function pickFirstPreset() {
  fireEvent.click(presetCard(first.id));
}

// The Mapper opens with all three panes; the old "Split" was fields + JSON, so hide the XML.
function pickFirstPresetSplit() {
  pickFirstPreset();
  fireEvent.click(paneToggle("Predicted XML"));
}

function paneToggle(name: string) {
  return within(screen.getByRole("group", { name: "Mapper panes" })).getByRole("button", { name });
}

describe("workflow pane", () => {
  beforeEach(() => {
    store.dispatch({ type: "goToStep", step: "setup" });
  });
  afterEach(cleanup);

  it("disables every later step until a preset is chosen and explains why", () => {
    render(<WorkflowPane />);
    for (const step of STEPS.slice(1)) {
      const button = stepButton(step.label);
      expect(button).toBeDisabled();
      expect(button.getAttribute("title")).toMatch(/preset/i);
    }
  });

  it("renders one card per preset the domain layer exposes", () => {
    render(<WorkflowPane />);
    const picker = screen.getByRole("region", { name: "Preset picker" });
    expect(within(picker).getAllByRole("button")).toHaveLength(listPresets().length);
    for (const meta of listPresets()) {
      expect(presetCard(meta.id)).toBeInTheDocument();
    }
    expect(screen.getByText(first.summary)).toBeInTheDocument();
    expect(screen.queryByText(first.legalBasis)).not.toBeInTheDocument();
    expect(screen.queryByText(first.formatLabel)).not.toBeInTheDocument();

    const card = presetCard(first.id);
    expect(card.title).toContain(first.formatLabel);
    expect(card.title).toContain(first.legalBasis);
  });

  it("moves the format label and the legal basis into the compose header", () => {
    render(<WorkflowPane />);
    pickFirstPreset();
    expect(screen.getByText(first.formatLabel)).toBeInTheDocument();
    expect(screen.getByText(`\u00b7 ${first.legalBasis}`)).toBeInTheDocument();
  });

  it("opens with all three structures side by side, the JSON in the middle", () => {
    render(<WorkflowPane />);
    pickFirstPreset();

    expect(store.getState().workflow.panes).toEqual({ human: true, xml: true });
    expect(screen.getByRole("region", { name: "Fields view" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "fiskaly JSON view" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Predicted XML view" })).toBeInTheDocument();
    expect(document.querySelector("[data-panes]")?.getAttribute("data-panes")).toBe(
      "human+json+xml",
    );
  });

  it("choosing a preset loads the invoice and renders the human view", () => {
    render(<WorkflowPane />);
    pickFirstPresetSplit();

    expect(store.getState().workflow).toMatchObject({ presetId: first.id, step: "mapper" });
    expect(screen.getByRole("region", { name: "Invoice viewer" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Fields view" })).toBeInTheDocument();
    expect(screen.getAllByText(preset(first.id).seller.name).length).toBeGreaterThan(0);
    expect(
      screen.getByText("Visualisation for review — the XML is the legally valid invoice."),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Document" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Document totals" })).toBeInTheDocument();
  });

  it("keeps one tab stop per group and moves between fields with the arrow keys", () => {
    render(<WorkflowPane />);
    pickFirstPresetSplit();

    const card = screen.getByRole("region", { name: "Document" });
    const fields = within(card)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("data-field") && button.closest("section") === card);
    expect(fields.filter((field) => field.tabIndex === 0)).toHaveLength(1);
    expect(fields[0].tabIndex).toBe(0);

    fireEvent.keyDown(fields[0], { key: "ArrowDown" });
    expect(fields[1].tabIndex).toBe(0);
    expect(fields[0].tabIndex).toBe(-1);
    expect(document.activeElement).toBe(fields[1]);
  });

  it("clicking a field selects it, resolves the XML path and opens its editor", () => {
    render(<WorkflowPane />);
    pickFirstPresetSplit();

    const field = screen.getByRole("button", { name: /^Invoice number/ });
    expect(field).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(field);

    const { selection } = store.getState().workflow;
    expect(selection).toMatchObject({ field: "number", source: "human" });
    expect(typeof selection?.path).toBe("string");
    expect(screen.getByRole("textbox", { name: "Invoice number" })).toHaveValue(
      preset(first.id).number,
    );
  });

  it("gives every invoice line its own section and selects fields inside it", () => {
    render(<WorkflowPane />);
    pickFirstPresetSplit();

    const invoice = preset(first.id);
    const lines = screen.getByRole("region", { name: "Invoice lines" });
    expect(within(lines).getByRole("button", { name: /BG-25/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const [index, line] of invoice.lines.entries()) {
      const row = within(lines).getByRole("region", { name: `Invoice lines ${index + 1}` });
      expect(within(row).getAllByRole("button")[0]).toHaveTextContent(line.name);
    }

    const second = within(lines).getByRole("region", { name: "Invoice lines 2" });
    fireEvent.click(within(second).getByRole("button", { name: /^Line net amount/ }));
    expect(store.getState().workflow.selection).toMatchObject({
      field: "lines.1.netAmount",
      source: "human",
    });
  });

  it("names the structures that carry the selected field, and the one that does not", () => {
    render(<WorkflowPane />);
    pickFirstPreset();

    const strip = () => document.querySelector("[data-presence-strip]");
    expect(strip()?.textContent).toMatch(/Select a field in any pane/);

    fireEvent.click(document.querySelector("[data-field='number']")!);
    expect(strip()?.getAttribute("data-presence-strip")).toBe("number");
    expect(strip()?.getAttribute("data-missing")).toBe("0");
    for (const structure of ["human", "json", "xml"]) {
      expect(
        strip()?.querySelector(`[data-structure='${structure}']`)?.getAttribute("data-present"),
      ).toBe("true");
    }
  });

  it("flags a field the operation cannot carry so an unsupported field is visible", () => {
    render(<WorkflowPane />);
    pickFirstPreset();

    // The seller comes from the commissioned taxpayer, so BT-27 reaches the XML but never the
    // payload — the case this strip exists to make obvious.
    fireEvent.click(document.querySelector("[data-field='seller.name']")!);
    const strip = document.querySelector("[data-presence-strip]");
    expect(strip?.getAttribute("data-missing")).toBe("1");
    expect(strip?.querySelector("[data-structure='json']")?.getAttribute("data-present")).toBe(
      "false",
    );
    expect(strip?.querySelector("[data-structure='xml']")?.getAttribute("data-present")).toBe(
      "true",
    );
    expect(strip?.textContent).toMatch(/taxpayer resource/);
  });

  it("folds the flanking panes away and back, keeping the JSON on screen", () => {
    render(<WorkflowPane />);
    pickFirstPreset();

    fireEvent.click(paneToggle("Fields"));
    expect(store.getState().workflow.panes).toEqual({ human: false, xml: true });
    expect(paneToggle("Fields")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Fields view" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "fiskaly JSON view" })).toBeInTheDocument();
    expect(screen.getByText(/what this browser expects fiskaly to generate/)).toBeInTheDocument();

    fireEvent.click(paneToggle("Predicted XML"));
    expect(store.getState().workflow.panes).toEqual({ human: false, xml: false });
    expect(document.querySelector("[data-panes]")?.getAttribute("data-panes")).toBe("json");
    expect(screen.queryByRole("region", { name: "Predicted XML view" })).not.toBeInTheDocument();

    fireEvent.click(paneToggle("Fields"));
    expect(screen.getByRole("region", { name: "Fields view" })).toBeInTheDocument();
  });

  it("offers the formats that can render the invoice and switches between them", () => {
    render(<WorkflowPane />);
    pickFirstPresetSplit();

    const invoice = preset(first.id);
    const renderable = Object.values(FORMATS).filter((plugin) => {
      try {
        plugin.write(invoice);
        return true;
      } catch {
        return false;
      }
    });

    if (renderable.length < 2) {
      expect(screen.getByText(FORMATS[invoice.format].label)).toBeInTheDocument();
      return;
    }
    const group = screen.getByRole("group", { name: "Predicted XML format" });
    expect(within(group).getAllByRole("button")).toHaveLength(renderable.length);
    const other = renderable.find((plugin) => plugin.id !== store.getState().workflow.formatId);
    fireEvent.click(within(group).getByRole("button", { name: other?.label ?? "" }));
    expect(store.getState().workflow.formatId).toBe(other?.id);
  });

  it("opens the validation pipeline on the Validate step, invoice still on screen", () => {
    render(<WorkflowPane />);
    pickFirstPreset();

    fireEvent.click(stepButton("Validate"));
    expect(store.getState().workflow.step).toBe("validate");
    expect(screen.getByRole("region", { name: "Validation stages" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Invoice viewer" })).toBeInTheDocument();
  });

  it("reaches the later steps and names the endpoint each one uses", () => {
    render(<WorkflowPane />);
    pickFirstPreset();

    for (const [step, endpoint] of [
      ["Send", "POST /api/invoices"],
      ["Receive", "GET /api/inbox"],
    ]) {
      fireEvent.click(stepButton(step));
      expect(store.getState().workflow.step).toBe(step.toLowerCase());
      expect(screen.getByRole("region", { name: step })).toBeInTheDocument();
      expect(screen.getByText(endpoint)).toBeInTheDocument();
    }
  });
});
