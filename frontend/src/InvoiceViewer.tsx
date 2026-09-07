import { useCallback, useId, useMemo, useRef, useState } from "react";
import { FATE_LEGEND, FATE_TONE, fateEntry, fateLabel, formatFateNotices } from "./field-fate";
import type { FormatPlugin } from "./formats";
import { HumanView, type EditContext } from "./HumanView";
import { useIsWide } from "./use-media";
import { useGridSplit, type GridSplit } from "./use-split";
import { CoveragePanel } from "./CoveragePanel";
import { JsonView, type JsonAnnotation } from "./JsonView";
import type { FieldId, FormatId, Invoice } from "./model";
import { checkModel } from "./model-rules";
import { store, useStore } from "./store";
import { UAPI_DERIVED_PATHS } from "./uapi-map";
import {
  fieldForPointer,
  indexJson,
  insertAtPointer,
  lossyGroups,
  OPERATION_PRIMARY_NOTE,
  partialGroups,
  pointerAtOffset,
  pointerForField,
  pointerRange,
  type LossyGroup,
} from "./uapi-json";
import type { Finding, Severity } from "./validation";
import { fieldPresence } from "./field-presence";
import { PresenceStrip } from "./PresenceStrip";
import type { EditState, PaneId } from "./workflow";
import {
  buildFieldIndex,
  indexXml,
  pathAtOffset,
  rangeForPath,
  type FieldEntry,
} from "./xml-locate";
import { XmlView } from "./XmlView";

// The fiskaly JSON is the payload the step exists to explain, so it is always on screen; the
// two structures it is mapped against flank it and can each be folded away.
const TOGGLES: { id: PaneId; label: string }[] = [
  { id: "human", label: "Fields" },
  { id: "xml", label: "Predicted XML" },
];

const MIN_PANE = 14;

function Separator({ split, wide }: { split: GridSplit; wide: boolean }) {
  return (
    <div
      {...split.separatorProps}
      title="Drag to resize · double-click to reset · arrow keys to nudge"
      className={`group grid place-items-center bg-transparent transition-colors focus-visible:outline-none ${
        wide ? "cursor-col-resize" : "cursor-row-resize"
      }`}
    >
      <span
        aria-hidden="true"
        className={`rounded-full bg-line transition-colors group-hover:bg-brand group-focus-visible:bg-brand group-active:bg-brand ${
          wide ? "h-full w-px group-hover:w-0.5" : "h-px w-full group-hover:h-0.5"
        }`}
      />
    </div>
  );
}

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

const NO_MARKS: JsonAnnotation[] = [];

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
  const panes = useStore((state) => state.workflow.panes);
  const selection = useStore((state) => state.workflow.selection);
  const [editing, setEditing] = useState<FieldId | null>(null);
  const panelId = useId();

  const [showFates, setShowFates] = useState(true);
  const jsonScroll = useRef<HTMLDivElement>(null);

  const xmlIndex = useMemo(() => indexXml(xmlText), [xmlText]);
  const jsonIndex = useMemo(() => indexJson(jsonText), [jsonText]);
  const parsedOperation = useMemo<unknown>(() => {
    try {
      return JSON.parse(jsonText);
    } catch {
      return undefined;
    }
  }, [jsonText]);
  const insertFields = useCallback(
    (inserts: { pointer: string; value: unknown }[]): string | null => {
      let next = jsonText;
      const failures: string[] = [];
      for (const insert of inserts) {
        next = insertAtPointer(next, insert.pointer, insert.value, (reason) =>
          failures.push(reason),
        );
      }
      if (next !== jsonText) onEditJson(next);
      return failures.length > 0 ? `Not inserted: ${failures.join("; ")}` : null;
    },
    [jsonText, onEditJson],
  );
  const fateMarks = useMemo<JsonAnnotation[]>(() => {
    const marks: JsonAnnotation[] = [];
    for (const entry of jsonIndex.ranges) {
      if (jsonPrefix !== "" && !entry.pointer.startsWith(`${jsonPrefix}/`)) continue;
      const fate = fateEntry(format.id, entry.pointer.slice(jsonPrefix.length));
      if (!fate) continue;
      marks.push({
        from: entry.from,
        to: entry.to,
        kind: fate.fate,
        title: `${fateLabel(fate.fate)}${fate.element ? ` · ${fate.element}` : ""} — ${fate.note}`,
      });
    }
    return marks;
  }, [jsonIndex, jsonPrefix, format.id]);
  const fateNotices = formatFateNotices(format.id);
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

  const showHuman = panes.human;
  const showXml = panes.xml;
  const showJson = true;
  const wideViewer = useIsWide();
  const both = showHuman && showXml;
  const left = useGridSplit("mapper-left", wideViewer, "Resize the fields pane", 30, {
    max: both ? 100 - MIN_PANE * 2 : undefined,
  });
  const right = useGridSplit("mapper-right", wideViewer, "Resize the predicted XML pane", 70, {
    min: both ? left.ratio + MIN_PANE : undefined,
  });
  // Both separators measure the same container. Depend on the setters, which are stable, not on
  // the hook objects: those change identity whenever a ratio moves, and a ref callback that
  // changes identity every render re-runs on every render.
  const measureLeft = left.measure;
  const measureRight = right.measure;
  const measurePanes = useCallback(
    (node: HTMLElement | null) => {
      measureLeft(node);
      measureRight(node);
    },
    [measureLeft, measureRight],
  );
  const selectedField = selection?.field ?? null;
  const presence = useMemo(
    () =>
      selectedField
        ? fieldPresence(selectedField, { invoice, format, fields, jsonIndex, jsonPrefix })
        : null,
    [selectedField, invoice, format, fields, jsonIndex, jsonPrefix],
  );
  const columns = both
    ? `${left.ratio}% 6px ${right.ratio - left.ratio}% 6px ${100 - right.ratio}%`
    : showHuman
      ? `${left.ratio}% 6px ${100 - left.ratio}%`
      : showXml
        ? `${right.ratio}% 6px ${100 - right.ratio}%`
        : "minmax(0,1fr)";

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
          role="group"
          aria-label="Mapper panes"
          className="inline-flex items-center gap-0.5 rounded-m border border-line bg-canvas p-0.5"
        >
          <span className="rounded-m bg-surface px-2.5 py-1 text-xs font-medium text-ink shadow-s">
            fiskaly JSON
          </span>
          {TOGGLES.map((toggle) => (
            <button
              key={toggle.id}
              type="button"
              aria-pressed={panes[toggle.id]}
              aria-controls={panes[toggle.id] ? `${panelId}-${toggle.id}` : undefined}
              onClick={() =>
                store.dispatch({ type: "setPane", pane: toggle.id, show: !panes[toggle.id] })
              }
              className={`rounded-m px-2.5 py-1 text-xs font-medium ${
                panes[toggle.id] ? "bg-surface text-ink shadow-s" : "text-muted hover:text-ink"
              }`}
            >
              {toggle.label}
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

      <PresenceStrip field={selectedField} presence={presence ?? []} />

      <div
        ref={measurePanes}
        data-panes={[showHuman && "human", "json", showXml && "xml"].filter(Boolean).join("+")}
        style={{ "--panes": columns } as React.CSSProperties}
        className="grid min-h-0 flex-1 grid-rows-[var(--panes)] xl:grid-cols-[var(--panes)] xl:grid-rows-[minmax(0,100%)]"
      >
        {showHuman && (
          <div
            id={`${panelId}-human`}
            role="region"
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
        {showHuman && <Separator split={left} wide={wideViewer} />}
        {showJson && (
          <div
            id={`${panelId}-json`}
            role="region"
            aria-label="fiskaly JSON view"
            data-fate-marks={showFates ? fateMarks.length : 0}
            className="flex min-h-0 min-w-0 flex-col bg-canvas"
          >
            <div className="shrink-0 border-b border-line px-3 py-1.5">
              <p className="text-[11px] text-ink">
                <span className="font-mono font-semibold">{jsonLabel}</span> —{" "}
                {OPERATION_PRIMARY_NOTE}
              </p>
              {jsonNote && <p className="mt-0.5 text-[11px] text-warning-ink">{jsonNote}</p>}
              {fateMarks.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                  <span className="font-semibold">Field fates:</span>
                  {FATE_LEGEND.map((entry) => (
                    <span
                      key={entry.fate}
                      title={entry.title}
                      className={`underline decoration-dotted underline-offset-2 ${FATE_TONE[entry.fate]}`}
                    >
                      {entry.label}
                    </span>
                  ))}
                  <button
                    type="button"
                    aria-pressed={showFates}
                    onClick={() => setShowFates((current) => !current)}
                    className="rounded-m border border-line px-1.5 py-0.5 font-medium text-muted hover:border-brand hover:text-ink"
                  >
                    {showFates ? "Hide fate marks" : "Show fate marks"}
                  </button>
                </div>
              )}
            </div>
            {jsonError && (
              <p
                role="alert"
                className="shrink-0 border-b border-line bg-error-soft px-3 py-1.5 font-mono text-[11px] text-error-ink"
              >
                {jsonError}
              </p>
            )}
            {/* One scroller for the pane: the editor keeps the full height of the window and the
                caveats sit past the end of the payload, reached by scrolling through it. They
                also grow after first paint (a lazy import and a fetch), and anywhere above the
                editor that pushed the text out from under the pointer mid-drag. */}
            <div ref={jsonScroll} className="min-h-0 flex-1 overflow-y-auto">
              <JsonView
                text={jsonText}
                label={`${jsonLabel} operation, editable`}
                range={jsonRange}
                annotations={showFates ? fateMarks : NO_MARKS}
                scrollTo={selection?.source !== "json" && edit.source !== "json"}
                editable
                flow
                scrollHost={jsonScroll}
                onPickOffset={selectPointer}
                onChange={onEditJson}
              />
              <div className="border-t border-line px-3 py-1.5">
                <OperationCaveat invoice={invoice} />
                {parsedOperation !== undefined && (
                  <CoveragePanel
                    operation={parsedOperation}
                    country={country ?? invoice.seller.address.country}
                    formatId={format.id}
                    jsonPrefix={jsonPrefix}
                    onInsert={insertFields}
                  />
                )}
                {fateNotices.length > 0 && (
                  <div className="mt-1 rounded-m bg-warning-soft px-2 py-1.5 text-[11px] text-warning-ink">
                    {fateNotices.map((notice) => (
                      <p key={notice.id} data-fate-notice={notice.id} className="mt-1 first:mt-0">
                        {notice.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {showXml && <Separator split={right} wide={wideViewer} />}
        {showXml && (
          <div
            id={`${panelId}-xml`}
            role="region"
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
