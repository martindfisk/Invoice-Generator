import { useEffect, useMemo, useRef, useState } from "react";
import { documentTierFateNote } from "./field-fate";
import { FindingsPanel, type FindingRow } from "./FindingsPanel";
import { Split } from "./Split";
import { useIsWide } from "./use-media";
import { getFormat } from "./formats";
import { InvoiceWorkbench } from "./InvoiceWorkbench";
import type { FieldId, FormatId, Invoice } from "./model";
import type { PresetId } from "./presets";
import { VALIDATION_RULES_SECTION_ID } from "./SettingsDialog";
import { store, useStore } from "./store";
import {
  CONTRACT_TIER_NOTE,
  DOCUMENT_TIER_NOTE,
  fieldForPointer,
  isContractStage,
} from "./uapi-json";
import {
  countBySeverity,
  emptyRun,
  runValidation,
  type Finding,
  type Severity,
  type StageResult,
  type StageStatus,
} from "./validation";
import {
  buildFieldIndex,
  indexXml,
  normalisePath,
  pathAtOffset,
  rangeForPath,
  type FieldIndex,
  type XmlIndex,
} from "./xml-locate";
import { composeOperation } from "./workflow";

const RUN_DEBOUNCE_MS = 250;

const SEVERITIES: Severity[] = ["fatal", "error", "warning", "info"];

const SEVERITY_GLYPH: Record<Severity, string> = {
  fatal: "■",
  error: "●",
  warning: "▲",
  info: "○",
};

const SEVERITY_TONE: Record<Severity, string> = {
  fatal: "bg-fatal text-white",
  error: "bg-error-soft text-error-ink",
  warning: "bg-warning-soft text-warning-ink",
  info: "bg-info-soft text-info",
};

const STATUS: Record<StageStatus, { label: string; glyph: string; chip: string; mark: string }> = {
  pending: { label: "Pending", glyph: "○", chip: "border-line text-muted", mark: "text-muted" },
  running: { label: "Running", glyph: "◍", chip: "border-brand text-ink", mark: "text-brand" },
  passed: {
    label: "Passed",
    glyph: "✓",
    chip: "border-success text-success",
    mark: "text-success",
  },
  failed: {
    label: "Failed",
    glyph: "✕",
    chip: "border-error bg-error-soft text-error-ink",
    mark: "text-error",
  },
  unavailable: {
    label: "Not run",
    glyph: "—",
    chip: "border-dashed border-line text-muted",
    mark: "text-muted",
  },
};

function ran(stage: StageResult): boolean {
  return stage.status === "passed" || stage.status === "failed";
}

function StageRows({ stages }: { stages: StageResult[] }) {
  return (
    <ul className="relative py-1">
      {stages.map((stage) => {
        const status = STATUS[stage.status];
        const counts = countBySeverity(stage.findings);
        return (
          <li
            key={stage.id}
            data-stage={stage.id}
            data-status={stage.status}
            className="group relative py-1.5 pr-3 pl-10 last:pb-1"
          >
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-[1.15rem] w-px bg-line group-first:top-2 group-last:bottom-auto group-last:h-2 group-only:hidden"
            />
            <span
              aria-hidden="true"
              className={`absolute top-3 left-2.5 grid h-4 w-4 place-items-center rounded-full border-2 border-canvas bg-surface font-mono text-[10px] leading-none ${status.mark}`}
            >
              {status.glyph}
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-medium text-ink">{stage.label}</span>
              <span
                className={`rounded-m border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${status.chip}`}
              >
                {status.label}
              </span>
              {stage.durationMs !== undefined && (
                <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">
                  {stage.durationMs} ms
                </span>
              )}
            </div>
            {ran(stage) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {stage.findings.length === 0 ? (
                  <span className="text-[11px] text-muted">No findings</span>
                ) : (
                  SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
                    <span
                      key={severity}
                      title={`${counts[severity]} ${severity}`}
                      className={`rounded-m px-1.5 py-0.5 font-mono text-[10px] ${SEVERITY_TONE[severity]}`}
                    >
                      <span aria-hidden="true">{SEVERITY_GLYPH[severity]} </span>
                      {counts[severity]} {severity}
                    </span>
                  ))
                )}
              </div>
            )}
            {stage.note && <p className="mt-1 text-[11px] text-muted">{stage.note}</p>}
            {stage.ruleSets && stage.ruleSets.length > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                Rule sets:{" "}
                {stage.ruleSets.map((set, index) => (
                  <span key={set.id}>
                    {index > 0 && ", "}
                    <span className="font-mono text-ink">
                      {set.id}
                      {set.version ? ` ${set.version}` : ""}
                    </span>
                  </span>
                ))}
                {" · "}
                <button
                  type="button"
                  onClick={() => store.openSettings(VALIDATION_RULES_SECTION_ID)}
                  className="underline decoration-dotted underline-offset-2 hover:text-ink"
                >
                  versions in Settings → Validation rules
                </button>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function StageList({ stages, formatId }: { stages: StageResult[]; formatId?: FormatId }) {
  const contract = stages.filter((stage) => isContractStage(stage.id));
  const documentTier = stages.filter((stage) => !isContractStage(stage.id));
  const fateNote = documentTierFateNote(formatId);
  return (
    <section
      aria-label="Validation stages"
      className="flex min-h-0 flex-col overflow-hidden rounded-l border border-line bg-surface shadow-s"
    >
      <h3 className="shrink-0 border-b border-line px-3 py-2 text-[11px] font-bold tracking-wide text-muted uppercase">
        Pipeline
      </h3>
      <div className="min-h-0 flex-1 overflow-auto">
        <div data-tier="contract" className="border-b-2 border-brand">
          <h4 className="border-b border-line bg-brand-soft px-3 py-1.5 text-[11px] font-semibold text-brand-ink">
            fiskaly API contract
          </h4>
          <p className="border-b border-line px-3 py-1 text-[10px] leading-snug text-muted">
            {CONTRACT_TIER_NOTE}
          </p>
          <StageRows stages={contract} />
        </div>
        <div data-tier="document">
          <h4 className="border-b border-line bg-surface-raised px-3 py-1.5 text-[11px] font-semibold text-muted">
            The predicted XML
          </h4>
          <p className="border-b border-line px-3 py-1 text-[10px] leading-snug text-muted">
            {DOCUMENT_TIER_NOTE}
          </p>
          {fateNote && (
            <p
              data-fate-note="document-tier"
              className="border-b border-line bg-warning-soft px-3 py-1 text-[10px] leading-snug text-warning-ink"
            >
              {fateNote}
            </p>
          )}
          <StageRows stages={documentTier} />
        </div>
      </div>
    </section>
  );
}

function offsetAt(xml: string, line: number, column: number | undefined): number | undefined {
  const lines = xml.split("\n");
  if (line < 1 || line > lines.length) return undefined;
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) offset += lines[index].length + 1;
  return offset + Math.max(0, (column ?? 1) - 1);
}

function lineAt(xml: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < xml.length; index += 1) {
    if (xml[index] === "\n") line += 1;
  }
  return line;
}

function variants(xpath: string): string[] {
  const steps = normalisePath(xpath)
    .split("/")
    .filter(Boolean)
    .map((step) => step.replace(/\[(\d+)]$/, (_, index: string) => `[${Number(index) - 1}]`));
  const bare = steps.map((step) => step.replace(/^(?:\*|[\w.-]+):(?=[\w*])/, ""));
  const first = steps.join("/");
  const second = bare.join("/");
  return second === first ? [first] : [first, second];
}

function match(index: XmlIndex, path: string): string | undefined {
  const exact = rangeForPath(index, path);
  if (exact) return exact.path;
  const suffix = `/${normalisePath(path)}`;
  return index.ranges.find((range) => range.path.endsWith(suffix))?.path;
}

function locate(index: XmlIndex, xpath: string | undefined): string | undefined {
  if (!xpath) return undefined;
  for (const variant of variants(xpath)) {
    let candidate = variant;
    while (candidate.length > 0) {
      const found = match(index, candidate);
      if (found) return found;
      const cut = candidate.lastIndexOf("/");
      candidate = cut === -1 ? "" : candidate.slice(0, cut);
    }
  }
  return undefined;
}

// A contract finding addresses the JSON with a Pointer rather than an XPath.
function pointerOf(finding: Finding): string | undefined {
  if (finding.pointer?.startsWith("/")) return finding.pointer;
  if (!isContractStage(finding.source)) return undefined;
  return finding.xpath?.startsWith("/") ? finding.xpath : undefined;
}

function resolve(
  finding: Finding,
  key: string,
  fields: FieldIndex,
  index: XmlIndex,
  xml: string,
  jsonPrefix: string,
): FindingRow {
  const pointer = pointerOf(finding);
  let field: FieldId | undefined =
    finding.field ?? (pointer && fieldForPointer(pointer, jsonPrefix));
  let path = field ? locate(index, fields.entry(field).path) : undefined;
  if (!path && !pointer) path = locate(index, finding.xpath);
  if (!path && !pointer && finding.line !== undefined) {
    const offset = offsetAt(xml, finding.line, finding.column);
    path = offset === undefined ? undefined : pathAtOffset(index, offset);
  }
  if (!field && path) field = fields.fieldForPath(path);
  const range = path ? rangeForPath(index, path) : undefined;
  const line = finding.line ?? (range ? lineAt(xml, range.from) : undefined);
  return { key, finding, field, path, pointer, line };
}

function digest(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function contractLine(stages: StageResult[]): string {
  const contract = stages.find((stage) => isContractStage(stage.id));
  if (!contract) return "The fiskaly API contract check did not run.";
  if (contract.status === "failed") {
    const blocking = contract.findings.filter(
      (finding) => finding.severity === "fatal" || finding.severity === "error",
    ).length;
    return `fiskaly would reject this payload — ${blocking} contract error${blocking === 1 ? "" : "s"}.`;
  }
  if (contract.status === "passed") return "The payload matches the fiskaly API contract.";
  return "The fiskaly API contract check did not run.";
}

function actionLine(
  stages: StageResult[],
  counts: Record<Severity, number>,
  busy: boolean,
): string {
  if (busy) return "Validating…";
  if (stages.every((stage) => stage.status === "pending")) return "Not validated yet.";
  const contract = contractLine(stages);
  const blocking = counts.fatal + counts.error;
  const missing = stages.filter((stage) => stage.status === "unavailable").length;
  if (blocking > 0) {
    return `${contract} ${blocking} error${blocking === 1 ? "" : "s"} in total — sending anyway will likely be rejected.`;
  }
  if (missing > 0) {
    return `${contract} ${missing} stage${missing === 1 ? "" : "s"} could not run — this is not a clean bill of health.`;
  }
  if (counts.warning > 0) {
    return `${contract} ${counts.warning} warning${counts.warning === 1 ? "" : "s"} — every stage passed.`;
  }
  return `${contract} Every stage passed.`;
}

function Validating({ invoice, presetId }: { invoice: Invoice; presetId: PresetId }) {
  const formatId = useStore((state) => state.workflow.formatId);
  const selection = useStore((state) => state.workflow.selection);
  const validation = useStore((state) => state.workflow.validation);
  const workflow = useStore((state) => state.workflow);
  const operation = composeOperation(workflow);
  const jsonPrefix = operation.prefix;
  const [source, setSource] = useState<{ xml: string; error: string | null }>({
    xml: "",
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const run = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const { xml, error } = source;
  const value = operation.value ?? undefined;
  const stamp = useMemo(() => JSON.stringify(invoice), [invoice]);
  // The digest hashes the whole XML + operation text on every render otherwise — cheap FNV,
  // but the inputs run to hundreds of KB and this component re-renders on every selection.
  const key = useMemo(
    () => `${nonce} ${formatId} ${digest(`${stamp} ${xml} ${operation.text}`)}`,
    [nonce, formatId, stamp, xml, operation.text],
  );
  const stored = validation.key;

  useEffect(() => {
    // Before the workbench delivers its first render there is nothing to validate; but a writer
    // failure (xml empty, error set) still runs the pipeline — the contract stage checks the
    // JSON, not the XML, and must not be silenced by an unrelated writer limitation.
    if ((xml === "" && error === null) || stored === key) return;
    const timer = setTimeout(() => {
      // A superseded run is not just ignored — its remaining stages and in-flight backend
      // calls are cancelled before the replacement starts.
      controller.current?.abort();
      const aborter = new AbortController();
      controller.current = aborter;
      const id = run.current + 1;
      run.current = id;
      store.dispatch({ type: "validationStarted", key, stages: emptyRun(formatId) });
      // The contract stage checks the JSON Send will post, hand edits and all — not a payload
      // re-derived from the model behind the user's back.
      void runValidation(
        { invoice, formatId, xml, xmlError: error, operation: value, signal: aborter.signal },
        (stage) => {
          if (run.current === id) store.dispatch({ type: "validationStage", key, stage });
        },
      ).then((stages) => {
        if (run.current === id) store.dispatch({ type: "validationFinished", key, stages });
      });
    }, RUN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [invoice, formatId, xml, error, key, stored, value]);

  useEffect(
    () => () => {
      // Leaving the step aborts the in-flight run AND invalidates it: without the run.current
      // bump the aborted result would be dispatched as final, and a partial (or one-stage
      // "backend not reachable") pipeline would stick because the run key still matches.
      run.current += 1;
      controller.current?.abort();
      if (store.getState().workflow.validation.running) {
        store.dispatch({ type: "validationReset" });
      }
    },
    [],
  );

  const stages = useMemo(
    () => (validation.stages.length > 0 ? validation.stages : emptyRun(formatId)),
    [validation.stages, formatId],
  );
  const xmlIndex = useMemo(() => indexXml(xml), [xml]);
  const fields = useMemo(
    () => buildFieldIndex(invoice, getFormat(formatId).map),
    [invoice, formatId],
  );
  const rows = useMemo(
    () =>
      stages.flatMap((stage) =>
        stage.findings.map((finding, index) =>
          resolve(finding, `${stage.id} ${index}`, fields, xmlIndex, xml, jsonPrefix),
        ),
      ),
    [stages, fields, xmlIndex, xml, jsonPrefix],
  );
  const findings = useMemo(() => rows.map((row) => ({ ...row.finding, field: row.field })), [rows]);

  const counts = countBySeverity(findings);
  const stalled = xml === "" && error !== null;
  const busy = !stalled && (validation.running || stored !== key);
  const blocking = counts.fatal + counts.error;

  const onSelect = (row: FindingRow) => {
    setSelectedKey(row.key);
    // The JSON pane is always on screen in the Mapper, so a contract finding needs no pane
    // switch — selecting it is enough for every pane to scroll to its own rendering of it.
    store.dispatch({
      type: "select",
      selection: { field: row.field, path: row.path, pointer: row.pointer, source: "finding" },
    });
  };

  const wide = useIsWide();

  const clear = () => {
    setSelectedKey(null);
    store.dispatch({ type: "select", selection: null });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <Split
        id="validate"
        orientation="vertical"
        label="Resize the invoice and the validation results"
        defaultFirst={40}
        minFirst="20%"
        minSecond="25%"
        className="flex-1"
        first={
          <div className="flex min-h-0 flex-1 flex-col gap-3 pb-1.5">
            <InvoiceWorkbench
              invoice={invoice}
              presetId={presetId}
              findings={findings}
              onXml={(next, failure) =>
                setSource((current) =>
                  current.xml === next && current.error === failure
                    ? current
                    : { xml: next, error: failure },
                )
              }
            />
          </div>
        }
        second={
          <Split
            id="validate-results"
            orientation={wide ? "horizontal" : "vertical"}
            label="Resize the pipeline and the findings"
            defaultFirst={50}
            className="flex-1 pt-1.5"
            first={<StageList stages={stages} formatId={formatId} />}
            second={
              <FindingsPanel
                stages={stages}
                rows={rows}
                running={busy}
                selectedKey={selection?.source === "finding" ? selectedKey : null}
                matchedField={selection?.source === "finding" ? undefined : selection?.field}
                onSelect={onSelect}
                onEscape={clear}
              />
            }
          />
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setNonce((current) => current + 1)}
          className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
        >
          Re-run
        </button>
        <button
          type="button"
          onClick={() => store.dispatch({ type: "goToStep", step: "mapper" })}
          className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
        >
          Back to Mapper
        </button>
        <p
          role="status"
          aria-live="polite"
          className={`rounded-m px-2 py-1 text-xs ${
            stalled
              ? "bg-warning-soft text-warning-ink"
              : !busy && blocking > 0
                ? "bg-error-soft text-error-ink"
                : "text-muted"
          }`}
        >
          {stalled ? error : actionLine(stages, counts, busy)}
        </p>
        <button
          type="button"
          onClick={() => store.dispatch({ type: "goToStep", step: "send" })}
          className={`ml-auto rounded-m px-3 py-1.5 text-xs font-semibold ${
            blocking > 0
              ? "border border-warning bg-warning-soft text-warning-ink"
              : "bg-brand text-bunker"
          }`}
        >
          {blocking > 0 ? "Send anyway" : "Continue to Send"}
        </button>
      </div>
    </div>
  );
}

export function StepValidate() {
  const workflow = useStore((state) => state.workflow);
  const { invoice, presetId } = workflow;

  if (!invoice || !presetId) {
    return (
      <p className="p-6 text-sm text-muted">
        No invoice loaded — pick a preset in Setup to validate one.
      </p>
    );
  }

  return <Validating invoice={invoice} presetId={presetId} />;
}
