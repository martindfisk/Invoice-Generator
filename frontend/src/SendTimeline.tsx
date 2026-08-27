import { useEffect, useRef, useState } from "react";
import { store } from "./store";
import type { RecordLog } from "./uapi-client";
import type { SendNode, SendNodeStatus, SendState } from "./workflow";

const STATUS: Record<SendNodeStatus, { label: string; glyph: string; mark: string; chip: string }> =
  {
    pending: { label: "Waiting", glyph: "○", mark: "text-muted", chip: "border-line text-muted" },
    active: { label: "Running", glyph: "◍", mark: "text-brand", chip: "border-brand text-ink" },
    done: {
      label: "Done",
      glyph: "✓",
      mark: "text-success",
      chip: "border-success text-success",
    },
    failed: {
      label: "Failed",
      glyph: "✕",
      mark: "text-error",
      chip: "border-error bg-error-soft text-error-ink",
    },
    skipped: {
      label: "Skipped",
      glyph: "—",
      mark: "text-muted",
      chip: "border-dashed border-line text-muted",
    },
  };

const LOG_TONE: Record<string, string> = {
  ERROR: "bg-error-soft text-error-ink",
  FATAL: "bg-error-soft text-error-ink",
  WARNING: "bg-warning-soft text-warning-ink",
  WARN: "bg-warning-soft text-warning-ink",
  INFO: "bg-info-soft text-info",
};

function elapsed(node: SendNode, now: number): string | undefined {
  if (node.startedAt === undefined) return undefined;
  const end = node.endedAt ?? (node.status === "active" ? now : undefined);
  if (end === undefined) return undefined;
  const ms = Math.max(0, end - node.startedAt);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function LogRow({ log }: { log: RecordLog }) {
  const severity = (log.severity ?? "INFO").toUpperCase();
  return (
    <li
      className={`flex flex-wrap items-baseline gap-2 rounded-m px-2 py-1 ${LOG_TONE[severity] ?? "text-muted"}`}
    >
      <span className="font-mono text-[10px] font-semibold tracking-wide uppercase">
        {severity}
      </span>
      {log.code && <span className="font-mono text-[10px]">{log.code}</span>}
      <span className="min-w-0 flex-1 text-[11px]">{log.message ?? JSON.stringify(log)}</span>
    </li>
  );
}

function Node({ node, now, focused }: { node: SendNode; now: number; focused: boolean }) {
  const status = STATUS[node.status];
  const time = elapsed(node, now);
  return (
    <li
      data-stage={node.stage}
      data-status={node.status}
      className={`border-b border-line px-3 py-2 last:border-b-0 ${focused ? "bg-select-bg" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true" className={`font-mono text-[11px] ${status.mark}`}>
          {status.glyph}
        </span>
        <span className="text-xs font-medium text-ink">{node.label}</span>
        <span
          className={`rounded-m border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${status.chip}`}
        >
          {status.label}
        </span>
        {node.state && (
          <span className="rounded-m border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
            state {node.state}
          </span>
        )}
        {node.mode && (
          <span className="rounded-m border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
            mode {node.mode}
          </span>
        )}
        {time && (
          <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">{time}</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted">{node.call}</span>
        {node.recordId && (
          <button
            type="button"
            title="Show the calls for this record in the API log"
            onClick={() => store.focusRecord(node.recordId!)}
            className="rounded-m border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-brand hover:text-ink"
          >
            {node.recordId}
          </button>
        )}
      </div>
      {node.note && <p className="mt-1 text-[11px] text-muted">{node.note}</p>}
      {node.logs.length > 0 && (
        <ul aria-label={`${node.label} log`} className="mt-1.5 flex flex-col gap-1">
          {node.logs.map((log, index) => (
            <LogRow key={`${node.stage}-${index}`} log={log} />
          ))}
        </ul>
      )}
    </li>
  );
}

export type SendTimelineProps = {
  send: SendState;
  focusedRecordId?: string | null;
};

export function SendTimeline({ send, focusedRecordId }: SendTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const list = useRef<HTMLOListElement>(null);
  const running =
    send.phase === "creating" || send.phase === "polling" || send.phase === "artifacts";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const nodes = [...element.querySelectorAll("li[data-stage]")].reverse();
    const target = nodes.find((entry) => entry.getAttribute("data-status") !== "pending");
    target?.scrollIntoView?.({ block: "nearest" });
  }, [send.polls, send.phase, send.outcome]);

  return (
    <section
      aria-label="Transmission lifecycle"
      className="flex shrink-0 flex-col overflow-hidden rounded-l border border-line bg-surface shadow-s"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="text-[11px] font-bold tracking-wide text-muted uppercase">Lifecycle</h3>
        {send.polls > 0 && (
          <span className="font-mono text-[10px] text-muted">
            polled {send.polls}×{send.transport === "backend" ? " via /api/invoices/…/wait" : ""}
          </span>
        )}
      </header>
      <ol ref={list}>
        {send.nodes.map((node) => (
          <Node
            key={node.stage}
            node={node}
            now={now}
            focused={Boolean(focusedRecordId && node.recordId === focusedRecordId)}
          />
        ))}
      </ol>
    </section>
  );
}
