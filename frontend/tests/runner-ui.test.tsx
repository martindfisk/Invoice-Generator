import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionNotesPanel, VariablePanel } from "../src/RunnerPane";
import { RunnerStepRow } from "../src/RunnerStep";
import type { StepResult } from "../src/runner";
import { store } from "../src/store";
import type { CollectionStep } from "../src/uapi-client";

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

describe("RunnerStepRow", () => {
  it("shows name, folder, method, resolved path, status and duration", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({ path: "/records/{{eInvoiceId}}", method: "GET" })}
          result={result({
            status: "passed",
            durationMs: 42,
            method: "GET",
            path: "/records/rec-123",
          })}
          disabled={false}
          onRunFrom={() => {}}
        />
      </ol>,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-status", "passed");
    expect(within(row).getByText("Create TRANSACTION::INVOICE")).toBeInTheDocument();
    expect(within(row).getByText("records (E-Invoice Transmission)")).toBeInTheDocument();
    expect(within(row).getByText("GET")).toBeInTheDocument();
    expect(within(row).getByText("/records/rec-123")).toBeInTheDocument();
    expect(within(row).getByText("Passed")).toBeInTheDocument();
    expect(within(row).getByText("42 ms")).toBeInTheDocument();
  });

  it("falls back to the templated path before the step ran", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({ path: "/records/{{eInvoiceId}}" })}
          disabled={false}
          onRunFrom={() => {}}
        />
      </ol>,
    );
    expect(screen.getByText("/records/{{eInvoiceId}}")).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveAttribute("data-status", "pending");
  });

  it("renders non-runnable steps muted with their skipReason and no run button", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({
            runnable: false,
            skipReason: "not run — creates account resources",
            name: "Create a Taxpayer::COMPANY (DE)",
          })}
          disabled={false}
          onRunFrom={() => {}}
        />
      </ol>,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-runnable", "false");
    expect(within(row).getByText("not run — creates account resources")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a failed assertion as expected vs actual", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({})}
          result={result({
            status: "failed",
            assertions: [
              { pointer: "/content/state", expected: "FAILED", actual: "COMPLETED", ok: false },
            ],
            error: "assert /content/state: expected FAILED, got COMPLETED",
          })}
          disabled={false}
          onRunFrom={() => {}}
        />
      </ol>,
    );
    expect(
      screen.getByText(/\/content\/state — expected FAILED, got COMPLETED/),
    ).toBeInTheDocument();
  });

  it("summarises a binary response body instead of rendering it", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({ method: "GET", path: "/files/rec-1.zip" })}
          result={result({
            status: "passed",
            binary: { contentType: "application/zip", bytes: 512 },
          })}
          disabled={false}
          onRunFrom={() => {}}
        />
      </ol>,
    );
    const summary = document.querySelector("[data-binary]") as HTMLElement;
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("zip, 512 bytes");
  });

  it("lists captured variables and offers Run from here", () => {
    const onRunFrom = vi.fn();
    render(
      <ol>
        <RunnerStepRow
          index={3}
          step={step({})}
          result={result({ status: "passed", captured: { eInvoiceId: "rec-9" } })}
          disabled={false}
          onRunFrom={onRunFrom}
        />
      </ol>,
    );
    expect(screen.getByText("eInvoiceId = rec-9")).toBeInTheDocument();
    screen.getByRole("button", { name: "Run from here" }).click();
    expect(onRunFrom).toHaveBeenCalledWith(3);
  });
});

describe("VariablePanel", () => {
  it("labels seeded and captured variables and warns on unset ones", () => {
    render(
      <VariablePanel
        seeds={[
          { name: "apiVersion", value: "2026-06-01", source: "backend settings" },
          { name: "eInvoiceSystemId", value: "", source: "Settings → Identifiers (seller, BE)" },
        ]}
        captured={{ eInvoiceId: "rec-1" }}
        missing={[{ name: "eInvoiceSystemId", stepIndex: 1, stepName: "Retrieve a System" }]}
      />,
    );
    const panel = screen.getByRole("region", { name: "Runner variables" });
    expect(within(panel).getByText("2026-06-01")).toBeInTheDocument();
    expect(within(panel).getByText(/seeded · backend settings/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/unset — configure it in Settings → Identifiers \(seller, BE\)/),
    ).toBeInTheDocument();
    expect(within(panel).getByText("captured at runtime")).toBeInTheDocument();
    expect(within(panel).getByText("rec-1")).toBeInTheDocument();
    expect(
      within(panel).getByText(/needed by step 2 \(Retrieve a System\) but nothing sets it/),
    ).toBeInTheDocument();
  });

  it("links an unset identifier seed to its Settings section", () => {
    render(
      <VariablePanel
        seeds={[
          {
            name: "eInvoiceSystemId",
            value: "",
            source: "Settings → Identifiers (seller, BE)",
            section: "settings-identifiers",
          },
        ]}
        captured={{}}
        missing={[]}
      />,
    );
    screen.getByRole("button", { name: "Settings → Identifiers (seller, BE)" }).click();
    expect(store.getState().settingsRequest?.section).toBe("settings-identifiers");
  });
});

describe("copy as cURL", () => {
  it("offers the recorded cURL on a finished step", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({})}
          result={result({ status: "passed", sent: true, runId: "run-1" })}
          disabled={false}
          onRunFrom={() => {}}
          curl={{ curl: "curl -X POST 'https://test.api.fiskaly.com/records'" }}
        />
      </ol>,
    );
    const button = screen.getByRole("button", { name: "Copy as cURL" });
    expect(button).toBeEnabled();
  });

  it("disables the control with a reason when the call is gone", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({})}
          result={result({ status: "passed", sent: true, runId: "run-1" })}
          disabled={false}
          onRunFrom={() => {}}
          curl={{ curl: null, reason: "its call is no longer in the API log" }}
        />
      </ol>,
    );
    const button = screen.getByRole("button", {
      name: "Copy as cURL — its call is no longer in the API log",
    });
    expect(button).toBeDisabled();
  });

  it("shows no copy control before the step ran", () => {
    render(
      <ol>
        <RunnerStepRow
          index={0}
          step={step({})}
          disabled={false}
          onRunFrom={() => {}}
          curl={{ curl: null, reason: "not run yet" }}
        />
      </ol>,
    );
    expect(screen.queryByRole("button", { name: /Copy as cURL/ })).not.toBeInTheDocument();
  });
});

describe("CollectionNotesPanel", () => {
  it("lists the published defects with severity chips and frames them as fiskaly's", () => {
    const onDismiss = vi.fn();
    render(
      <CollectionNotesPanel
        notes={[
          { severity: "warning", message: "Italian standard rate on a German invoice." },
          { severity: "info", message: "Variables keep their Belgian names." },
        ]}
        onDismiss={onDismiss}
      />,
    );
    const panel = screen.getByRole("region", { name: "Published collection notes" });
    expect(within(panel).getByText(/This is what fiskaly publishes/)).toBeInTheDocument();
    expect(within(panel).getByText(/Nothing below is an error in this tool/)).toBeInTheDocument();
    expect(
      within(panel).getByText("Italian standard rate on a German invoice."),
    ).toBeInTheDocument();
    expect(within(panel).getByText("warning")).toBeInTheDocument();
    expect(within(panel).getByText("info")).toBeInTheDocument();
    within(panel).getByRole("button", { name: "Dismiss" }).click();
    expect(onDismiss).toHaveBeenCalled();
  });
});
