import { useEffect, useMemo, useRef, useState } from "react";
import { DiffView } from "./DiffView";
import { Modal } from "./Modal";
import { blockedByLine, DEGRADED_NO_CAUSE } from "./onboarding";
import { getFormat } from "./formats";
import type { Invoice } from "./model";
import { listPresets, type PresetId } from "./presets";
import { SendPreflight } from "./SendPreflight";
import { SendTimeline } from "./SendTimeline";
import { store, useStore } from "./store";
import {
  fetchArtifact,
  getOnboardingStatus,
  fetchRecordFiles,
  POLL_DELAY_MS,
  sendCorrection,
  sendInvoice,
  SEND_COUNTRIES,
  waitForTransmission,
  type ArtifactKind,
  type SettingsCountry,
  type TransmissionWait,
  type Transport,
} from "./uapi-client";
import { CORRECTION_BLOCKED_NOTE } from "./uapi-json";
import { composeOperation, type SendOutcome } from "./workflow";
import { XmlView } from "./XmlView";

const POLL_BUDGET_MS = 60_000;

export const MOCK_DIFF_CAVEAT =
  "MOCK — this diff is not representative. The right-hand document is a static fixture of a " +
  "different invoice with only the number and the total patched in, so almost every changed " +
  "line is fixture noise, not fiskaly rewriting your invoice. The comparison is only " +
  "meaningful in LIVE, where the artifact really is generated from what you posted.";

const TIMEOUT_NOTE =
  "Polling stopped after 60 s. Nothing failed — SDI routinely takes minutes and the spec allows " +
  "up to 48 h. Keep polling to carry on watching the same record.";

const OUTCOME: Record<SendOutcome, { tone: string; headline: string; body: string }> = {
  transmitted: {
    tone: "border border-success bg-brand-soft text-brand-ink",
    headline: "Transmitted",
    body: "fiskaly generated the compliance XML from the JSON you posted and handed it to the network. The diff below is that document against the XML this browser predicted.",
  },
  rejected: {
    tone: "bg-error-soft text-error-ink",
    headline: "Rejected",
    body: "The record ended REJECTED. Read the log entries on the timeline — that is the provider's or the tax authority's own wording.",
  },
  failed: {
    tone: "bg-error-soft text-error-ink",
    headline: "Failed",
    body: "The transmission finished in state FAILED. Nothing is filed; the log entries carry the reason.",
  },
  "not-transmitted": {
    tone: "bg-warning-soft text-warning-ink",
    headline: "Nothing was transmitted",
    body: "The transaction record completed, but no transmission record was ever created — with no invoicing block on the recipient, fiskaly had nothing to hand to a network. No invoice left the building.",
  },
  timeout: {
    tone: "bg-warning-soft text-warning-ink",
    headline: "Still processing",
    body: TIMEOUT_NOTE,
  },
  stopped: {
    tone: "bg-warning-soft text-warning-ink",
    headline: "Polling paused",
    body:
      "You stopped the polling — the record keeps processing at fiskaly regardless. " +
      "Keep polling to carry on watching the same record.",
  },
  error: {
    tone: "bg-error-soft text-error-ink",
    headline: "The call failed",
    body: "The request never reached a lifecycle state. The API log on the right holds the exchange.",
  },
};

let activeRun = 0;

// Whether any send ran in this browser session (vs. one restored from localStorage) — a restored
// send has no calls in the log, only startup backfill, so arrival clears the pane.
let sendRanThisSession = false;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ModeBanner({ mode, environment }: { mode: string; environment?: string }) {
  // "unknown" is the boot value and the state while /api/config is unreachable. Falling through
  // to the MOCK copy here would assert "no request leaves this machine" exactly when that
  // cannot be verified.
  if (mode !== "LIVE" && mode !== "MOCK") {
    return (
      <p
        role="status"
        className="shrink-0 rounded-l bg-error-soft px-3 py-2 text-xs text-error-ink"
      >
        <span className="font-mono font-bold">MODE UNKNOWN</span> — the backend has not answered{" "}
        <span className="font-mono">/api/config</span> yet, so whether a send would be mocked or
        real cannot be determined. Nothing can be sent until it does.
      </p>
    );
  }
  if (mode === "LIVE") {
    return (
      <p
        role="status"
        className="shrink-0 rounded-l border-2 border-brand bg-surface px-3 py-2 text-xs text-ink"
      >
        <span className="font-mono font-bold text-brand">LIVE</span> — pressing Send really posts to{" "}
        <span className="font-mono">
          {environment === "live" ? "live" : "test"}.api.fiskaly.com
        </span>
        {environment === "live"
          ? ". That is production: the invoice is transmitted for real and cannot be recalled."
          : ". The TEST environment simulates validation and transmits nothing to a tax authority."}
      </p>
    );
  }
  return (
    <p
      role="status"
      className="shrink-0 rounded-l bg-warning-soft px-3 py-2 text-xs text-warning-ink"
    >
      <span className="font-mono font-bold">MOCK</span> — no request leaves this machine. Every
      response below comes from <span className="font-mono">backend/fixtures/uapi</span>, replayed
      through the same client code as a live call.
    </p>
  );
}

export function StepSend() {
  const invoice = useStore((state) => state.workflow.invoice);
  const presetId = useStore((state) => state.workflow.presetId);

  if (!invoice || !presetId) {
    return (
      <p className="p-6 text-sm text-muted">
        No invoice loaded — pick a preset in Setup to send one.
      </p>
    );
  }
  return <Sending invoice={invoice} presetId={presetId} />;
}

function Sending({ invoice, presetId }: { invoice: Invoice; presetId: PresetId }) {
  const mode = useStore((state) => state.mode);
  const offline = useStore((state) => state.offline);
  const workflow = useStore((state) => state.workflow);
  const { formatId, send } = workflow;
  const editXml = workflow.edit.xml;
  const stages = workflow.validation.stages;
  const focus = useStore((state) => state.focus);
  // Arriving at Send starts the call log empty, so what appears below is this send and nothing
  // else — startup backfill and earlier attempts would otherwise be indistinguishable from it.
  // Coming back after a send in *this session* keeps that send's calls on screen; a restored
  // send from a previous session has no calls here, only backfill, so it clears too.
  useEffect(() => {
    if (store.getState().workflow.send.phase === "idle" || !sendRanThisSession) {
      store.clearCalls();
    }
  }, []);

  // Read from the store, not fetched here: saving a system id in Settings has to reach this
  // preflight without a reload.
  const config = useStore((state) => state.config);
  const settings = useStore((state) => state.settings);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [degradedNote, setDegradedNote] = useState<string | null>(null);
  const attemptKey = useRef<string | null>(null);

  const meta = listPresets().find((candidate) => candidate.id === presetId);
  // The invoice decides the country — hand edits can move it away from the preset's. The preset
  // is only the fallback for a blob with no seller country.
  const country = invoice.seller.address.country || (meta?.country ?? "");
  const countryDiverges = meta !== undefined && country !== meta.country;
  const format = getFormat(formatId);
  const systemId = config?.systems?.[country as SettingsCountry]?.system_id;

  const operation = composeOperation(workflow);
  const target = workflow.correctionTarget;
  const isCorrection = operation.label === "TRANSACTION::CORRECTION";
  const callMode: "MOCK" | "LIVE" = mode === "MOCK" ? "MOCK" : "LIVE";
  const targetMismatch =
    isCorrection && target !== null
      ? target.country !== country
        ? `This credit note would reference record ${target.id}, which was transmitted for ${target.country} — the invoice at hand is for ${country}. Send the original invoice for this country first.`
        : target.mode !== callMode
          ? `This credit note would reference record ${target.id}, which exists only in ${target.mode} mode — the app is now in ${callMode}. Send the original invoice in this mode first.`
          : null
      : null;

  const localXml = useMemo(() => {
    if (editXml !== null) return editXml;
    try {
      return format.write(invoice);
    } catch {
      return "";
    }
  }, [invoice, format, editXml]);

  const supported = SEND_COUNTRIES.includes(country);
  const busy = send.phase === "creating" || send.phase === "polling" || send.phase === "artifacts";
  const blocked =
    offline || mode === "unknown"
      ? "The backend is unreachable, so nothing can be sent — and the API log would not show the exchange."
      : (operation.error ??
        targetMismatch ??
        (operation.correctionPending
          ? CORRECTION_BLOCKED_NOTE
          : supported
            ? null
            : unsupportedCountry(country)));

  const loadArtifact = async (
    kind: ArtifactKind,
    recordId: string,
    transport: Transport,
    alive: () => boolean,
  ) => {
    try {
      const artifact = await fetchArtifact({ transport, recordId, kind });
      if (!alive()) return;
      store.dispatch({
        type: "sendArtifact",
        at: Date.now(),
        kind,
        artifact: { recordId, type: artifact.type, xml: artifact.xml },
      });
    } catch (error) {
      if (alive()) {
        store.dispatch({ type: "sendArtifact", at: Date.now(), kind, error: reason(error) });
      }
    }
  };

  // In LIVE, a DEGRADED system (typically Peppol proof-of-ownership outstanding for BE/DE) means
  // the transmission will not go out — say so before Send, not after. LIVE-only: in MOCK the
  // fixture account is always OPERATIVE and the extra listing calls would be noise.
  useEffect(() => {
    if (mode !== "LIVE" || !systemId) return;
    let cancelled = false;
    getOnboardingStatus().then(
      (status) => {
        if (cancelled) return;
        const system = status.systems.find((entry) => entry.id === systemId);
        setDegradedNote(
          system && system.mode === "DEGRADED"
            ? system.blocked_by
              ? blockedByLine(system.blocked_by)
              : DEGRADED_NO_CAUSE
            : null,
        );
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [mode, systemId]);

  // A restored terminal send lost its artifacts (they are stripped from persistence); the record
  // ids survive, so refetch instead of showing a transmitted invoice without its diff.
  useEffect(() => {
    const current = store.getState().workflow.send;
    if (
      current.phase === "settled" &&
      current.outcome === "transmitted" &&
      current.transmissionId !== null &&
      current.transport !== null &&
      current.compliance === null
    ) {
      const alive = () => true;
      void loadArtifact("compliance", current.transmissionId, current.transport, alive);
      void loadArtifact("archive", current.transmissionId, current.transport, alive);
    }
    // Mount-only by design: the ids come from the restored snapshot, not from render state.
  }, []);

  const run = async (resume: boolean) => {
    const runId = (activeRun += 1);
    const alive = () => activeRun === runId;
    let transport = send.transport;
    let transactionId = send.transactionId;
    let transmissionId = send.transmissionId ?? undefined;
    try {
      if (resume) {
        store.dispatch({ type: "sendResumed", at: Date.now() });
      } else {
        // A retry after a failed call reuses the attempt's idempotency key, so a response lost in
        // transit replays the same records instead of creating a second invoice.
        const idempotencyKey =
          send.outcome === "error" && attemptKey.current !== null
            ? attemptKey.current
            : crypto.randomUUID();
        attemptKey.current = idempotencyKey;
        sendRanThisSession = true;
        store.dispatch({
          type: "sendStarted",
          at: Date.now(),
          localXml,
          label: operation.label,
          callMode,
        });
        const correction =
          operation.label === "TRANSACTION::CORRECTION"
            ? (operation.value as {
                record?: { id?: string };
                data?: unknown;
                reason?: string;
              } | null)
            : null;
        const started =
          correction?.record?.id !== undefined
            ? await sendCorrection(
                {
                  country,
                  correctedRecordId: correction.record.id,
                  operation: correction.data,
                  correctionValue: operation.value,
                  reason: correction.reason,
                  systemId,
                  idempotencyKey,
                },
                callMode,
              )
            : await sendInvoice(
                { country, operation: operation.value, systemId, idempotencyKey },
                callMode,
              );
        if (!alive()) return;
        store.dispatch({
          type: "sendCreated",
          at: Date.now(),
          created: started,
          transport: started.transport,
          note: started.note,
        });
        transport = started.transport;
        transactionId = started.transaction_id;
        transmissionId = undefined;
      }
      if (!transport || !transactionId) return;
      const deadline = Date.now() + POLL_BUDGET_MS;
      let wait: TransmissionWait | null = null;
      while (alive()) {
        wait = await waitForTransmission({ transport, transactionId, transmissionId });
        if (!alive()) return;
        store.dispatch({ type: "sendPolled", at: Date.now(), wait });
        transmissionId = wait.transmission_id ?? transmissionId;
        if (wait.finished) break;
        if (Date.now() >= deadline) {
          store.dispatch({ type: "sendStopped", at: Date.now() });
          return;
        }
        await delay(POLL_DELAY_MS[transport]);
      }
      if (!alive() || !wait?.finished || !transmissionId) return;
      await Promise.all([
        loadArtifact("compliance", transmissionId, transport, alive),
        loadArtifact("archive", transmissionId, transport, alive),
      ]);
    } catch (error) {
      if (alive()) store.dispatch({ type: "sendFailed", at: Date.now(), error: reason(error) });
    }
  };

  const stop = () => {
    activeRun += 1;
    store.dispatch({ type: "sendStopped", at: Date.now(), manual: true });
  };

  const reset = () => {
    activeRun += 1;
    setFilesError(null);
    setShowReceipt(false);
    store.dispatch({ type: "sendReset" });
  };

  const downloadFiles = async () => {
    if (!send.transmissionId) return;
    setFilesError(null);
    try {
      const blob = await fetchRecordFiles(send.transmissionId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${send.transmissionId}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFilesError(reason(error));
    }
  };

  const outcome = send.outcome ? OUTCOME[send.outcome] : null;

  return (
    <section aria-label="Send" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <ModeBanner mode={mode} environment={config?.environment} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        <SendPreflight
          open={send.phase === "idle"}
          country={country}
          channel={invoice.buyer.channel}
          channelLabel={meta?.channel}
          systemId={systemId}
          config={config}
          credentials={settings?.credentials}
          mode={mode}
          stages={stages}
          operation={operation}
          correction={target}
        />

        {mode === "LIVE" && degradedNote && (
          <p className="shrink-0 rounded-l bg-warning-soft px-3 py-2 text-[11px] text-warning-ink">
            System <span className="font-mono">{systemId}</span> is DEGRADED — {degradedNote}
          </p>
        )}

        {countryDiverges && (
          <p className="shrink-0 rounded-l bg-warning-soft px-3 py-2 text-[11px] text-warning-ink">
            The invoice's seller country is <span className="font-mono">{country}</span>, but the
            preset was written for <span className="font-mono">{meta?.country}</span> — the send
            uses the invoice's country for the system id and support checks.
          </p>
        )}

        {send.phase !== "idle" && (
          <SendTimeline send={send} focusedRecordId={focus?.recordId ?? null} />
        )}

        {send.note && (
          <p className="shrink-0 rounded-l bg-warning-soft px-3 py-2 text-[11px] text-warning-ink">
            {send.note}
          </p>
        )}
      </div>

      {outcome && (
        <div
          role="status"
          data-outcome={send.outcome}
          className={`shrink-0 rounded-l px-3 py-2 text-xs ${outcome.tone}`}
        >
          <span className="font-semibold">{outcome.headline}</span>
          <span className="ml-2">{send.error ?? outcome.body}</span>
        </div>
      )}

      {send.complianceError && (
        <p className="shrink-0 rounded-l bg-warning-soft px-3 py-2 text-[11px] text-warning-ink">
          No compliance artifact: {send.complianceError}
        </p>
      )}

      {(send.archive || send.archiveError || send.transmissionId) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {send.archive && (
            <button
              type="button"
              onClick={() => setShowReceipt((current) => !current)}
              className="rounded-m border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:border-brand hover:text-ink"
            >
              {showReceipt ? "Hide" : "Show"} Receipt of Transmission
            </button>
          )}
          {send.archiveError && (
            <span className="text-[11px] text-muted">
              No Receipt of Transmission: {send.archiveError}
            </span>
          )}
          {send.transmissionId && (
            <button
              type="button"
              onClick={() => void downloadFiles()}
              className="rounded-m border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:border-brand hover:text-ink"
            >
              Download files ZIP
            </button>
          )}
          {filesError && <span className="text-[11px] text-muted">{filesError}</span>}
        </div>
      )}

      {showReceipt && send.archive && (
        <div className="h-56 shrink-0 overflow-hidden rounded-l border border-line">
          <XmlView
            text={send.archive.xml}
            label="Receipt of Transmission"
            scrollTo={false}
            editable={false}
            onPickOffset={() => undefined}
            onChange={() => undefined}
          />
        </div>
      )}
      {send.compliance && (
        <div className="flex min-h-0 flex-[2] flex-col">
          <DiffView
            localXml={send.localXml ?? localXml}
            localLabel={`Predicted — ${format.label}, generated in this browser`}
            remoteXml={send.compliance.xml}
            remoteLabel={`Transmitted by fiskaly — ${send.compliance.type} · ${send.compliance.recordId}`}
            caveat={mode === "LIVE" ? null : MOCK_DIFF_CAVEAT}
          />
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || blocked !== null}
          title={blocked ?? undefined}
          // LIVE creates real records; the runner already guards this with a counting modal, so
          // the flow's Send gets the same standard. MOCK stays one click.
          onClick={() => (mode === "LIVE" ? setConfirmLive(true) : void run(false))}
          className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker disabled:cursor-not-allowed disabled:opacity-60"
        >
          {send.phase === "idle" ? "Send to fiskaly" : "Send again"}
        </button>
        {busy && (
          <button
            type="button"
            onClick={stop}
            disabled={send.phase === "creating"}
            title={
              send.phase === "creating"
                ? "The create call is still in flight — the record ids it returns arrive in a moment."
                : undefined
            }
            className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Stop polling
          </button>
        )}
        {(send.outcome === "timeout" || send.outcome === "stopped") && !busy && (
          <button
            type="button"
            onClick={() => void run(true)}
            className="rounded-m border border-brand px-3 py-1.5 text-xs font-semibold text-ink"
          >
            Keep polling
          </button>
        )}
        {send.phase !== "idle" && !busy && (
          <button
            type="button"
            onClick={reset}
            className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => store.dispatch({ type: "goToStep", step: "validate" })}
          className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
        >
          Back to Validate
        </button>
        <p role="status" aria-live="polite" className="text-xs text-muted">
          {blocked ??
            (busy
              ? `Polling — ${send.polls} read${send.polls === 1 ? "" : "s"} so far.`
              : send.phase === "idle"
                ? "Nothing has been sent yet."
                : "")}
        </p>
        {send.outcome === "transmitted" && (
          <button
            type="button"
            onClick={() => store.dispatch({ type: "goToStep", step: "setup" })}
            className="ml-auto rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker"
          >
            Done — start a new invoice
          </button>
        )}
      </div>

      <Modal
        open={confirmLive}
        labelledBy="send-live-guard-title"
        describedBy="send-live-guard-blurb"
        onClose={() => setConfirmLive(false)}
        className="max-w-md p-4"
      >
        <h3 id="send-live-guard-title" className="text-sm font-semibold text-ink">
          Send to LIVE fiskaly?
        </h3>
        <p id="send-live-guard-blurb" className="mt-2 text-xs text-muted">
          {send.outcome === "transmitted" && (
            <span className="mb-1 block font-medium text-error-ink">
              {operation.label === "TRANSACTION::CORRECTION"
                ? "This document was already transmitted — sending again files a second TRANSACTION::CORRECTION against the same original."
                : "This invoice was already transmitted — sending again files a duplicate invoice."}
            </span>
          )}
          This creates an INTENTION and a {operation.label} record at fiskaly, and a transmission
          the moment fiskaly hands the generated document to the network.{" "}
          {config?.environment === "live"
            ? "The environment is PRODUCTION: the document is transmitted for real and cannot be recalled."
            : "The TEST environment simulates validation and transmits nothing to a tax authority."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmLive(false)}
            className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmLive(false);
              void run(false);
            }}
            className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker"
          >
            {send.phase === "idle" ? "Send it" : "Send it again"}
          </button>
        </div>
      </Modal>
    </section>
  );
}

function unsupportedCountry(country: string): string {
  return `This preset targets ${country || "an unknown country"}; the backend has e-invoicing systems for ${SEND_COUNTRIES.join(", ")} only.`;
}
