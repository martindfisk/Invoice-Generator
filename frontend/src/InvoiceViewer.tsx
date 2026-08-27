import { useCallback, useId, useMemo, useState, type KeyboardEvent } from "react";
import type { FormatPlugin } from "./formats";
import { HumanView, type EditContext } from "./HumanView";
import { useIsWide } from "./use-media";
import { useGridSplit } from "./use-split";
import { JsonView } from "./JsonView";
import type { FieldId, FormatId, Invoice } from "./model";
import { checkModel } from "./model-rules";
import { store, useStore } from "./store";
import { UAPI_DERIVED_PATHS } from "./uapi-map";
import {
  fieldForPointer,
  indexJson,
  lossyGroups,
  OPERATION_PRIMARY_NOTE,
  partialGroups,
  pointerAtOffset,
  pointerForField,
  pointerRange,
  type LossyGroup,
} from "./uapi-json";
import type { Finding, Severity } from "./validation";
import type { EditState, ViewMode } from "./workflow";
import {
  buildFieldIndex,
  indexXml,
  pathAtOffset,
  rangeForPath,
  type FieldEntry,
} from "./xml-locate";
import { XmlView } from "./XmlView";

const MODES: { id: ViewMode; label: string }[] = [
  { id: "human", label: "Fields" },
  { id: "json", label: "fiskaly JSON" },
  { id: "xml", label: "Predicted XML" },
  { id: "split", label: "Split" },
];

export const XML_PREDICTION_NOTE =
  "Predicted XML — what this browser expects fiskaly to generate. Nothing here is transmitted; " +
  "fiskaly's actual document is fetched in Send.";

function Groups({ title, groups }: { title: string; groups: LossyGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <>
      <dt className="mt-1 font-semibold text-ink">{title}</dt>
      {groups.map((group) => (
        <dd key={group.reason} className="mt-0.5 ml-0">
          {group.reason}: <span className="font-mono">{group.fields.join(", ")}</span>
        </dd>
      ))}
    </>
  );
}

function OperationCaveat({ invoice }: { invoice: Invoice }) {
  const lossy = useMemo(() => lossyGroups(invoice), [invoice]);
  const partial = useMemo(() => partialGroups(invoice), [invoice]);
  const count = lossy.reduce((total, group) => total + group.fields.length, 0);
  return (
    <details data-uncarried-by-operation={count} className="mt-0.5">
      <summary className="cursor-pointer text-[11px] text-muted">
        The operation is not the whole invoice — {count} value{count === 1 ? "" : "s"} on this one
        {count === 1 ? " has" : " have"} no place in it. What the JSON cannot carry, and what a JSON
        edit cannot change
      </summary>
      <dl className="mt-1 text-[11px] text-muted">
        <Groups title="Not carried at all" groups={lossy} />
        <Groups title="Carried only in some shapes" groups={partial} />
        <dt className="mt-1 font-semibold text-ink">Derived by the mapping, not stored</dt>
        <dd className="mt-0.5 ml-0 font-mono">{UAPI_DERIVED_PATHS.join(", ")}</dd>
      </dl>
    </details>
  );
}

const RANK: Record<Severity, number> = { fatal: 0, error: 1, warning: 2, info: 3 };

function modelFindings(invoice: Invoice): Finding[] {
  try {
    return checkModel(invoice);
  } catch (error) {
    return [
      {
        source: "model",
        ruleId: "MODEL-UNREADABLE",
        severity: "fatal",
        message: `The model rules could not run on this invoice: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ];
  }
}

function findingsByField(
  invoice: Invoice,
  provided: Finding[] | undefined,
): { all: Finding[]; byField: Map<FieldId, Finding> } {
  const all = provided ?? modelFindings(invoice);
  const byField = new Map<FieldId, Finding>();
  for (const finding of all) {
    if (!finding.field) continue;
    const held = byField.get(finding.field);
    if (!held || RANK[finding.severity] < RANK[held.severity]) byField.set(finding.field, finding);
  }
  return { all, byField };
}

function tone({ all }: { all: Finding[] }): string {
  if (all.some((finding) => finding.severity === "fatal" || finding.severity === "error")) {
    return "bg-error-soft text-error-ink";
  }
  if (all.some((finding) => finding.severity === "warning")) {
    return "bg-warning-soft text-warning-ink";
  }
  return "text-muted";
}

function summary(all: Finding[], validated: boolean): string {
  if (all.length > 0) {
    return `${all.length} ${validated ? "" : "model "}finding${all.length === 1 ? "" : "s"}`;
  }
  return validated ? "" : "Model rules pass";
}

export type InvoiceViewerProps = {
  invoice: Invoice;
  format: FormatPlugin;
  formats: FormatPlugin[];
  xmlText: string;
  xmlError: string | null;
  jsonText: string;
  jsonError: string | null;
  jsonLabel: string;
  jsonNote?: string | null;
  jsonPrefix: string;
  edit: EditState;
  presetLabel: string;
  country?: string;
  findings?: Finding[];
  onFormat: (formatId: FormatId) => void;
  onEditField: (field: FieldId, value: string) => void;
  onEditXml: (text: string) => void;
  onEditJson: (text: string) => void;
  onDismissNotice: () => void;
};

export function InvoiceViewer({
  invoice,
  format,
  formats,
  xmlText,
  xmlError,
  jsonText,
  jsonError,
  jsonLabel,
  jsonNote,
  jsonPrefix,
  edit,
  presetLabel,
  country,
  findings: provided,
  onFormat,
  onEditField,
  onEditXml,
  onEditJson,
  onDismissNotice,
}: InvoiceViewerProps) {
  const view = useStore((state) => state.workflow.view);
  const selection = useStore((state) => state.workflow.selection);
  const [editing, setEditing] = useState<FieldId | null>(null);
  const panelId = useId();

  const xmlIndex = useMemo(() => indexXml(xmlText), [xmlText]);
  const jsonIndex = useMemo(() => indexJson(jsonText), [jsonText]);
  const fields = useMemo(() => buildFieldIndex(invoice, format.map), [invoice, format]);
  const findings = useMemo(() => findingsByField(invoice, provided), [invoice, provided]);
  const path =
    selection?.path ?? (selection?.field ? fields.entry(selection.field).path : undefined);
  const range = useMemo(() => rangeForPath(xmlIndex, path), [xmlIndex, path]);
  const pointer =
    selection?.pointer ??
    (selection?.field ? pointerForField(selection.field, jsonPrefix) : undefined);
  const jsonRange = useMemo(() => pointerRange(jsonIndex, pointer), [jsonIndex, pointer]);

  const selectField = useCallback(
    (entry: FieldEntry) =>
      store.dispatch({
        type: "select",
        selection: {
          field: entry.field,
          path: entry.path,
          pointer: pointerForField(entry.field, jsonPrefix),
          source: "human",
        },
      }),
    [jsonPrefix],
  );

  const selectOffset = (offset: number) => {
    const picked = pathAtOffset(xmlIndex, offset);
    if (!picked) return;
    const field = fields.fieldForPath(picked);
    store.dispatch({
      type: "select",
      selection: {
        field,
        path: picked,
        pointer: field ? pointerForField(field, jsonPrefix) : undefined,
        source: "xml",
      },
    });
  };

  const selectPointer = (offset: number) => {
    const picked = pointerAtOffset(jsonIndex, offset);
    if (!picked) return;
    const field = fieldForPointer(picked, jsonPrefix);
    store.dispatch({
      type: "select",
      selection: {
        field,
        path: field ? fields.entry(field).path : undefined,
        pointer: picked,
        source: "json",
      },
    });
  };

  const editContext: EditContext = useMemo(
    () => ({
      findings: findings.byField,
      onEdit: setEditing,
      onCommit: (field: FieldId, value: string) => {
        setEditing(null);
        onEditField(field, value);
      },
      onCancelEdit: () => setEditing(null),
    }),
    [findings.byField, onEditField],
  );

  const showXml = view === "xml";
  const showJson = view === "json" || view === "split";
  const showHuman = view === "human" || view === "split";
  const wideViewer = useIsWide();
  const {
    ratio: splitRatio,
    measure: splitMeasure,
    separatorProps: splitSeparator,
  } = useGridSplit("viewer", wideViewer, "Resize the fields and JSON panes");

  const controls = (mode: ViewMode): string | undefined => {
    if (mode === "human" || mode === "split") return showHuman ? `${panelId}-human` : undefined;
    if (mode === "json") return showJson ? `${panelId}-json` : undefined;
    return showXml ? `${panelId}-xml` : undefined;
  };

  const onModeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = MODES.findIndex((mode) => mode.id === view);
    const next =
      event.key === "ArrowRight"
        ? current + 1
        : event.key === "ArrowLeft"
          ? current - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? MODES.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const mode = MODES[Math.max(0, Math.min(MODES.length - 1, next))];
    store.dispatch({ type: "setView", view: mode.id });
  };

  return (
    <section
      aria-label="Invoice viewer"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (editing !== null) {
          setEditing(null);
          return;
        }
        if (!selection) return;
        store.dispatch({ type: "select", selection: null });
      }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-l border border-line bg-surface shadow-s"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-3 py-2">
        <div
          role="tablist"
          aria-label="Invoice view mode"
          onKeyDown={onModeKeyDown}
          className="inline-flex gap-0.5 rounded-m border border-line bg-canvas p-0.5"
        >
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={view === mode.id}
              aria-controls={controls(mode.id)}
              tabIndex={view === mode.id ? 0 : -1}
              onClick={() => store.dispatch({ type: "setView", view: mode.id })}
              className={`rounded-m px-2.5 py-1 text-xs font-medium ${
                view === mode.id ? "bg-surface text-ink shadow-s" : "text-muted hover:text-ink"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {formats.length > 1 && (
          <div
            role="group"
            aria-label="Predicted XML format"
            className="inline-flex gap-0.5 rounded-m border border-line bg-canvas p-0.5"
          >
            {formats.map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                aria-pressed={plugin.id === format.id}
                aria-label={plugin.label}
                title={`${plugin.label} — ${plugin.spec}`}
                onClick={() => onFormat(plugin.id)}
                className={`rounded-m px-2 py-1 font-mono text-[11px] font-medium ${
                  plugin.id === format.id
                    ? "bg-surface text-ink shadow-s"
                    : "text-muted hover:text-ink"
                }`}
              >
                {plugin.id.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        <span
          title={format.spec}
          className="rounded-m border border-line px-2 py-0.5 text-[11px] text-muted"
        >
          {format.label}
        </span>

        <span className="rounded-m border border-line px-2 py-0.5 text-[11px] text-muted">
          Preset: {presetLabel}
        </span>

        <span
          role="status"
          className={`ml-auto rounded-m px-2 py-0.5 text-[11px] ${tone(findings)}`}
        >
          {summary(findings.all, provided !== undefined)}
        </span>
      </div>

      {edit.notice && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-line bg-warning-soft px-3 py-2 text-[11px] text-warning-ink"
        >
          <span aria-hidden="true">▲</span>
          <span className="min-w-0 flex-1">{edit.notice}</span>
          <button
            type="button"
            onClick={onDismissNotice}
            className="shrink-0 rounded-m border border-line px-1.5 py-0.5 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        ref={splitMeasure}
        style={
          showHuman && showJson
            ? ({ "--split-a": `${splitRatio}%` } as React.CSSProperties)
            : undefined
        }
        className={
          showHuman && showJson
            ? "grid min-h-0 flex-1 grid-rows-[var(--split-a)_6px_minmax(0,1fr)] xl:grid-cols-[var(--split-a)_6px_minmax(0,1fr)] xl:grid-rows-[minmax(0,100%)]"
            : "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]"
        }
      >
        {showHuman && (
          <div
            id={`${panelId}-human`}
            role="tabpanel"
            aria-label="Fields view"
            className="flex min-h-0 min-w-0 flex-col"
          >
            <HumanView
              invoice={invoice}
              fields={fields}
              format={format}
              selection={selection}
              editing={editing}
              onSelect={selectField}
              edit={editContext}
              country={country}
            />
          </div>
        )}
        {showHuman && showJson && (
          <div
            {...splitSeparator}
            title="Drag to resize · double-click to reset · arrow keys to nudge"
            className={`group grid place-items-center bg-transparent transition-colors focus-visible:outline-none ${
              wideViewer ? "cursor-col-resize" : "cursor-row-resize"
            }`}
          >
            <span
              aria-hidden="true"
              className={`rounded-full bg-line transition-colors group-hover:bg-brand group-focus-visible:bg-brand group-active:bg-brand ${
                wideViewer ? "h-full w-px group-hover:w-0.5" : "h-px w-full group-hover:h-0.5"
              }`}
            />
          </div>
        )}
        {showJson && (
          <div
            id={`${panelId}-json`}
            role="tabpanel"
            aria-label="fiskaly JSON view"
            className="flex min-h-0 min-w-0 flex-col bg-canvas"
          >
            <div className="shrink-0 border-b border-line px-3 py-1.5">
              <p className="text-[11px] text-ink">
                <span className="font-mono font-semibold">{jsonLabel}</span> —{" "}
                {OPERATION_PRIMARY_NOTE}
              </p>
              <OperationCaveat invoice={invoice} />
              {jsonNote && <p className="mt-0.5 text-[11px] text-warning-ink">{jsonNote}</p>}
            </div>
            {jsonError && (
              <p
                role="alert"
                className="shrink-0 border-b border-line bg-error-soft px-3 py-1.5 font-mono text-[11px] text-error-ink"
              >
                {jsonError}
              </p>
            )}
            <div className="flex min-h-0 flex-1 flex-col p-1.5">
              <JsonView
                text={jsonText}
                label={`${jsonLabel} operation, editable`}
                range={jsonRange}
                scrollTo={selection?.source !== "json" && edit.source !== "json"}
                editable
                onPickOffset={selectPointer}
                onChange={onEditJson}
              />
            </div>
          </div>
        )}
        {showXml && (
          <div
            id={`${panelId}-xml`}
            role="tabpanel"
            aria-label="Predicted XML view"
            className="flex min-h-0 min-w-0 flex-col"
          >
            <p className="shrink-0 border-b border-line px-3 py-1.5 text-[11px] text-muted">
              {XML_PREDICTION_NOTE}
            </p>
            {xmlError && (
              <p
                role="alert"
                className="shrink-0 border-b border-line bg-error-soft px-3 py-1.5 font-mono text-[11px] text-error-ink"
              >
                {xmlError}
              </p>
            )}
            <div className="min-h-0 flex-1">
              <XmlView
                text={xmlText}
                label={`${format.label} XML, editable`}
                range={range}
                scrollTo={selection?.source !== "xml" && edit.source !== "xml"}
                editable
                onPickOffset={selectOffset}
                onChange={onEditXml}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
