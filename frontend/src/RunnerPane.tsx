import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./ApiCallCard";
import type { Persona } from "./api-log";
import { EntityTree } from "./EntityTree";
import { Modal } from "./Modal";
import { Split } from "./Split";
import { useIsWide } from "./use-media";
import { ensureRunnerLoaded, selectCollection } from "./runner-actions";
import {
  finishLine,
  IDENTIFIERS_SECTION_ID,
  matchStepCalls,
  missingVariables,
  pendingResult,
  recordsCreated,
  runCurlScript,
  runSteps,
  seedValues,
  seedVariables,
  stepCurl,
  type MissingVariable,
  type RunTransport,
  type SeededVariable,
  type StepResult,
  type Vars,
} from "./runner";
import { RunnerStepRow } from "./RunnerStep";
import { store, useStore } from "./store";
import { passthrough, type CollectionNote } from "./uapi-client";

const PRIMARY =
  "rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker transition-opacity " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const SECONDARY =
  "rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors " +
  "hover:border-brand hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

let controller: AbortController | null = null;

async function startRun(from: number, until?: number, continueOnFailure = false): Promise<void> {
  const state = store.getState();
  const { collection } = state.runner;
  if (!collection || state.runner.running) return;
  const to = until ?? collection.steps.length - 1;
  const persona = state.workflow.persona;
  const seeds = seedVariables(state.settings, persona, collection.id);
  // Captured ids belong to the persona whose run captured them; against the other persona's
  // credentials they only produce 403/404s, so a persona switch starts from the seeds alone.
  const staleCaptures = state.runner.capturedBy !== null && state.runner.capturedBy !== persona;
  const carried = staleCaptures ? {} : state.runner.captured;
  const variables: Vars = { ...seedValues(seeds), ...carried };
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  controller = new AbortController();
  const results: Record<number, StepResult> = { ...state.runner.results };
  for (let index = from; index <= to; index += 1) results[index] = pendingResult();
  store.patchRunner({
    running: true,
    runId,
    haltedAt: null,
    results,
    status: `Running ${collection.name}…`,
  });
  const transport: RunTransport = ({ method, path, body, stepName, idempotencyKey }) =>
    passthrough(method, path, persona, body ?? undefined, idempotencyKey, {
      "X-Step": stepName,
      "X-Run-Id": runId,
    });
  const outcome = await runSteps({
    steps: collection.steps,
    variables,
    transport,
    from,
    to,
    continueOnFailure,
    signal: controller.signal,
    onStep: (index, result) => {
      const runner = store.getState().runner;
      store.patchRunner({
        results: { ...runner.results, [index]: { ...result, runId } },
        status: `Running ${collection.name} — step ${index + 1} of ${collection.steps.length}`,
      });
    },
  });
  const captured: Vars = staleCaptures ? {} : { ...store.getState().runner.captured };
  for (const result of Object.values(outcome.results)) Object.assign(captured, result.captured);
  store.patchRunner({
    running: false,
    haltedAt: outcome.haltedAt,
    captured,
    capturedBy: persona,
    status: finishLine(collection.steps, store.getState().runner.results, Date.now() - startedAt),
  });
  controller = null;
}

function clearRun(): void {
  store.patchRunner({
    results: {},
    captured: {},
    capturedBy: null,
    haltedAt: null,
    runId: null,
    status: null,
  });
}

function stopRun(): void {
  controller?.abort();
  store.patchRunner({ status: "Stopping after the current step…" });
}

export function VariablePanel({
  seeds,
  captured,
  capturedBy = null,
  persona,
  missing,
  onClearCaptured,
}: {
  seeds: SeededVariable[];
  captured: Vars;
  capturedBy?: Persona | null;
  persona?: Persona;
  missing: MissingVariable[];
  onClearCaptured?: () => void;
}) {
  const capturedEntries = Object.entries(captured);
  const staleCaptures =
    capturedEntries.length > 0 &&
    capturedBy !== null &&
    persona !== undefined &&
    capturedBy !== persona;
  const settingsLink = (section: string, label: string) => (
    <button
      type="button"
      className="underline decoration-dotted underline-offset-2 hover:text-ink"
      onClick={() => store.openSettings(section)}
    >
      {label}
    </button>
  );
  return (
    <section aria-label="Runner variables" className="rounded-l border border-line bg-surface p-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Variables</h3>
      <ul className="mt-2 space-y-1">
        {seeds.map((seed) => (
          <li
            key={seed.name}
            data-variable={seed.name}
            className="flex flex-wrap items-baseline gap-x-2 text-[11px]"
          >
            <span className="font-mono text-ink">{seed.name}</span>
            {seed.value === "" ? (
              <span className="rounded-m bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning-ink">
                unset — configure it in{" "}
                {seed.section ? settingsLink(seed.section, seed.source) : seed.source}
              </span>
            ) : (
              <span className="font-mono break-all text-muted">{seed.value}</span>
            )}
            <span className="text-[10px] text-muted italic">seeded · {seed.source}</span>
          </li>
        ))}
        {capturedEntries.map(([name, value]) => (
          <li
            key={name}
            data-variable={name}
            className="flex flex-wrap items-baseline gap-x-2 text-[11px]"
          >
            <span className="font-mono text-ink">{name}</span>
            <span className="font-mono break-all text-muted">
              {typeof value === "string" ? value : JSON.stringify(value)}
            </span>
            <span className="rounded-m bg-select-bg px-1.5 py-0.5 text-[10px] text-ink">
              captured at runtime{capturedBy ? ` as ${capturedBy}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {staleCaptures && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-m bg-warning-soft px-2 py-1.5 text-[11px] text-warning-ink">
          <p>
            These values were captured as the {capturedBy} — the next run as the {persona} starts
            from the seeds alone and ignores them.
          </p>
          {onClearCaptured && (
            <button
              type="button"
              className="rounded-m border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-muted hover:border-brand hover:text-ink"
              onClick={onClearCaptured}
            >
              Clear captured
            </button>
          )}
        </div>
      )}
      {missing.length > 0 && (
        <div className="mt-2 rounded-m bg-warning-soft px-2 py-1.5 text-[11px] text-warning-ink">
          {missing.map((entry) => (
            <p key={entry.name}>
              <span className="font-mono">{`{{${entry.name}}}`}</span> is needed by step{" "}
              {entry.stepIndex + 1} ({entry.stepName}) but nothing sets it — configure it in{" "}
              {settingsLink(IDENTIFIERS_SECTION_ID, "Settings → Identifiers")} or run the step that
              captures it first.
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export function CollectionNotesPanel({
  notes,
  onDismiss,
}: {
  notes: CollectionNote[];
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label="Published collection notes"
      className="rounded-l border border-warning bg-warning-soft p-3"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-warning-ink">
            Notes on the published collection
          </h3>
          <p className="mt-0.5 text-[11px] text-ink">
            This is what fiskaly publishes — the runner reproduces the collection faithfully,
            defects included. Nothing below is an error in this tool.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto shrink-0 rounded-m border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-muted hover:border-brand hover:text-ink"
        >
          Dismiss
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {notes.map((note) => (
          <li key={note.message} className="flex items-baseline gap-2 text-[11px] text-ink">
            <span
              className={`shrink-0 rounded-m border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                note.severity === "warning"
                  ? "border-warning bg-surface text-warning-ink"
                  : "border-line bg-info-soft text-ink"
              }`}
            >
              {note.severity}
            </span>
            <span>{note.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RunnerPane() {
  const runner = useStore((state) => state.runner);
  const settings = useStore((state) => state.settings);
  const persona = useStore((state) => state.workflow.persona);
  const mode = useStore((state) => state.mode);
  const calls = useStore((state) => state.calls);
  const wide = useIsWide();
  const [liveGuard, setLiveGuard] = useState<{ from: number; to?: number } | null>(null);

  useEffect(() => {
    if (!runner.collectionsError) void ensureRunnerLoaded();
    // Load once on first mount; the Retry button re-triggers explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seeds = useMemo(
    () =>
      runner.collection ? seedVariables(settings, persona as Persona, runner.collection.id) : [],
    [settings, persona, runner.collection],
  );

  const missing = useMemo(() => {
    if (!runner.collection) return [];
    // Stale captures are ignored by the next run, so they must not satisfy references here.
    const stale = runner.capturedBy !== null && runner.capturedBy !== persona;
    return missingVariables(runner.collection.steps, {
      ...seedValues(seeds),
      ...(stale ? {} : runner.captured),
    });
  }, [runner.collection, seeds, runner.captured, runner.capturedBy, persona]);

  const matches = useMemo(
    () => (runner.collection ? matchStepCalls(runner.collection.steps, runner.results, calls) : {}),
    [runner.collection, runner.results, calls],
  );

  const runScript = useMemo(
    () =>
      runner.collection
        ? runCurlScript(runner.collection.name, runner.collection.steps, runner.results, matches)
        : null,
    [runner.collection, runner.results, matches],
  );

  // null = no runnable step without a result — "Step" would only re-run step 1, so it disables
  // instead; Clear results starts the collection over.
  const nextIndex = useMemo(() => {
    if (!runner.collection) return null;
    const index = runner.collection.steps.findIndex(
      (step, i) => step.runnable && (runner.results[i]?.status ?? "pending") === "pending",
    );
    return index === -1 ? null : index;
  }, [runner.collection, runner.results]);

  const hasRunState =
    Object.keys(runner.results).length > 0 || Object.keys(runner.captured).length > 0;

  const requestRun = (from: number, to?: number) => {
    if (mode === "LIVE") setLiveGuard({ from, to });
    else void startRun(from, to);
  };

  const liveRecords =
    liveGuard !== null && runner.collection
      ? recordsCreated(
          runner.collection.steps,
          liveGuard.from,
          liveGuard.to ?? runner.collection.steps.length - 1,
        )
      : 0;

  const collectionPane = (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-line bg-surface px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Test runner</h2>
        <p className="mt-0.5 text-xs text-muted">
          Runs the published fiskaly Postman collections against the Unified API — every call lands
          in the log on the right under its own step name.
        </p>
        {runner.collections && runner.collections.length > 0 && (
          <div
            role="group"
            aria-label="Collection picker"
            className="mt-2 flex flex-wrap items-center gap-1.5"
          >
            {runner.collections.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-collection={entry.id}
                aria-pressed={runner.collectionId === entry.id}
                disabled={runner.running}
                onClick={() => void selectCollection(entry.id)}
                className={`rounded-m border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  runner.collectionId === entry.id
                    ? "border-brand bg-select-bg text-ink"
                    : "border-line text-muted hover:border-brand hover:text-ink"
                }`}
              >
                <span className="font-medium">{entry.name}</span>
                <span className="ml-1.5 font-mono text-[10px] text-muted">
                  {entry.version} · {entry.steps} steps
                </span>
                {entry.notes > 0 && (
                  <span className="ml-1.5 rounded-m bg-warning-soft px-1 py-0.5 font-mono text-[10px] text-warning-ink">
                    {entry.notes} notes
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {runner.collectionsError && (
          <div className="rounded-l border border-line bg-surface p-4 text-sm text-muted">
            <p>{runner.collectionsError}</p>
            <button
              type="button"
              className={`${SECONDARY} mt-3`}
              onClick={() => void ensureRunnerLoaded()}
            >
              Retry
            </button>
          </div>
        )}
        {runner.loading && (
          <p role="status" className="text-xs text-muted">
            Loading…
          </p>
        )}
        {runner.collectionError && (
          <p className="rounded-m bg-error-soft px-3 py-2 text-xs text-error-ink">
            {runner.collectionError}
          </p>
        )}
        {!runner.collectionsError &&
          !runner.loading &&
          runner.collections &&
          !runner.collection && (
            <p className="text-sm text-muted">Pick a collection above to inspect and run it.</p>
          )}

        {runner.collection && (
          <>
            {runner.collection.notes.length > 0 && !runner.notesDismissed && (
              <CollectionNotesPanel
                notes={runner.collection.notes}
                onDismiss={() => store.patchRunner({ notesDismissed: true })}
              />
            )}
            <VariablePanel
              seeds={seeds}
              captured={runner.captured}
              capturedBy={runner.capturedBy}
              persona={persona as Persona}
              missing={missing}
              onClearCaptured={() =>
                store.patchRunner({ captured: {}, capturedBy: null, status: null })
              }
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={PRIMARY}
                disabled={runner.running}
                onClick={() => requestRun(0)}
              >
                Run all
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={runner.running || nextIndex === null}
                title={
                  nextIndex === null && !runner.running
                    ? "Run finished — every runnable step has a result. Clear results to step through again."
                    : undefined
                }
                onClick={() => {
                  if (nextIndex !== null) requestRun(nextIndex, nextIndex);
                }}
              >
                Step
              </button>
              {!runner.running && hasRunState && (
                <button type="button" className={SECONDARY} onClick={clearRun}>
                  Clear results
                </button>
              )}
              {runner.running && (
                <button type="button" className={SECONDARY} onClick={stopRun}>
                  Stop
                </button>
              )}
              {runScript !== null ? (
                <CopyButton text={runScript} label="Copy run as cURL" />
              ) : (
                <CopyButton
                  text=""
                  label="Copy run as cURL"
                  disabledReason="no recorded calls for this run yet"
                />
              )}
              {!runner.running &&
                runner.haltedAt !== null &&
                // No-op past the last step: the halted step was the final one, so there is
                // nothing to continue into.
                runner.collection !== null &&
                runner.haltedAt + 1 < runner.collection.steps.length && (
                  <button
                    type="button"
                    className={SECONDARY}
                    // Through requestRun, not startRun: continuing after a failure creates LIVE
                    // records exactly like Run all does, and deserves the same confirmation.
                    onClick={() => requestRun(runner.haltedAt! + 1)}
                  >
                    Continue anyway
                  </button>
                )}
              <p aria-live="polite" role="status" className="text-xs text-muted">
                {runner.status ?? ""}
              </p>
            </div>

            <ol
              aria-label="Collection steps"
              className="rounded-l border border-line bg-surface py-1"
            >
              {runner.collection.steps.map((step, index) => (
                <RunnerStepRow
                  key={step.id}
                  index={index}
                  step={step}
                  result={runner.results[index]}
                  disabled={runner.running}
                  onRunFrom={requestRun}
                  curl={stepCurl(runner.results[index], matches[index])}
                />
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );

  return (
    <section aria-label="Test runner" className="flex h-full min-h-0 flex-col bg-canvas">
      <Split
        id="runner-entities"
        orientation={wide ? "horizontal" : "vertical"}
        label="Resize the entity tree and the collection steps"
        defaultFirst={38}
        minFirst="20%"
        minSecond="35%"
        className="flex-1"
        first={<EntityTree />}
        second={collectionPane}
      />

      <Modal
        open={liveGuard !== null}
        labelledBy="runner-live-guard-title"
        describedBy="runner-live-guard-blurb"
        onClose={() => setLiveGuard(null)}
        className="max-w-md p-4"
      >
        <h3 id="runner-live-guard-title" className="text-sm font-semibold text-ink">
          Run against LIVE?
        </h3>
        <p id="runner-live-guard-blurb" className="mt-2 text-xs text-muted">
          This run will create{" "}
          <span className="font-mono font-semibold text-error-ink">{liveRecords}</span> record
          {liveRecords === 1 ? "" : "s"} at fiskaly. LIVE records are real and cannot be recalled.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={() => setLiveGuard(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              const guard = liveGuard;
              setLiveGuard(null);
              void startRun(guard?.from ?? 0, guard?.to);
            }}
          >
            Create {liveRecords} record{liveRecords === 1 ? "" : "s"}
          </button>
        </div>
      </Modal>
    </section>
  );
}
