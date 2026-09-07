import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCall } from "../src/api-log";
import { ApiLogPane } from "../src/ApiLogPane";
import { SendTimeline } from "../src/SendTimeline";
import { StepSend } from "../src/StepSend";
import { store } from "../src/store";
import {
  composeOperation,
  freshSend,
  sendReducer,
  type SendAction,
  type SendState,
} from "../src/workflow";

const REMOTE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<FatturaElettronica>\n  <Numero>1</Numero>\n  <ProgressivoInvio>ABC</ProgressivoInvio>\n</FatturaElettronica>';

const mocks = vi.hoisted(() => ({
  sendInvoice: vi.fn(),
  waitForTransmission: vi.fn(),
  fetchArtifact: vi.fn(),
}));

vi.mock("../src/uapi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/uapi-client")>();
  return {
    ...actual,
    getConfig: () =>
      Promise.resolve({
        mode: "mock",
        environment: "test",
        api_version: "2026-06-01",
        personas: { seller: { IT: { system_id: "sys-it", taxpayer_id: "tax-it" } }, buyer: {} },
      }),
    sendInvoice: mocks.sendInvoice,
    waitForTransmission: mocks.waitForTransmission,
    fetchArtifact: mocks.fetchArtifact,
  };
});

const { sendInvoice, waitForTransmission, fetchArtifact } = mocks;

function apply(...actions: SendAction[]): SendState {
  return actions.reduce(sendReducer, freshSend());
}

function call(id: string, overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    id,
    ts: `2026-08-26T09:31:0${id}.000Z`,
    step: "poll",
    persona: "seller",
    mode: "MOCK",
    method: "GET",
    url: "https://test.api.fiskaly.com/records/trn-1",
    request: { headers: { "X-Api-Version": "2026-06-01" } },
    response: { status: 200, headers: { "X-Trace-Identifier": "trace-1" } },
    duration_ms: 8,
    curl: "curl https://test.api.fiskaly.com/records/trn-1",
    record_id: "trn-1",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  store.clearCalls();
  // The Send step now refuses to claim MOCK safety while the mode is unknown, so the tests
  // state their precondition explicitly.
  store.setMode("MOCK");
  store.setOffline(false);
  store.dispatch({ type: "sendReset" });
  store.dispatch({ type: "choosePreset", presetId: "it-b2b-sdi", fresh: true });
  sendInvoice.mockReset();
  waitForTransmission.mockReset();
  fetchArtifact.mockReset();
});

afterEach(() => {
  cleanup();
  store.dispatch({ type: "sendReset" });
});

describe("SendTimeline", () => {
  it("renders an SDI rejection log as a legible finding row", () => {
    const state = apply(
      { type: "sendStarted", at: 1, localXml: "" },
      {
        type: "sendCreated",
        at: 2,
        created: { intention_id: "int-1", transaction_id: "txn-1" },
        transport: "backend",
      },
      {
        type: "sendPolled",
        at: 3,
        wait: {
          transaction_id: "txn-1",
          finished: true,
          state: "COMPLETED",
          mode: "FINISHED",
          transmission_id: "trn-1",
          transmission: {
            id: "trn-1",
            state: "FAILED",
            mode: "FINISHED",
            logs: [{ severity: "ERROR", message: "00471 Cessionario uguale al cedente" }],
          },
        },
      },
    );
    render(<SendTimeline send={state} />);

    const timeline = screen.getByRole("region", { name: "Transmission lifecycle" });
    const row = within(timeline).getByText("00471 Cessionario uguale al cedente");
    expect(row).toBeInTheDocument();
    expect(row.parentElement?.className).toContain("text-error-ink");
    expect(within(timeline).getByText("ERROR")).toBeInTheDocument();
    expect(timeline.querySelector('[data-stage="transmission"]')).toHaveAttribute(
      "data-status",
      "failed",
    );
  });

  it("says nothing was transmitted when no transmission record exists", () => {
    const state = apply(
      { type: "sendStarted", at: 1, localXml: "" },
      {
        type: "sendCreated",
        at: 2,
        created: { intention_id: "int-1", transaction_id: "txn-1" },
        transport: "backend",
      },
      {
        type: "sendPolled",
        at: 3,
        wait: {
          transaction_id: "txn-1",
          finished: true,
          state: "COMPLETED",
          mode: "FINISHED",
          logs: [{ severity: "ERROR", message: "no recipient with invoicing configuration found" }],
        },
      },
    );
    render(<SendTimeline send={state} />);

    expect(screen.getByText("no recipient with invoicing configuration found")).toBeInTheDocument();
    expect(screen.getByText(/nothing was handed to the network/i)).toBeInTheDocument();
  });

  it("points the API log at the record behind a node", () => {
    const state = apply(
      { type: "sendStarted", at: 1, localXml: "" },
      {
        type: "sendCreated",
        at: 2,
        created: { intention_id: "int-1", transaction_id: "txn-1" },
        transport: "backend",
      },
    );
    render(<SendTimeline send={state} />);

    fireEvent.click(screen.getByRole("button", { name: "txn-1" }));
    expect(store.getState().focus?.recordId).toBe("txn-1");
  });
});

describe("Send step", () => {
  it("says the mode is unknown instead of claiming MOCK safety when the backend never answered", () => {
    store.setMode("unknown");
    render(<StepSend />);
    expect(screen.getByText(/MODE UNKNOWN/)).toBeInTheDocument();
    expect(screen.queryByText(/no request leaves this machine/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Send to fiskaly" })).toBeDisabled();
  });

  it("blocks sending while the backend is offline", () => {
    store.setOffline(true);
    render(<StepSend />);
    expect(screen.getByRole("button", { name: "Send to fiskaly" })).toBeDisabled();
  });

  it("guards a LIVE send behind a confirmation naming what will be created", async () => {
    store.setMode("LIVE");
    sendInvoice.mockResolvedValue({
      intention_id: "int-1",
      transaction_id: "txn-1",
      transport: "backend",
    });
    waitForTransmission.mockResolvedValue({ transaction_id: "txn-1", finished: false, logs: [] });
    render(<StepSend />);

    fireEvent.click(screen.getByRole("button", { name: "Send to fiskaly" }));
    expect(sendInvoice).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Send to LIVE fiskaly?" });
    expect(dialog).toHaveTextContent(/creates an INTENTION and a TRANSACTION::INVOICE record/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Send it" }));
    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(1));
  });

  it("walks the lifecycle and shows the diff once the artifact arrives", async () => {
    sendInvoice.mockResolvedValue({
      intention_id: "int-1",
      transaction_id: "txn-1",
      state: "ACCEPTED",
      mode: "PROCESSING",
      logs: [],
      transport: "backend",
    });
    waitForTransmission
      .mockResolvedValueOnce({
        transaction_id: "txn-1",
        finished: false,
        state: "ACCEPTED",
        mode: "PROCESSING",
        logs: [],
      })
      .mockResolvedValue({
        transaction_id: "txn-1",
        finished: true,
        state: "COMPLETED",
        mode: "FINISHED",
        logs: [],
        transmission_id: "trn-1",
        transmission: { id: "trn-1", state: "COMPLETED", mode: "FINISHED", logs: [] },
      });
    fetchArtifact.mockImplementation((input: { kind: string }) =>
      input.kind === "compliance"
        ? Promise.resolve({
            record_id: "trn-1",
            kind: "compliance",
            type: "application/xml",
            xml: REMOTE_XML,
          })
        : Promise.reject(new Error("record trn-1 carries no archive artifact")),
    );

    render(<StepSend />);
    expect(screen.getByText(/no request leaves this machine/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send to fiskaly" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Compliance artifact diff" })).toBeInTheDocument();
    });
    const timeline = screen.getByRole("region", { name: "Transmission lifecycle" });
    expect(timeline.querySelector('[data-stage="transmission"]')).toHaveAttribute(
      "data-status",
      "done",
    );
    expect(timeline.querySelector('[data-stage="artifacts"]')).toHaveAttribute(
      "data-status",
      "done",
    );
    expect(document.querySelector('[data-outcome="transmitted"]')).toBeInTheDocument();
    expect(waitForTransmission).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/no Receipt of Transmission/i)).toBeInTheDocument();

    const diff = screen.getByRole("region", { name: "Compliance artifact diff" });
    expect(
      within(diff).getByText(/Transmitted by fiskaly — application\/xml · trn-1/),
    ).toBeInTheDocument();
    expect(
      within(diff).getByText(/Predicted — FatturaPA \(SDI\), generated in this browser/),
    ).toBeInTheDocument();
    expect(diff.querySelectorAll(".cm-editor").length).toBeGreaterThanOrEqual(2);

    // The mock replays a fixture of a different invoice, so its diff is noise, not fiskaly
    // rewriting the user's document — the caveat has to say so.
    const caveat = diff.querySelector("[data-diff-caveat]");
    expect(caveat).not.toBeNull();
    expect(caveat).toHaveTextContent(/static fixture of a different invoice/);
    expect(caveat).toHaveTextContent(/only meaningful in LIVE/);
  });

  it("posts the JSON the user composed, with no mapping step in between", async () => {
    sendInvoice.mockRejectedValue(new Error("stop here"));
    const derived = composeOperation(store.getState().workflow).text;
    store.dispatch({
      type: "editJson",
      text: derived.replace(/"number": "[^"]*"/, '"number": "HAND-EDITED"'),
    });
    const composed = composeOperation(store.getState().workflow);
    expect(composed.error).toBeNull();

    render(<StepSend />);
    const payload = screen.getByRole("group", { name: "Operation payload" });
    const editor = EditorView.findFromDOM(payload.querySelector(".cm-editor") as HTMLElement);
    expect(editor?.state.doc.toString()).toBe(composed.text);
    expect(screen.getByText(/This is the JSON you composed, posted unchanged/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send to fiskaly" }));
    await waitFor(() => expect(sendInvoice).toHaveBeenCalled());
    const [request] = sendInvoice.mock.calls[0] as [{ operation: unknown }];
    expect(request.operation).toEqual(JSON.parse(composed.text));
    expect((request.operation as { document: { number: string } }).document.number).toBe(
      "HAND-EDITED",
    );
  });

  it("keeps the failure honest when the first POST is refused", async () => {
    sendInvoice.mockRejectedValue(new Error("SELLER_SYSTEM_ID_IT is not set in .env"));

    render(<StepSend />);
    fireEvent.click(screen.getByRole("button", { name: "Send to fiskaly" }));

    await waitFor(() => {
      expect(document.querySelector('[data-outcome="error"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-outcome="error"]')?.textContent).toContain(
      "SELLER_SYSTEM_ID_IT is not set in .env",
    );
    expect(
      screen
        .getByRole("region", { name: "Transmission lifecycle" })
        .querySelector('[data-stage="intention"]'),
    ).toHaveAttribute("data-status", "failed");
    expect(screen.queryByRole("region", { name: "Compliance artifact diff" })).toBeNull();
  });

  it("offers to keep polling instead of calling a slow SDI run a failure", async () => {
    sendInvoice.mockResolvedValue({
      intention_id: "int-1",
      transaction_id: "txn-1",
      transport: "backend",
    });
    waitForTransmission.mockResolvedValue({
      transaction_id: "txn-1",
      finished: false,
      state: "ACCEPTED",
      mode: "PROCESSING",
      logs: [],
    });

    render(<StepSend />);
    fireEvent.click(screen.getByRole("button", { name: "Send to fiskaly" }));
    await waitFor(() => expect(waitForTransmission).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "Stop polling" }));
    await waitFor(() => {
      expect(document.querySelector('[data-outcome="stopped"]')).toBeInTheDocument();
    });
    expect(screen.getByText(/You stopped the polling/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep polling" })).toBeInTheDocument();
  });
});

describe("API log correlation", () => {
  it("groups repeated polls and opens the group a lifecycle node points at", async () => {
    for (const entry of [call("1"), call("2"), call("3")]) store.addCall(entry);
    store.addCall(
      call("4", {
        method: "POST",
        step: "transaction",
        url: "https://test.api.fiskaly.com/records",
        record_id: "txn-1",
      }),
    );
    render(<ApiLogPane />);

    expect(screen.getByText("polled 3×")).toBeInTheDocument();
    const cards = document.querySelectorAll("[data-group]");
    expect(cards).toHaveLength(2);

    store.focusRecord("trn-1");
    await waitFor(() => {
      const card = document.querySelector('[data-record="trn-1"]');
      expect(card?.querySelector("button")).toHaveAttribute("aria-expanded", "true");
    });
    expect(screen.getByText("X-Trace-Identifier")).toBeInTheDocument();
  });

  it("filters by step and counts what is shown", () => {
    store.addCall(call("1"));
    store.addCall(
      call("2", { step: "intention", method: "POST", url: "https://test.api.fiskaly.com/records" }),
    );
    render(<ApiLogPane />);

    const filters = screen.getByRole("group", { name: "Call filters" });
    fireEvent.click(within(filters).getByRole("button", { name: "intention" }));
    expect(document.querySelectorAll("[data-group]")).toHaveLength(1);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });
});
