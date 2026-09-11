import { toApiCall, type ApiCall, type CallMode } from "./api-log";

export type BackendMode = "live" | "mock";

export type Environment = "test" | "live";

export type SettingsCountry = "IT" | "BE" | "DE";

export type CountryConfig = { system_id: string; taxpayer_id: string };

export type Config = {
  mode: BackendMode;
  environment: Environment;
  api_version: string;
  systems: Partial<Record<SettingsCountry, CountryConfig>>;
};

export type ModeState = { mode: BackendMode; live_available: boolean };

export type CredentialSource = "stored" | "env" | "none";

// Never a key or a secret: `configured` plus a masked `fingerprint` is everything the browser
// is allowed to know about a credential it posted.
export type CredentialState = {
  configured: boolean;
  source: CredentialSource;
  fingerprint?: string | null;
};

export type SettingsSystem = { system_id?: string | null; taxpayer_id?: string | null };

export type Settings = {
  mode: BackendMode;
  environment: Environment;
  base_url: string;
  api_version: string;
  credentials: CredentialState;
  systems: Partial<Record<SettingsCountry, SettingsSystem>>;
};

export type SettingsPatch = {
  mode?: BackendMode;
  environment?: Environment;
  confirm_live?: boolean;
  api_key?: string;
  api_secret?: string;
  systems?: Partial<Record<SettingsCountry, SettingsSystem>>;
};

export type OnboardingCountry = "IT" | "BE" | "DE";

export type OnboardingEntity = {
  id: string;
  type?: string | null;
  state?: string | null;
  name?: string | null;
};

export type OnboardingTaxpayer = {
  id: string;
  state?: string | null;
  country?: string | null;
  name?: string | null;
  vat_id?: string | null;
  fiscalization_type?: string | null;
};

export type OnboardingSystem = {
  id: string;
  type?: string | null;
  state?: string | null;
  mode?: string | null;
  taxpayer_id?: string | null;
  location_id?: string | null;
  compliance_state?: string | null;
  peppol_id?: string | null;
  registrations?: { type: string }[] | null;
  blocked_by?: string | null;
};

// `organizations` and `subjects` land with the newer backend; the tree renders the counts
// alone when an older backend omits them.
export type OnboardingStatus = {
  environment: Environment;
  credentials: CredentialState;
  counts: { organizations: number; subjects: number; taxpayers: number; systems: number };
  organizations?: OnboardingEntity[] | null;
  subjects?: OnboardingEntity[] | null;
  taxpayers: OnboardingTaxpayer[];
  systems: OnboardingSystem[];
  ready: Partial<Record<OnboardingCountry, boolean>>;
  missing: string[];
  // Resource name → upstream failure for listings that could not be fetched; those resources
  // are unknown, not absent.
  errors?: Record<string, string> | null;
};

export type ProvisionStep = {
  name: string;
  method: string;
  path: string;
  status: "passed" | "failed" | "skipped";
  id?: string | null;
  error?: unknown;
};

export type ProvisionResult = {
  steps: ProvisionStep[];
  created: { taxpayer_id?: string | null; location_id?: string | null; system_id?: string | null };
  ready: boolean;
};

export type ProvisionRequest = {
  country: OnboardingCountry;
  confirm: true;
  reuse?: boolean;
  taxpayer?: Record<string, unknown>;
};

export function getOnboardingStatus(): Promise<OnboardingStatus> {
  return request("GET", "/api/onboarding/status");
}

// The IT body carries FISCONLINE credentials; they travel in this one request and are never
// kept in the store, the log or localStorage.
export function provisionCountry(body: ProvisionRequest): Promise<ProvisionResult> {
  return request("POST", "/api/onboarding/provision", body);
}

export type RecordLog = { severity?: string; message?: string; code?: string };

export type CreatedInvoice = {
  intention_id: string;
  transaction_id: string;
  state?: string | null;
  mode?: string | null;
  logs?: RecordLog[];
};

export type TransmissionRef = {
  id?: string | null;
  state?: string | null;
  mode?: string | null;
  logs?: RecordLog[];
};

export type TransmissionWait = {
  transaction_id: string;
  transmission_id?: string | null;
  finished: boolean;
  state?: string | null;
  mode?: string | null;
  // null = the transaction was not read this slice (transmission-id short-circuit).
  logs?: RecordLog[] | null;
  transmission?: TransmissionRef | null;
};

export type ArtifactKind = "compliance" | "archive";

export type ArtifactPayload = {
  record_id: string;
  kind: ArtifactKind;
  type: string;
  xml: string;
};

export type Transport = "backend" | "direct";

export type SendRequest = {
  country: string;
  operation: unknown;
  systemId?: string;
  // Reused across retries of the same attempt, so a lost response followed by a retry replays
  // the record instead of creating a second one.
  idempotencyKey?: string;
};

export type SendStart = CreatedInvoice & { transport: Transport; note?: string };

export type WaitRequest = {
  transport: Transport;
  transactionId: string;
  transmissionId?: string;
};

export type ArtifactRequest = {
  transport: Transport;
  recordId: string;
  kind: ArtifactKind;
};

type UapiRecord = {
  id: string;
  type?: string;
  state?: string;
  mode?: string;
  used_in?: { id?: string } | null;
  logs?: RecordLog[];
  compliance?: {
    artifact?: { type?: string; data?: string };
    archive?: { type?: string; data?: string };
  };
};

type RecordEnvelope = { content: UapiRecord };

export const SEND_COUNTRIES = ["IT", "BE", "DE"];

export const WAIT_SLICE_S = 5;

export const POLL_DELAY_MS: Record<Transport, number> = { backend: 200, direct: 1500 };

export const PASSTHROUGH_NOTE =
  "The backend has no system id for this country, so this ran the same choreography " +
  "through the /api/uapi passthrough with a placeholder system id. It only works against the " +
  "mock — set the system id in Settings (or provision the account) before showing anything live.";

const PLACEHOLDER_SYSTEM_ID = "demo-e-invoice-system";

const ARTIFACT_QUERY: Record<ArtifactKind, string> = {
  compliance: "compliance-artifact",
  archive: "archive-artifact",
};

const ARTIFACT_KEY: Record<ArtifactKind, "artifact" | "archive"> = {
  compliance: "artifact",
  archive: "archive",
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function messageOf(body: unknown): string | undefined {
  if (typeof body === "string") return body.trim() === "" ? undefined : body;
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const nested = messageOf(record.content);
  if (nested) return nested;
  for (const key of ["detail", "message", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    // Structured details ({code, detail, ...}) carry their human text one level down.
    if (key === "detail" && typeof value === "object" && value !== null) {
      const inner = messageOf(value);
      if (inner) return inner;
    }
  }
  return undefined;
}

// Structured error codes the backend attaches under detail.code.
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body;
  if (typeof body !== "object" || body === null) return undefined;
  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const code = (detail as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function parseBody(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function failure(method: string, path: string, response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  const body = parseBody(text);
  const fallback = `${method} ${path} failed with ${response.status} ${response.statusText}`;
  return new ApiError(response.status, messageOf(body) ?? fallback, body);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failure(method, path, response);
  // A passthrough step can legitimately return a binary body (GET /files/{id}.zip); a JSON
  // parse there would fail the step. Summarize anything that is not JSON instead.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    const blob = await response.blob();
    return { binary: true, content_type: contentType || "unknown", bytes: blob.size } as T;
  }
  return (await response.json()) as T;
}

export function getConfig(): Promise<Config> {
  return request("GET", "/api/config");
}

export function getMode(): Promise<ModeState> {
  return request("GET", "/api/mode");
}

export function setMode(mode: BackendMode): Promise<ModeState> {
  return request("PUT", "/api/mode", { mode });
}

export function getSettings(): Promise<Settings> {
  return request("GET", "/api/settings");
}

// The request body carries the secrets; the response never does. Nothing here is persisted
// browser-side — the caller hands the answer straight to the store and drops its own copy.
export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return request("PUT", "/api/settings", patch);
}

export function clearCredentials(): Promise<Settings> {
  return request("DELETE", "/api/settings/credentials");
}

export type StepCapture = { variable: string; pointer: string };
export type StepWait = { pointer: string; equals: string | null; timeoutS: number };
export type StepAssert = { pointer: string; equals: string | null };

export type CollectionStep = {
  id: string;
  name: string;
  folder: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  runnable: boolean;
  skipReason: string | null;
  captures: StepCapture[];
  waitFor: StepWait | null;
  asserts: StepAssert[];
};

export type CollectionNote = { severity: "warning" | "info"; message: string };

export type CollectionSummary = {
  id: string;
  name: string;
  version: string;
  steps: number;
  notes: number;
};

export type Collection = {
  id: string;
  name: string;
  version: string;
  steps: CollectionStep[];
  notes: CollectionNote[];
};

export function getCollections(): Promise<CollectionSummary[]> {
  return request("GET", "/api/collections");
}

export function getCollection(id: string): Promise<Collection> {
  return request("GET", `/api/collections/${encodeURIComponent(id)}`);
}

export async function listCalls(): Promise<ApiCall[]> {
  const calls = await request<unknown>("GET", "/api/calls");
  if (!Array.isArray(calls)) throw new Error("GET /api/calls did not return a JSON array");
  return calls.map(toApiCall);
}

function idempotencyKey(): string {
  return crypto.randomUUID();
}

export function passthrough<T>(
  method: string,
  path: string,
  body?: unknown,
  key?: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (key) headers["X-Idempotency-Key"] = key;
  return request<T>(method, `/api/uapi${path}`, body, headers);
}

function unconfigured(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 404 || error.status === 405) return true;
  return error.status === 409 && errorCode(error) === "SYSTEM_ID_MISSING";
}

async function createDirect(input: SendRequest): Promise<CreatedInvoice> {
  const systemId = input.systemId ?? PLACEHOLDER_SYSTEM_ID;
  const intention = await passthrough<RecordEnvelope>(
    "POST",
    "/records",
    {
      content: { type: "INTENTION", system: { id: systemId }, operation: { type: "TRANSACTION" } },
    },
    idempotencyKey(),
  );
  const transaction = await passthrough<RecordEnvelope>(
    "POST",
    "/records",
    {
      content: {
        type: "TRANSACTION",
        record: { id: intention.content.id },
        operation: input.operation,
      },
    },
    idempotencyKey(),
  );
  return {
    intention_id: intention.content.id,
    transaction_id: transaction.content.id,
    state: transaction.content.state,
    mode: transaction.content.mode,
    logs: transaction.content.logs ?? [],
  };
}

export async function sendInvoice(input: SendRequest, mode: CallMode): Promise<SendStart> {
  try {
    const created = await request<CreatedInvoice>("POST", "/api/invoices", {
      country: input.country,
      operation: input.operation,
      idempotency_key: input.idempotencyKey ?? idempotencyKey(),
    });
    return { ...created, transport: "backend" };
  } catch (error) {
    if (mode !== "MOCK" || !unconfigured(error)) throw error;
  }
  return { ...(await createDirect(input)), transport: "direct", note: PASSTHROUGH_NOTE };
}

export type CorrectionSendRequest = {
  country: string;
  correctedRecordId: string;
  // The nested invoice body — the backend wraps it into the TRANSACTION::CORRECTION envelope.
  operation: unknown;
  // The full composed CORRECTION value, posted verbatim on the passthrough fallback where no
  // backend endpoint does the wrapping.
  correctionValue: unknown;
  reason?: string;
  systemId?: string;
  idempotencyKey?: string;
};

export async function sendCorrection(
  input: CorrectionSendRequest,
  mode: CallMode,
): Promise<SendStart> {
  const path = `/api/invoices/${encodeURIComponent(input.correctedRecordId)}/correction`;
  try {
    const created = await request<CreatedInvoice>("POST", path, {
      country: input.country,
      operation: input.operation,
      reason: input.reason,
      idempotency_key: input.idempotencyKey ?? idempotencyKey(),
    });
    return { ...created, transport: "backend" };
  } catch (error) {
    if (mode !== "MOCK" || !unconfigured(error)) throw error;
  }
  const direct = await createDirect({
    country: input.country,
    operation: input.correctionValue,
    systemId: input.systemId,
  });
  return { ...direct, transport: "direct", note: PASSTHROUGH_NOTE };
}

function readRecord(recordId: string): Promise<UapiRecord> {
  const path = `/records/${encodeURIComponent(recordId)}`;
  return passthrough<RecordEnvelope>("GET", path).then((envelope) => envelope.content);
}

function refOf(record: UapiRecord): TransmissionRef {
  return {
    id: record.id,
    state: record.state,
    mode: record.mode,
    logs: record.logs ?? [],
  };
}

function untransmitted(record: UapiRecord): boolean {
  if (record.state === "REJECTED" || record.state === "FAILED") return true;
  return (record.logs ?? []).some((log) => log.severity === "ERROR");
}

async function waitDirect(input: WaitRequest): Promise<TransmissionWait> {
  if (input.transmissionId) {
    const transmission = await readRecord(input.transmissionId);
    return {
      transaction_id: input.transactionId,
      transmission_id: input.transmissionId,
      finished: transmission.mode === "FINISHED",
      transmission: refOf(transmission),
    };
  }
  const invoice = await readRecord(input.transactionId);
  const transmissionId = invoice.used_in?.id;
  const seen = {
    transaction_id: input.transactionId,
    state: invoice.state,
    mode: invoice.mode,
    logs: invoice.logs ?? [],
  };
  if (!transmissionId) return { ...seen, finished: untransmitted(invoice) };
  const transmission = await readRecord(transmissionId);
  return {
    ...seen,
    transmission_id: transmissionId,
    finished: transmission.mode === "FINISHED",
    transmission: refOf(transmission),
  };
}

export function waitForTransmission(input: WaitRequest): Promise<TransmissionWait> {
  if (input.transport === "direct") return waitDirect(input);
  const query = new URLSearchParams({ timeout: String(WAIT_SLICE_S) });
  // Once the transmission id is known the backend skips the transaction read — half the poll
  // traffic on a send that keeps polling for minutes.
  if (input.transmissionId) query.set("transmission_id", input.transmissionId);
  const path = `/api/invoices/${encodeURIComponent(input.transactionId)}/wait?${query}`;
  return request<TransmissionWait>("GET", path);
}

function decodeBase64(data: string): string {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function fetchArtifact(input: ArtifactRequest): Promise<ArtifactPayload> {
  const { recordId, kind } = input;
  if (input.transport === "backend") {
    const query = new URLSearchParams({ kind });
    const path = `/api/records/${encodeURIComponent(recordId)}/artifact?${query}`;
    return request<ArtifactPayload>("GET", path);
  }
  const path = `/records/${encodeURIComponent(recordId)}?${ARTIFACT_QUERY[kind]}`;
  const envelope = await passthrough<RecordEnvelope>("GET", path);
  const artifact = envelope.content.compliance?.[ARTIFACT_KEY[kind]];
  if (!artifact?.data) {
    throw new ApiError(
      409,
      `record ${recordId} carries no ${kind} artifact: content.compliance.` +
        `${ARTIFACT_KEY[kind]}.data is absent from GET /records/${recordId}?${ARTIFACT_QUERY[kind]}`,
    );
  }
  return {
    record_id: recordId,
    kind,
    type: artifact.type ?? "application/xml",
    xml: decodeBase64(artifact.data),
  };
}

export async function fetchRecordFiles(recordId: string): Promise<Blob> {
  const path = `/api/records/${encodeURIComponent(recordId)}/files.zip`;
  const response = await fetch(path);
  if (response.ok) return await response.blob();
  const error = await failure("GET", path, response);
  const replay = await fetch(`/api/uapi/files/${encodeURIComponent(recordId)}.zip`);
  if (!replay.ok) throw error;
  return await replay.blob();
}
