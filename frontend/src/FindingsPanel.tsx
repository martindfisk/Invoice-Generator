import { useId, useRef, useState, type KeyboardEvent } from "react";
import { MappingBadges } from "./Field";
import type { FieldId } from "./model";
import {
  countBySeverity,
  type Finding,
  type FindingSource,
  type Severity,
  type StageResult,
} from "./validation";

const SEVERITIES: Severity[] = ["fatal", "error", "warning", "info"];

const SEVERITY: Record<Severity, { glyph: string; label: string; mark: string; badge: string }> = {
  fatal: { glyph: "■", label: "Fatal", mark: "text-fatal", badge: "bg-fatal text-white" },
  error: {
    glyph: "●",
    label: "Error",
    mark: "text-error",
    badge: "border border-error bg-error-soft text-error-ink",
  },
  warning: {
    glyph: "▲",
    label: "Warning",
    mark: "text-warning",
    badge: "border border-warning bg-warning-soft text-warning-ink",
  },
  info: {
    glyph: "○",
    label: "Info",
    mark: "text-info",
    badge: "border border-info bg-info-soft text-info",
  },
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((held) => held !== value) : [...list, value];
}

const CHIP = "rounded-m border px-1.5 py-0.5 text-[11px] whitespace-nowrap";
const CHIP_OFF = "border-line bg-surface text-muted hover:text-ink";
const CHIP_ON = "border-brand bg-select-bg text-ink";

export type FindingRow = {
  key: string;
  finding: Finding;
  field?: FieldId;
  path?: string;
  pointer?: string;
  line?: number;
};

export type FindingsPanelProps = {
  stages: StageResult[];
  rows: FindingRow[];
  running: boolean;
  selectedKey: string | null;
  matchedField?: FieldId;
  onSelect: (row: FindingRow) => void;
  onEscape: () => void;
};

function Chip({
  on,
  label,
  count,
  mono,
  onToggle,
}: {
  on: boolean;
  label: string;
  count: number;
  mono?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF} ${mono ? "font-mono" : ""}`}
    >
      {label} <span className="font-mono font-semibold">{count}</span>
    </button>
  );
}

function Location({ path, line }: { path?: string; line?: number }) {
  const suffix = line === undefined ? "" : ` · line ${line}`;
  if (!path) {
    return line === undefined ? null : (
      <span className="mt-0.5 block font-mono text-[10px] text-muted">line {line}</span>
    );
  }
  const cut = path.lastIndexOf("/");
  return (
    <span
      title={`${path}${suffix}`}
      className="mt-0.5 flex min-w-0 font-mono text-[10px] text-muted"
    >
      <span aria-hidden="true" className="shrink-0">
        →&nbsp;
      </span>
      <span className="truncate">{path.slice(0, cut + 1)}</span>
      <span className="shrink-0">
        {path.slice(cut + 1)}
        {suffix}
      </span>
    </span>
  );
}

function FindingOption({
  row,
  id,
  selected,
  matched,
  active,
  onSelect,
  ref,
}: {
  row: FindingRow;
  id: string;
  selected: boolean;
  matched: boolean;
  active: boolean;
  onSelect: () => void;
  ref: React.Ref<HTMLButtonElement>;
}) {
  const { finding } = row;
  const severity = SEVERITY[finding.severity];
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      id={id}
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      data-rule={finding.ruleId}
      data-severity={finding.severity}
      onClick={onSelect}
      className={`grid w-full grid-cols-[14px_minmax(0,1fr)] gap-x-2.5 border-b border-line px-3 py-2 text-left ${
        selected
          ? "bg-select-bg shadow-[inset_3px_0_0_var(--fsk-brand)]"
          : matched
            ? "bg-surface-raised"
            : "hover:bg-surface-raised"
      }`}
    >
      <span aria-hidden="true" className={`row-span-3 mt-0.5 text-[11px] ${severity.mark}`}>
        {severity.glyph}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-m px-1 text-[10px] font-bold tracking-wide uppercase ${severity.badge}`}
        >
          {severity.label}
        </span>
        <span className="font-mono text-[11px] text-muted">{finding.ruleId}</span>
        <MappingBadges
          entry={{ field: row.field ?? "", rows: [], bt: finding.bt, fpa: finding.fpa }}
        />
        <span className="font-mono text-[10px] text-muted">{finding.source}</span>
      </span>
      <span className="mt-0.5 line-clamp-3 text-xs text-ink" title={finding.message}>
        {finding.message}
      </span>
      <Location path={row.pointer ?? row.path} line={row.line} />
    </button>
  );
}

export function FindingsPanel({
  stages,
  rows,
  running,
  selectedKey,
  matchedField,
  onSelect,
  onEscape,
}: FindingsPanelProps) {
  const listId = useId();
  const [mutedSeverities, setMutedSeverities] = useState<Severity[]>([]);
  const [mutedStages, setMutedStages] = useState<FindingSource[]>([]);
  const [active, setActive] = useState(0);
  const options = useRef<(HTMLButtonElement | null)[]>([]);

  const counts = countBySeverity(rows.map((row) => row.finding));
  const stageCounts = stages
    .map((stage) => ({
      id: stage.id,
      count: rows.filter((row) => row.finding.source === stage.id).length,
    }))
    .filter((stage) => stage.count > 0);

  const visible = rows.filter(
    (row) =>
      !mutedSeverities.includes(row.finding.severity) && !mutedStages.includes(row.finding.source),
  );
  const position = Math.min(active, Math.max(visible.length - 1, 0));

  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(visible.length - 1, next));
    setActive(clamped);
    options.current[clamped]?.focus();
    const row = visible[clamped];
    if (row) onSelect(row);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onEscape();
      return;
    }
    const steps: Record<string, number> = {
      ArrowDown: position + 1,
      ArrowUp: position - 1,
      Home: 0,
      End: visible.length - 1,
    };
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    move(next);
  };

  const started = stages.some((stage) => stage.status !== "pending");
  const ran = stages.filter(
    (stage) => stage.status === "passed" || stage.status === "failed",
  ).length;
  const notRun = stages.filter((stage) => stage.status === "unavailable").length;

  const empty = (): string | null => {
    if (visible.length > 0) return null;
    if (!started && !running) return "No validation has run on this invoice yet.";
    if (rows.length === 0 && running) return "Validating — no findings so far.";
    if (rows.length > 0) return `All ${rows.length} findings are hidden by the filters.`;
    const clean = `No findings from the ${ran} stage${ran === 1 ? "" : "s"} that ran.`;
    return notRun === 0
      ? clean
      : `${clean} ${notRun} stage${notRun === 1 ? "" : "s"} could not run, so this is not a clean bill of health.`;
  };

  const message = empty();
  const activeRow = visible[position];

  return (
    <section
      aria-label="Findings"
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-col overflow-hidden rounded-l border border-line bg-surface shadow-s"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <h3 className="text-[11px] font-bold tracking-wide text-muted uppercase">Findings</h3>
        <span className="rounded-m border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {rows.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {stageCounts.map((stage) => (
            <Chip
              key={stage.id}
              mono
              on={!mutedStages.includes(stage.id)}
              label={stage.id}
              count={stage.count}
              onToggle={() => setMutedStages(toggle(mutedStages, stage.id))}
            />
          ))}
          {SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
            <Chip
              key={severity}
              on={!mutedSeverities.includes(severity)}
              label={SEVERITY[severity].label}
              count={counts[severity]}
              onToggle={() => setMutedSeverities(toggle(mutedSeverities, severity))}
            />
          ))}
        </div>
      </div>

      {message && (
        <p role="status" className="px-3 py-3 text-xs text-muted">
          {message}
        </p>
      )}

      <div
        role="listbox"
        aria-label="Validation findings"
        aria-activedescendant={activeRow ? `${listId}-${activeRow.key}` : undefined}
        className="min-h-0 flex-1 overflow-auto"
      >
        {visible.map((row, index) => (
          <FindingOption
            key={row.key}
            row={row}
            id={`${listId}-${row.key}`}
            selected={row.key === selectedKey}
            matched={
              row.key !== selectedKey && matchedField !== undefined && row.field === matchedField
            }
            active={index === position}
            ref={(node) => {
              options.current[index] = node;
            }}
            onSelect={() => {
              setActive(index);
              onSelect(row);
            }}
          />
        ))}
      </div>
    </section>
  );
}
