import type { Persona } from "./api-log";
import { store, useStore } from "./store";

const PERSONAS: { id: Persona; label: string }[] = [
  { id: "seller", label: "Seller" },
  { id: "buyer", label: "Buyer" },
];

export function PersonaSwitch() {
  const persona = useStore((state) => state.workflow.persona);
  return (
    <div
      role="group"
      aria-label="Persona"
      className="flex rounded-m border border-line bg-canvas p-0.5 text-xs"
    >
      {PERSONAS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={persona === id}
          onClick={() => store.setPersona(id)}
          className={`rounded-m px-2.5 py-1 font-medium transition-colors ${
            persona === id ? "bg-surface text-ink shadow-s" : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
