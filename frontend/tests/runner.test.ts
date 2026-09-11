import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCall } from "../src/api-log";
import {
  finishLine,
  matchStepCalls,
  missingVariables,
  recordsCreated,
  resolvePointer,
  resolveStep,
  runCurlScript,
  runnableSummary,
  runSteps,
  savedNotesDismissed,
  saveNotesDismissed,
  seedValues,
  seedVariables,
  stepCurl,
  stoppedLine,
  summarise,
  type RunTransport,
  type StepResult,
  type Vars,
} from "../src/runner";
import type { CollectionStep, Settings } from "../src/uapi-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function step(overrides: Partial<CollectionStep>): CollectionStep {
  return {
    id: "step-1",
    name: "Create INTENTION::TRANSACTION",
    folder: "records",
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

function immediate(ms: number): Promise<void> {
  void ms;
  return Promise.resolve();
}

describe("templating", () => {
  it("substitutes variables into path, query and body strings", () => {
    const resolved = resolveStep(
      step({
        path: "/records/{{eInvoiceId}}",
        query: { system_id: "{{eInvoiceSystemId}}", "compliance-artifact": "" },
        body: { content: { system: { id: "{{eInvoiceSystemId}}" }, note: "for {{taxpayerId}}" } },
      }),
      { eInvoiceId: "rec-1", eInvoiceSystemId: "sys-1", taxpayerId: "tax-1" },
    );
    expect(resolved.missing).toEqual([]);
    expect(resolved.path).toBe("/records/rec-1?system_id=sys-1&compliance-artifact");
    expect(resolved.body).toEqual({
      content: { system: { id: "sys-1" }, note: "for tax-1" },
    });
  });

  it("keeps the variable's own type for a whole-string placeholder", () => {
    const resolved = resolveStep(
      step({ body: { amount: "{{lineCount}}", label: "{{lineCount}} lines" } }),
      { lineCount: 3 },
    );
    expect(resolved.body).toEqual({ amount: 3, label: "3 lines" });
  });

  it("resolves {{$guid}} to a UUID and {{$timestamp}} to epoch seconds", () => {
    const resolved = resolveStep(
      step({
        body: { key: "{{$guid}}", issued: "{{$timestamp}}", company: "{{$randomCompanyName}}" },
      }),
      {},
    );
    const body = resolved.body as { key: string; issued: number; company: string };
    expect(resolved.missing).toEqual([]);
    expect(body.key).toMatch(UUID);
    expect(body.issued).toBeGreaterThan(1_700_000_000);
    expect(typeof body.company).toBe("string");
    expect(body.company.length).toBeGreaterThan(0);
  });

  it("reports unresolved variables instead of sending the literal template", async () => {
    const transport = vi.fn<RunTransport>();
    const outcome = await runSteps({
      steps: [step({ path: "/records/{{missingId}}", body: { a: "{{alsoMissing}}" } })],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(outcome.results[0].status).toBe("failed");
    expect(outcome.results[0].error).toContain("{{missingId}}");
    expect(outcome.results[0].error).toContain("{{alsoMissing}}");
    expect(outcome.results[0].error).toContain("nothing was sent");
  });

  it("treats an empty-string variable as unset", async () => {
    const transport = vi.fn<RunTransport>();
    const outcome = await runSteps({
      steps: [step({ path: "/systems/{{eInvoiceSystemId}}", method: "GET" })],
      variables: { eInvoiceSystemId: "" },
      transport,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("failed");
    expect(outcome.results[0].error).toContain("{{eInvoiceSystemId}}");
  });
});

describe("resolvePointer", () => {
  it("resolves RFC 6901 pointers including array indices and escapes", () => {
    const body = { content: { id: "rec-1", logs: [{ message: "ok" }], "a/b": { "c~d": 1 } } };
    expect(resolvePointer(body, "/content/id")).toBe("rec-1");
    expect(resolvePointer(body, "/content/logs/0/message")).toBe("ok");
    expect(resolvePointer(body, "/content/a~1b/c~0d")).toBe(1);
    expect(resolvePointer(body, "/content/nope")).toBeUndefined();
    expect(resolvePointer(body, "")).toBe(body);
  });
});

describe("captures", () => {
  it("captures /content/id and /content/used_in/id into the variable map", async () => {
    const responses: Record<string, unknown> = {
      "POST /records": { content: { id: "int-1" } },
      "GET /records/int-1": { content: { id: "int-1", used_in: { id: "tx-1" } } },
    };
    const transport: RunTransport = ({ method, path }) =>
      Promise.resolve(responses[`${method} ${path}`]);
    const outcome = await runSteps({
      steps: [
        step({ captures: [{ variable: "intentionId", pointer: "/content/id" }] }),
        step({
          id: "step-2",
          name: "Retrieve",
          method: "GET",
          path: "/records/{{intentionId}}",
          captures: [{ variable: "transmissionId", pointer: "/content/used_in/id" }],
        }),
      ],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(outcome.results[0].captured).toEqual({ intentionId: "int-1" });
    expect(outcome.results[1].status).toBe("passed");
    expect(outcome.results[1].path).toBe("/records/int-1");
    expect(outcome.variables).toMatchObject({ intentionId: "int-1", transmissionId: "tx-1" });
  });

  it("fails the step when a capture pointer does not resolve", async () => {
    const transport: RunTransport = () => Promise.resolve({ content: {} });
    const outcome = await runSteps({
      steps: [step({ captures: [{ variable: "intentionId", pointer: "/content/id" }] })],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("failed");
    expect(outcome.results[0].error).toContain("capture intentionId: /content/id did not resolve");
  });
});

describe("waitFor", () => {
  it("re-issues the request until the pointer appears", async () => {
    let calls = 0;
    const transport: RunTransport = () => {
      calls += 1;
      return Promise.resolve(
        calls < 3
          ? { content: { id: "tx-1" } }
          : { content: { id: "tx-1", used_in: { id: "tr-1" } } },
      );
    };
    const outcome = await runSteps({
      steps: [
        step({
          method: "GET",
          path: "/records/tx-1",
          waitFor: { pointer: "/content/used_in/id", equals: null, timeoutS: 60 },
          captures: [{ variable: "transmissionId", pointer: "/content/used_in/id" }],
        }),
      ],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(calls).toBe(3);
    expect(outcome.results[0].status).toBe("passed");
    expect(outcome.results[0].polls).toBe(2);
    expect(outcome.variables.transmissionId).toBe("tr-1");
  });

  it("waits until the pointer equals the expected value", async () => {
    let calls = 0;
    const transport: RunTransport = () => {
      calls += 1;
      return Promise.resolve({ content: { mode: calls < 2 ? "PROCESSING" : "FINISHED" } });
    };
    const outcome = await runSteps({
      steps: [
        step({
          method: "GET",
          waitFor: { pointer: "/content/mode", equals: "FINISHED", timeoutS: 60 },
        }),
      ],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("passed");
    expect(calls).toBe(2);
  });

  it("fails with the last seen value when the timeout elapses", async () => {
    let clock = 0;
    const transport: RunTransport = () => Promise.resolve({ content: { mode: "PROCESSING" } });
    const outcome = await runSteps({
      steps: [
        step({
          method: "GET",
          waitFor: { pointer: "/content/mode", equals: "FINISHED", timeoutS: 5 },
        }),
      ],
      variables: {},
      transport,
      sleep: immediate,
      now: () => {
        clock += 3000;
        return clock;
      },
    });
    expect(outcome.results[0].status).toBe("failed");
    expect(outcome.results[0].error).toContain("waited 5s for /content/mode = FINISHED");
    expect(outcome.results[0].error).toContain("PROCESSING");
  });
});

describe("assertions", () => {
  it("records expected vs actual for pass and fail", async () => {
    const transport: RunTransport = () =>
      Promise.resolve({ content: { state: "COMPLETED", type: "TRANSACTION::INVOICE" } });
    const outcome = await runSteps({
      steps: [
        step({
          asserts: [
            { pointer: "/content/type", equals: "TRANSACTION::INVOICE" },
            { pointer: "/content/state", equals: "FAILED" },
          ],
        }),
      ],
      variables: {},
      transport,
      sleep: immediate,
    });
    const result = outcome.results[0];
    expect(result.status).toBe("failed");
    expect(result.assertions).toEqual([
      {
        pointer: "/content/type",
        expected: "TRANSACTION::INVOICE",
        actual: "TRANSACTION::INVOICE",
        ok: true,
      },
      { pointer: "/content/state", expected: "FAILED", actual: "COMPLETED", ok: false },
    ]);
    expect(result.error).toContain("expected FAILED, got COMPLETED");
  });
});

describe("run control", () => {
  it("halts on failure by default and marks the rest skipped", async () => {
    const transport: RunTransport = ({ path }) =>
      path === "/bad" ? Promise.reject(new Error("boom")) : Promise.resolve({ content: {} });
    const outcome = await runSteps({
      steps: [
        step({ id: "a", path: "/ok" }),
        step({ id: "b", path: "/bad" }),
        step({ id: "c", path: "/never" }),
      ],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("passed");
    expect(outcome.results[1].status).toBe("failed");
    expect(outcome.results[2].status).toBe("skipped");
    expect(outcome.results[2].skipReason).toContain("step 2 failed");
    expect(outcome.haltedAt).toBe(1);
  });

  it("keeps running past failures with continueOnFailure", async () => {
    const transport: RunTransport = ({ path }) =>
      path === "/bad" ? Promise.reject(new Error("boom")) : Promise.resolve({ content: {} });
    const outcome = await runSteps({
      steps: [step({ id: "a", path: "/bad" }), step({ id: "b", path: "/ok" })],
      variables: {},
      transport,
      continueOnFailure: true,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("failed");
    expect(outcome.results[1].status).toBe("passed");
    expect(outcome.haltedAt).toBeNull();
  });

  it("skips non-runnable steps with their skipReason and keeps going", async () => {
    const transport: RunTransport = () => Promise.resolve({ content: {} });
    const outcome = await runSteps({
      steps: [
        step({ id: "a", runnable: false, skipReason: "not run — creates account resources" }),
        step({ id: "b" }),
      ],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("skipped");
    expect(outcome.results[0].skipReason).toBe("not run — creates account resources");
    expect(outcome.results[1].status).toBe("passed");
  });

  it("runs only the requested range", async () => {
    const transport = vi.fn<RunTransport>(() => Promise.resolve({ content: {} }));
    const outcome = await runSteps({
      steps: [step({ id: "a" }), step({ id: "b" }), step({ id: "c" })],
      variables: {},
      transport,
      from: 1,
      to: 1,
      sleep: immediate,
    });
    expect(Object.keys(outcome.results)).toEqual(["1"]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("treats a stop as a pause: unreached steps stay pending and stoppedAt marks the resume point", async () => {
    const abort = new AbortController();
    const transport: RunTransport = () => {
      abort.abort();
      return Promise.resolve({ content: {} });
    };
    const outcome = await runSteps({
      steps: [step({ id: "a" }), step({ id: "b" })],
      variables: {},
      transport,
      signal: abort.signal,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("passed");
    // No verdict for the step the run never reached — a later run resumes there.
    expect(outcome.results[1]).toBeUndefined();
    expect(outcome.stoppedAt).toBe(1);
  });

  it("skips the step whose wait the stop interrupted, without a verdict for the rest", async () => {
    const abort = new AbortController();
    const transport: RunTransport = () => Promise.resolve({ content: { mode: "PROCESSING" } });
    const outcome = await runSteps({
      steps: [
        step({
          id: "a",
          method: "GET",
          waitFor: { pointer: "/content/mode", equals: "FINISHED", timeoutS: 60 },
        }),
        step({ id: "b" }),
      ],
      variables: {},
      transport,
      signal: abort.signal,
      sleep: () => {
        abort.abort();
        return Promise.resolve();
      },
    });
    expect(outcome.results[0].status).toBe("skipped");
    expect(outcome.results[0].skipReason).toBe("run stopped while waiting");
    expect(outcome.results[1]).toBeUndefined();
    expect(outcome.stoppedAt).toBe(1);
  });

  it("reports where a stopped run paused and how many steps stay pending", () => {
    const steps = [step({ id: "a" }), step({ id: "b" }), step({ id: "c" })];
    expect(stoppedLine(steps, { 0: done({}) }, 1)).toBe("Stopped after step 1 — 2 steps pending");
    expect(stoppedLine(steps, {}, 0)).toBe("Stopped before the first step — 3 steps pending");
    expect(stoppedLine(steps, { 0: done({}), 1: done({}) }, 2)).toBe(
      "Stopped after step 2 — 1 step pending",
    );
  });

  it("sends an idempotency key on POST but not on GET", async () => {
    const keys: (string | undefined)[] = [];
    const transport: RunTransport = ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      return Promise.resolve({ content: {} });
    };
    await runSteps({
      steps: [step({ id: "a", method: "POST" }), step({ id: "b", method: "GET", path: "/x" })],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(keys[0]).toMatch(UUID);
    expect(keys[1]).toBeUndefined();
  });
});

describe("seeding and analysis", () => {
  const settings: Settings = {
    mode: "mock",
    environment: "test",
    base_url: "https://test.api.fiskaly.com",
    api_version: "2026-06-01",
    credentials: { configured: true, source: "env", fingerprint: "test***" },
    systems: {
      IT: { system_id: "sys-it", taxpayer_id: "tax-it" },
      BE: { system_id: "sys-be", taxpayer_id: "tax-be" },
      DE: { system_id: "sys-de", taxpayer_id: "tax-de" },
    },
  };

  const unconfigured: Settings = { ...settings, systems: {} };

  it("seeds identifiers from the settings for the collection country", () => {
    const seeds = seedVariables(settings, "de");
    expect(seedValues(seeds)).toEqual({
      apiBaseUrl: "https://test.api.fiskaly.com",
      apiVersion: "2026-06-01",
      eInvoiceSystemId: "sys-de",
      taxpayerId: "tax-de",
    });
    // The German collection seeds from the German slot — it used to borrow Belgium's.
    expect(seeds.find((seed) => seed.name === "eInvoiceSystemId")?.source).toContain("DE");
  });

  it("falls back to MOCK placeholders for unconfigured identifiers in mock mode", () => {
    const seeds = seedVariables(unconfigured, "it");
    const bySeed = Object.fromEntries(seeds.map((seed) => [seed.name, seed.value]));
    expect(bySeed.eInvoiceSystemId).toBe("demo-e-invoice-system");
    expect(bySeed.taxpayerId).toBe("demo-taxpayer");
    expect(seeds.find((seed) => seed.name === "taxpayerId")?.source).toContain("MOCK placeholder");
  });

  it("leaves unconfigured identifiers empty in live mode instead of inventing them", () => {
    const live: Settings = { ...unconfigured, mode: "live" };
    const seeds = seedVariables(live, "it");
    const bySeed = Object.fromEntries(seeds.map((seed) => [seed.name, seed.value]));
    expect(bySeed.eInvoiceSystemId).toBe("");
    expect(bySeed.taxpayerId).toBe("");
    expect(seedValues(seeds)).not.toHaveProperty("eInvoiceSystemId");
    expect(seeds.find((seed) => seed.name === "eInvoiceSystemId")?.source).toBe(
      "Settings → Identifiers (IT)",
    );
  });

  it("marks identifier seeds with the Settings section that configures them", () => {
    const seeds = seedVariables(settings, "it");
    expect(seeds.find((seed) => seed.name === "eInvoiceSystemId")?.section).toBe(
      "settings-identifiers",
    );
    expect(seeds.find((seed) => seed.name === "apiBaseUrl")?.section).toBeUndefined();
  });

  it("asserts presence when equals is null", async () => {
    const transport: RunTransport = () =>
      Promise.resolve({ content: { annotations: { peppol_id: "0208:0123456789" } } });
    const outcome = await runSteps({
      steps: [
        step({
          method: "GET",
          asserts: [
            { pointer: "/content/annotations/peppol_id", equals: null },
            { pointer: "/content/annotations/missing", equals: null },
          ],
        }),
      ],
      variables: {},
      transport,
      sleep: immediate,
    });
    const result = outcome.results[0];
    expect(result.assertions[0]).toMatchObject({ expected: "(present)", ok: true });
    expect(result.assertions[1]).toMatchObject({ expected: "(present)", ok: false });
    expect(result.status).toBe("failed");
  });

  it("flags variables no seed provides and no earlier step captures", () => {
    const steps: CollectionStep[] = [
      step({ id: "a", captures: [{ variable: "intentionId", pointer: "/content/id" }] }),
      step({ id: "b", name: "Retrieve", method: "GET", path: "/records/{{intentionId}}" }),
      step({ id: "c", name: "Check", method: "GET", path: "/systems/{{eInvoiceSystemId}}" }),
    ];
    const missing = missingVariables(steps, { taxpayerId: "tax-1" } satisfies Vars);
    expect(missing).toEqual([{ name: "eInvoiceSystemId", stepIndex: 2, stepName: "Check" }]);
  });

  it("counts the records a LIVE run would create", () => {
    const steps: CollectionStep[] = [
      step({ id: "a", method: "POST" }),
      step({ id: "b", method: "GET" }),
      step({ id: "c", method: "POST", runnable: false }),
      step({ id: "d", method: "POST" }),
    ];
    expect(recordsCreated(steps, 0, 3)).toBe(2);
    expect(recordsCreated(steps, 3, 3)).toBe(1);
  });

  it("summarises a binary response instead of failing to parse it", async () => {
    const transport: RunTransport = () =>
      Promise.resolve({ binary: true, content_type: "application/zip", bytes: 512 });
    const outcome = await runSteps({
      steps: [step({ id: "a", method: "GET", path: "/files/rec-1.zip" })],
      variables: {},
      transport,
      sleep: immediate,
    });
    expect(outcome.results[0].status).toBe("passed");
    expect(outcome.results[0].binary).toEqual({ contentType: "application/zip", bytes: 512 });
  });

  it("says how many steps actually run against the API", () => {
    const runnable = [step({ id: "a" }), step({ id: "b" })];
    expect(runnableSummary(runnable)).toBe("All 2 steps run against the API.");
    const mixed = [
      step({ id: "a" }),
      step({ id: "b", runnable: false, skipReason: "account mutation" }),
      step({ id: "c" }),
    ];
    expect(runnableSummary(mixed)).toBe(
      "2 of 3 steps run against the API; the rest are skipped with a reason inline.",
    );
  });

  it("summarises results", () => {
    expect(
      summarise({
        0: { status: "passed", polls: 0, captured: {}, assertions: [] },
        1: { status: "failed", polls: 0, captured: {}, assertions: [] },
        2: { status: "skipped", polls: 0, captured: {}, assertions: [] },
      }),
    ).toBe("1 passed · 1 failed · 1 skipped");
  });
});

function call(overrides: Partial<ApiCall>): ApiCall {
  return {
    id: "1",
    ts: "2026-08-28T10:00:00Z",
    step: "passthrough",
    mode: "MOCK",
    method: "POST",
    url: "http://localhost:8000/records",
    request: { headers: {} },
    duration_ms: 12,
    curl: "curl -X POST 'https://test.api.fiskaly.com/records'",
    ...overrides,
  };
}

function done(overrides: Partial<StepResult>): StepResult {
  return {
    status: "passed",
    polls: 0,
    captured: {},
    assertions: [],
    sent: true,
    runId: "run-1",
    ...overrides,
  };
}

describe("finishLine", () => {
  it("appends the elapsed wall-clock time", () => {
    const line = finishLine([step({})], { 0: done({}) }, 12_345);
    expect(line).toBe("Finished: 1 passed \u00b7 0 failed \u00b7 0 skipped in 12.3 s");
  });

  it("names the first failing step", () => {
    const steps = [
      step({ name: "Create INTENTION::TRANSACTION" }),
      step({ name: "Create TRANSACTION::INVOICE" }),
      step({ name: "Retrieve TRANSACTION::INVOICE" }),
    ];
    const line = finishLine(
      steps,
      {
        0: done({}),
        1: done({ status: "failed" }),
        2: done({ status: "skipped" }),
      },
      500,
    );
    expect(line).toBe(
      "Finished: 1 passed \u00b7 1 failed \u00b7 1 skipped in 0.5 s " +
        "\u2014 first failure: Create TRANSACTION::INVOICE",
    );
  });

  it("switches to minutes for long runs", () => {
    expect(finishLine([step({})], { 0: done({}) }, 125_000)).toContain("in 2 min 5 s");
  });
});

describe("matchStepCalls and stepCurl", () => {
  it("matches a step to its recorded call by run_id and step_name", () => {
    const steps = [step({ name: "Create INTENTION::TRANSACTION" })];
    const results = { 0: done({}) };
    const calls = [
      call({
        id: "2",
        step_name: "Create INTENTION::TRANSACTION",
        run_id: "run-1",
        curl: "curl A",
      }),
      call({ id: "1", step: "token", step_name: undefined, run_id: undefined }),
    ];
    const matches = matchStepCalls(steps, results, calls);
    expect(matches[0]?.curl).toBe("curl A");
    expect(stepCurl(results[0], matches[0])).toEqual({ curl: "curl A" });
  });

  it("collapses polls of one step into a single match on its first call", () => {
    const steps = [step({ name: "Retrieve TRANSACTION::INVOICE", method: "GET" })];
    const results = { 0: done({ polls: 2 }) };
    const calls = [
      call({
        id: "3",
        step_name: "Retrieve TRANSACTION::INVOICE",
        run_id: "run-1",
        curl: "poll 3",
      }),
      call({
        id: "2",
        step_name: "Retrieve TRANSACTION::INVOICE",
        run_id: "run-1",
        curl: "poll 2",
      }),
      call({
        id: "1",
        step_name: "Retrieve TRANSACTION::INVOICE",
        run_id: "run-1",
        curl: "poll 1",
      }),
    ];
    expect(matchStepCalls(steps, results, calls)[0]?.curl).toBe("poll 1");
  });

  it("consumes same-named steps in order, as in the BE collection's two folders", () => {
    const steps = [
      step({ id: "s1", name: "Create TRANSACTION::INVOICE" }),
      step({ id: "s2", name: "Retrieve TRANSACTION::INVOICE", method: "GET" }),
      step({ id: "s3", name: "Create TRANSACTION::INVOICE" }),
    ];
    const results = { 0: done({}), 1: done({}), 2: done({}) };
    const calls = [
      call({ id: "3", step_name: "Create TRANSACTION::INVOICE", run_id: "run-1", curl: "second" }),
      call({ id: "2", step_name: "Retrieve TRANSACTION::INVOICE", run_id: "run-1", curl: "get" }),
      call({ id: "1", step_name: "Create TRANSACTION::INVOICE", run_id: "run-1", curl: "first" }),
    ];
    const matches = matchStepCalls(steps, results, calls);
    expect(matches[0]?.curl).toBe("first");
    expect(matches[1]?.curl).toBe("get");
    expect(matches[2]?.curl).toBe("second");
  });

  it("ignores calls from another run", () => {
    const steps = [step({ name: "Create INTENTION::TRANSACTION" })];
    const results = { 0: done({ runId: "run-2" }) };
    const calls = [call({ id: "1", step_name: "Create INTENTION::TRANSACTION", run_id: "run-1" })];
    const matches = matchStepCalls(steps, results, calls);
    expect(matches[0]).toBeUndefined();
    expect(stepCurl(results[0], matches[0])).toEqual({
      curl: null,
      reason: "its call is no longer in the API log",
    });
  });

  it("explains why nothing can be copied", () => {
    expect(stepCurl(undefined, undefined)).toEqual({ curl: null, reason: "not run yet" });
    expect(stepCurl(done({ status: "running" }), undefined)).toEqual({
      curl: null,
      reason: "still running",
    });
    expect(stepCurl(done({ status: "skipped", sent: false }), undefined)).toEqual({
      curl: null,
      reason: "step was skipped \u2014 nothing was sent",
    });
    expect(
      stepCurl(
        done({ status: "skipped", sent: false, skipReason: "handled by the proxy" }),
        undefined,
      ),
    ).toEqual({
      curl: null,
      reason: "step was skipped \u2014 handled by the proxy",
    });
    expect(stepCurl(done({ status: "failed", sent: false }), undefined)).toEqual({
      curl: null,
      reason: "nothing was sent",
    });
  });
});

describe("runCurlScript", () => {
  it("yields every step's cURL in order with skipped steps annotated", () => {
    const steps = [
      step({ id: "s1", name: "Create INTENTION::TRANSACTION" }),
      step({
        id: "s2",
        name: "Create a Taxpayer::COMPANY",
        runnable: false,
        skipReason: "creates or mutates account resources",
      }),
      step({ id: "s3", name: "Create TRANSACTION::INVOICE" }),
    ];
    const results = {
      0: done({}),
      1: done({
        status: "skipped",
        sent: false,
        skipReason: "creates or mutates account resources",
      }),
      2: done({}),
    };
    const matches = {
      0: call({ id: "1", curl: "curl one" }),
      2: call({ id: "2", curl: "curl two" }),
    };
    const script = runCurlScript("fiskaly E-INVOICE (DE)", steps, results, matches);
    expect(script).toBe(
      [
        "# fiskaly E-INVOICE (DE) \u2014 collection run, steps in execution order",
        "",
        "# 1. Create INTENTION::TRANSACTION",
        "curl one",
        "",
        "# 2. Create a Taxpayer::COMPANY \u2014 step was skipped \u2014 creates or mutates account resources",
        "",
        "# 3. Create TRANSACTION::INVOICE",
        "curl two",
      ].join("\n"),
    );
  });

  it("returns null when no step has a recorded call", () => {
    expect(runCurlScript("x", [step({})], { 0: done({ sent: false }) }, {})).toBeNull();
  });
});

describe("notes dismissal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists per collection id and survives switches", () => {
    expect(savedNotesDismissed("de")).toBe(false);
    saveNotesDismissed("de");
    expect(savedNotesDismissed("de")).toBe(true);
    expect(savedNotesDismissed("be")).toBe(false);
    saveNotesDismissed("be");
    expect(savedNotesDismissed("de")).toBe(true);
    expect(savedNotesDismissed("be")).toBe(true);
    expect(savedNotesDismissed(null)).toBe(false);
  });

  it("recovers from an unreadable stored value", () => {
    localStorage.setItem("runner:notes-dismissed", "{not json");
    expect(savedNotesDismissed("de")).toBe(false);
    saveNotesDismissed("de");
    expect(savedNotesDismissed("de")).toBe(true);
  });
});
