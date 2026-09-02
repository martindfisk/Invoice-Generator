import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFormat } from "../src/formats";
import { getField, type Invoice } from "../src/model";
import { listPresets, preset } from "../src/presets";
import { store } from "../src/store";
import { WorkflowPane } from "../src/WorkflowPane";
import { XmlView } from "../src/XmlView";

const first = listPresets()[0];

function invoice(): Invoice {
  const held = store.getState().workflow.invoice;
  if (!held) throw new Error("test: no invoice loaded");
  return held;
}

function xmlOf(source: Invoice = invoice()): string {
  return getFormat(store.getState().workflow.formatId).write(source);
}

function commit(name: string | RegExp, value: string) {
  const input = screen.getByRole("textbox", { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function openEditor(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function editorText(): string {
  const content = document.querySelector(".cm-content");
  if (!content) throw new Error("test: the XML pane is not mounted");
  return content.textContent ?? "";
}

describe("compose editing", () => {
  beforeEach(() => {
    localStorage.clear();
    store.dispatch({ type: "choosePreset", presetId: first.id });
    store.dispatch({ type: "setPane", pane: "human", show: true });
    store.dispatch({ type: "setPane", pane: "xml", show: false });
  });
  afterEach(cleanup);

  it("commits a human field into the invoice and regenerates the XML from it", () => {
    render(<WorkflowPane />);
    openEditor(/^Invoice number/);
    commit("Invoice number", "EDIT-2026-0001");

    expect(invoice().number).toBe("EDIT-2026-0001");
    expect(store.getState().workflow.edit).toMatchObject({ source: "human", xml: null });
    expect(xmlOf()).toContain("EDIT-2026-0001");
    expect(screen.getByRole("button", { name: /^Invoice number/ })).toHaveTextContent(
      "EDIT-2026-0001",
    );
  });

  it("shows the regenerated XML in the pane", () => {
    render(<WorkflowPane />);
    openEditor(/^Invoice number/);
    commit("Invoice number", "SHOWN-IN-XML");
    act(() => {
      store.dispatch({ type: "setPane", pane: "human", show: false });
      store.dispatch({ type: "setPane", pane: "xml", show: true });
      store.dispatch({ type: "setPane", pane: "xml", show: true });
    });

    expect(editorText()).toContain("SHOWN-IN-XML");
  });

  it("keeps a decimal field as the string the user typed", () => {
    render(<WorkflowPane />);
    openEditor(/^Amount due for payment/);
    commit("Amount due for payment", "1234.50");

    const payable = getField(invoice(), "totals.payable");
    expect(payable).toBe("1234.50");
    expect(typeof payable).toBe("string");
    expect(xmlOf()).toContain("1234.50");
  });

  it("targets the addressed row when an indexed line field is edited", () => {
    const before = preset(first.id);
    render(<WorkflowPane />);
    const row = within(screen.getByRole("region", { name: "Invoice lines 2" }));
    fireEvent.click(row.getByRole("button", { name: /^Line net amount/ }));
    commit("Line net amount", "77.77");

    expect(invoice().lines[1].netAmount).toBe("77.77");
    expect(invoice().lines[0].netAmount).toBe(before.lines[0].netAmount);
    expect(invoice().lines[2]?.netAmount).toBe(before.lines[2]?.netAmount);
  });

  it("escape cancels an edit and leaves the invoice alone", () => {
    render(<WorkflowPane />);
    openEditor(/^Invoice number/);
    const input = screen.getByRole("textbox", { name: "Invoice number" });
    fireEvent.change(input, { target: { value: "DISCARDED" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(invoice().number).toBe(preset(first.id).number);
    expect(screen.queryByRole("textbox", { name: "Invoice number" })).not.toBeInTheDocument();
  });

  it("feeds an XML edit back into the human view", () => {
    render(<WorkflowPane />);
    const edited = xmlOf().replace(preset(first.id).number, "FROM-THE-XML");
    act(() => store.dispatch({ type: "editXml", text: edited }));

    expect(invoice().number).toBe("FROM-THE-XML");
    expect(store.getState().workflow.edit).toMatchObject({ source: "xml", error: null });
    expect(screen.getByRole("button", { name: /^Invoice number/ })).toHaveTextContent(
      "FROM-THE-XML",
    );
  });

  it("keeps the last good invoice and reports the parser message on a broken XML edit", () => {
    store.dispatch({ type: "setPane", pane: "human", show: false });
    store.dispatch({ type: "setPane", pane: "xml", show: true });
    render(<WorkflowPane />);
    const before = invoice();
    act(() => store.dispatch({ type: "editXml", text: "<FatturaElettronica" }));

    expect(invoice()).toBe(before);
    const { edit } = store.getState().workflow;
    expect(edit.xml).toBe("<FatturaElettronica");
    expect(edit.error).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(edit.error ?? "");
  });

  it("recovers from a parse failure as soon as the XML parses again", () => {
    render(<WorkflowPane />);
    act(() => store.dispatch({ type: "editXml", text: "<broken" }));
    expect(store.getState().workflow.edit.error).toBeTruthy();

    const good = xmlOf().replace(preset(first.id).number, "RECOVERED");
    act(() => store.dispatch({ type: "editXml", text: good }));
    expect(store.getState().workflow.edit.error).toBeNull();
    expect(invoice().number).toBe("RECOVERED");
  });

  it("warns once when a human edit drops hand-written XML the model cannot carry", () => {
    render(<WorkflowPane />);
    const lossy = xmlOf().replace(
      "<FatturaElettronicaBody>",
      "<!-- by hand --><FatturaElettronicaBody>",
    );
    act(() => store.dispatch({ type: "editXml", text: lossy }));
    expect(store.getState().workflow.edit.lossy).toBe(true);

    openEditor(/^Invoice number/);
    commit("Invoice number", "AFTER-THE-HAND-EDIT");

    const { edit } = store.getState().workflow;
    expect(edit.lossy).toBe(false);
    expect(edit.notice).toBeTruthy();
    const notice = screen
      .getAllByRole("alert")
      .find((node) => node.textContent?.includes("dropped"));
    expect(notice).toBeTruthy();

    fireEvent.click(within(notice as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(store.getState().workflow.edit.notice).toBeNull();
  });

  it("flags a model-rule failure on the field that carries it", () => {
    render(<WorkflowPane />);
    openEditor(/^Total VAT amount/);
    commit("Total VAT amount", "0.01");

    const field = screen.getByRole("button", { name: /^Total VAT amount/ });
    expect(field).toHaveTextContent("BR-CO-14");
    expect(screen.getByText(/model finding/)).toBeInTheDocument();
  });

  it("does not block editing while a model rule fails", () => {
    render(<WorkflowPane />);
    openEditor(/^Total VAT amount/);
    commit("Total VAT amount", "0.01");
    openEditor(/^Total VAT amount/);
    commit("Total VAT amount", preset(first.id).totals.taxAmount);

    expect(invoice().totals.taxAmount).toBe(preset(first.id).totals.taxAmount);
    expect(screen.getByText("Model rules pass")).toBeInTheDocument();
  });
});

describe("xml pane", () => {
  afterEach(cleanup);

  const props = {
    label: "XML",
    scrollTo: false,
    editable: true,
    onPickOffset: () => {},
  };

  function editor(): EditorView {
    const found = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    if (!found) throw new Error("test: no editor");
    return found;
  }

  it("keeps what the user typed until the parent hands it different text", () => {
    const onChange = vi.fn();
    const { rerender } = render(<XmlView text="<a>one</a>" {...props} onChange={onChange} />);
    expect(editorText()).toBe("<a>one</a>");

    const view = editor();
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "<a>typed</a>" } });
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("<a>typed</a>");

    rerender(<XmlView text="<a>one</a>" {...props} onChange={onChange} />);
    expect(editorText()).toBe("<a>typed</a>");

    rerender(<XmlView text="<a>typed</a>" {...props} onChange={onChange} />);
    expect(editorText()).toBe("<a>typed</a>");
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(<XmlView text="<a>regenerated</a>" {...props} onChange={onChange} />);
    expect(editorText()).toBe("<a>regenerated</a>");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the pane writable and says so", () => {
    render(<XmlView text="<a/>" {...props} onChange={() => {}} />);
    const content = document.querySelector(".cm-content");
    expect(content).toHaveAttribute("aria-readonly", "false");
    expect(content).toHaveAttribute("contenteditable", "true");
  });
});
