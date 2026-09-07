import type { ApiCall, CallMode, Persona } from "./api-log";
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

export type Step = "setup" | "mapper" | "validate" | "send";

// "json" is the fiskaly operation the API actually accepts; "xml" is this browser's prediction
// of the document fiskaly would generate from it. Split pairs the fields with the JSON.
// The Mapper shows the fiskaly JSON always; the fields and the predicted XML flank it and can
// each be hidden, so what is on screen is a set of panes rather than one of four modes.
export type PaneId = "human" | "xml";
export type Panes = Record<PaneId, boolean>;

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
  "transmitted" | "rejected" | "failed" | "not-transmitted" | "timeout" | "stopped" | "error";

export type SendPhase = "idle" | "creating" | "polling" | "artifacts" | "settled";

export type SendArtifact = { recordId: string; type: string; xml: string };

export type SendState = {
  phase: SendPhase;
  outcome: SendOutcome | null;
  transport: Transport | null;
  // What was posted: "TRANSACTION::INVOICE" or "TRANSACTION::CORRECTION". Only a transmitted
  // invoice becomes the correction target a later credit note may reference.
  operationLabel: string | null;
  // MOCK or LIVE at the moment of the send — the correction target inherits it, so a record id
  // minted by the mock can never be referenced from a LIVE correction.
  callMode: CallMode | null;
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
  panes: Panes;
  groups: GroupViewState;
  edit: EditState;
  validation: ValidationState;
  send: SendState;
  // The last invoice this browser transmitted — what a credit note's TRANSACTION::CORRECTION
  // references. Survives preset changes (the credit-note preset differs from the invoice it
  // corrects) and carries enough context to refuse a cross-country or cross-mode reference.
  correctionTarget: CorrectionTarget | null;
};

export type CorrectionTarget = {
  id: string;
  presetId: PresetId | null;
  country: string;
  mode: CallMode;
  at: number;
};

export type WorkflowAction =
  | { type: "choosePreset"; presetId: PresetId; fresh?: boolean }
  | { type: "goToStep"; step: Step }
  | { type: "setFormat"; formatId: FormatId }
  | { type: "select"; selection: Selection }
  | { type: "setPane"; pane: PaneId; show: boolean }
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
  | { type: "validationReset" }
  | SendAction;

export type SendAction =
  | { type: "sendReset" }
  | { type: "sendStarted"; at: number; localXml: string; label?: string; callMode?: CallMode }
  | {
      type: "sendCreated";
      at: number;
      created: CreatedInvoice;
      transport: Transport;
      note?: string;
    }
  | { type: "sendPolled"; at: number; wait: TransmissionWait }
  | { type: "sendResumed"; at: number }
  | { type: "sendStopped"; at: number; manual?: boolean }
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
    id: "mapper",
    label: "Mapper",
    blurb: "Map the invoice across fields, fiskaly JSON and predicted XML",
  },
  { id: "validate", label: "Validate", blurb: "Run the local validation pipeline" },
  { id: "send", label: "Send", blurb: "Hand the invoice to fiskaly" },
];

export const WORKFLOW_KEY = "workflow";

const STEP_IDS = STEPS.map((step) => step.id);

// "compose" was renamed to "mapper" on 2026-09-02; "receive" was removed on 2026-09-03. A saved
// workflow still on either lands on the nearest live step rather than being bounced to the start.
const LEGACY_STEPS: Record<string, Step> = { compose: "mapper", receive: "send" };

export function migrateStep(saved: unknown): Step {
  if (typeof saved !== "string") return "mapper";
  if (STEP_IDS.includes(saved as Step)) return saved as Step;
  return LEGACY_STEPS[saved] ?? "mapper";
}

export const PANE_IDS: PaneId[] = ["human", "xml"];

// v4 (2026-09-03) added invoice, edit, send and correctionTarget to the persisted state, so a
// reload keeps the user's work and the send's record ids instead of only the cosmetics.
export const VIEW_VERSION = 4;

// Until 2026-09-02 this was a single mode: "human", "json", "xml" or "split". Each maps onto the
// pane set that showed the same thing, so a saved layout survives the change.
const LEGACY_PANES: Record<string, Panes> = {
  human: { human: true, xml: false },
  json: { human: false, xml: false },
  xml: { human: false, xml: true },
  split: { human: true, xml: false },
};

type Persisted = {
  step: Step;
  presetId: PresetId | null;
  formatId: FormatId;
  persona: Persona;
  panes: Panes;
  viewVersion: number;
  invoice: Invoice | null;
  edit: EditState;
  send: SendState | null;
  correctionTarget: CorrectionTarget | null;
};

function firstFormatId(): FormatId {
  const [id] = Object.keys(FORMATS) as FormatId[];
  if (!id) throw new Error("workflow: formats.ts registers no format");
  return id;
}

export function knownFormat(id: unknown): id is FormatId {
  return typeof id === "string" && id in FORMATS;
}

export function defaultPanes(): Panes {
  // All three at once: seeing one structure against the others is the point of the step.
  return { human: true, xml: true };
}

function readPanes(saved: unknown): Panes | null {
  if (saved === null || typeof saved !== "object") return null;
  const value = saved as Record<string, unknown>;
  if (typeof value.human !== "boolean" || typeof value.xml !== "boolean") return null;
  return { human: value.human, xml: value.xml };
}

export function migratePanes(saved: {
  panes?: unknown;
  view?: unknown;
  viewVersion?: unknown;
}): Panes {
  // The pane shape has been stable since v3; v4 only added fields elsewhere.
  if (typeof saved.viewVersion === "number" && saved.viewVersion >= 3) {
    return readPanes(saved.panes) ?? defaultPanes();
  }
  if (typeof saved.view === "string") return LEGACY_PANES[saved.view] ?? defaultPanes();
  return defaultPanes();
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
    operationLabel: null,
    callMode: null,
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
      // defined(), not ??: a transmission-id slice reports logs as null (not read), and an
      // empty array from it must not wipe the entries already on the node.
      logs: defined(wait.logs, transaction?.logs) ?? [],
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
        operationLabel: action.label ?? null,
        callMode: action.callMode ?? null,
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
      // note: null — a restore/stop explanation must not keep sitting above a live poll.
      return state.outcome === "timeout" || state.outcome === "stopped"
        ? { ...state, phase: "polling", outcome: null, endedAt: null, note: null }
        : state;
    case "sendStopped":
      return {
        ...state,
        phase: "settled",
        outcome: action.manual ? "stopped" : "timeout",
        endedAt: action.at,
      };
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
    panes: defaultPanes(),
    groups: freshGroups(),
    edit: freshEdit(),
    validation: freshValidation(),
    send: freshSend(),
    correctionTarget: null,
  };
}

export function stepLock(state: WorkflowState, step: Step): string | undefined {
  if (step === "setup" || state.presetId !== null) return undefined;
  return "Pick a preset in Setup first — every later step works on that invoice";
}

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case "choosePreset": {
      // Re-clicking the already-active preset must not silently wipe edits, validation and send
      // state — the card looks selected, so the click reads as "continue", not "start over".
      // "Reset preset" in Setup passes fresh: true for the deliberate start-over.
      if (!action.fresh && action.presetId === state.presetId && state.invoice) {
        return state.step === "mapper" ? state : { ...state, step: "mapper" };
      }
      const invoice = preset(action.presetId);
      return {
        ...state,
        presetId: action.presetId,
        invoice,
        formatId: invoice.format,
        step: "mapper",
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
    case "setPane":
      return state.panes[action.pane] === action.show
        ? state
        : { ...state, panes: { ...state.panes, [action.pane]: action.show } };
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
      const prefix = buildOperation(state.invoice, state.correctionTarget?.id ?? null).prefix;
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
    case "validationReset":
      return { ...state, validation: freshValidation() };
    case "sendReset":
    case "sendStarted":
    case "sendCreated":
    case "sendPolled":
    case "sendResumed":
    case "sendStopped":
    case "sendFailed":
    case "sendArtifact": {
      const send = sendReducer(state.send, action);
      if (send === state.send) return state;
      // Only a transmitted invoice becomes the target a credit note corrects — a transmitted
      // correction must never become its own target, or "Send again" would reference itself.
      const correctionTarget =
        send.outcome === "transmitted" &&
        send.operationLabel === "TRANSACTION::INVOICE" &&
        send.transactionId !== null
          ? {
              id: send.transactionId,
              presetId: state.presetId,
              country: state.invoice?.seller.address.country ?? "",
              mode: send.callMode ?? "MOCK",
              at: Date.now(),
            }
          : state.correctionTarget;
      return { ...state, send, correctionTarget };
    }
  }
}

// Exactly the step buckets the backend emits (see CallRecord in ARCHITECTURE.md); a step with no
// workflow home (list, onboarding, passthrough) renders without a jump target. The send bucket
// covers the whole lifecycle including the token minted for it, corrections and the files ZIP.
const CALL_STEPS: Record<string, Step> = {
  token: "send",
  intention: "send",
  transaction: "send",
  correction: "send",
  poll: "send",
  artifact: "send",
  files: "send",
};

export function stepForCall(call: Pick<ApiCall, "step">): Step | undefined {
  return CALL_STEPS[call.step];
}

export function persistWorkflow(state: WorkflowState): void {
  const persisted: Persisted = {
    step: state.step,
    presetId: state.presetId,
    formatId: state.formatId,
    persona: state.persona,
    panes: state.panes,
    viewVersion: VIEW_VERSION,
    invoice: state.invoice,
    edit: state.edit,
    // Artifact XML is stripped: it can be re-fetched from the persisted record ids, and a large
    // artifact would otherwise be the one thing that pushes the blob over the storage quota —
    // silently losing everything else with it.
    send:
      state.send.phase === "idle"
        ? null
        : { ...state.send, localXml: null, compliance: null, archive: null },
    correctionTarget: state.correctionTarget,
  };
  try {
    localStorage.setItem(WORKFLOW_KEY, JSON.stringify(persisted));
  } catch {
    // Site data disabled or quota exceeded: the workflow is not remembered across reloads.
  }
}

function readPersisted(): Partial<Persisted> | undefined {
  try {
    const raw = localStorage.getItem(WORKFLOW_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Partial<Persisted>)
      : undefined;
  } catch {
    return undefined;
  }
}

export const RESTORED_SEND_NOTE =
  "Restored from this browser after a reload while polling was still under way — the record ids " +
  "are kept, and Keep polling resumes watching the same record.";

function restoreEdit(saved: unknown): EditState {
  if (saved === null || typeof saved !== "object") return freshEdit();
  const value = saved as Partial<EditState>;
  if (value.xml === undefined || value.json === undefined || typeof value.source !== "string") {
    return freshEdit();
  }
  return { ...freshEdit(), ...value };
}

const TERMINAL_OUTCOMES: readonly SendOutcome[] = [
  "transmitted",
  "rejected",
  "failed",
  "not-transmitted",
];

function restoreSend(saved: unknown): SendState {
  if (saved === null || typeof saved !== "object") return freshSend();
  const value = saved as Partial<SendState>;
  if (typeof value.phase !== "string" || !Array.isArray(value.nodes)) return freshSend();
  const send: SendState = { ...freshSend(), ...value };
  // A reload killed the poll loop; an in-flight phase becomes settled. A terminal outcome is
  // kept — a reload during the artifact fetches must not relabel a transmitted invoice as
  // "you stopped the polling". Only a genuinely undecided save becomes a resumable "stopped".
  if (send.phase === "creating" && send.transactionId === null) return freshSend();
  if (send.phase !== "idle" && send.phase !== "settled") {
    if (send.outcome !== null && TERMINAL_OUTCOMES.includes(send.outcome)) {
      return { ...send, phase: "settled" };
    }
    return { ...send, phase: "settled", outcome: "stopped", note: RESTORED_SEND_NOTE };
  }
  return send;
}

function readCorrectionTarget(saved: unknown): CorrectionTarget | null {
  if (saved === null || typeof saved !== "object") return null;
  const value = saved as Partial<CorrectionTarget>;
  if (typeof value.id !== "string" || typeof value.country !== "string") return null;
  if (value.mode !== "MOCK" && value.mode !== "LIVE") return null;
  return {
    id: value.id,
    presetId: value.presetId ?? null,
    country: value.country,
    mode: value.mode,
    at: typeof value.at === "number" ? value.at : 0,
  };
}

function restoreInvoice(saved: unknown, fallback: Invoice): Invoice {
  if (saved === null || typeof saved !== "object") return fallback;
  const value = saved as Partial<Invoice>;
  // The loss tables, presence strip and viewers walk these members unguarded; a blob missing any
  // of them would crash the render, and the bad blob would reproduce the crash on every reload.
  const record = (candidate: unknown) => candidate !== null && typeof candidate === "object";
  if (
    !knownFormat(value.format) ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.vatBreakdown) ||
    !record(value.seller) ||
    !record(value.buyer) ||
    !record(value.payment) ||
    !record(value.totals)
  ) {
    return fallback;
  }
  return value as Invoice;
}

export function initialWorkflow(): WorkflowState {
  const fresh = freshWorkflow();
  const saved = readPersisted();
  if (!saved) return fresh;

  const shell: WorkflowState = {
    ...fresh,
    persona: saved.persona === "buyer" ? "buyer" : "seller",
    panes: migratePanes(saved),
    // A legacy bare-string target (pre-typed shape) lacks the country/mode context the
    // mismatch guards need, so it is dropped rather than trusted.
    correctionTarget: readCorrectionTarget(saved.correctionTarget),
  };
  if (!saved.presetId) return shell;

  let fallback: Invoice;
  try {
    fallback = preset(saved.presetId);
  } catch {
    return shell;
  }
  const restored = saved.viewVersion === VIEW_VERSION;
  const invoice = restored ? restoreInvoice(saved.invoice, fallback) : fallback;
  // Edits ride with the invoice: restoring hand-edited XML/JSON next to a rejected (pristine)
  // invoice would show three panes describing three different documents.
  const invoiceRestored = restored && invoice !== fallback;
  return {
    ...shell,
    presetId: saved.presetId,
    invoice,
    edit: invoiceRestored ? restoreEdit(saved.edit) : freshEdit(),
    send: restored ? restoreSend(saved.send) : freshSend(),
    formatId: knownFormat(saved.formatId) ? saved.formatId : fallback.format,
    step: migrateStep(saved.step),
  };
}

export type OperationView = Operation & { text: string };

// composeOperation is called from render paths on every store change, and the full UAPI mapping
// plus stringify is the most expensive derived value in the app — one memo slot covers it,
// because the inputs only change on actual edits, never on selection clicks.
let composeMemo: {
  invoice: Invoice;
  json: string | null;
  jsonError: string | null;
  target: CorrectionTarget | null;
  result: OperationView;
} | null = null;

// The one place the Mapper and Send agree on what gets posted: the derived operation unless the
// user hand-edited the JSON, in which case exactly what the JSON pane holds.
export function composeOperation(state: WorkflowState): OperationView {
  if (
    state.invoice &&
    composeMemo &&
    composeMemo.invoice === state.invoice &&
    composeMemo.json === state.edit.json &&
    composeMemo.jsonError === state.edit.jsonError &&
    composeMemo.target === state.correctionTarget
  ) {
    return composeMemo.result;
  }
  const result = composeOperationUncached(state);
  if (state.invoice) {
    composeMemo = {
      invoice: state.invoice,
      json: state.edit.json,
      jsonError: state.edit.jsonError,
      target: state.correctionTarget,
      result,
    };
  }
  return result;
}

function composeOperationUncached(state: WorkflowState): OperationView {
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
  const derived = buildOperation(state.invoice, state.correctionTarget?.id ?? null);
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
