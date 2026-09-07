import { useEffect, useMemo, useRef, useState } from "react";
import { groupCalls, statusMarker, stepLabel, type Persona } from "./api-log";
import { ApiCallCard } from "./ApiCallCard";
import { store, useStore } from "./store";

const PERSONAS: Persona[] = ["seller", "buyer"];

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-m border px-1.5 py-0.5 font-mono text-[10px] ${
        active ? "border-brand bg-select-bg text-ink" : "border-line text-muted hover:border-brand"
      }`}
    >
      {label}
    </button>
  );
}

export function ApiLogPane() {
  const calls = useStore((state) => state.calls);
  const focus = useStore((state) => state.focus);
  const eventsDown = useStore((state) => state.eventsDown);
  const [steps, setSteps] = useState<string[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLOListElement>(null);
  const handled = useRef(0);

  const knownSteps = useMemo(() => [...new Set(calls.map(stepLabel))].sort(), [calls]);
  // The flow always sends as the seller; a buyer chip only means something when buyer calls
  // exist (the runner ran as the buyer), so the chips are derived from the log, not hardcoded.
  const knownPersonas = useMemo(
    () => PERSONAS.filter((persona) => calls.some((call) => call.persona === persona)),
    [calls],
  );

  const filtered = useMemo(
    () =>
      calls.filter(
        (call) =>
          (steps.length === 0 || steps.includes(stepLabel(call))) &&
          (personas.length === 0 || personas.includes(call.persona)),
      ),
    [calls, steps, personas],
  );

  const groups = useMemo(() => groupCalls(filtered), [filtered]);
  // Read as a sequence: earliest call at the top, newest arriving at the bottom.
  const ordered = useMemo(() => [...groups].reverse(), [groups]);

  const focusedKey = useMemo(() => {
    if (!focus) return null;
    // Search in display order, so a lifecycle node jumps to where its record first appears
    // rather than to the last poll of it.
    const group = ordered.find((entry) =>
      entry.calls.some((call) => call.record_id === focus.recordId),
    );
    return group?.key ?? null;
  }, [focus, ordered]);

  // New calls now arrive at the bottom. Follow them only when the reader is already there, so
  // expanding an older call does not get yanked away mid-read.
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance < 120) node.scrollTop = node.scrollHeight;
  }, [ordered.length]);

  useEffect(() => {
    if (!focus || focusedKey === null || focus.nonce === handled.current) return;
    handled.current = focus.nonce;
    const card = list.current?.querySelector(`[data-group="${focusedKey}"]`);
    card?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focus, focusedKey]);

  const isOpen = (key: string) => open[key] ?? key === focusedKey;

  const toggle = (step: string) =>
    setSteps((current) =>
      current.includes(step) ? current.filter((entry) => entry !== step) : [...current, step],
    );

  const togglePersona = (persona: Persona) =>
    setPersonas((current) =>
      current.includes(persona)
        ? current.filter((entry) => entry !== persona)
        : [...current, persona],
    );

  return (
    <section aria-label="API log" className="flex h-full flex-col bg-surface">
      {eventsDown && (
        <p
          role="status"
          className="shrink-0 bg-warning-soft px-3 py-1 text-[11px] text-warning-ink"
        >
          Live stream disconnected — reconnecting; calls made in the meantime are replayed once it
          is back.
        </p>
      )}
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">UAPI calls</h2>
          <span className="font-mono text-xs text-muted">
            {filtered.length}
            {filtered.length !== calls.length && ` / ${calls.length}`}
          </span>
          {calls.length > 0 && (
            <button
              type="button"
              onClick={() => store.clearCalls()}
              title="Clears this view only — the backend keeps its history"
              className="ml-auto rounded-m border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-brand hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
        {calls.length > 0 && (
          <div role="group" aria-label="Call filters" className="flex flex-wrap items-center gap-1">
            {knownSteps.map((step) => (
              <FilterChip
                key={step}
                label={step}
                active={steps.includes(step)}
                onClick={() => toggle(step)}
              />
            ))}
            {knownPersonas.length > 1 && (
              <>
                <span aria-hidden="true" className="mx-1 h-3 w-px bg-line" />
                {knownPersonas.map((persona) => (
                  <FilterChip
                    key={persona}
                    label={persona}
                    active={personas.includes(persona)}
                    onClick={() => togglePersona(persona)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </header>
      {calls.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted">
          No calls yet — every fiskaly request shows up here as it happens.
        </p>
      ) : groups.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted">
          No call matches these filters.
        </p>
      ) : (
        <ol ref={list} className="flex-1 overflow-y-auto py-3 pr-3 pl-8">
          {ordered.map((group, index) => (
            <li key={group.key} className="group relative pb-2 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute top-0 bottom-0 -left-4 w-px bg-line group-first:top-3 group-last:bottom-auto group-last:h-3 group-only:hidden"
              />
              <span
                aria-hidden="true"
                title={`Call ${index + 1} of ${ordered.length}`}
                className={`absolute top-2 -left-[1.3rem] h-2.5 w-2.5 rounded-full border-2 border-canvas ${statusMarker(group.latest)}`}
              />
              <ApiCallCard
                group={group}
                open={isOpen(group.key)}
                focused={focusedKey === group.key}
                onToggle={() =>
                  setOpen((current) => ({ ...current, [group.key]: !isOpen(group.key) }))
                }
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
