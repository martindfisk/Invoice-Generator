import { memo, useState, type ReactNode } from "react";
import {
  headerEntries,
  otherHeaders,
  pathOf,
  PROMINENT_HEADERS,
  stepLabel,
  type ApiCall,
  type CallGroup,
} from "./api-log";
import { JsonView } from "./JsonView";
import { store } from "./store";
import { stepForCall } from "./workflow";

type Tab = "request" | "response" | "curl";

const TABS: { id: Tab; label: string }[] = [
  { id: "request", label: "Request" },
  { id: "response", label: "Response" },
  { id: "curl", label: "cURL" },
];

function statusTone(call: ApiCall): string {
  if (call.error || !call.response) return "border-fatal text-fatal";
  const { status } = call.response;
  if (status >= 500) return "border-error bg-error-soft text-error-ink";
  if (status >= 400) return "border-warning bg-warning-soft text-warning-ink";
  if (status >= 300) return "border-line text-muted";
  return "border-success text-success";
}

function methodTone(method: string): string {
  return method.toUpperCase() === "GET" ? "text-info" : "text-brand";
}

function Chip({
  children,
  title,
  onClick,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
  className?: string;
}) {
  const shared = `rounded-m border border-line px-1.5 py-0.5 font-mono text-[10px] ${className}`;
  if (!onClick) {
    return (
      <span title={title} className={shared}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${shared} hover:border-brand hover:text-ink`}
    >
      {children}
    </button>
  );
}

export function CopyButton({
  text,
  label,
  disabledReason,
}: {
  text: string;
  label: string;
  disabledReason?: string;
}) {
  const [done, setDone] = useState(false);
  if (disabledReason) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        aria-label={`${label} — ${disabledReason}`}
        className="cursor-not-allowed rounded-m border border-line px-2 py-0.5 text-[10px] font-medium text-muted opacity-60"
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => undefined,
        );
      }}
      className="rounded-m border border-line px-2 py-0.5 text-[10px] font-medium text-muted hover:border-brand hover:text-ink"
    >
      {done ? "Copied" : label}
    </button>
  );
}

function Headers({ call }: { call: ApiCall }) {
  const request = headerEntries(call.request.headers, PROMINENT_HEADERS);
  const response = headerEntries(call.response?.headers, PROMINENT_HEADERS);
  const rest = [
    ...otherHeaders(call.request.headers, PROMINENT_HEADERS),
    ...otherHeaders(call.response?.headers, PROMINENT_HEADERS),
  ];
  const seen = new Set(request.map(([name, value]) => `${name}=${value}`));
  const shown = [...request, ...response.filter(([name, value]) => !seen.has(`${name}=${value}`))];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {shown.map(([name, value]) => (
          <span
            key={`${name}-${value}`}
            className="rounded-m border border-brand bg-select-bg px-1.5 py-0.5 font-mono text-[10px] text-ink"
          >
            <span className="text-muted">{name}</span> {value}
          </span>
        ))}
        {shown.length === 0 && <span className="text-[10px] text-muted">No fiskaly headers</span>}
      </div>
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[10px] text-muted">
            {rest.length} other header{rest.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {rest.map(([name, value]) => (
              <li key={`${name}-${value}`} className="font-mono text-[10px] break-all text-muted">
                <span className="text-ink">{name}</span>: {value}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function bodyText(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch (error) {
    return `not JSON-serialisable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function Body({ call, tab }: { call: ApiCall; tab: Tab }) {
  if (tab === "curl") {
    return (
      <pre className="overflow-x-auto rounded-m border border-line bg-canvas p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap">
        {call.curl}
      </pre>
    );
  }
  if (tab === "request") {
    return call.request.body === undefined || call.request.body === null ? (
      <p className="text-[11px] text-muted">No request body.</p>
    ) : (
      <JsonView text={bodyText(call.request.body)} label="Request body" maxHeight={280} />
    );
  }
  if (!call.response) {
    return <p className="text-[11px] text-error-ink">{call.error ?? "No response."}</p>;
  }
  return <JsonView text={bodyText(call.response.body)} label="Response body" maxHeight={280} />;
}

export type ApiCallCardProps = {
  group: CallGroup;
  open: boolean;
  focused: boolean;
  onToggle: () => void;
};

function ApiCallCardImpl({ group, open, focused, onToggle }: ApiCallCardProps) {
  const [tab, setTab] = useState<Tab>("response");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const call = group.calls.find((entry) => entry.id === selectedId) ?? group.latest;
  const step = stepForCall(call);
  const time = new Date(call.ts).toLocaleTimeString();
  const responseText = call.response ? JSON.stringify(call.response.body, null, 2) : "";

  return (
    <div
      data-group={group.key}
      data-record={call.record_id ?? undefined}
      className={`rounded-l border bg-surface-raised text-xs shadow-s ${
        focused ? "border-brand ring-2 ring-brand" : "border-line"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="block w-full cursor-pointer px-3 pt-2 pb-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={`w-11 shrink-0 font-mono font-semibold ${methodTone(call.method)}`}>
            {call.method}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono" title={call.url}>
            {pathOf(call.url)}
          </span>
          {group.repeats > 1 && (
            <span className="shrink-0 rounded-m border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
              polled {group.repeats}×
            </span>
          )}
          <span
            className={`shrink-0 rounded-m border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${statusTone(call)}`}
          >
            {call.response?.status ?? "ERR"}
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-[10px] text-muted tabular-nums">
            {Math.round(call.duration_ms)} ms
          </span>
        </span>
      </button>
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        <Chip
          title={step ? `Open the ${step} step` : undefined}
          onClick={step ? () => store.dispatch({ type: "goToStep", step }) : undefined}
        >
          {stepLabel(call)}
        </Chip>
        <Chip className={call.mode === "LIVE" ? "border-brand text-brand" : "text-warning-ink"}>
          {call.mode}
        </Chip>
        {call.record_id && (
          <Chip title="Record id" className="max-w-[16rem] truncate">
            {call.record_id}
          </Chip>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted">{time}</span>
      </div>

      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          {call.error && <p className="text-[11px] font-medium text-error-ink">{call.error}</p>}
          {group.repeats > 1 && (
            <ul aria-label="Polls" className="flex flex-wrap gap-1">
              {[...group.calls].reverse().map((entry, index) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-pressed={entry.id === call.id}
                    onClick={() => setSelectedId(entry.id)}
                    className={`rounded-m border px-1.5 py-0.5 font-mono text-[10px] ${
                      entry.id === call.id
                        ? "border-brand bg-select-bg text-ink"
                        : "border-line text-muted hover:border-brand"
                    }`}
                  >
                    #{index + 1} · {entry.response?.status ?? "ERR"} ·{" "}
                    {new Date(entry.ts).toLocaleTimeString()}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Headers call={call} />
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="tablist"
              aria-label="Call detail"
              className="inline-flex gap-0.5 rounded-m border border-line bg-canvas p-0.5"
            >
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  onClick={() => setTab(entry.id)}
                  className={`rounded-m px-2 py-0.5 text-[10px] font-medium ${
                    tab === entry.id ? "bg-surface text-ink shadow-s" : "text-muted hover:text-ink"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <span className="ml-auto flex gap-1.5">
              <CopyButton text={call.curl} label="Copy as cURL" />
              {responseText !== "" && <CopyButton text={responseText} label="Copy response" />}
            </span>
          </div>
          <Body call={call} tab={tab} />
        </div>
      )}
    </div>
  );
}

// The log can hold up to 1000 cards and every SSE event re-renders the pane; a card only needs
// to re-render when its own group gained a call or its open/focused state flipped. onToggle is
// deliberately not compared: its closure reads the same open/focused inputs the props carry, so
// any change that would alter its behaviour also changes a compared prop.
export const ApiCallCard = memo(
  ApiCallCardImpl,
  (prev, next) =>
    prev.group.key === next.group.key &&
    prev.group.latest === next.group.latest &&
    prev.group.repeats === next.group.repeats &&
    prev.open === next.open &&
    prev.focused === next.focused,
);
