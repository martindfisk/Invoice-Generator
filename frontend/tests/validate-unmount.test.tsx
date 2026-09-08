import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/store";
import { WorkflowPane } from "../src/WorkflowPane";

// The contract stage runs first in the pipeline; a never-settling mock holds the run in flight
// deterministically so the unmount genuinely happens mid-run.
vi.mock("../src/uapi-schema-client", () => ({
  validateUapiOperation: () => new Promise(() => undefined),
}));

describe("leaving Validate mid-run", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(cleanup);

  it("resets the validation instead of pinning a stale partial pipeline", async () => {
    store.dispatch({ type: "choosePreset", presetId: "it-b2b-sdi", fresh: true });
    store.dispatch({ type: "goToStep", step: "validate" });
    const { unmount } = render(<WorkflowPane />);
    await waitFor(() => expect(store.getState().workflow.validation.running).toBe(true), {
      timeout: 4000,
    });
    unmount();
    // Without the reset, the aborted run's key would still match on the next visit and the
    // early-return would pin whatever partial stages the abort left behind.
    expect(store.getState().workflow.validation.key).toBeNull();
    expect(store.getState().workflow.validation.running).toBe(false);
  });
});
