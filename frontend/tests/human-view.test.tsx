import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatCarries, invoiceGroups } from "../src/field-registry";
import { getFormat } from "../src/formats";
import { getField, type FieldId, type Invoice } from "../src/model";
import { listPresets, preset } from "../src/presets";
import { store } from "../src/store";
import { WorkflowPane } from "../src/WorkflowPane";

const first = listPresets()[0];

function invoice(): Invoice {
  const held = store.getState().workflow.invoice;
  if (!held) throw new Error("test: no invoice loaded");
  return held;
}

function xml(): string {
  return getFormat(store.getState().workflow.formatId).write(invoice());
}

function human(): HTMLElement {
  return screen.getByRole("region", { name: "Fields view" });
}

function headers(): HTMLElement[] {
  return within(human()).getAllByRole("button", { name: /·/ });
}

function header(match: RegExp): HTMLElement {
  const found = headers().filter((candidate) =>
    match.test(candidate.getAttribute("aria-label") ?? ""),
  );
  if (found.length !== 1) {
    throw new Error(`test: ${found.length} group headers match ${String(match)}`);
  }
  return found[0];
}

function section(head: HTMLElement): HTMLElement {
  const owner = head.closest("section");
  if (!owner) throw new Error("test: a group header outside a section");
  return owner;
}

function field(id: FieldId): HTMLElement | null {
  return human().querySelector(`button[data-field="${id}"]`);
}

function emptyField(): { id: FieldId; label: string } {
  const document = invoiceGroups()[0];
  const spec = document.fields.find(
    (candidate) =>
      getField(invoice(), candidate.field) === undefined &&
      formatCarries(store.getState().workflow.formatId, candidate.field),
  );
  if (!spec) throw new Error("test: this preset fills every field of the first group");
  return { id: spec.field, label: spec.label };
}

describe("human view groups", () => {
  beforeEach(() => {
    localStorage.clear();
    store.dispatch({ type: "goToStep", step: "setup" });
    store.dispatch({ type: "choosePreset", presetId: first.id });
    store.dispatch({ type: "setPane", pane: "human", show: true });
    store.dispatch({ type: "setPane", pane: "xml", show: false });
    render(<WorkflowPane />);
  });
  afterEach(cleanup);

  it("renders every registry group as a disclosure headed by its BG id and cardinality", () => {
    const top = invoiceGroups();
    expect(top.length).toBeGreaterThan(0);
    for (const group of top) {
      const head = header(new RegExp(`^${group.bg} · `));
      expect(head).toHaveAttribute("aria-expanded");
      expect(head.getAttribute("aria-label")).toContain(group.title);
      expect(head.getAttribute("aria-label")).toContain(group.cardinality);
      const panel = window.document.getElementById(head.getAttribute("aria-controls") ?? "");
      expect(panel).not.toBeNull();
    }
  });

  it("starts a group with no values collapsed, counts what it holds and opens on click", () => {
    const collapsed = headers().filter((candidate) =>
      / · 0 of \d+ set$/.test(candidate.getAttribute("aria-label") ?? ""),
    );
    expect(collapsed.length).toBeGreaterThan(0);

    const head = collapsed[0];
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(within(section(head)).queryAllByRole("button", { name: /^\w/ })).toHaveLength(1);

    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    const fields = within(section(head))
      .getAllByRole("button")
      .filter((candidate) => candidate.hasAttribute("data-field"));
    expect(fields.length).toBeGreaterThan(0);
    for (const shown of fields) expect(shown).toHaveTextContent("—");
  });

  it("renders an empty optional field, edits it, and keeps it after it is cleared again", () => {
    const { id, label } = emptyField();
    expect(getField(invoice(), id)).toBeUndefined();
    expect(field(id)).toHaveTextContent("—");

    fireEvent.click(field(id) as HTMLElement);
    const input = screen.getByRole("textbox", { name: label });
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "FILLED-BY-HAND" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(getField(invoice(), id)).toBe("FILLED-BY-HAND");
    expect(field(id)).toHaveTextContent("FILLED-BY-HAND");
    expect(xml()).toContain("FILLED-BY-HAND");

    fireEvent.click(field(id) as HTMLElement);
    const again = screen.getByRole("textbox", { name: label });
    fireEvent.change(again, { target: { value: "" } });
    fireEvent.keyDown(again, { key: "Enter" });

    expect(getField(invoice(), id)).toBe("");
    expect(field(id)).toHaveTextContent("—");
    expect(xml()).not.toContain("FILLED-BY-HAND");
  });

  it("marks the fields this format cannot carry, claims no path for them, and hides them on demand", () => {
    const marked = human().querySelectorAll("[data-uncarried]");
    expect(marked.length).toBeGreaterThan(0);
    const one = marked[0] as HTMLElement;
    expect(one).toHaveTextContent(/not carried by FatturaPA/);

    fireEvent.click(one);
    expect(store.getState().workflow.selection).toMatchObject({ source: "human" });
    expect(store.getState().workflow.selection?.path).toBeUndefined();

    const toggle = screen.getByRole("checkbox", { name: /cannot carry/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(store.getState().workflow.groups.showUncarried).toBe(false);
    expect(human().querySelectorAll("[data-uncarried]")).toHaveLength(0);
    expect(screen.queryByText(/not carried by FatturaPA/)).not.toBeInTheDocument();
    expect(field("number")).not.toBeNull();
  });

  it("gives a repeatable group one section per row, labelled with the row and its summary", () => {
    const lines = section(header(/^BG-25 · /));
    expect(header(/^BG-25 · /).getAttribute("aria-label")).toContain(
      `${invoice().lines.length} rows`,
    );

    const rows = within(lines)
      .getAllByRole("button")
      .filter((candidate) => /^Invoice lines \d/.test(candidate.getAttribute("aria-label") ?? ""));
    expect(rows).toHaveLength(invoice().lines.length);
    for (const [index, line] of invoice().lines.entries()) {
      expect(rows[index].getAttribute("aria-label")).toContain(`Invoice lines ${index + 1}`);
      expect(rows[index].getAttribute("aria-label")).toContain(line.name);
      expect(field(`lines.${index}.netAmount`)).not.toBeNull();
    }
  });

  it("keeps a group the user opened open across a step change", () => {
    const head = headers().find(
      (candidate) => candidate.getAttribute("aria-expanded") === "false",
    ) as HTMLElement;
    const name = head.getAttribute("aria-label") ?? "";
    fireEvent.click(head);
    expect(header(new RegExp(`^${name.split(" · ")[0]} · `))).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    act(() => store.dispatch({ type: "goToStep", step: "send" }));
    act(() => store.dispatch({ type: "goToStep", step: "mapper" }));

    expect(header(new RegExp(`^${name.split(" · ")[0]} · `))).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("opens a collapsed group when a selection lands inside it", () => {
    const head = headers().find(
      (candidate) => candidate.getAttribute("aria-expanded") === "false",
    ) as HTMLElement;
    const owner = section(head);
    fireEvent.click(head);
    const hidden = within(owner)
      .getAllByRole("button")
      .filter((candidate) => candidate.hasAttribute("data-field"))[0];
    const id = hidden.getAttribute("data-field") as FieldId;
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");

    act(() => store.dispatch({ type: "select", selection: { field: id, source: "finding" } }));
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(field(id)).toHaveAttribute("aria-pressed", "true");
  });
});

describe("human view with an empty preset", () => {
  afterEach(cleanup);

  it("counts the totals of a preset that fills them", () => {
    localStorage.clear();
    store.dispatch({ type: "choosePreset", presetId: first.id });
    render(<WorkflowPane />);
    const totals = preset(first.id).totals;
    const set = Object.values(totals).filter((value) => value !== undefined).length;
    expect(header(/^BG-22 · /).getAttribute("aria-label")).toContain(`${set} of `);
  });
});
