import { useEffect, useMemo, useState } from "react";

import { FATE_TONE, fateEntry, fateLabel } from "./field-fate";
import { loadSpecFields, type SpecField, type SpecFields } from "./uapi-fields-client";
import { companions, coverage, insertBlocker, suggestedValue } from "./uapi-fields";
import { fieldForPointer } from "./uapi-json";
import type { FormatId } from "./model";

type Insert = { pointer: string; value: unknown };

type CoveragePanelProps = {
  operation: unknown;
  country: string | undefined;
  formatId: FormatId;
  jsonPrefix: string;
  onInsert: (inserts: Insert[]) => void;
};

function describe(field: SpecField): string {
  const parts: string[] = [];
  if (field.type) parts.push(field.type);
  const max = field.constraints.maxLength;
  if (typeof max === "number") parts.push(`≤${max}`);
  const values = field.constraints.enum;
  if (Array.isArray(values)) parts.push(values.slice(0, 4).join(" | "));
  if (field.bt.length > 0) parts.push(field.bt.join(", "));
  return parts.join(" · ");
}

export function CoveragePanel({
  operation,
  country,
  formatId,
  jsonPrefix,
  onInsert,
}: CoveragePanelProps) {
  // The catalogue is keyed by the country it was fetched for, so a late answer for the previous
  // country is ignored rather than rendered against this one.
  const [loaded, setLoaded] = useState<{
    country: string | undefined;
    spec: SpecFields | null;
    unavailable: string | null;
  }>({ country: undefined, spec: null, unavailable: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Always the INVOICE catalogue: pointerTemplate strips a CORRECTION's /data wrapper, so the
    // nested invoice body measures against the same pointers either way.
    loadSpecFields(country, "INVOICE", controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        setLoaded(
          outcome.status === "ok"
            ? { country, spec: outcome.spec, unavailable: null }
            : { country, spec: null, unavailable: outcome.reason },
        );
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [country, attempt]);

  const spec = loaded.country === country ? loaded.spec : null;
  const unavailable = loaded.country === country ? loaded.unavailable : null;

  const derived = useMemo(
    () => (spec ? coverage(spec, operation, spec.profile) : null),
    [spec, operation],
  );

  // Every state of this panel is exactly one line high. The JSON editor sits directly beneath it,
  // and a message that wrapped to two lines would shift the text under the user's cursor.
  if (unavailable) {
    return (
      <p
        data-spec-coverage="unavailable"
        title={unavailable}
        className="mt-0.5 flex items-baseline gap-1.5 text-[11px] text-muted"
      >
        <span className="truncate">Spec field coverage unavailable — {unavailable}</span>
        <button
          type="button"
          onClick={() => setAttempt((current) => current + 1)}
          className="shrink-0 rounded-m border border-line px-1.5 font-medium hover:border-brand hover:text-ink"
        >
          Retry
        </button>
      </p>
    );
  }
  if (!spec || !derived) {
    return (
      <p data-spec-coverage="pending" className="mt-0.5 truncate text-[11px] text-muted">
        Measuring the payload against the fiskaly spec…
      </p>
    );
  }
  if (derived.total === 0) {
    return (
      <p data-spec-coverage="empty" className="mt-0.5 truncate text-[11px] text-muted">
        The spec catalogue lists no fields for this operation.
      </p>
    );
  }

  const count = `${derived.populated.length}/${derived.total}`;
  return (
    <details data-spec-coverage={count} className="mt-0.5">
      <summary className="cursor-pointer truncate text-[11px] text-muted marker:text-muted">
        {derived.populated.length} of {derived.total} spec fields populated
        {derived.missing.length > 0 && ` — ${derived.missing.length} available`}
        {derived.notApplicable.length > 0 &&
          `, ${derived.notApplicable.length} not applicable for ${spec.profile}`}
      </summary>
      <p className="mt-1 text-[10px] text-muted">
        Measured against <span className="font-mono">{spec.source}</span>. Inserting a field writes
        it into the JSON exactly as typing would.
      </p>
      <ul className="mt-1 space-y-0.5">
        {derived.missing.map((field) => {
          const fate = fateEntry(formatId, field.pointer);
          const value = suggestedValue(field);
          const extra = companions(spec, field, derived);
          const orphan = fieldForPointer(field.pointer, jsonPrefix) === undefined;
          const blocked = insertBlocker(spec, field, derived, operation);
          return (
            <li
              key={`${field.pointer}:${JSON.stringify(field.variants)}`}
              data-coverage-row={field.pointer}
              className="flex flex-wrap items-baseline gap-x-1.5 text-[10px]"
            >
              <span className="font-mono text-ink">{field.pointer}</span>
              <span className="text-muted">{describe(field)}</span>
              {fate && (
                <span
                  title={fate.note}
                  className={`underline decoration-dotted underline-offset-2 ${FATE_TONE[fate.fate]}`}
                >
                  {fateLabel(fate.fate)}
                </span>
              )}
              {!fate && orphan && (
                <span
                  className="text-muted"
                  title="No form field addresses this pointer, so a later field edit re-derives the JSON without it."
                >
                  stays only in the JSON
                </span>
              )}
              {blocked ? (
                <span className="text-muted" title="Inserting this alone would not validate.">
                  {blocked}
                </span>
              ) : value === undefined ? (
                <span className="text-muted">the spec gives no example</span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    onInsert([
                      { pointer: field.pointer, value },
                      ...extra.map((sibling) => ({
                        pointer: sibling.pointer,
                        value: suggestedValue(sibling),
                      })),
                    ])
                  }
                  className="rounded-m border border-line px-1.5 font-medium text-muted hover:border-brand hover:text-ink"
                >
                  {fate ? `Insert anyway — ${fateLabel(fate.fate)}` : "Insert"}
                  {extra.length > 0 && ` + ${extra.length} required`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {derived.notApplicable.length > 0 && (
        <p className="mt-1 text-[10px] text-muted">
          Not applicable for {spec.profile}:{" "}
          <span className="font-mono">
            {derived.notApplicable.map((field) => field.pointer).join(", ")}
          </span>
        </p>
      )}
    </details>
  );
}
