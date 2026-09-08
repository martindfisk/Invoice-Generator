import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindingsPanel, type FindingRow } from "../src/FindingsPanel";
import type { Finding, StageResult } from "../src/validation";

afterEach(cleanup);

const scrolled = vi.fn();
beforeEach(() => {
  scrolled.mockReset();
  Element.prototype.scrollIntoView = scrolled;
});

function finding(ruleId: string): Finding {
  return { source: "schematron", ruleId, severity: "error", message: `${ruleId} failed` };
}

function row(key: string, field?: string): FindingRow {
  return { key, finding: finding(key), field };
}

const STAGES: StageResult[] = [
  { id: "schematron", label: "Schematron", status: "failed", findings: [] },
];

describe("FindingsPanel follows a cross-pane selection", () => {
  it("scrolls the selected row into view and continues arrow keys from it", () => {
    const onSelect = vi.fn();
    const rows = [row("BR-01"), row("BR-02"), row("BR-03")];
    render(
      <FindingsPanel
        stages={STAGES}
        rows={rows}
        running={false}
        selectedKey="BR-02"
        onSelect={onSelect}
        onEscape={() => {}}
      />,
    );
    // The highlight moved here from another pane: the row is brought into view…
    expect(scrolled).toHaveBeenCalled();
    const listbox = screen.getByRole("listbox", { name: "Validation findings" });
    expect(listbox.getAttribute("aria-activedescendant")).toContain("BR-02");
    // …and ArrowDown continues from it, not from wherever the keyboard last was.
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "BR-03" }));
  });

  it("a field matched from the mapper highlights and positions the same way", () => {
    const onSelect = vi.fn();
    const rows = [row("BR-01", "number"), row("BR-02", "lines.0.netAmount")];
    render(
      <FindingsPanel
        stages={STAGES}
        rows={rows}
        running={false}
        selectedKey={null}
        matchedField="lines.0.netAmount"
        onSelect={onSelect}
        onEscape={() => {}}
      />,
    );
    expect(scrolled).toHaveBeenCalled();
    const listbox = screen.getByRole("listbox", { name: "Validation findings" });
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "BR-01" }));
  });

  it("does not scroll when nothing is selected", () => {
    render(
      <FindingsPanel
        stages={STAGES}
        rows={[row("BR-01")]}
        running={false}
        selectedKey={null}
        onSelect={() => {}}
        onEscape={() => {}}
      />,
    );
    expect(scrolled).not.toHaveBeenCalled();
  });
});
