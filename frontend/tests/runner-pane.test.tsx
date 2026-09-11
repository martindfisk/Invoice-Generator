import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunnerPane } from "../src/RunnerPane";
import { initialRunnerUi, type StepResult } from "../src/runner";
import { store } from "../src/store";
import type { Collection, CollectionStep, Settings } from "../src/uapi-client";

vi.mock("../src/EntityTree", () => ({ EntityTree: () => null }));
vi.mock("../src/runner-actions", () => ({
  ensureRunnerLoaded: vi.fn(() => Promise.resolve()),
  selectCollection: vi.fn(() => Promise.resolve()),
}));

const mocks = vi.hoisted(() => ({ passthrough: vi.fn() }));

vi.mock("../src/uapi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/uapi-client")>();
  return { ...actual, passthrough: mocks.passthrough };
});

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

function collection(steps: CollectionStep[], notes: Collection["notes"] = []): Collection {
  return { id: "de", name: "Germany", version: "2026-06-01", steps, notes };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    mode: "mock",
    environment: "test",
    base_url: "https://test.api.fiskaly.com",
    api_version: "2026-06-01",
    credentials: { configured: true, source: "env", fingerprint: "test***" },
    systems: {},
    ...overrides,
  };
}

function seed(overrides: Partial<ReturnType<typeof initialRunnerUi>>) {
  store.patchRunner({
    ...initialRunnerUi("de"),
    collections: [{ id: "de", name: "Germany", version: "2026-06-01", steps: 2, notes: 0 }],
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  store.applySettings(settings());
  store.setMode("MOCK");
  store.patchRunner(initialRunnerUi(null));
  mocks.passthrough.mockReset();
});

describe("RunnerPane run controls", () => {
  it("disables Step with a visible run-finished line and offers Clear results", () => {
    const steps = [step({ id: "a" }), step({ id: "b", name: "Retrieve the record" })];
    seed({
      collection: collection(steps),
      results: { 0: result({ status: "passed" }), 1: result({ status: "passed" }) },
      captured: { eInvoiceId: "rec-1" },
    });
    render(<RunnerPane />);
    expect(screen.getByRole("button", { name: "Step" })).toBeDisabled();
    expect(screen.getByText(/Run finished — every runnable step has a result/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear results" }));
    const runner = store.getState().runner;
    expect(runner.results).toEqual({});
    expect(runner.captured).toEqual({});
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

  it("disables Run all and Step while a referenced variable is unset", () => {
    const steps = [step({ id: "a", path: "/records/{{eInvoiceId}}", name: "Retrieve E-Invoice" })];
    seed({ collection: collection(steps) });
    render(<RunnerPane />);
    const runAll = screen.getByRole("button", { name: "Run all" });
    expect(runAll).toBeDisabled();
    expect(runAll).toHaveAttribute("title", expect.stringContaining("{{eInvoiceId}}"));
    expect(screen.getByRole("button", { name: "Step" })).toBeDisabled();
    expect(screen.getByText(/is needed by step 1/)).toBeVisible();
  });

  it("resumes Run all from the first pending step after a stop", async () => {
    mocks.passthrough.mockResolvedValue({ content: {} });
    const steps = [
      step({ id: "a", path: "/records" }),
      step({ id: "b", name: "Retrieve the record", method: "GET", path: "/records/rec-1" }),
    ];
    // Step 1 already has a verdict — a stopped run left step 2 pending.
    seed({
      collection: collection(steps),
      results: { 0: result({ status: "passed" }) },
      status: "Stopped after step 1 — 1 step pending",
    });
    render(<RunnerPane />);
    fireEvent.click(screen.getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(store.getState().runner.running).toBe(false));
    expect(mocks.passthrough).toHaveBeenCalledTimes(1);
    expect(mocks.passthrough.mock.calls[0][1]).toBe("/records/rec-1");
    const { results } = store.getState().runner;
    expect(results[0].status).toBe("passed");
    expect(results[1].status).toBe("passed");
  });

  it("names the TEST environment in the LIVE guard when the credentials point at test.api", () => {
    store.applySettings(settings({ mode: "live", environment: "test" }));
    seed({ collection: collection([step({ id: "a" })]) });
    render(<RunnerPane />);
    fireEvent.click(screen.getByRole("button", { name: "Run all" }));
    expect(
      screen.getByText(
        /real records in the fiskaly TEST environment \(not billed, no tax-authority transmission\)/,
      ),
    ).toBeVisible();
  });

  it("warns that production records cannot be recalled when the environment is live", () => {
    store.applySettings(settings({ mode: "live", environment: "live" }));
    seed({ collection: collection([step({ id: "a" })]) });
    render(<RunnerPane />);
    fireEvent.click(screen.getByRole("button", { name: "Run all" }));
    expect(screen.getByText(/LIVE records are real and cannot be recalled/)).toBeVisible();
  });
});

describe("collection notes dismissal", () => {
  const notes = [{ severity: "warning" as const, message: "Italian rate on a German invoice." }];

  it("persists the dismissal per collection id", () => {
    seed({ collection: collection([step({ id: "a" })], notes) });
    render(<RunnerPane />);
    expect(screen.getByText("Italian rate on a German invoice.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Italian rate on a German invoice.")).not.toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("runner:notes-dismissed") ?? "{}") as Record<string, unknown>,
    ).toEqual({ de: true });
    // A fresh runner state for the same collection id keeps the dismissal.
    expect(initialRunnerUi("de").notesDismissed).toBe(true);
    expect(initialRunnerUi("be").notesDismissed).toBe(false);
  });
});
