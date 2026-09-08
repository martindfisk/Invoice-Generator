import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunnerPane } from "../src/RunnerPane";
import { initialRunnerUi, type StepResult } from "../src/runner";
import { store } from "../src/store";
import type { Collection, CollectionStep } from "../src/uapi-client";

vi.mock("../src/EntityTree", () => ({ EntityTree: () => null }));
vi.mock("../src/runner-actions", () => ({
  ensureRunnerLoaded: vi.fn(() => Promise.resolve()),
  selectCollection: vi.fn(() => Promise.resolve()),
}));

afterEach(cleanup);

function step(overrides: Partial<CollectionStep>): CollectionStep {
  return {
    id: "step-1",
    name: "Create TRANSACTION::INVOICE",
    folder: "records (E-Invoice Transmission)",
    method: "POST",
    path: "/records",
    query: {},
    body: null,
    runnable: true,
    skipReason: null,
    captures: [],
    waitFor: null,
    asserts: [],
    ...overrides,
  };
}

function result(overrides: Partial<StepResult>): StepResult {
  return { status: "pending", polls: 0, captured: {}, assertions: [], ...overrides };
}

function collection(steps: CollectionStep[]): Collection {
  return { id: "de", name: "Germany", version: "2026-06-01", steps, notes: [] } as Collection;
}

function seed(overrides: Partial<ReturnType<typeof initialRunnerUi>>) {
  store.patchRunner({
    ...initialRunnerUi("de"),
    collections: [{ id: "de", name: "Germany", version: "2026-06-01", steps: 2, notes: 0 }],
    ...overrides,
  });
}

beforeEach(() => {
  store.setMode("MOCK");
  store.patchRunner(initialRunnerUi(null));
});

describe("RunnerPane run controls", () => {
  it("disables Step with a visible run-finished line and offers Clear results", () => {
    const steps = [step({ id: "a" }), step({ id: "b", name: "Retrieve the record" })];
    seed({
      collection: collection(steps),
      results: { 0: result({ status: "passed" }), 1: result({ status: "passed" }) },
      captured: { eInvoiceId: "rec-1" },
      capturedBy: "seller",
    });
    render(<RunnerPane />);
    expect(screen.getByRole("button", { name: "Step" })).toBeDisabled();
    expect(screen.getByText(/Run finished — every runnable step has a result/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear results" }));
    const runner = store.getState().runner;
    expect(runner.results).toEqual({});
    expect(runner.captured).toEqual({});
    expect(runner.capturedBy).toBeNull();
    expect(screen.getByRole("button", { name: "Step" })).toBeEnabled();
  });

  it("routes Continue anyway through the LIVE guard instead of starting silently", () => {
    store.setMode("LIVE");
    const steps = [step({ id: "a" }), step({ id: "b", name: "Retrieve the record" })];
    seed({
      collection: collection(steps),
      results: { 0: result({ status: "failed" }) },
      haltedAt: 0,
    });
    render(<RunnerPane />);
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
    expect(screen.getByText("Run against LIVE?")).toBeVisible();
    // Nothing ran: the modal gates the run, so the runner is still idle.
    expect(store.getState().runner.running).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Run against LIVE?")).not.toBeInTheDocument();
  });

  it("hides Continue anyway when only skipped steps remain after the halt", () => {
    const steps = [
      step({ id: "a" }),
      step({ id: "b", runnable: false, skipReason: "account mutation" }),
    ];
    seed({
      collection: collection(steps),
      results: { 0: result({ status: "failed" }) },
      haltedAt: 0,
    });
    render(<RunnerPane />);
    expect(screen.queryByRole("button", { name: "Continue anyway" })).not.toBeInTheDocument();
  });

  it("does not let another persona's captures satisfy the missing-variables check", () => {
    const steps = [step({ id: "a", path: "/records/{{eInvoiceId}}", name: "Retrieve E-Invoice" })];
    seed({
      collection: collection(steps),
      captured: { eInvoiceId: "rec-1" },
      capturedBy: "buyer",
    });
    render(<RunnerPane />);
    // The active persona is the seller, so the buyer's capture is stale: the reference is
    // reported missing and the stale-capture notice explains why.
    expect(screen.getByText(/is needed by step 1/)).toBeVisible();
    expect(screen.getByText(/captured as the buyer — the next run as the seller/)).toBeVisible();
  });
});
