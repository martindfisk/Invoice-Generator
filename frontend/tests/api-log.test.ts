import { afterEach, describe, expect, it, vi } from "vitest";
import {
  groupCalls,
  headerEntries,
  normaliseMode,
  otherHeaders,
  parseCall,
  pathOf,
  PROMINENT_HEADERS,
  subscribeApiLog,
  type ApiCall,
} from "../src/api-log";

const payload = {
  id: "call-1",
  ts: "2026-08-26T09:31:02.412Z",
  step: "setup",
  persona: "seller",
  mode: "live",
  method: "GET",
  url: "https://test.api.fiskaly.com/api/v5/systems/sys-1",
  request: { headers: { Authorization: "Bearer ****ab12", "X-Api-Version": "2026-06-01" } },
  response: {
    status: 200,
    headers: { "X-Trace-Identifier": "trace-1" },
    body: { id: "sys-1", state: "OPERATIVE" },
  },
  duration_ms: 142,
  curl: "curl -H 'Authorization: Bearer $FISKALY_TOKEN' https://test.api.fiskaly.com/api/v5/systems/sys-1",
  record_id: "sys-1",
};

describe("parseCall", () => {
  it("parses one SSE call payload and upper-cases the mode", () => {
    const call = parseCall(JSON.stringify(payload));
    expect(call).toEqual({ ...payload, mode: "LIVE" });
    expect(call.response?.body).toEqual({ id: "sys-1", state: "OPERATIVE" });
  });

  it("normalises mock and mixed-case modes", () => {
    expect(parseCall(JSON.stringify({ ...payload, mode: "mock" })).mode).toBe("MOCK");
    expect(normaliseMode("Live")).toBe("LIVE");
  });

  it("rejects unknown modes and malformed records", () => {
    expect(() => normaliseMode("staging")).toThrow(/Unknown mode "staging"/);
    expect(() => parseCall(JSON.stringify({ ...payload, id: 7 }))).toThrow(/"id" must be a string/);
    expect(() => parseCall(JSON.stringify({ ...payload, persona: "auditor" }))).toThrow(/persona/);
    expect(() => parseCall("null")).toThrow(/JSON object/);
  });
});

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;

  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe("subscribeApiLog", () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("forwards call events to the callback and closes on unsubscribe", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onCall = vi.fn();
    const unsubscribe = subscribeApiLog(onCall);
    const [source] = FakeEventSource.instances;
    expect(source.url).toBe("/api/events");

    source.dispatchEvent(new MessageEvent("call", { data: JSON.stringify(payload) }));
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ id: "call-1", mode: "LIVE" }));

    unsubscribe();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("reconnects with doubling backoff once the browser has given up", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const unsubscribe = subscribeApiLog(vi.fn());

    const [first] = FakeEventSource.instances;
    first.readyState = FakeEventSource.CLOSED;
    first.dispatchEvent(new Event("error"));
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);

    const second = FakeEventSource.instances[1];
    second.readyState = FakeEventSource.CLOSED;
    second.dispatchEvent(new Event("error"));
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    unsubscribe();
  });
});

function call(id: string, overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    id,
    ts: `2026-08-26T09:31:${id.padStart(2, "0")}.000Z`,
    step: "poll",
    persona: "seller",
    mode: "MOCK",
    method: "GET",
    url: "https://test.api.fiskaly.com/records/trn-1",
    request: { headers: {} },
    response: { status: 200, headers: {} },
    duration_ms: 8,
    curl: "curl https://test.api.fiskaly.com/records/trn-1",
    record_id: "trn-1",
    ...overrides,
  };
}

describe("groupCalls", () => {
  it("collapses a run of identical polls into one expandable group", () => {
    const groups = groupCalls([call("5"), call("4"), call("3"), call("2")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].repeats).toBe(4);
    expect(groups[0].latest.id).toBe("5");
    expect(groups[0].calls.map((entry) => entry.id)).toEqual(["5", "4", "3", "2"]);
  });

  it("never groups anything but consecutive identical GETs", () => {
    const groups = groupCalls([
      call("6"),
      call("5", { url: "https://test.api.fiskaly.com/records/trn-1?compliance-artifact" }),
      call("4"),
      call("3", {
        method: "POST",
        url: "https://test.api.fiskaly.com/records",
        step: "transaction",
      }),
      call("2", { method: "POST", url: "https://test.api.fiskaly.com/records", step: "intention" }),
    ]);
    expect(groups.map((group) => group.repeats)).toEqual([1, 1, 1, 1, 1]);
  });

  it("splits a run when the persona or the step changes", () => {
    const groups = groupCalls([call("4"), call("3", { persona: "buyer" }), call("2")]);
    expect(groups.map((group) => group.repeats)).toEqual([1, 1, 1]);
    const steps = groupCalls([call("3"), call("2", { step: "artifact" })]);
    expect(steps.map((group) => group.repeats)).toEqual([1, 1]);
  });

  it("keeps one group per record when two records are polled in turn", () => {
    const other = { url: "https://test.api.fiskaly.com/records/txn-1", record_id: "txn-1" };
    const groups = groupCalls([call("4"), call("3"), call("2", other), call("1", other)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].latest.record_id).toBe("trn-1");
    expect(groups[1].latest.record_id).toBe("txn-1");
  });

  it("leaves an empty log empty", () => {
    expect(groupCalls([])).toEqual([]);
  });
});

describe("call presentation", () => {
  it("shows path and query, and falls back to the raw string", () => {
    expect(pathOf("https://test.api.fiskaly.com/records/x?compliance-artifact")).toBe(
      "/records/x?compliance-artifact",
    );
    expect(pathOf("/records/x")).toBe("/records/x");
  });

  it("picks the fiskaly headers out in a fixed order, whatever their case", () => {
    const headers = {
      "x-trace-identifier": "trace-1",
      Authorization: "Bearer ****ab12",
      "X-Api-Version": "2026-06-01",
      "x-idempotency-key": "key-1",
    };
    expect(headerEntries(headers, PROMINENT_HEADERS)).toEqual([
      ["X-Api-Version", "2026-06-01"],
      ["X-Idempotency-Key", "key-1"],
      ["X-Trace-Identifier", "trace-1"],
    ]);
    expect(otherHeaders(headers, PROMINENT_HEADERS)).toEqual([
      ["Authorization", "Bearer ****ab12"],
    ]);
    expect(headerEntries(undefined, PROMINENT_HEADERS)).toEqual([]);
  });
});
