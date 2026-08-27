import type { Persona } from "./api-log";
import { store, useStore } from "./store";

const PERSONAS: { id: Persona; label: string }[] = [
  { id: "seller", label: "Seller" },
  { id: "buyer", label: "Buyer" },
];

export function PersonaSwitch() {
  const persona = useStore((state) => state.workflow.persona);
  const settings = useStore((state) => state.settings);
  const mode = useStore((state) => state.mode);
  return (
    <div
      role="group"
      aria-label="Persona"
      className="flex rounded-m border border-line bg-canvas p-0.5 text-xs"
    >
      {PERSONAS.map(({ id, label }) => {
        const credentials = settings?.personas?.[id]?.credentials;
        const configured = credentials?.configured ?? null;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={persona === id}
            data-credentials={configured === null ? "unknown" : credentials?.source}
            title={
              configured
                ? `${label}: API key from ${credentials?.source} · ${credentials?.fingerprint ?? "no fingerprint"}`
                : configured === false
                  ? `${label}: no API key configured — set one in Settings → Credentials${
                      mode === "LIVE" ? "; LIVE mode cannot call fiskaly without it" : ""
                    }`
                  : undefined
            }
            onClick={() => store.setPersona(id)}
            className={`rounded-m px-2.5 py-1 font-medium transition-colors ${
              persona === id ? "bg-surface text-ink shadow-s" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
