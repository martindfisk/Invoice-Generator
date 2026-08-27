import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import catalogRaw from "./bt-catalog.json?raw";
import type { Finding, Severity } from "./validation";
import type { FieldEntry } from "./xml-locate";
import { elementName } from "./xml-writer";

type CatalogEntry = {
  id: string;
  group: string;
  name: string;
  description: string;
  cardinality: string;
  datatype: string;
};

const CATALOG = new Map<string, CatalogEntry>(
  (JSON.parse(catalogRaw) as CatalogEntry[]).map((entry) => [entry.id, entry]),
);

const TAIL = 8;

const SEVERITY: Record<Severity, { glyph: string; note: string; rail: string }> = {
  fatal: { glyph: "■", note: "bg-fatal-soft text-error-ink", rail: "border-l-fatal" },
  error: { glyph: "●", note: "bg-error-soft text-error-ink", rail: "border-l-error" },
  warning: { glyph: "▲", note: "bg-warning-soft text-warning-ink", rail: "border-l-warning" },
  info: { glyph: "○", note: "bg-info-soft text-info", rail: "border-l-info" },
};

function btTooltip(bt: string, path: string | undefined): string {
  const catalogId = /^(BT-\d+)/.exec(bt)?.[1] ?? bt;
  const known = CATALOG.get(catalogId);
  const head = known ? `${bt} ${known.name} — ${known.description}` : `${bt} (EN 16931)`;
  return path ? `${head} · ${path}` : head;
}

function fpaTooltip(fpa: string, entry: FieldEntry): string {
  const element = entry.path ? elementName(entry.path) : "";
  const name = element ? `${fpa} ${element}` : fpa;
  return entry.label ? `${name} — ${entry.label}` : name;
}

function Badge({
  id,
  title,
  kind,
  children,
}: {
  id?: string;
  title: string;
  kind: "bt" | "fpa";
  children: string;
}) {
  const style =
    kind === "bt" ? "border-brand text-brand" : "border-transparent bg-surface-raised text-muted";
  return (
    <span
      id={id}
      title={title}
      className={`cursor-help rounded-m border px-1 font-mono text-[10px] leading-5 font-normal whitespace-nowrap ${style}`}
    >
      {children}
    </span>
  );
}

export function MappingBadges({
  entry,
  baseId,
  uapi = false,
}: {
  entry: FieldEntry;
  baseId?: string;
  uapi?: boolean;
}) {
  if (!entry.bt && !entry.fpa) {
    return uapi ? (
      <Badge
        id={baseId && `${baseId}-uapi`}
        kind="fpa"
        title="Carried by the fiskaly Unified API envelope, not by an element of this XML"
      >
        UAPI
      </Badge>
    ) : null;
  }
  return (
    <>
      {entry.bt && (
        <Badge id={baseId && `${baseId}-bt`} kind="bt" title={btTooltip(entry.bt, entry.path)}>
          {entry.bt}
        </Badge>
      )}
      {entry.fpa && (
        <Badge id={baseId && `${baseId}-fpa`} kind="fpa" title={fpaTooltip(entry.fpa, entry)}>
          {entry.fpa}
        </Badge>
      )}
    </>
  );
}

export function SeverityGlyph({ finding }: { finding: Finding }) {
  const severity = SEVERITY[finding.severity];
  return (
    <span aria-hidden="true" className={`mr-1 rounded-m px-1 ${severity.note}`}>
      {severity.glyph}
    </span>
  );
}

export function FindingNote({ finding, id }: { finding: Finding; id?: string }) {
  const severity = SEVERITY[finding.severity];
  return (
    <span
      id={id}
      className={`block rounded-m px-1.5 py-0.5 text-[11px] ${severity.note}`}
      title={`${finding.ruleId} · ${finding.severity}`}
    >
      <span aria-hidden="true">{severity.glyph} </span>
      <span className="font-mono">{finding.ruleId}</span> {finding.message}
    </span>
  );
}

export type InlineInputProps = {
  initial: string;
  label: string;
  mono?: boolean;
  align?: "right";
  onCommit: (value: string) => void;
  onCancel: () => void;
};

export function InlineInput({ initial, label, mono, align, onCommit, onCancel }: InlineInputProps) {
  const [draft, setDraft] = useState(initial);
  const settled = useRef(false);
  const own = useRef<HTMLInputElement>(null);

  useEffect(() => {
    own.current?.focus();
    own.current?.select();
  }, []);

  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(draft);
    else onCancel();
  };

  return (
    <input
      ref={own}
      type="text"
      value={draft}
      aria-label={label}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          settle(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(false);
        }
      }}
      className={`w-full min-w-0 rounded-m border-2 border-brand bg-surface px-1 py-0.5 text-[13px] text-ink outline-none ${
        mono ? "font-mono tabular-nums" : ""
      } ${align === "right" ? "text-right" : ""}`}
    />
  );
}

export type FieldProps = {
  entry: FieldEntry;
  label: string;
  value: string;
  mono?: boolean;
  truncate?: "mid";
  uapi?: boolean;
  caveat?: string;
  caveatHint?: string;
  selected: boolean;
  scrollIntoView?: boolean;
  tabIndex: number;
  editable?: string;
  editing?: boolean;
  finding?: Finding;
  onSelect: (entry: FieldEntry) => void;
  onEdit?: () => void;
  onCommit?: (value: string) => void;
  onCancelEdit?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus?: () => void;
  ref?: React.Ref<HTMLButtonElement>;
};

export function Field({
  entry,
  label,
  value,
  mono = false,
  truncate,
  uapi = false,
  caveat,
  caveatHint,
  selected,
  scrollIntoView = false,
  tabIndex,
  editable,
  editing = false,
  finding,
  onSelect,
  onEdit,
  onCommit,
  onCancelEdit,
  onKeyDown,
  onFocus,
  ref,
}: FieldProps) {
  const baseId = useId();
  const own = useRef<HTMLButtonElement>(null);
  const badgeIds: string[] = [];
  if (entry.bt) badgeIds.push(`${baseId}-bt`);
  if (entry.fpa) badgeIds.push(`${baseId}-fpa`);
  if (badgeIds.length === 0 && uapi) badgeIds.push(`${baseId}-uapi`);
  if (caveat) badgeIds.push(`${baseId}-caveat`);
  if (finding) badgeIds.push(`${baseId}-finding`);
  const empty = value === "";

  useEffect(() => {
    if (!selected || !scrollIntoView) return;
    own.current?.scrollIntoView?.({
      block: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selected, scrollIntoView]);

  const shell =
    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5 rounded-m border-2 px-2 py-1.5 text-left";
  const state = selected
    ? "border-brand bg-select-bg"
    : "border-transparent hover:bg-surface-raised";
  const rail = finding ? `border-l-[3px] ${SEVERITY[finding.severity].rail}` : "";
  const dim = caveat && !selected ? "opacity-70" : "";

  const head = (
    <span
      className={`col-start-1 text-[11px] ${selected ? "font-semibold text-ink" : "text-muted"}`}
    >
      {label}
    </span>
  );
  const badges = (
    <span className="col-start-2 row-span-2 row-start-1 flex items-center gap-1">
      <MappingBadges entry={entry} baseId={baseId} uapi={uapi} />
      {caveat && (
        <span
          id={`${baseId}-caveat`}
          title={caveatHint ?? caveat}
          className="cursor-help rounded-m border border-dashed border-line px-1 text-[10px] leading-5 font-normal whitespace-nowrap text-muted"
        >
          {caveat}
        </span>
      )}
    </span>
  );
  const note = finding && (
    <span className="col-span-2 col-start-1">
      <FindingNote finding={finding} id={`${baseId}-finding`} />
    </span>
  );

  if (editing && editable !== undefined) {
    return (
      <div
        data-field={entry.field}
        className={`${shell} ${state} ${rail}`}
        data-uncarried={caveat && "true"}
      >
        {head}
        <span className="col-start-1 min-w-0">
          <InlineInput
            initial={editable}
            label={label}
            mono={mono}
            onCommit={(next) => onCommit?.(next)}
            onCancel={() => onCancelEdit?.()}
          />
        </span>
        {badges}
        {note}
      </div>
    );
  }

  return (
    <button
      type="button"
      ref={(node) => {
        own.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      data-field={entry.field}
      data-uncarried={caveat && "true"}
      aria-pressed={selected}
      aria-describedby={badgeIds.length > 0 ? badgeIds.join(" ") : undefined}
      tabIndex={tabIndex}
      onClick={() => {
        onSelect(entry);
        if (editable !== undefined) onEdit?.();
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={`${shell} ${state} ${rail} ${dim}`}
    >
      {head}
      <span
        title={empty ? undefined : value}
        className={`col-start-1 min-w-0 text-[13px] ${empty ? "text-muted" : "text-ink"} ${
          mono && !empty ? "font-mono tabular-nums" : ""
        } ${truncate === "mid" && !empty ? "flex" : mono ? "truncate" : "line-clamp-3"}`}
      >
        {empty ? (
          <span aria-label="not set">—</span>
        ) : truncate === "mid" ? (
          <>
            <span className="truncate">{value.slice(0, -TAIL)}</span>
            <span className="shrink-0">{value.slice(-TAIL)}</span>
          </>
        ) : (
          value
        )}
      </span>
      {badges}
      {note}
    </button>
  );
}
