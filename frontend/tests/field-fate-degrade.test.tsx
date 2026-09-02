import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fateEntry } from "../src/field-fate";
import type { FormatId } from "../src/model";
import { store } from "../src/store";
import { WorkflowPane } from "../src/WorkflowPane";

// No vi.mock here on purpose: this file exercises whatever src/uapi-field-fate.ts really is —
// including the case where it does not exist yet.
describe("field-fate degradation without the evidence table", () => {
  beforeEach(() => {
    localStorage.clear();
    store.dispatch({ type: "choosePreset", presetId: "it-b2b-sdi" });
    store.dispatch({ type: "setPane", pane: "human", show: false });
    store.dispatch({ type: "setPane", pane: "human", show: true });
    store.dispatch({ type: "setPane", pane: "xml", show: false });
  });
  afterEach(cleanup);

  it("answers unknown pointers and formats with undefined instead of throwing", () => {
    expect(() => fateEntry("fatturapa", "/no/such/pointer")).not.toThrow();
    expect(fateEntry("fatturapa", "/no/such/pointer")).toBeUndefined();
    expect(() => fateEntry("not-a-format" as FormatId, "/totals")).not.toThrow();
    expect(() => fateEntry("ubl", "")).not.toThrow();
  });

  it("still renders the JSON pane and the FatturaPA notices", () => {
    render(<WorkflowPane />);
    const pane = screen.getByRole("region", { name: "fiskaly JSON view" });
    expect(pane.querySelector("[data-fate-notice='totals']")).not.toBeNull();
    expect(pane.querySelector("[data-fate-notice='seller']")).not.toBeNull();
    expect(Number(pane.getAttribute("data-fate-marks"))).toBeGreaterThanOrEqual(0);
  });
});
