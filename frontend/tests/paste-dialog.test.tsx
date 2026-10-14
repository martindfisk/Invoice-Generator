import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleText } from "../src/pasted";
import { preset } from "../src/presets";
import { store } from "../src/store";
import { PASTED_SEND_NOTE } from "../src/workflow";
import { WorkflowPane } from "../src/WorkflowPane";

function picker() {
  return screen.getByRole("region", { name: "Preset picker" });
}

function dialog() {
  return screen.getByRole("dialog", { name: "Paste your own payload" });
}

function openDialog() {
  render(<WorkflowPane />);
  fireEvent.click(within(picker()).getByRole("button", { name: /Paste your own payload/ }));
  return dialog();
}

function stepper() {
  return within(within(screen.getByRole("region", { name: "Workflow" })).getByRole("list"));
}

describe("paste payload dialog", () => {
  beforeEach(() => {
    localStorage.clear();
    // The pre-check and the account lookup go to the backend; here there is none, and the
    // dialog must stay usable without it.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    act(() => {
      store.dispatch({ type: "choosePreset", presetId: "be-peppol", fresh: true });
      store.dispatch({ type: "goToStep", step: "setup" });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens from the card, refuses text that is not a payload and names why", () => {
    const panel = openDialog();
    const open = within(panel).getByRole("button", { name: "Open in Mapper" });
    expect(open).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText("Payload JSON"), { target: { value: "{" } });
    expect(within(panel).getByRole("alert")).toHaveTextContent(/Not valid JSON/);
    expect(open).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText("Payload JSON"), {
      target: { value: JSON.stringify({ type: "INTENTION" }) },
    });
    expect(within(panel).getByRole("alert")).toHaveTextContent(/INTENTION/);
    expect(open).toBeDisabled();
  });

  it("loads the example, warns on a country mismatch and opens the Mapper read-only", () => {
    const panel = openDialog();
    fireEvent.click(within(panel).getByRole("button", { name: "Load example" }));
    const textarea = within(panel).getByLabelText("Payload JSON") as HTMLTextAreaElement;
    expect(textarea.value).toBe(exampleText("IT"));
    expect(within(panel).getByText(/Recognised as/)).toHaveTextContent("TRANSACTION::INVOICE");
    expect(panel.querySelector("[data-mismatch]")).toBeNull();

    // The Italian example under Belgium: SDI is Italian, so the dialog says so but still allows it.
    fireEvent.change(within(panel).getByLabelText("Country"), { target: { value: "BE" } });
    expect(panel.querySelector("[data-mismatch]")).toHaveTextContent(/SDI/);
    expect(within(panel).getByLabelText("Predicted format")).toHaveValue("ubl");
    fireEvent.change(within(panel).getByLabelText("Country"), { target: { value: "IT" } });
    expect(within(panel).getByLabelText("Predicted format")).toHaveValue("fatturapa");

    fireEvent.click(within(panel).getByRole("button", { name: "Open in Mapper" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const workflow = store.getState().workflow;
    expect(workflow.step).toBe("mapper");
    expect(workflow.presetId).toBeNull();
    expect(workflow.pasted?.country).toBe("IT");
    expect(workflow.invoice?.number).toBe(preset("it-b2b-sdi").number);

    expect(screen.getByRole("heading", { name: /Pasted payload · IT · FatturaPA/ })).toBeVisible();
    expect(screen.getByRole("region", { name: "fiskaly JSON view" })).toBeVisible();
    expect(document.querySelector("[data-readonly-hint]")).toHaveTextContent(/Read-only/);
    expect(document.querySelector("[data-seller-source='placeholder']")).toHaveTextContent(
      /placeholder/,
    );
    const send = stepper().getByRole("button", { name: /Send$/ });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("title", PASTED_SEND_NOTE);
    expect(stepper().getByRole("button", { name: /Validate$/ })).toBeEnabled();
  });

  it("accepts a full POST /records body and marks the Setup card as active", () => {
    const panel = openDialog();
    const body = {
      content: {
        type: "TRANSACTION",
        record: { id: "00000000-0000-4000-8000-000000000001" },
        operation: JSON.parse(exampleText("BE")) as unknown,
      },
    };
    fireEvent.change(within(panel).getByLabelText("Country"), { target: { value: "BE" } });
    fireEvent.change(within(panel).getByLabelText("Payload JSON"), {
      target: { value: JSON.stringify(body, null, 2) },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Open in Mapper" }));
    expect(store.getState().workflow.pasted?.prefix).toBe("/content/operation");

    act(() => store.dispatch({ type: "goToStep", step: "setup" }));
    expect(
      within(picker()).getByRole("button", { name: /Paste your own payload/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/A pasted TRANSACTION::INVOICE for BE is loaded/)).toBeVisible();
  });
});
