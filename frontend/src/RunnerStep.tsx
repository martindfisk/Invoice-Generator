import { CopyButton } from "./ApiCallCard";
import type { StepCurl, StepResult, StepStatus } from "./runner";
import { pendingResult } from "./runner";
import type { CollectionStep } from "./uapi-client";

const STATUS: Record<StepStatus, { label: string; glyph: string; chip: string; mark: string }> = {
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
  skipped: {
    label: "Skipped",
    glyph: "—",
    chip: "border-dashed border-line text-muted",
    mark: "text-muted",
  },
};

const METHOD_TONE: Record<string, string> = {
  GET: "text-info",
  POST: "text-success",
  PATCH: "text-warning-ink",
  PUT: "text-warning-ink",
  DELETE: "text-error-ink",
};

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

const FINISHED: StepStatus[] = ["passed", "failed", "skipped"];

export function RunnerStepRow({
  index,
  step,
  result = pendingResult(),
  disabled,
  onRunFrom,
  curl,
}: {
  index: number;
  step: CollectionStep;
  result?: StepResult;
  disabled: boolean;
  onRunFrom: (index: number) => void;
  curl?: StepCurl;
}) {
  const status = STATUS[result.status];
  const method = step.method.toUpperCase();
  const path = result.path ?? step.path;
  const muted = !step.runnable;
  const capturedEntries = Object.entries(result.captured);
  const showCurl = step.runnable && curl !== undefined && FINISHED.includes(result.status);
  return (
    <li
      data-runner-step={step.id}
      data-status={result.status}
      data-runnable={step.runnable}
      className={`group relative py-2 pr-3 pl-10 ${muted ? "opacity-60" : ""}`}
    >
      <span
        aria-hidden="true"
        className="absolute top-0 bottom-0 left-[1.15rem] w-px bg-line group-first:top-3 group-last:bottom-auto group-last:h-3 group-only:hidden"
      />
      <span
        aria-hidden="true"
        className={`absolute top-3.5 left-2.5 grid h-4 w-4 place-items-center rounded-full border-2 border-canvas bg-surface font-mono text-[10px] leading-none ${status.mark}`}
      >
        {status.glyph}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-ink">{step.name}</span>
        <span
          className={`rounded-m border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${status.chip}`}
        >
          {status.label}
        </span>
        {result.durationMs !== undefined && (
          <span className="font-mono text-[10px] text-muted tabular-nums">
            {result.durationMs} ms
          </span>
        )}
        {result.polls > 0 && (
          <span className="font-mono text-[10px] text-muted">{result.polls + 1} polls</span>
        )}
        {(step.runnable || showCurl) && (
          <span className="ml-auto flex items-center gap-1.5">
            {showCurl &&
              (curl.curl !== null ? (
                <CopyButton text={curl.curl} label="Copy as cURL" />
              ) : (
                <CopyButton text="" label="Copy as cURL" disabledReason={curl.reason} />
              ))}
            {step.runnable && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRunFrom(index)}
                className="rounded-m border border-line px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-brand hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Run from here
              </button>
            )}
          </span>
        )}
      </div>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <span className={`font-mono font-semibold ${METHOD_TONE[method] ?? "text-muted"}`}>
          {method}
        </span>
        <span data-resolved-path="" className="font-mono break-all text-muted">
          {path}
        </span>
        <span className="text-[10px] text-muted italic">{step.folder}</span>
      </p>
      {!step.runnable && step.skipReason && (
        <p className="mt-1 text-[11px] text-muted italic">{step.skipReason}</p>
      )}
      {result.skipReason && step.runnable && (
        <p className="mt-1 text-[11px] text-muted italic">{result.skipReason}</p>
      )}
      {result.error && (
        <p className="mt-1 rounded-m bg-error-soft px-2 py-1 font-mono text-[11px] break-all text-error-ink">
          {result.error}
        </p>
      )}
      {result.assertions.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {result.assertions.map((assertion) => (
            <li
              key={assertion.pointer}
              className={`font-mono text-[10px] ${assertion.ok ? "text-success" : "text-error-ink"}`}
            >
              {assertion.ok ? "✓" : "✕"} {assertion.pointer}
              {assertion.ok
                ? ` = ${assertion.expected}`
                : ` — expected ${assertion.expected}, got ${assertion.actual}`}
            </li>
          ))}
        </ul>
      )}
      {capturedEntries.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {capturedEntries.map(([name, value]) => (
            <li
              key={name}
              data-captured={name}
              className="rounded-m bg-select-bg px-1.5 py-0.5 font-mono text-[10px] text-ink"
            >
              {name} = {valueText(value)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
