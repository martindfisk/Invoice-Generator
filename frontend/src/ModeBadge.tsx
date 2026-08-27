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
