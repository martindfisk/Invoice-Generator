import { useStore, type Mode } from "./store";

const STYLES: Record<Mode, string> = {
  LIVE: "bg-warning text-bunker",
  MOCK: "bg-brand-soft text-brand-ink",
  unknown: "border border-line bg-canvas text-muted",
};

export function ModeBadge() {
  const mode = useStore((state) => state.mode);
  return (
    <span
      title="Backend mode from GET /api/config"
      className={`rounded-m px-2 py-0.5 font-mono text-xs font-medium ${STYLES[mode]}`}
    >
      {mode === "unknown" ? "MODE ?" : mode}
    </span>
  );
}

export function EnvironmentBadge() {
  const environment = useStore((state) => state.settings?.environment ?? state.config?.environment);
  if (!environment) return null;
  const live = environment === "live";
  return (
    <span
      title={
        live
          ? "fiskaly environment: live.api.fiskaly.com — production"
          : "fiskaly environment: test.api.fiskaly.com"
      }
      className={`rounded-m px-2 py-0.5 font-mono text-xs font-medium ${
        live ? "bg-error text-white" : "border border-brand text-brand-ink"
      }`}
    >
      {environment.toUpperCase()}
    </span>
  );
}
