import { useStore } from "./store";

// One badge for the whole story: MOCK is on-device replay; LIVE names the host the stored
// environment credentials point at, so "LIVE · TEST API" is the normal demo state and only
// "LIVE · PRODUCTION" is the dangerous one.
export function StatusBadge() {
  const mode = useStore((state) => state.mode);
  const environment = useStore((state) => state.settings?.environment ?? state.config?.environment);
  if (mode === "unknown") {
    return (
      <span className="rounded-m border border-line bg-canvas px-2 py-0.5 font-mono text-xs font-medium text-muted">
        MODE ?
      </span>
    );
  }
  if (mode === "MOCK") {
    return (
      <span
        title="On-device mocked run: fixture replay, nothing leaves the machine"
        className="rounded-m bg-brand-soft px-2 py-0.5 font-mono text-xs font-medium text-brand-ink"
      >
        MOCK
      </span>
    );
  }
  const production = environment === "live";
  return (
    <span
      title={
        production
          ? "Live calls against live.api.fiskaly.com — production"
          : "Live calls against test.api.fiskaly.com — the fiskaly testing environment"
      }
      className={`rounded-m px-2 py-0.5 font-mono text-xs font-medium ${
        production ? "bg-error text-white" : "bg-warning text-bunker"
      }`}
    >
      {production ? "LIVE · PRODUCTION" : "LIVE · TEST API"}
    </span>
  );
}
