import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./ApiCallCard";
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
  runnableSummary,
  runSteps,
  saveNotesDismissed,
  seedValues,
  seedVariables,
  stepCurl,
  stoppedLine,
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
  const seeds = seedVariables(state.settings, collection.id);
  const variables: Vars = { ...seedValues(seeds), ...state.runner.captured };
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
    passthrough(method, path, body ?? undefined, idempotencyKey, {
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
  const captured: Vars = { ...store.getState().runner.captured };
  for (const result of Object.values(outcome.results)) Object.assign(captured, result.captured);
  const finalResults = store.getState().runner.results;
  store.patchRunner({
    running: false,
    haltedAt: outcome.haltedAt,
    captured,
    status:
      outcome.stoppedAt !== null
        ? stoppedLine(collection.steps, finalResults, outcome.stoppedAt)
        : finishLine(collection.steps, finalResults, Date.now() - startedAt),
  });
  controller = null;
}

function clearRun(): void {
  store.patchRunner({
    results: {},
    captured: {},
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
  missing,
}: {
  seeds: SeededVariable[];
  captured: Vars;
  missing: MissingVariable[];
}) {
  const capturedEntries = Object.entries(captured);
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
              captured at runtime
            </span>
          </li>
        ))}
      </ul>
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
    () => (runner.collection ? seedVariables(settings, runner.collection.id) : []),
    [settings, runner.collection],
  );

  const missing = useMemo(() => {
    if (!runner.collection) return [];
    return missingVariables(runner.collection.steps, {
      ...seedValues(seeds),
      ...runner.captured,
    });
  }, [runner.collection, seeds, runner.captured]);

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

  // Where "Run all" starts: the first step without a verdict, so a stopped run resumes where
  // it paused; when every step has a result the whole collection runs again from the top.
  const resumeIndex = useMemo(() => {
    if (!runner.collection) return 0;
    const index = runner.collection.steps.findIndex(
      (_, i) => (runner.results[i]?.status ?? "pending") === "pending",
    );
    return index === -1 ? 0 : index;
  }, [runner.collection, runner.results]);

  const blocked = missing.length > 0;
  const blockedTitle = blocked
    ? `unresolved ${missing.map((entry) => `{{${entry.name}}}`).join(", ")} — ` +
      "set them in Settings → Identifiers (see the Variables panel above)"
    : undefined;

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
                onDismiss={() => {
                  saveNotesDismissed(runner.collection!.id);
                  store.patchRunner({ notesDismissed: true });
                }}
              />
            )}
            <VariablePanel seeds={seeds} captured={runner.captured} missing={missing} />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={PRIMARY}
                disabled={runner.running || blocked}
                title={blockedTitle}
                onClick={() => requestRun(resumeIndex)}
              >
                Run all
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={runner.running || nextIndex === null || blocked}
                title={blockedTitle}
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
              {nextIndex === null && !runner.running && hasRunState && (
                // Rendered text, not a title on a disabled control: a tooltip there is
                // unreliable for mouse users and invisible to assistive tech.
                <span className="text-[11px] text-muted">
                  Run finished — every runnable step has a result; Clear results to step through
                  again.
                </span>
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
                runner.collection !== null &&
                // Only when something runnable remains: a tail of skipped steps is nothing to
                // continue into, exactly like the halted step being the last one.
                runner.collection.steps
                  .slice(runner.haltedAt + 1)
                  .some((step) => step.runnable) && (
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

            <p className="text-[11px] text-muted">{runnableSummary(runner.collection.steps)}</p>

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
          {liveRecords === 1 ? "" : "s"} at fiskaly.{" "}
          {settings?.environment === "test"
            ? "These are real records in the fiskaly TEST environment (not billed, no tax-authority transmission)."
            : "LIVE records are real and cannot be recalled."}
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
