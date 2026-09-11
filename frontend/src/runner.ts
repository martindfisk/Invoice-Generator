import type { ApiCall } from "./api-log";
import type {
  Collection,
  CollectionStep,
  CollectionSummary,
  Settings,
  SettingsCountry,
} from "./uapi-client";

export type Vars = Record<string, unknown>;

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export type AssertionResult = { pointer: string; expected: string; actual: string; ok: boolean };

export type BinarySummary = { contentType: string; bytes: number };

export type StepResult = {
  status: StepStatus;
  durationMs?: number;
  method?: string;
  path?: string;
  polls: number;
  captured: Record<string, unknown>;
  assertions: AssertionResult[];
  error?: string;
  skipReason?: string;
  runId?: string;
  sent?: boolean;
  binary?: BinarySummary;
};

export type TransportRequest = {
  method: string;
  path: string;
  body: unknown;
  stepId: string;
  stepName: string;
  idempotencyKey?: string;
};

export type RunTransport = (request: TransportRequest) => Promise<unknown>;

export type RunOptions = {
  steps: CollectionStep[];
  variables: Vars;
  transport: RunTransport;
  from?: number;
  to?: number;
  continueOnFailure?: boolean;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  onStep?: (index: number, result: StepResult, variables: Vars) => void;
};

export type RunOutcome = {
  results: Record<number, StepResult>;
  variables: Vars;
  haltedAt: number | null;
  // Index of the first step the loop never reached because the run was stopped; null when the
  // run ran to its end. The steps from here on keep their pending results, so a later run
  // resumes instead of reporting them skipped.
  stoppedAt: number | null;
};

const TEMPLATE = /\{\{([^{}]+)\}\}/g;
const WHOLE = /^\{\{([^{}]+)\}\}$/;

const COMPANY_NAMES = ["Muster GmbH", "Rossi S.r.l.", "Van Peppol BV", "Exempel AB"];

function dynamicValue(name: string): { known: boolean; value?: unknown } {
  switch (name) {
    case "$guid":
      return { known: true, value: crypto.randomUUID() };
    case "$timestamp":
      return { known: true, value: Math.floor(Date.now() / 1000) };
    case "$randomCompanyName":
      return {
        known: true,
        value: COMPANY_NAMES[Math.floor(Math.random() * COMPANY_NAMES.length)],
      };
    default:
      return { known: false };
  }
}

function lookup(rawName: string, vars: Vars, missing: Set<string>): unknown {
  const name = rawName.trim();
  if (name.startsWith("$")) {
    const dynamic = dynamicValue(name);
    if (dynamic.known) return dynamic.value;
    missing.add(name);
    return undefined;
  }
  const value = vars[name];
  if (value === undefined || value === null || value === "") {
    missing.add(name);
    return undefined;
  }
  return value;
}

export function resolveText(input: string, vars: Vars, missing: Set<string>): unknown {
  const whole = WHOLE.exec(input);
  if (whole) {
    const before = missing.size;
    const value = lookup(whole[1], vars, missing);
    return missing.size > before ? input : value;
  }
  return input.replace(TEMPLATE, (match, name: string) => {
    const before = missing.size;
    const value = lookup(name, vars, missing);
    return missing.size > before ? match : String(value);
  });
}

function resolveValue(value: unknown, vars: Vars, missing: Set<string>): unknown {
  if (typeof value === "string") return resolveText(value, vars, missing);
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, vars, missing));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[String(resolveText(key, vars, missing))] = resolveValue(entry, vars, missing);
    }
    return out;
  }
  return value;
}

function queryString(query: Record<string, string>, vars: Vars, missing: Set<string>): string {
  const parts = Object.entries(query).map(([key, value]) => {
    const resolved = String(resolveText(value, vars, missing) ?? "");
    const name = encodeURIComponent(key);
    return resolved === "" ? name : `${name}=${encodeURIComponent(resolved)}`;
  });
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export type ResolvedRequest = {
  method: string;
  path: string;
  body: unknown;
  missing: string[];
};

export function resolveStep(step: CollectionStep, vars: Vars): ResolvedRequest {
  const missing = new Set<string>();
  const path =
    String(resolveText(step.path, vars, missing)) + queryString(step.query, vars, missing);
  const body = step.body === null ? null : resolveValue(step.body, vars, missing);
  return { method: step.method.toUpperCase(), path, body, missing: [...missing] };
}

export function resolvePointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) return undefined;
  let current: unknown = value;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      current = current[Number(token)];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

function asText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function emptyResult(): StepResult {
  return { status: "pending", polls: 0, captured: {}, assertions: [] };
}

export function pendingResult(): StepResult {
  return emptyResult();
}

function skipped(reason: string): StepResult {
  return { ...emptyResult(), status: "skipped", skipReason: reason };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function binarySummary(response: unknown): BinarySummary | undefined {
  if (response === null || typeof response !== "object") return undefined;
  const record = response as Record<string, unknown>;
  if (record.binary !== true) return undefined;
  return {
    contentType: typeof record.content_type === "string" ? record.content_type : "unknown",
    bytes: typeof record.bytes === "number" ? record.bytes : 0,
  };
}

type StepContext = {
  transport: RunTransport;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
};

async function runStep(step: CollectionStep, vars: Vars, ctx: StepContext): Promise<StepResult> {
  const resolved = resolveStep(step, vars);
  if (resolved.missing.length > 0) {
    const names = resolved.missing.map((name) => `{{${name}}}`).join(", ");
    return {
      ...emptyResult(),
      status: "failed",
      method: resolved.method,
      path: step.path,
      error: `unresolved ${names} — nothing was sent`,
    };
  }
  const needsKey = resolved.method === "POST" || resolved.method === "PATCH";
  const idempotencyKey = needsKey ? crypto.randomUUID() : undefined;
  let sent = false;
  const issue = () => {
    sent = true;
    return ctx.transport({
      method: resolved.method,
      path: resolved.path,
      body: resolved.body,
      stepId: step.id,
      stepName: step.name,
      idempotencyKey,
    });
  };
  const started = ctx.now();
  let polls = 0;
  let response: unknown;
  try {
    response = await issue();
    if (step.waitFor) {
      const { pointer, equals, timeoutS } = step.waitFor;
      const satisfied = () => {
        const value = resolvePointer(response, pointer);
        return equals === null ? value !== undefined : asText(value) === equals;
      };
      while (!satisfied()) {
        if (ctx.signal?.aborted) {
          return {
            ...skipped("run stopped while waiting"),
            method: resolved.method,
            path: resolved.path,
            polls,
            sent,
          };
        }
        if (ctx.now() - started >= timeoutS * 1000) {
          const last = asText(resolvePointer(response, pointer)) ?? "(unresolved)";
          const expectation = equals === null ? "to resolve" : `= ${equals}`;
          return {
            ...emptyResult(),
            status: "failed",
            method: resolved.method,
            path: resolved.path,
            polls,
            durationMs: ctx.now() - started,
            sent,
            error: `waited ${timeoutS}s for ${pointer} ${expectation} — last value ${last}`,
          };
        }
        await ctx.sleep(ctx.pollIntervalMs);
        polls += 1;
        response = await issue();
      }
    }
  } catch (error) {
    return {
      ...emptyResult(),
      status: "failed",
      method: resolved.method,
      path: resolved.path,
      polls,
      durationMs: ctx.now() - started,
      sent,
      error: reason(error),
    };
  }
  const assertions: AssertionResult[] = step.asserts.map(({ pointer, equals }) => {
    const value = resolvePointer(response, pointer);
    const actual = asText(value) ?? "(unresolved)";
    if (equals === null) return { pointer, expected: "(present)", actual, ok: value !== undefined };
    return { pointer, expected: equals, actual, ok: actual === equals };
  });
  const captured: Record<string, unknown> = {};
  const problems: string[] = assertions
    .filter((assertion) => !assertion.ok)
    .map((a) => `assert ${a.pointer}: expected ${a.expected}, got ${a.actual}`);
  for (const { variable, pointer } of step.captures) {
    const value = resolvePointer(response, pointer);
    if (value === undefined) problems.push(`capture ${variable}: ${pointer} did not resolve`);
    else captured[variable] = value;
  }
  return {
    status: problems.length === 0 ? "passed" : "failed",
    durationMs: ctx.now() - started,
    method: resolved.method,
    path: resolved.path,
    polls,
    captured,
    assertions,
    sent,
    binary: binarySummary(response),
    error: problems.length === 0 ? undefined : problems.join("; "),
  };
}

export async function runSteps(options: RunOptions): Promise<RunOutcome> {
  const {
    steps,
    transport,
    from = 0,
    to = steps.length - 1,
    continueOnFailure = false,
    pollIntervalMs = 1000,
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    signal,
    onStep,
  } = options;
  const variables: Vars = { ...options.variables };
  const results: Record<number, StepResult> = {};
  let haltedAt: number | null = null;
  let stoppedAt: number | null = null;

  const report = (index: number, result: StepResult) => {
    results[index] = result;
    onStep?.(index, result, { ...variables });
  };

  for (let index = Math.max(from, 0); index <= to && index < steps.length; index += 1) {
    const step = steps[index];
    // A stop is a pause, not a verdict: the steps not reached keep their pending results so
    // the next run can resume from here instead of reporting them skipped.
    if (signal?.aborted) {
      stoppedAt = index;
      break;
    }
    if (!step.runnable) {
      report(index, skipped(step.skipReason ?? "not runnable"));
      continue;
    }
    if (haltedAt !== null && !continueOnFailure) {
      report(index, skipped(`skipped — step ${haltedAt + 1} failed`));
      continue;
    }
    report(index, { ...emptyResult(), status: "running" });
    const result = await runStep(step, variables, {
      transport,
      pollIntervalMs,
      sleep,
      now,
      signal,
    });
    Object.assign(variables, result.captured);
    if (result.status === "failed" && haltedAt === null) haltedAt = index;
    report(index, result);
    if (signal?.aborted) {
      stoppedAt = index + 1;
      break;
    }
  }
  return { results, variables, haltedAt: continueOnFailure ? null : haltedAt, stoppedAt };
}

export type SeededVariable = {
  name: string;
  value: string;
  source: string;
  // Settings-dialog section that configures this seed, when one exists — the UI renders the
  // source as a link there instead of asking the user to find it by prose.
  section?: string;
};

// Owned here rather than in SettingsDialog so this pure-TS module never imports the component
// graph; SettingsDialog renders its Identifiers section under this id.
export const IDENTIFIERS_SECTION_ID = "settings-identifiers";

const COLLECTION_COUNTRY: Record<string, SettingsCountry> = { it: "IT", be: "BE", de: "DE" };

const MOCK_PLACEHOLDERS: Record<string, string> = {
  eInvoiceSystemId: "demo-e-invoice-system",
  taxpayerId: "demo-taxpayer",
};

export function seedVariables(settings: Settings | null, collectionId: string): SeededVariable[] {
  const country = COLLECTION_COUNTRY[collectionId];
  const system = country ? settings?.systems?.[country] : undefined;
  const identifierSource = country
    ? `Settings → Identifiers (${country})`
    : "Settings → Identifiers";
  const identifier = (
    name: keyof typeof MOCK_PLACEHOLDERS,
    value: string | null | undefined,
  ): SeededVariable => {
    if (value) return { name, value, source: identifierSource, section: IDENTIFIERS_SECTION_ID };
    if (settings?.mode === "mock") {
      return {
        name,
        value: MOCK_PLACEHOLDERS[name],
        source: `MOCK placeholder — the mock accepts any id; real ids live in ${identifierSource}`,
        section: IDENTIFIERS_SECTION_ID,
      };
    }
    return { name, value: "", source: identifierSource, section: IDENTIFIERS_SECTION_ID };
  };
  return [
    { name: "apiBaseUrl", value: settings?.base_url ?? "", source: "backend settings" },
    { name: "apiVersion", value: settings?.api_version ?? "", source: "backend settings" },
    identifier("eInvoiceSystemId", system?.system_id),
    identifier("taxpayerId", system?.taxpayer_id),
  ];
}

export function seedValues(seeds: SeededVariable[]): Vars {
  const values: Vars = {};
  for (const seed of seeds) {
    if (seed.value !== "") values[seed.name] = seed.value;
  }
  return values;
}

function collectReferences(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(TEMPLATE)) {
      const name = match[1].trim();
      if (!name.startsWith("$")) into.add(name);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectReferences(key, into);
      collectReferences(entry, into);
    }
  }
}

export function referencedVariables(step: CollectionStep): string[] {
  const refs = new Set<string>();
  collectReferences(step.path, refs);
  collectReferences(step.query, refs);
  collectReferences(step.body, refs);
  return [...refs];
}

export type MissingVariable = { name: string; stepIndex: number; stepName: string };

export function missingVariables(steps: CollectionStep[], seeded: Vars): MissingVariable[] {
  const available = new Set(
    Object.entries(seeded)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([name]) => name),
  );
  const missing: MissingVariable[] = [];
  const seen = new Set<string>();
  steps.forEach((step, index) => {
    if (step.runnable) {
      for (const name of referencedVariables(step)) {
        if (!available.has(name) && !seen.has(name)) {
          seen.add(name);
          missing.push({ name, stepIndex: index, stepName: step.name });
        }
      }
      for (const capture of step.captures) available.add(capture.variable);
    }
  });
  return missing;
}

export type RunnerUiState = {
  collections: CollectionSummary[] | null;
  collectionsError: string | null;
  collectionId: string | null;
  collection: Collection | null;
  collectionError: string | null;
  loading: boolean;
  results: Record<number, StepResult>;
  captured: Vars;
  running: boolean;
  runId: string | null;
  haltedAt: number | null;
  status: string | null;
  notesDismissed: boolean;
};

const COLLECTION_KEY = "runner:collection";
const NOTES_DISMISSED_KEY = "runner:notes-dismissed";

export function savedCollectionId(): string | null {
  try {
    return localStorage.getItem(COLLECTION_KEY);
  } catch {
    return null;
  }
}

export function saveCollectionId(id: string): void {
  try {
    localStorage.setItem(COLLECTION_KEY, id);
  } catch {
    // Site data disabled: the selection simply is not remembered.
  }
}

// Dismissals are per collection id and survive collection switches and reloads — the notes
// describe the published collection, not this browser session.
export function savedNotesDismissed(collectionId: string | null): boolean {
  if (!collectionId) return false;
  try {
    const raw = localStorage.getItem(NOTES_DISMISSED_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return false;
    return (parsed as Record<string, unknown>)[collectionId] === true;
  } catch {
    return false;
  }
}

export function saveNotesDismissed(collectionId: string): void {
  try {
    const raw = localStorage.getItem(NOTES_DISMISSED_KEY);
    let parsed: unknown;
    try {
      parsed = raw === null ? {} : JSON.parse(raw);
    } catch {
      parsed = {};
    }
    const map = parsed !== null && typeof parsed === "object" ? { ...parsed } : {};
    (map as Record<string, boolean>)[collectionId] = true;
    localStorage.setItem(NOTES_DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // Site data disabled: the dismissal simply is not remembered.
  }
}

export function initialRunnerUi(collectionId: string | null = null): RunnerUiState {
  return {
    collections: null,
    collectionsError: null,
    collectionId,
    collection: null,
    collectionError: null,
    loading: false,
    results: {},
    captured: {},
    running: false,
    runId: null,
    haltedAt: null,
    status: null,
    notesDismissed: savedNotesDismissed(collectionId),
  };
}

export function summarise(results: Record<number, StepResult>): string {
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const result of Object.values(results)) {
    if (result.status === "passed") counts.passed += 1;
    else if (result.status === "failed") counts.failed += 1;
    else if (result.status === "skipped") counts.skipped += 1;
  }
  return `${counts.passed} passed · ${counts.failed} failed · ${counts.skipped} skipped`;
}

export function elapsedText(ms: number): string {
  const seconds = Math.max(ms, 0) / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

export function finishLine(
  steps: CollectionStep[],
  results: Record<number, StepResult>,
  elapsedMs: number,
): string {
  const base = `Finished: ${summarise(results)} in ${elapsedText(elapsedMs)}`;
  const failed = Object.keys(results)
    .map(Number)
    .filter((index) => results[index].status === "failed")
    .sort((a, b) => a - b);
  if (failed.length === 0) return base;
  const name = steps[failed[0]]?.name ?? `step ${failed[0] + 1}`;
  return `${base} — first failure: ${name}`;
}

export function stoppedLine(
  steps: CollectionStep[],
  results: Record<number, StepResult>,
  stoppedAt: number,
): string {
  const pending = steps.filter(
    (_, index) => (results[index]?.status ?? "pending") === "pending",
  ).length;
  const tail = `${pending} step${pending === 1 ? "" : "s"} pending`;
  if (stoppedAt === 0) return `Stopped before the first step — ${tail}`;
  return `Stopped after step ${stoppedAt} — ${tail}`;
}

export function runnableSummary(steps: CollectionStep[]): string {
  const runnable = steps.filter((step) => step.runnable).length;
  if (runnable === steps.length) return `All ${steps.length} steps run against the API.`;
  return (
    `${runnable} of ${steps.length} steps run against the API; ` +
    "the rest are skipped with a reason inline."
  );
}

// A step is matched to its recorded call by run_id + step_name. Names repeat across folders
// (BE has two "Create TRANSACTION::INVOICE"), so within a run the contiguous call groups for
// one name are consumed in step order — polls of a single step form one group.
export function matchStepCalls(
  steps: CollectionStep[],
  results: Record<number, StepResult>,
  calls: ApiCall[],
): Record<number, ApiCall> {
  const groups = new Map<string, ApiCall[]>();
  let previousKey: string | null = null;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (!call.run_id || !call.step_name) continue;
    const key = `${call.run_id}\u0000${call.step_name}`;
    if (key !== previousKey) {
      const list = groups.get(key) ?? [];
      list.push(call);
      groups.set(key, list);
    }
    previousKey = key;
  }
  const taken = new Map<string, number>();
  const matches: Record<number, ApiCall> = {};
  steps.forEach((step, index) => {
    const result = results[index];
    if (!result?.runId || !result.sent) return;
    const key = `${result.runId}\u0000${step.name}`;
    const position = taken.get(key) ?? 0;
    const group = groups.get(key);
    if (group && position < group.length) {
      matches[index] = group[position];
      taken.set(key, position + 1);
    }
  });
  return matches;
}

export type StepCurl = { curl: string; reason?: undefined } | { curl: null; reason: string };

export function stepCurl(result: StepResult | undefined, match: ApiCall | undefined): StepCurl {
  if (!result || result.status === "pending") return { curl: null, reason: "not run yet" };
  if (result.status === "running") return { curl: null, reason: "still running" };
  if (!result.sent) {
    if (result.status === "skipped") {
      const why = result.skipReason ?? "nothing was sent";
      return { curl: null, reason: `step was skipped — ${why}` };
    }
    return { curl: null, reason: "nothing was sent" };
  }
  if (!match) return { curl: null, reason: "its call is no longer in the API log" };
  return { curl: match.curl };
}

export function runCurlScript(
  collectionName: string,
  steps: CollectionStep[],
  results: Record<number, StepResult>,
  matches: Record<number, ApiCall>,
): string | null {
  if (!Object.values(matches).length) return null;
  const lines = [`# ${collectionName} — collection run, steps in execution order`];
  steps.forEach((step, index) => {
    const result = results[index];
    if (!result || result.status === "pending") return;
    const entry = stepCurl(result, matches[index]);
    if (entry.curl !== null) {
      lines.push("", `# ${index + 1}. ${step.name}`, entry.curl);
    } else {
      lines.push("", `# ${index + 1}. ${step.name} — ${entry.reason}`);
    }
  });
  return lines.join("\n");
}

export function recordsCreated(steps: CollectionStep[], from: number, to: number): number {
  let count = 0;
  for (let index = Math.max(from, 0); index <= to && index < steps.length; index += 1) {
    const step = steps[index];
    if (step.runnable && step.method.toUpperCase() === "POST") count += 1;
  }
  return count;
}
