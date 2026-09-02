import type { FieldPresence } from "./field-presence";

const DOT = { present: "bg-success", absent: "bg-warning-ink" } as const;

export function PresenceStrip({
  field,
  presence,
}: {
  field: string | null;
  presence: FieldPresence[];
}) {
  // Always rendered, even with nothing selected: the panes sit directly below, and a strip that
  // appeared on selection shifted the text out from under the pointer mid-drag.
  if (!field) {
    return (
      <div
        data-presence-strip=""
        className="flex shrink-0 items-center border-b border-line bg-canvas px-3 py-1.5 text-[11px] text-muted"
      >
        Select a field in any pane to see which structures carry it.
      </div>
    );
  }
  const missing = presence.filter((entry) => !entry.present);
  return (
    <div
      data-presence-strip={field}
      data-missing={missing.length}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-canvas px-3 py-1.5 text-[11px]"
    >
      <span className="text-muted">
        Selected <span className="font-mono text-ink">{field}</span>
      </span>
      {presence.map((entry) => (
        <span
          key={entry.structure}
          data-structure={entry.structure}
          data-present={entry.present}
          title={entry.reason ?? entry.detail}
          className="flex items-baseline gap-1"
        >
          <span
            aria-hidden="true"
            className={`inline-block size-1.5 shrink-0 translate-y-[-1px] rounded-full ${
              entry.present ? DOT.present : DOT.absent
            }`}
          />
          <span className={entry.present ? "text-ink" : "text-warning-ink"}>{entry.label}</span>
          <span className="truncate font-mono text-muted" style={{ maxWidth: "22ch" }}>
            {entry.present ? entry.detail : "not carried"}
          </span>
        </span>
      ))}
      {missing.length > 0 && (
        <span className="text-warning-ink">
          {missing[0]?.reason ??
            `Missing from ${missing.map((entry) => entry.label).join(" and ")}.`}
        </span>
      )}
    </div>
  );
}
