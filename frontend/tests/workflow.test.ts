import { beforeEach, describe, expect, it } from "vitest";
import { FORMATS, getFormat } from "../src/formats";
import type { FormatId } from "../src/model";
import { listPresets } from "../src/presets";
import { emptyRun, stagesFor, type StageResult } from "../src/validation";
import {
  defaultView,
  freshWorkflow,
  initialWorkflow,
  JSON_LOSS_NOTICE,
  LOSS_NOTICE,
  migrateView,
  persistWorkflow,
  stepLock,
  STEPS,
  VIEW_VERSION,
  workflowReducer,
  WORKFLOW_KEY,
  type WorkflowAction,
  type WorkflowState,
} from "../src/workflow";

const first = listPresets()[0];

function chosen(): WorkflowState {
  return workflowReducer(freshWorkflow(), { type: "choosePreset", presetId: first.id });
}

function otherFormat(formatId: FormatId): FormatId | undefined {
  return (Object.keys(FORMATS) as FormatId[]).find((id) => id !== formatId);
}

describe("workflow reducer", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts on setup with no preset and no invoice", () => {
    expect(freshWorkflow()).toMatchObject({
      step: "setup",
      presetId: null,
      invoice: null,
      persona: "seller",
      selection: null,
    });
    expect(freshWorkflow().formatId in FORMATS).toBe(true);
  });

  it("locks every step but setup until a preset is chosen", () => {
    const fresh = freshWorkflow();
    for (const step of STEPS) {
      const lock = stepLock(fresh, step.id);
      if (step.id === "setup") expect(lock).toBeUndefined();
      else expect(lock).toMatch(/preset/i);
    }
  });

  it("choosePreset loads the invoice, adopts its format and moves to compose", () => {
    const state = chosen();
    expect(state.presetId).toBe(first.id);
    expect(state.invoice?.number).toBeTruthy();
    expect(state.formatId).toBe(state.invoice?.format);
    expect(state.step).toBe("compose");
    expect(STEPS.every((step) => stepLock(state, step.id) === undefined)).toBe(true);
  });

  it("goToStep is ignored while the step is locked and works once it is not", () => {
    const fresh = freshWorkflow();
    expect(workflowReducer(fresh, { type: "goToStep", step: "send" })).toBe(fresh);
    expect(workflowReducer(chosen(), { type: "goToStep", step: "send" }).step).toBe("send");
  });

  it("choosePreset clears a selection carried over from the previous invoice", () => {
    const selected = workflowReducer(chosen(), {
      type: "select",
      selection: { field: "number", path: "Invoice/cbc:ID", source: "human" },
    });
    expect(
      workflowReducer(selected, { type: "choosePreset", presetId: first.id }).selection,
    ).toBeNull();
  });

  it("select replaces the selection and round trips both halves", () => {
    const state = workflowReducer(chosen(), {
      type: "select",
      selection: { field: "seller.vatId", path: "Invoice/x", source: "human" },
    });
    expect(state.selection).toEqual({
      field: "seller.vatId",
      path: "Invoice/x",
      source: "human",
    });
    const fromXml = workflowReducer(state, {
      type: "select",
      selection: { path: "Invoice/y", source: "xml" },
    });
    expect(fromXml.selection).toEqual({ path: "Invoice/y", source: "xml" });
    expect(workflowReducer(fromXml, { type: "select", selection: null }).selection).toBeNull();
  });

  it("setFormat only accepts a registered format and re-resolves the selected path", () => {
    const state = workflowReducer(chosen(), {
      type: "select",
      selection: { field: "number", path: "Invoice/cbc:ID", source: "human" },
    });
    expect(workflowReducer(state, { type: "setFormat", formatId: "nope" as FormatId })).toBe(state);

    const target = otherFormat(state.formatId);
    if (!target) return;
    const switched = workflowReducer(state, { type: "setFormat", formatId: target });
    expect(switched.formatId).toBe(target);
    expect(switched.selection).toEqual({ field: "number", source: "human" });
  });

  it("keeps the selection when the view or the persona changes", () => {
    const state = workflowReducer(chosen(), {
      type: "select",
      selection: { field: "number", source: "human" },
    });
    expect(workflowReducer(state, { type: "setView", view: "xml" })).toMatchObject({
      view: "xml",
      selection: { field: "number" },
    });
    expect(workflowReducer(state, { type: "setPersona", persona: "buyer" })).toMatchObject({
      persona: "buyer",
      selection: { field: "number" },
    });
  });

  it("remembers which viewer groups the user opened and forgets them on a new preset", () => {
    const state = chosen();
    expect(state.groups).toEqual({ open: {}, showUncarried: true });

    const opened = workflowReducer(state, { type: "setGroupOpen", key: "BG-13", open: true });
    expect(opened.groups.open).toEqual({ "BG-13": true });
    expect(workflowReducer(opened, { type: "goToStep", step: "validate" }).groups).toBe(
      opened.groups,
    );

    const reloaded = workflowReducer(opened, { type: "choosePreset", presetId: first.id });
    expect(reloaded.groups.open).toEqual({});
  });

  it("keeps the show-uncarried preference across a new preset", () => {
    const hidden = workflowReducer(chosen(), { type: "showUncarried", show: false });
    expect(hidden.groups.showUncarried).toBe(false);
    expect(
      workflowReducer(hidden, { type: "choosePreset", presetId: first.id }).groups.showUncarried,
    ).toBe(false);
  });

  it("returns the same state for a no-op action", () => {
    const state = chosen();
    expect(workflowReducer(state, { type: "setView", view: state.view })).toBe(state);
    expect(workflowReducer(state, { type: "setPersona", persona: state.persona })).toBe(state);
    expect(workflowReducer(state, { type: "goToStep", step: state.step })).toBe(state);
    expect(
      workflowReducer(state, { type: "showUncarried", show: state.groups.showUncarried }),
    ).toBe(state);
    expect(workflowReducer(state, { type: "setGroupOpen", key: "BG-4", open: true })).not.toBe(
      state,
    );
  });
});

describe("workflow persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("rehydrates the step, the preset, the format, the persona and the view", () => {
    const state = workflowReducer(
      workflowReducer(chosen(), { type: "goToStep", step: "validate" }),
      { type: "setPersona", persona: "buyer" },
    );
    persistWorkflow(state);
    const restored = initialWorkflow();
    expect(restored).toMatchObject({
      step: "validate",
      presetId: state.presetId,
      formatId: state.formatId,
      persona: "buyer",
      view: state.view,
    });
    expect(restored.invoice).toEqual(state.invoice);
  });

  it("persists no invoice payload and no api-log data", () => {
    const state = chosen();
    persistWorkflow(state);
    const raw = localStorage.getItem(WORKFLOW_KEY) ?? "";
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      "formatId",
      "persona",
      "presetId",
      "step",
      "view",
      "viewVersion",
    ]);
    expect(raw).not.toContain(state.invoice?.seller.name ?? "seller name");
    expect(raw).not.toContain(state.invoice?.number ?? "invoice number");
  });

  it("falls back to a fresh workflow when the stored preset no longer exists", () => {
    localStorage.setItem(
      WORKFLOW_KEY,
      JSON.stringify({ step: "send", presetId: "gone", formatId: "nope", persona: "buyer" }),
    );
    expect(initialWorkflow()).toMatchObject({
      step: "setup",
      presetId: null,
      invoice: null,
      persona: "buyer",
    });
  });

  it("ignores unreadable storage", () => {
    localStorage.setItem(WORKFLOW_KEY, "{not json");
    expect(initialWorkflow()).toMatchObject({ step: "setup", presetId: null });
  });
});

describe("compose edits", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function loaded(): WorkflowState {
    return chosen();
  }

  function xmlOf(state: WorkflowState): string {
    if (!state.invoice) throw new Error("test: no invoice");
    return getFormat(state.formatId).write(state.invoice);
  }

  function handEdited(state: WorkflowState): string {
    const text = xmlOf(state);
    const declaration = text.indexOf("\n") + 1;
    return `${text.slice(0, declaration)}<!-- kept by hand -->\n${text.slice(declaration)}`;
  }

  it("starts with a model-derived, error-free XML", () => {
    expect(loaded().edit).toEqual({
      source: "human",
      xml: null,
      error: null,
      lossy: false,
      json: null,
      jsonError: null,
      jsonLossy: false,
      notice: null,
    });
  });

  it("editField sets the value immutably and keeps the XML derived from the model", () => {
    const before = loaded();
    const after = workflowReducer(before, {
      type: "editField",
      field: "number",
      value: "NEW-0001",
    });
    expect(after.invoice?.number).toBe("NEW-0001");
    expect(before.invoice?.number).not.toBe("NEW-0001");
    expect(after.invoice).not.toBe(before.invoice);
    expect(after.edit).toMatchObject({ source: "human", xml: null });
    expect(xmlOf(after)).toContain("NEW-0001");
  });

  it("editField keeps decimals as the string it was given and leaves the other rows alone", () => {
    const before = loaded();
    const after = workflowReducer(before, {
      type: "editField",
      field: "lines.0.netAmount",
      value: "10.50",
    });
    expect(after.invoice?.lines[0].netAmount).toBe("10.50");
    expect(after.invoice?.lines[1]).toBe(before.invoice?.lines[1]);
  });

  it("editField is a no-op when the value did not change", () => {
    const state = loaded();
    const same = workflowReducer(state, {
      type: "editField",
      field: "number",
      value: state.invoice?.number ?? "",
    });
    expect(same).toBe(state);
  });

  it("editXml parses the text into the invoice and remembers it came from the XML", () => {
    const state = loaded();
    const text = xmlOf(state).replaceAll(state.invoice?.lines[0].name ?? "", "FROM THE XML");
    const after = workflowReducer(state, { type: "editXml", text });
    expect(after.invoice?.lines[0].name).toBe("FROM THE XML");
    expect(after.invoice?.format).toBe(state.invoice?.format);
    expect(after.edit).toMatchObject({ source: "xml", xml: text, error: null, lossy: false });
  });

  it("editXml flags an edit whose derived elements no longer agree with the model", () => {
    const state = loaded();
    const text = xmlOf(state).replace(state.invoice?.number ?? "", "ONLY-HERE");
    expect(workflowReducer(state, { type: "editXml", text }).edit).toMatchObject({
      error: null,
      lossy: true,
    });
  });

  it("editXml keeps the last good invoice and reports the parser message", () => {
    const state = loaded();
    const after = workflowReducer(state, { type: "editXml", text: "<not-an-invoice/>" });
    expect(after.invoice).toBe(state.invoice);
    expect(after.edit.xml).toBe("<not-an-invoice/>");
    expect(after.edit.error).toMatch(/root/i);

    const recovered = workflowReducer(after, { type: "editXml", text: xmlOf(state) });
    expect(recovered.edit).toMatchObject({ error: null, lossy: false });
    expect(xmlOf(recovered)).toBe(xmlOf(state));
  });

  it("editXml flags a hand edit the mapping table cannot read back", () => {
    const state = loaded();
    const text = handEdited(state);
    const after = workflowReducer(state, { type: "editXml", text });
    expect(after.edit.error).toBeNull();
    expect(after.edit.lossy).toBe(true);
    expect(after.edit.notice).toBeNull();
  });

  it("warns once when regenerating the XML drops a lossy hand edit", () => {
    const state = loaded();
    const lossy = workflowReducer(state, {
      type: "editXml",
      text: handEdited(state),
    });
    const edited = workflowReducer(lossy, { type: "editField", field: "number", value: "X-1" });
    expect(edited.edit).toMatchObject({ source: "human", xml: null, lossy: false });
    expect(edited.edit.notice).toBe(LOSS_NOTICE);

    const again = workflowReducer(edited, { type: "editField", field: "number", value: "X-2" });
    expect(again.edit.notice).toBe(LOSS_NOTICE);
    expect(workflowReducer(again, { type: "dismissEditNotice" }).edit.notice).toBeNull();
  });

  it("switching format or preset regenerates the XML from the invoice", () => {
    const state = loaded();
    const drafted = workflowReducer(state, { type: "editXml", text: xmlOf(state) });
    expect(drafted.edit.xml).not.toBeNull();

    const target = otherFormat(state.formatId);
    if (target) {
      expect(workflowReducer(drafted, { type: "setFormat", formatId: target }).edit.xml).toBeNull();
    }
    expect(
      workflowReducer(drafted, { type: "choosePreset", presetId: first.id }).edit,
    ).toMatchObject({ source: "human", xml: null, notice: null });
  });

  it("persists no draft XML", () => {
    const state = loaded();
    const drafted = workflowReducer(state, { type: "editXml", text: xmlOf(state) });
    persistWorkflow(drafted);
    expect(localStorage.getItem(WORKFLOW_KEY) ?? "").not.toContain("<");
  });
});

describe("validation state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const started = (): WorkflowState => {
    const state = chosen();
    return workflowReducer(state, {
      type: "validationStarted",
      key: "run-1",
      stages: emptyRun(state.formatId),
    });
  };

  it("holds no run until one is started", () => {
    expect(chosen().validation).toEqual({ key: null, running: false, stages: [] });
  });

  it("starts a run pending in pipeline order and marks it running", () => {
    const state = started();
    expect(state.validation).toMatchObject({ key: "run-1", running: true });
    expect(state.validation.stages.map((stage) => stage.id)).toEqual(
      stagesFor(state.formatId).map((stage) => stage.id),
    );
    expect(state.validation.stages.every((stage) => stage.status === "pending")).toBe(true);
  });

  it("replaces a single stage as it reports and keeps the rest", () => {
    const state = started();
    const stage: StageResult = {
      ...state.validation.stages[0],
      status: "failed",
      findings: [{ source: "model", ruleId: "BR-11", severity: "error", message: "nope" }],
      durationMs: 4,
    };
    const next = workflowReducer(state, { type: "validationStage", key: "run-1", stage });
    expect(next.validation.stages[0]).toEqual(stage);
    expect(next.validation.stages.slice(1)).toEqual(state.validation.stages.slice(1));
    expect(next.validation.running).toBe(true);
  });

  it("ignores reports from a superseded run", () => {
    const state = started();
    const stage: StageResult = { ...state.validation.stages[0], status: "passed" };
    expect(workflowReducer(state, { type: "validationStage", key: "run-0", stage })).toBe(state);
    expect(workflowReducer(state, { type: "validationFinished", key: "run-0", stages: [] })).toBe(
      state,
    );
  });

  it("finishing the run stops it and keeps the reported stages", () => {
    const state = started();
    const stages: StageResult[] = state.validation.stages.map((stage) => ({
      ...stage,
      status: "passed",
    }));
    const next = workflowReducer(state, { type: "validationFinished", key: "run-1", stages });
    expect(next.validation).toEqual({ key: "run-1", running: false, stages });
  });

  it("drops the result as soon as the invoice, the format or the XML changes", () => {
    const state = started();
    const other = otherFormat(state.formatId);
    const actions: WorkflowAction[] = [
      { type: "editField", field: "number", value: "STALE-1" },
      { type: "editXml", text: "<not-a-fattura/>" },
      { type: "choosePreset", presetId: first.id },
      ...(other ? [{ type: "setFormat", formatId: other } as WorkflowAction] : []),
    ];
    for (const action of actions) {
      expect(workflowReducer(state, action).validation).toEqual({
        key: null,
        running: false,
        stages: [],
      });
    }
  });
});

describe("view mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens on the fiskaly JSON, the artifact the API accepts", () => {
    expect(defaultView()).toBe("json");
    expect(freshWorkflow().view).toBe("json");
  });

  it("migrates a view written before the JSON became the primary artifact", () => {
    // The old UI's "xml" meant "show me the artifact"; the artifact is now the JSON.
    expect(migrateView({ view: "xml" })).toBe("json");
    expect(migrateView({ view: "human" })).toBe("human");
    expect(migrateView({ view: "split" })).toBe("split");
    expect(migrateView({ view: "json" })).toBe("json");
    expect(migrateView({ view: "nonsense" })).toBe("json");
    expect(migrateView({})).toBe("json");
  });

  it("keeps a view written by this UI, including a deliberate Predicted XML", () => {
    expect(migrateView({ view: "xml", viewVersion: VIEW_VERSION })).toBe("xml");
    expect(migrateView({ view: "human", viewVersion: VIEW_VERSION })).toBe("human");
    expect(migrateView({ view: "gone", viewVersion: VIEW_VERSION })).toBe("json");
  });

  it("migrates through initialWorkflow and re-persists the new version", () => {
    localStorage.setItem(
      WORKFLOW_KEY,
      JSON.stringify({ step: "compose", presetId: first.id, persona: "seller", view: "xml" }),
    );
    const restored = initialWorkflow();
    expect(restored.view).toBe("json");

    persistWorkflow(restored);
    const raw: unknown = JSON.parse(localStorage.getItem(WORKFLOW_KEY) ?? "{}");
    expect(raw).toMatchObject({ view: "json", viewVersion: VIEW_VERSION });
  });

  it("round-trips a Predicted XML choice across a reload", () => {
    const state = { ...chosen(), view: "xml" as const };
    persistWorkflow(state);
    expect(initialWorkflow().view).toBe("xml");
  });
});

describe("json edits", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("regenerating after a lossy JSON edit warns once and then clears", () => {
    const loaded = chosen();
    const lossy: WorkflowState = {
      ...loaded,
      edit: { ...loaded.edit, source: "json", json: "{}", jsonLossy: true },
    };
    const after = workflowReducer(lossy, { type: "editField", field: "number", value: "X-1" });
    expect(after.edit.notice).toBe(JSON_LOSS_NOTICE);
    expect(after.edit.json).toBeNull();
    expect(after.edit.jsonLossy).toBe(false);

    const again = workflowReducer(after, { type: "editField", field: "number", value: "X-2" });
    expect(again.edit.notice).toBe(JSON_LOSS_NOTICE);
    expect(
      workflowReducer(
        { ...after, edit: { ...after.edit, notice: null } },
        { type: "editField", field: "number", value: "X-3" },
      ).edit.notice,
    ).toBeNull();
  });

  it("an XML edit regenerates the JSON and reports what that dropped", () => {
    const loaded = chosen();
    const state: WorkflowState = {
      ...loaded,
      edit: { ...loaded.edit, source: "json", json: "{}", jsonLossy: true },
    };
    if (!state.invoice) throw new Error("test: no invoice");
    const xml = getFormat(state.formatId).write(state.invoice);
    const after = workflowReducer(state, { type: "editXml", text: xml });
    expect(after.edit.json).toBeNull();
    expect(after.edit.notice).toBe(JSON_LOSS_NOTICE);
    expect(after.edit.source).toBe("xml");
  });

  it("an unparseable JSON edit leaves the invoice and the XML alone", () => {
    const loaded = chosen();
    const after = workflowReducer(loaded, { type: "editJson", text: "{oops" });
    expect(after.invoice).toBe(loaded.invoice);
    expect(after.edit.jsonError).toBeTruthy();
    expect(after.edit.xml).toBeNull();
    expect(after.edit.error).toBeNull();
  });
});
