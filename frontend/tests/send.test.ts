import { describe, expect, it } from "vitest";
import type { CreatedInvoice, TransmissionWait } from "../src/uapi-client";
import {
  freshSend,
  NO_TRANSMISSION_NOTE,
  sendOutcome,
  sendReducer,
  type SendAction,
  type SendNode,
  type SendStage,
  type SendState,
} from "../src/workflow";

const CREATED: CreatedInvoice = {
  intention_id: "int-1",
  transaction_id: "txn-1",
  state: "ACCEPTED",
  mode: "PROCESSING",
  logs: [],
};

const SDI_REJECTION = "00471 Cessionario uguale al cedente";

function node(state: SendState, stage: SendStage): SendNode {
  const found = state.nodes.find((entry) => entry.stage === stage);
  if (!found) throw new Error(`no ${stage} node`);
  return found;
}

function statuses(state: SendState): Record<string, string> {
  return Object.fromEntries(state.nodes.map((entry) => [entry.stage, entry.status]));
}

function apply(state: SendState, ...actions: SendAction[]): SendState {
  return actions.reduce(sendReducer, state);
}

function started(at = 1000): SendState {
  return apply(freshSend(), { type: "sendStarted", at, localXml: "<Invoice/>" });
}

function created(at = 1100): SendState {
  return apply(started(), { type: "sendCreated", at, created: CREATED, transport: "backend" });
}

function waiting(overrides: Partial<TransmissionWait> = {}): TransmissionWait {
  return {
    transaction_id: "txn-1",
    finished: false,
    state: "ACCEPTED",
    mode: "PROCESSING",
    logs: [],
    ...overrides,
  };
}

describe("send lifecycle reducer", () => {
  it("starts idle with four pending nodes and nothing sent", () => {
    const fresh = freshSend();
    expect(fresh.phase).toBe("idle");
    expect(fresh.outcome).toBeNull();
    expect(fresh.nodes.map((entry) => entry.stage)).toEqual([
      "intention",
      "transaction",
      "transmission",
      "artifacts",
    ]);
    expect(fresh.nodes.every((entry) => entry.status === "pending")).toBe(true);
  });

  it("marks the intention active while the first POST is in flight", () => {
    const state = started();
    expect(state.phase).toBe("creating");
    expect(statuses(state)).toMatchObject({ intention: "active", transaction: "pending" });
    expect(node(state, "intention").startedAt).toBe(1000);
    expect(state.localXml).toBe("<Invoice/>");
  });

  it("records both record ids once the two POSTs came back", () => {
    const state = created();
    expect(state.phase).toBe("polling");
    expect(state.transport).toBe("backend");
    expect(state.intentionId).toBe("int-1");
    expect(state.transactionId).toBe("txn-1");
    expect(node(state, "intention")).toMatchObject({
      status: "done",
      recordId: "int-1",
      endedAt: 1100,
    });
    expect(node(state, "transaction")).toMatchObject({
      status: "active",
      recordId: "txn-1",
      state: "ACCEPTED",
      mode: "PROCESSING",
    });
  });

  it("counts polls and keeps the transmission pending until used_in appears", () => {
    const state = apply(
      created(),
      { type: "sendPolled", at: 1200, wait: waiting() },
      { type: "sendPolled", at: 1400, wait: waiting() },
    );
    expect(state.polls).toBe(2);
    expect(state.phase).toBe("polling");
    expect(state.transmissionId).toBeNull();
    expect(node(state, "transmission").recordId).toBeUndefined();
  });

  it("adopts the transmission record as soon as used_in resolves", () => {
    const state = apply(created(), {
      type: "sendPolled",
      at: 1300,
      wait: waiting({
        transmission_id: "trn-1",
        transmission: { id: "trn-1", state: "ACCEPTED", mode: "PROCESSING", logs: [] },
      }),
    });
    expect(state.transmissionId).toBe("trn-1");
    expect(node(state, "transmission")).toMatchObject({
      status: "active",
      recordId: "trn-1",
      state: "ACCEPTED",
      mode: "PROCESSING",
    });
    expect(state.outcome).toBeNull();
  });

  it("reaches COMPLETED and moves on to the artifacts", () => {
    const state = apply(created(), {
      type: "sendPolled",
      at: 1500,
      wait: waiting({
        finished: true,
        state: "COMPLETED",
        mode: "FINISHED",
        transmission_id: "trn-1",
        transmission: { id: "trn-1", state: "COMPLETED", mode: "FINISHED", logs: [] },
      }),
    });
    expect(state.outcome).toBe("transmitted");
    expect(state.phase).toBe("artifacts");
    expect(statuses(state)).toMatchObject({
      transaction: "done",
      transmission: "done",
      artifacts: "active",
    });
    expect(node(state, "transmission").endedAt).toBe(1500);
  });

  it("keeps an SDI rejection legible on the transmission node", () => {
    const state = apply(created(), {
      type: "sendPolled",
      at: 1600,
      wait: waiting({
        finished: true,
        state: "COMPLETED",
        mode: "FINISHED",
        transmission_id: "trn-1",
        transmission: {
          id: "trn-1",
          state: "FAILED",
          mode: "FINISHED",
          logs: [{ severity: "ERROR", message: SDI_REJECTION }],
        },
      }),
    });
    expect(state.outcome).toBe("failed");
    expect(node(state, "transmission").status).toBe("failed");
    expect(node(state, "transmission").logs).toEqual([
      { severity: "ERROR", message: SDI_REJECTION },
    ]);
  });

  it("says plainly that a recipient without invoicing transmitted nothing", () => {
    const state = apply(created(), {
      type: "sendPolled",
      at: 1700,
      wait: waiting({
        finished: true,
        state: "COMPLETED",
        mode: "FINISHED",
        logs: [{ severity: "ERROR", message: "no recipient with invoicing configuration found" }],
      }),
    });
    expect(state.outcome).toBe("not-transmitted");
    expect(state.phase).toBe("settled");
    expect(statuses(state)).toMatchObject({
      transaction: "done",
      transmission: "skipped",
      artifacts: "skipped",
    });
    expect(node(state, "transmission").note).toBe(NO_TRANSMISSION_NOTE);
    expect(node(state, "transaction").logs[0].message).toMatch(/no recipient with invoicing/);
  });

  it("treats a REJECTED transaction as a failed transaction with no transmission", () => {
    const state = apply(created(), {
      type: "sendPolled",
      at: 1800,
      wait: waiting({ finished: true, state: "REJECTED", mode: "FINISHED" }),
    });
    expect(state.outcome).toBe("rejected");
    expect(statuses(state)).toMatchObject({ transaction: "failed", transmission: "skipped" });
  });

  it("classifies every terminal wait shape", () => {
    expect(sendOutcome(waiting({ finished: true, state: "FAILED" }))).toBe("failed");
    expect(sendOutcome(waiting({ finished: true, state: "REJECTED" }))).toBe("rejected");
    expect(sendOutcome(waiting({ finished: true, state: "COMPLETED" }))).toBe("not-transmitted");
    expect(
      sendOutcome(
        waiting({
          finished: true,
          transmission_id: "trn-1",
          transmission: { id: "trn-1", state: "REJECTED" },
        }),
      ),
    ).toBe("rejected");
  });

  it("calls a polling timeout what it is and can carry on afterwards", () => {
    const timed = apply(
      created(),
      { type: "sendPolled", at: 1900, wait: waiting() },
      { type: "sendStopped", at: 2000 },
    );
    expect(timed.outcome).toBe("timeout");
    expect(timed.phase).toBe("settled");
    expect(node(timed, "transaction").status).toBe("active");

    const resumed = sendReducer(timed, { type: "sendResumed", at: 2100 });
    expect(resumed.phase).toBe("polling");
    expect(resumed.outcome).toBeNull();
    expect(resumed.endedAt).toBeNull();
    expect(resumed.transactionId).toBe("txn-1");
  });

  it("fails the node that was in flight when the call itself blew up", () => {
    const state = apply(started(), {
      type: "sendFailed",
      at: 2200,
      error: "POST /api/invoices failed with 409",
    });
    expect(state.outcome).toBe("error");
    expect(state.error).toBe("POST /api/invoices failed with 409");
    expect(node(state, "intention")).toMatchObject({
      status: "failed",
      note: "POST /api/invoices failed with 409",
    });
  });

  it("settles once both artifacts have answered, error or not", () => {
    const transmitted = apply(created(), {
      type: "sendPolled",
      at: 2300,
      wait: waiting({
        finished: true,
        state: "COMPLETED",
        mode: "FINISHED",
        transmission_id: "trn-1",
        transmission: { id: "trn-1", state: "COMPLETED", mode: "FINISHED", logs: [] },
      }),
    });
    const withCompliance = sendReducer(transmitted, {
      type: "sendArtifact",
      at: 2400,
      kind: "compliance",
      artifact: { recordId: "trn-1", type: "application/xml", xml: "<FatturaElettronica/>" },
    });
    expect(withCompliance.phase).toBe("artifacts");
    expect(node(withCompliance, "artifacts").status).toBe("done");

    const settled = sendReducer(withCompliance, {
      type: "sendArtifact",
      at: 2500,
      kind: "archive",
      error: "record trn-1 carries no archive artifact",
    });
    expect(settled.phase).toBe("settled");
    expect(settled.endedAt).toBe(2500);
    expect(settled.compliance?.xml).toBe("<FatturaElettronica/>");
    expect(settled.archiveError).toMatch(/no archive artifact/);
  });

  it("marks the artifacts node failed when the compliance artifact is missing", () => {
    const transmitted = apply(created(), {
      type: "sendPolled",
      at: 2600,
      wait: waiting({
        finished: true,
        transmission_id: "trn-1",
        transmission: { id: "trn-1", state: "COMPLETED", mode: "FINISHED", logs: [] },
      }),
    });
    const state = apply(
      transmitted,
      { type: "sendArtifact", at: 2700, kind: "compliance", error: "409 artifact missing" },
      { type: "sendArtifact", at: 2700, kind: "archive", error: "409 artifact missing" },
    );
    expect(node(state, "artifacts")).toMatchObject({
      status: "failed",
      note: "409 artifact missing",
    });
    expect(state.outcome).toBe("transmitted");
    expect(state.compliance).toBeNull();
  });

  it("throws the whole run away on reset", () => {
    const state = apply(created(), { type: "sendReset" });
    expect(state).toEqual(freshSend());
  });
});
