export type Persona = "seller" | "buyer";
export type CallMode = "LIVE" | "MOCK";

export type ApiCall = {
  id: string;
  ts: string;
  step: string;
  persona: Persona;
  mode: CallMode;
  method: string;
  url: string;
  request: { headers: Record<string, string>; body?: unknown };
  response?: { status: number; headers: Record<string, string>; body?: unknown };
  duration_ms: number;
  curl: string;
  error?: string;
  record_id?: string;
  step_name?: string;
  run_id?: string;
};

export type CallGroup = {
  key: string;
  calls: ApiCall[];
  latest: ApiCall;
  repeats: number;
};

const STRING_FIELDS = ["id", "ts", "step", "method", "url", "curl"] as const;
const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

export const PROMINENT_HEADERS = [
  "X-Api-Version",
  "X-Idempotency-Key",
  "X-Scope-Identifier",
  "X-Trace-Identifier",
  "X-Idempotency-Replayed",
];

export function normaliseMode(mode: unknown): CallMode {
  const upper = String(mode).toUpperCase();
  if (upper === "LIVE" || upper === "MOCK") return upper;
  throw new Error(`Unknown mode "${String(mode)}", expected live or mock`);
}

export function toApiCall(raw: unknown): ApiCall {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Call record must be a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const label = `Call record ${String(record.id ?? "<no id>")}`;
  for (const field of STRING_FIELDS) {
    if (typeof record[field] !== "string") throw new Error(`${label}: "${field}" must be a string`);
  }
  if (record.persona !== "seller" && record.persona !== "buyer") {
    throw new Error(`${label}: persona must be seller or buyer`);
  }
  if (typeof record.duration_ms !== "number") {
    throw new Error(`${label}: "duration_ms" must be a number`);
  }
  if (typeof record.request !== "object" || record.request === null) {
    throw new Error(`${label}: "request" must be an object`);
  }
  return { ...(record as Omit<ApiCall, "mode">), mode: normaliseMode(record.mode) };
}

export function parseCall(json: string): ApiCall {
  return toApiCall(JSON.parse(json));
}

// The recorder keeps `step` as its coarse bucket; a collection run labels each call with the
// step name it belongs to via X-Step. The label is what a reader filters by.
export function stepLabel(call: Pick<ApiCall, "step" | "step_name">): string {
  return call.step_name ?? call.step;
}

export function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return pathname + search;
  } catch {
    return url;
  }
}

export function headerEntries(
  headers: Record<string, string> | undefined,
  names: string[],
): [string, string][] {
  if (!headers) return [];
  const wanted = new Map(names.map((name) => [name.toLowerCase(), name]));
  const found = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    const label = wanted.get(name.toLowerCase());
    if (label) found.set(label, value);
  }
  return names.filter((name) => found.has(name)).map((name) => [name, found.get(name)!]);
}

export function otherHeaders(
  headers: Record<string, string> | undefined,
  names: string[],
): [string, string][] {
  if (!headers) return [];
  const skip = new Set(names.map((name) => name.toLowerCase()));
  return Object.entries(headers).filter(([name]) => !skip.has(name.toLowerCase()));
}

export function groupCalls(calls: ApiCall[]): CallGroup[] {
  const groups: CallGroup[] = [];
  for (const call of calls) {
    const previous = groups[groups.length - 1];
    const poll = call.method.toUpperCase() === "GET";
    if (
      poll &&
      previous &&
      previous.latest.method.toUpperCase() === "GET" &&
      previous.latest.url === call.url &&
      previous.latest.persona === call.persona &&
      stepLabel(previous.latest) === stepLabel(call)
    ) {
      previous.calls.push(call);
      previous.repeats = previous.calls.length;
      continue;
    }
    groups.push({ key: call.id, calls: [call], latest: call, repeats: 1 });
  }
  return groups;
}

export function subscribeApiLog(
  onCall: (call: ApiCall) => void,
  onState?: (connected: boolean) => void,
): () => void {
  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = INITIAL_RETRY_MS;
  let closed = false;
  // A manually rebuilt EventSource does not carry Last-Event-ID (only the browser's own
  // auto-reconnect does), so the last seen id travels as a query parameter instead — otherwise
  // every hard reconnect is a guaranteed gap.
  let lastId: string | undefined;

  const connect = () => {
    const query = lastId ? `?last_event_id=${encodeURIComponent(lastId)}` : "";
    const current = new EventSource(`/api/events${query}`);
    source = current;
    current.addEventListener("open", () => {
      delay = INITIAL_RETRY_MS;
      onState?.(true);
    });
    current.addEventListener("call", (event) => {
      const message = event as MessageEvent<string>;
      if (message.lastEventId) lastId = message.lastEventId;
      onCall(parseCall(message.data));
    });
    current.addEventListener("error", () => {
      if (closed || current.readyState !== EventSource.CLOSED) return;
      onState?.(false);
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    });
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    source?.close();
  };
}

// Timeline node colour for a call, mirroring the status pill in ApiCallCard.
export function statusMarker(call: ApiCall): string {
  if (call.error || !call.response) return "bg-fatal";
  const { status } = call.response;
  if (status >= 500) return "bg-error";
  if (status >= 400) return "bg-warning";
  if (status >= 300) return "bg-line";
  return "bg-success";
}
