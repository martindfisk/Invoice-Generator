import type { ApiCall, Persona } from "./api-log";
import { FORMATS, getFormat } from "./formats";
import { getField, setField, type FieldId, type FormatId, type Invoice } from "./model";
import { preset, type PresetId } from "./presets";
import type {
  ArtifactKind,
  CreatedInvoice,
  RecordLog,
  TransmissionWait,
  Transport,
} from "./uapi-client";
import {
  applyOperation,
  buildOperation,
  operationIsLossy,
  stringifyOperation,
  type Operation,
} from "./uapi-json";
import type { StageResult } from "./validation";

export type Step = "setup" | "compose" | "validate" | "send" | "receive";

// "json" is the fiskaly operation the API actually accepts; "xml" is this browser's prediction
// of the document fiskaly would generate from it. Split pairs the fields with the JSON.
export type ViewMode = "human" | "json" | "xml" | "split";

export type SelectionSource = "human" | "xml" | "json" | "finding";

export type Selection = {
  field?: FieldId;
  path?: string;
  pointer?: string;
  source: SelectionSource;
} | null;

export type EditSource = "human" | "xml" | "json";

export type EditState = {
  source: EditSource;
  xml: string | null;
  error: string | null;
  lossy: boolean;
  json: string | null;
  jsonError: string | null;
  jsonLossy: boolean;
  notice: string | null;
};

export type ValidationState = {
  key: string | null;
  running: boolean;
  stages: StageResult[];
};

export type GroupViewState = {
  open: Record<string, boolean>;
  showUncarried: boolean;
};

export type SendStage = "intention" | "transaction" | "transmission" | "artifacts";

export type SendNodeStatus = "pending" | "active" | "done" | "failed" | "skipped";

export type SendNode = {
  stage: SendStage;
  label: string;
  call: string;
  status: SendNodeStatus;
  recordId?: string;
  state?: string;
  mode?: string;
  note?: string;
  startedAt?: number;
  endedAt?: number;
  logs: RecordLog[];
};

export type SendOutcome =
  "transmitted" | "rejected" | "failed" | "not-transmitted" | "timeout" | "error";

export type SendPhase = "idle" | "creating" | "polling" | "artifacts" | "settled";

export type SendArtifact = { recordId: string; type: string; xml: string };

export type SendState = {
  phase: SendPhase;
  outcome: SendOutcome | null;
  transport: Transport | null;
  note: string | null;
  error: string | null;
  nodes: SendNode[];
  intentionId: string | null;
  transactionId: string | null;
  transmissionId: string | null;
  polls: number;
  startedAt: number | null;
  endedAt: number | null;
  localXml: string | null;
  compliance: SendArtifact | null;
  complianceError: string | null;
  archive: SendArtifact | null;
  archiveError: string | null;
};

export type WorkflowState = {
  step: Step;
  presetId: PresetId | null;
  invoice: Invoice | null;
  formatId: FormatId;
  persona: Persona;
  selection: Selection;
  view: ViewMode;
  groups: GroupViewState;
  edit: EditState;
  validation: ValidationState;
  send: SendState;
};

export type WorkflowAction =
  | { type: "choosePreset"; presetId: PresetId }
  | { type: "goToStep"; step: Step }
  | { type: "setFormat"; formatId: FormatId }
  | { type: "select"; selection: Selection }
  | { type: "setView"; view: ViewMode }
  | { type: "setGroupOpen"; key: string; open: boolean }
  | { type: "showUncarried"; show: boolean }
  | { type: "setPersona"; persona: Persona }
  | { type: "editField"; field: FieldId; value: string }
  | { type: "editXml"; text: string }
  | { type: "editJson"; text: string }
  | { type: "dismissEditNotice" }
  | { type: "validationStarted"; key: string; stages: StageResult[] }
  | { type: "validationStage"; key: string; stage: StageResult }
  | { type: "validationFinished"; key: string; stages: StageResult[] }
  | SendAction;

export type SendAction =
  | { type: "sendReset" }
  | { type: "sendStarted"; at: number; localXml: string }
  | {
      type: "sendCreated";
      at: number;
      created: CreatedInvoice;
      transport: Transport;
      note?: string;
    }
  | { type: "sendPolled"; at: number; wait: TransmissionWait }
  | { type: "sendResumed"; at: number }
  | { type: "sendStopped"; at: number }
  | { type: "sendFailed"; at: number; error: string }
  | {
      type: "sendArtifact";
      at: number;
      kind: ArtifactKind;
      artifact?: SendArtifact;
      error?: string;
    };

export const LOSS_NOTICE =
  "The XML you edited by hand held content this format's mapping table cannot read back, " +
  "so regenerating it from the invoice dropped that part of your edit. " +
  "Re-apply it in the XML pane.";

export const JSON_LOSS_NOTICE =
  "The fiskaly JSON you edited by hand held content the invoice model cannot read back, " +
  "so regenerating the operation from the invoice dropped that part of your edit. " +
  "Re-apply it in the JSON pane.";

export const STEPS: { id: Step; label: string; blurb: string }[] = [
  { id: "setup", label: "Setup", blurb: "Pick the scenario to work from" },
  {
    id: "compose",
    label: "Compose",
    blurb: "Author the fiskaly JSON, read it as fields and as predicted XML",
  },
  { id: "validate", label: "Validate", blurb: "Run the local validation pipeline" },
  { id: "send", label: "Send", blurb: "Hand the invoice to fiskaly" },
  { id: "receive", label: "Receive", blurb: "Follow what arrives on the buyer side" },
];

export const WORKFLOW_KEY = "workflow";

const STEP_IDS = STEPS.map((step) => step.id);

export const VIEWS: ViewMode[] = ["human", "json", "xml", "split"];

export const VIEW_VERSION = 2;

// Before the UAPI JSON became the primary artifact, "xml" meant "show me the artifact". It now
// means "show me the prediction", so a value written by that UI is migrated to the JSON pane.
const LEGACY_VIEWS: Record<string, ViewMode> = { xml: "json", human: "human", split: "split" };

type Persisted = {
  step: Step;
  presetId: PresetId | null;
  formatId: FormatId;
  persona: Persona;
  view: ViewMode;
  viewVersion: number;
};

function firstFormatId(): FormatId {
  const [id] = Object.keys(FORMATS) as FormatId[];
  if (!id) throw new Error("workflow: formats.ts registers no format");
  return id;
}

export function knownFormat(id: unknown): id is FormatId {
  return typeof id === "string" && id in FORMATS;
}

export function defaultView(): ViewMode {
  return "json";
}

export function knownView(id: unknown): id is ViewMode {
  return typeof id === "string" && VIEWS.includes(id as ViewMode);
}

export function migrateView(saved: { view?: unknown; viewVersion?: unknown }): ViewMode {
  if (saved.viewVersion === VIEW_VERSION) {
    return knownView(saved.view) ? saved.view : defaultView();
  }
  return typeof saved.view === "string"
    ? (LEGACY_VIEWS[saved.view] ?? defaultView())
    : defaultView();
}

export function freshEdit(): EditState {
  return {
    source: "human",
    xml: null,
    error: null,
    lossy: false,
    json: null,
    jsonError: null,
    jsonLossy: false,
    notice: null,
  };
}

export function freshValidation(): ValidationState {
  return { key: null, running: false, stages: [] };
}

export function freshGroups(): GroupViewState {
  return { open: {}, showUncarried: true };
}

const SEND_NODES: { stage: SendStage; label: string; call: string }[] = [
  { stage: "intention", label: "Intention", call: "POST /records · INTENTION::TRANSACTION" },
  { stage: "transaction", label: "Transaction", call: "POST /records · TRANSACTION::INVOICE" },
  {
    stage: "transmission",
    label: "Transmission",
    call: "GET /records/{id} · E_INVOICE::TRANSMISSION",
  },
  { stage: "artifacts", label: "Artifacts", call: "GET /records/{id}?compliance-artifact" },
];

export const NO_TRANSMISSION_NOTE =
  "fiskaly created no transmission record — nothing was handed to the network.";

export function freshSend(): SendState {
  return {
    phase: "idle",
    outcome: null,
    transport: null,
    note: null,
    error: null,
    nodes: SEND_NODES.map((node): SendNode => ({ ...node, status: "pending", logs: [] })),
    intentionId: null,
    transactionId: null,
    transmissionId: null,
    polls: 0,
    startedAt: null,
    endedAt: null,
    localXml: null,
    compliance: null,
    complianceError: null,
    archive: null,
    archiveError: null,
  };
}

function withNode(
  nodes: SendNode[],
  stage: SendStage,
  changes: Partial<SendNode>,
  at?: number,
): SendNode[] {
  return nodes.map((node) => {
    if (node.stage !== stage) return node;
    const next = { ...node, ...changes };
    if (at !== undefined && next.startedAt === undefined) next.startedAt = at;
    if (at !== undefined && next.status !== "active" && next.endedAt === undefined) {
      next.endedAt = at;
    }
    return next;
  });
}

function defined<T>(value: T | null | undefined, fallback: T | undefined): T | undefined {
  return value === null || value === undefined ? fallback : value;
}

export function sendOutcome(wait: TransmissionWait): SendOutcome {
  if (wait.transmission_id) {
    const state = wait.transmission?.state;
    if (state === "COMPLETED") return "transmitted";
    if (state === "REJECTED") return "rejected";
    return "failed";
  }
  if (wait.state === "REJECTED") return "rejected";
  if (wait.state === "FAILED") return "failed";
  return "not-transmitted";
}

function polled(state: SendState, action: { at: number; wait: TransmissionWait }): SendState {
  const { at, wait } = action;
  const transaction = state.nodes.find((node) => node.stage === "transaction");
  let nodes = withNode(
    state.nodes,
    "transaction",
    {
      status: "active",
      state: defined(wait.state, transaction?.state),
      mode: defined(wait.mode, transaction?.mode),
      logs: wait.logs ?? transaction?.logs ?? [],
    },
    at,
  );
  const transmissionId = wait.transmission_id ?? state.transmissionId ?? null;
  if (transmissionId) {
    const previous = state.nodes.find((node) => node.stage === "transmission");
    nodes = withNode(
      nodes,
      "transmission",
      {
        status: "active",
        recordId: transmissionId,
        state: defined(wait.transmission?.state, previous?.state),
        mode: defined(wait.transmission?.mode, previous?.mode),
        logs: wait.transmission?.logs ?? previous?.logs ?? [],
      },
      at,
    );
  }
  const polls = state.polls + 1;
  if (!wait.finished) {
    return { ...state, nodes, transmissionId, polls, phase: "polling", outcome: null };
  }

  const outcome = sendOutcome(wait);
  if (!transmissionId) {
    nodes = withNode(
      nodes,
      "transaction",
      { status: outcome === "not-transmitted" ? "done" : "failed" },
      at,
    );
    nodes = withNode(nodes, "transmission", { status: "skipped", note: NO_TRANSMISSION_NOTE }, at);
    nodes = withNode(
      nodes,
      "artifacts",
      { status: "skipped", note: "No record to read them from." },
      at,
    );
    return { ...state, nodes, polls, transmissionId, outcome, phase: "settled", endedAt: at };
  }
  nodes = withNode(nodes, "transaction", { status: "done" }, at);
  nodes = withNode(
    nodes,
    "transmission",
    { status: outcome === "transmitted" ? "done" : "failed" },
    at,
  );
  nodes = withNode(nodes, "artifacts", { status: "active", recordId: transmissionId }, at);
  return { ...state, nodes, polls, transmissionId, outcome, phase: "artifacts" };
}

function artifactArrived(
  state: SendState,
  action: { at: number; kind: ArtifactKind; artifact?: SendArtifact; error?: string },
): SendState {
  const { at, kind, artifact, error } = action;
  const next: SendState =
    kind === "compliance"
      ? { ...state, compliance: artifact ?? null, complianceError: error ?? null }
      : { ...state, archive: artifact ?? null, archiveError: error ?? null };
  const complianceDone = next.compliance !== null || next.complianceError !== null;
  const archiveDone = next.archive !== null || next.archiveError !== null;
  if (kind === "compliance") {
    next.nodes = withNode(
      next.nodes,
      "artifacts",
      artifact
        ? { status: "done", note: undefined }
        : { status: "failed", note: error ?? "The compliance artifact could not be read." },
      at,
    );
  }
  if (complianceDone && archiveDone) {
    next.phase = "settled";
    next.endedAt = at;
  }
  return next;
}

export function sendReducer(state: SendState, action: SendAction): SendState {
  switch (action.type) {
    case "sendReset":
      return freshSend();
    case "sendStarted": {
      const fresh = freshSend();
      return {
        ...fresh,
        phase: "creating",
        startedAt: action.at,
        localXml: action.localXml,
        nodes: withNode(fresh.nodes, "intention", { status: "active" }, action.at),
      };
    }
    case "sendCreated": {
      const { created, at } = action;
      let nodes = withNode(
        state.nodes,
        "intention",
        { status: "done", recordId: created.intention_id },
        at,
      );
      nodes = withNode(
        nodes,
        "transaction",
        {
          status: "active",
          recordId: created.transaction_id,
          state: created.state ?? undefined,
          mode: created.mode ?? undefined,
          logs: created.logs ?? [],
        },
        at,
      );
      nodes = withNode(nodes, "transmission", { status: "active" }, at);
      return {
        ...state,
        nodes,
        phase: "polling",
        transport: action.transport,
        note: action.note ?? null,
        intentionId: created.intention_id,
        transactionId: created.transaction_id,
      };
    }
    case "sendPolled":
      return polled(state, action);
    case "sendResumed":
      return state.outcome === "timeout"
        ? { ...state, phase: "polling", outcome: null, endedAt: null }
        : state;
    case "sendStopped":
      return { ...state, phase: "settled", outcome: "timeout", endedAt: action.at };
    case "sendFailed": {
      const active = state.nodes.find((node) => node.status === "active");
      const nodes = active
        ? withNode(state.nodes, active.stage, { status: "failed", note: action.error }, action.at)
        : state.nodes;
      return {
        ...state,
        nodes,
        phase: "settled",
        outcome: "error",
        error: action.error,
        endedAt: action.at,
      };
    }
    case "sendArtifact":
      return artifactArrived(state, action);
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function droppedNotice(edit: EditState): string | null {
  if (edit.lossy) return LOSS_NOTICE;
  if (edit.jsonLossy) return JSON_LOSS_NOTICE;
  return edit.notice;
}

function regenerate(edit: EditState): EditState {
  return { ...freshEdit(), notice: droppedNotice(edit) };
}

export function freshWorkflow(): WorkflowState {
  return {
    step: "setup",
    presetId: null,
    invoice: null,
    formatId: firstFormatId(),
    persona: "seller",
    selection: null,
    view: defaultView(),
    groups: freshGroups(),
    edit: freshEdit(),
    validation: freshValidation(),
    send: freshSend(),
  };
}

export function stepLock(state: WorkflowState, step: Step): string | undefined {
  if (step === "setup" || state.presetId !== null) return undefined;
  return "Pick a preset in Setup first — every later step works on that invoice";
}

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case "choosePreset": {
      const invoice = preset(action.presetId);
      return {
        ...state,
        presetId: action.presetId,
        invoice,
        formatId: invoice.format,
        step: "compose",
        selection: null,
        groups: { ...state.groups, open: {} },
        edit: freshEdit(),
        validation: freshValidation(),
        send: freshSend(),
      };
    }
    case "goToStep":
      if (stepLock(state, action.step)) return state;
      return state.step === action.step ? state : { ...state, step: action.step };
    case "setFormat": {
      if (!knownFormat(action.formatId) || action.formatId === state.formatId) return state;
      const previous = state.selection;
      return {
        ...state,
        formatId: action.formatId,
        selection: previous?.field ? { field: previous.field, source: previous.source } : null,
        edit: regenerate(state.edit),
        validation: freshValidation(),
      };
    }
    case "select":
      return { ...state, selection: action.selection };
    case "setView":
      return state.view === action.view ? state : { ...state, view: action.view };
    case "setGroupOpen": {
      if (state.groups.open[action.key] === action.open) return state;
      const open = { ...state.groups.open, [action.key]: action.open };
      return { ...state, groups: { ...state.groups, open } };
    }
    case "showUncarried":
      return state.groups.showUncarried === action.show
        ? state
        : { ...state, groups: { ...state.groups, showUncarried: action.show } };
    case "setPersona":
      return state.persona === action.persona ? state : { ...state, persona: action.persona };
    case "editField": {
      if (!state.invoice) return state;
      if (getField(state.invoice, action.field) === action.value) return state;
      let invoice: Invoice;
      try {
        invoice = setField(state.invoice, action.field, action.value);
      } catch {
        return state;
      }
      return {
        ...state,
        invoice,
        edit: regenerate(state.edit),
        validation: freshValidation(),
      };
    }
    case "editXml": {
      if (!state.invoice || state.edit.xml === action.text) return state;
      const plugin = getFormat(state.formatId);
      let parsed: Invoice;
      try {
        parsed = plugin.parse(action.text);
      } catch (error) {
        return {
          ...state,
          edit: { ...state.edit, source: "xml", xml: action.text, error: reason(error) },
          validation: freshValidation(),
        };
      }
      const invoice: Invoice = { ...parsed, format: state.invoice.format };
      let lossy: boolean;
      try {
        lossy = plugin.write(invoice) !== action.text;
      } catch {
        lossy = true;
      }
      return {
        ...state,
        invoice,
        edit: {
          source: "xml",
          xml: action.text,
          error: null,
          lossy,
          json: null,
          jsonError: null,
          jsonLossy: false,
          notice: state.edit.jsonLossy ? JSON_LOSS_NOTICE : state.edit.notice,
        },
        validation: freshValidation(),
      };
    }
    case "editJson": {
      if (!state.invoice || state.edit.json === action.text) return state;
      let parsed: unknown;
      try {
        parsed = JSON.parse(action.text);
      } catch (error) {
        return {
          ...state,
          edit: { ...state.edit, source: "json", json: action.text, jsonError: reason(error) },
          validation: freshValidation(),
        };
      }
      const prefix = buildOperation(state.invoice, state.send.transactionId).prefix;
      let invoice: Invoice;
      try {
        invoice = applyOperation(parsed, state.invoice);
      } catch (error) {
        return {
          ...state,
          edit: { ...state.edit, source: "json", json: action.text, jsonError: reason(error) },
          validation: freshValidation(),
        };
      }
      return {
        ...state,
        invoice,
        edit: {
          source: "json",
          xml: null,
          error: null,
          lossy: false,
          json: action.text,
          jsonError: null,
          jsonLossy: operationIsLossy(invoice, parsed, prefix),
          notice: state.edit.lossy ? LOSS_NOTICE : state.edit.notice,
        },
        validation: freshValidation(),
      };
    }
    case "dismissEditNotice":
      return state.edit.notice === null
        ? state
        : { ...state, edit: { ...state.edit, notice: null } };
    case "validationStarted":
      return { ...state, validation: { key: action.key, running: true, stages: action.stages } };
    case "validationStage": {
      if (state.validation.key !== action.key) return state;
      const stages = state.validation.stages.map((stage) =>
        stage.id === action.stage.id ? action.stage : stage,
      );
      return { ...state, validation: { ...state.validation, stages } };
    }
    case "validationFinished":
      if (state.validation.key !== action.key) return state;
      return { ...state, validation: { key: action.key, running: false, stages: action.stages } };
    case "sendReset":
    case "sendStarted":
    case "sendCreated":
    case "sendPolled":
    case "sendResumed":
    case "sendStopped":
    case "sendFailed":
    case "sendArtifact": {
      const send = sendReducer(state.send, action);
      return send === state.send ? state : { ...state, send };
    }
  }
}

const CALL_STEPS: Record<string, Step> = {
  token: "setup",
  setup: "setup",
  system: "setup",
  taxpayer: "setup",
  validate: "validate",
  intention: "send",
  transaction: "send",
  poll: "send",
  artifact: "send",
  inbox: "receive",
};

export function stepForCall(call: Pick<ApiCall, "step" | "persona">): Step | undefined {
  if (call.persona === "buyer" && (call.step === "inbox" || call.step === "artifact")) {
    return "receive";
  }
  return CALL_STEPS[call.step];
}

export function persistWorkflow(state: WorkflowState): void {
  const persisted: Persisted = {
    step: state.step,
    presetId: state.presetId,
    formatId: state.formatId,
    persona: state.persona,
    view: state.view,
    viewVersion: VIEW_VERSION,
  };
  localStorage.setItem(WORKFLOW_KEY, JSON.stringify(persisted));
}

function readPersisted(): Partial<Persisted> | undefined {
  const raw = localStorage.getItem(WORKFLOW_KEY);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Partial<Persisted>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function initialWorkflow(): WorkflowState {
  const fresh = freshWorkflow();
  const saved = readPersisted();
  if (!saved) return fresh;

  const shell: WorkflowState = {
    ...fresh,
    persona: saved.persona === "buyer" ? "buyer" : "seller",
    view: migrateView(saved),
  };
  if (!saved.presetId) return shell;

  let invoice: Invoice;
  try {
    invoice = preset(saved.presetId);
  } catch {
    return shell;
  }
  return {
    ...shell,
    presetId: saved.presetId,
    invoice,
    formatId: knownFormat(saved.formatId) ? saved.formatId : invoice.format,
    step: STEP_IDS.includes(saved.step as Step) ? (saved.step as Step) : "compose",
  };
}

export type OperationView = Operation & { text: string };

// The one place Compose and Send agree on what gets posted: the derived operation unless the
// user hand-edited the JSON, in which case exactly what the JSON pane holds.
export function composeOperation(state: WorkflowState): OperationView {
  if (!state.invoice) {
    return {
      value: null,
      error: "No invoice loaded.",
      correctionPending: false,
      label: "TRANSACTION::INVOICE",
      prefix: "",
      text: "",
    };
  }
  const derived = buildOperation(state.invoice, state.send.transactionId);
  const edited = state.edit.json;
  if (edited === null) {
    return { ...derived, text: derived.error ? "" : stringifyOperation(derived.value) };
  }
  if (state.edit.jsonError !== null) {
    return { ...derived, value: null, error: state.edit.jsonError, text: edited };
  }
  try {
    return { ...derived, value: JSON.parse(edited), error: null, text: edited };
  } catch (error) {
    return { ...derived, value: null, error: reason(error), text: edited };
  }
}
