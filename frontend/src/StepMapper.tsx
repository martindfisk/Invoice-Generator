import { useEffect } from "react";
import { InvoiceWorkbench } from "./InvoiceWorkbench";
import { store, useStore } from "./store";
import { prewarmValidation } from "./validation";

export function StepMapper() {
  const workflow = useStore((state) => state.workflow);
  const { invoice, presetId, formatId } = workflow;

  // Warm the active format's Schematron SEFs (and the SaxonJS runtime) while the user edits,
  // so the first Validate run does not pay the cold start. Idle-scheduled to stay out of the
  // way of the Mapper's own first paint.
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => void prewarmValidation(formatId));
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => void prewarmValidation(formatId), 250);
    return () => window.clearTimeout(handle);
  }, [formatId]);

  if (!invoice || !presetId) {
    return (
      <p className="p-6 text-sm text-muted">
        No invoice loaded — pick a preset in Setup to compose one.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <InvoiceWorkbench invoice={invoice} presetId={presetId} />
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => store.dispatch({ type: "goToStep", step: "validate" })}
          className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker"
        >
          Continue to Validate
        </button>
        <button
          type="button"
          onClick={() => store.dispatch({ type: "goToStep", step: "setup" })}
          className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
        >
          Change preset
        </button>
      </div>
    </div>
  );
}
