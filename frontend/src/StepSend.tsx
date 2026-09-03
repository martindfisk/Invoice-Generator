import { useEffect, useMemo, useState } from "react";
import { DiffView } from "./DiffView";
import { getFormat } from "./formats";
import type { Invoice } from "./model";
import { listPresets, type PresetId } from "./presets";
import { SendPreflight } from "./SendPreflight";
import { SendTimeline } from "./SendTimeline";
import { store, useStore } from "./store";
import {
  fetchArtifact,
  fetchRecordFiles,
  POLL_DELAY_MS,
  sendInvoice,
  SEND_COUNTRIES,
  waitForTransmission,
  type ArtifactKind,
  type TransmissionWait,
  type Transport,
} from "./uapi-client";
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
  error: {
    tone: "bg-error-soft text-error-ink",
    headline: "The call failed",
    body: "The request never reached a lifecycle state. The API log on the right holds the exchange.",
  },
};

let activeRun = 0;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ModeBanner({ mode, environment }: { mode: string; environment?: string }) {
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
  const workflow = useStore((state) => state.workflow);
  const { persona, formatId, send } = workflow;
  const editXml = workflow.edit.xml;
  const stages = workflow.validation.stages;
  const focus = useStore((state) => state.focus);
  // Arriving at Send starts the call log empty, so what appears below is this send and nothing
  // else — startup backfill and earlier attempts would otherwise be indistinguishable from it.
  // Only on a fresh arrival: coming back after a send keeps that send's calls on screen.
  useEffect(() => {
    if (store.getState().workflow.send.phase === "idle") store.clearCalls();
  }, []);

  // Read from the store, not fetched here: saving a system id in Settings has to reach this
  // preflight without a reload.
  const config = useStore((state) => state.config);
  const settings = useStore((state) => state.settings);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const meta = listPresets().find((candidate) => candidate.id === presetId);
  const country = meta?.country ?? "";
  const format = getFormat(formatId);
  const systemId = config?.personas?.[persona]?.[country as "IT" | "BE"]?.system_id;

  const operation = composeOperation(workflow);

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
  const blocked = operation.error ?? (supported ? null : unsupportedCountry(country));

  const loadArtifact = async (
    kind: ArtifactKind,
    recordId: string,
    transport: Transport,
    alive: () => boolean,
  ) => {
    try {
      const artifact = await fetchArtifact({ transport, persona, recordId, kind });
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
        store.dispatch({ type: "sendStarted", at: Date.now(), localXml });
        const started = await sendInvoice(
          { persona, country, operation: operation.value, systemId },
          mode === "MOCK" ? "MOCK" : "LIVE",
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
        wait = await waitForTransmission({ transport, persona, transactionId, transmissionId });
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
    store.dispatch({ type: "sendStopped", at: Date.now() });
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
      const blob = await fetchRecordFiles(send.transmissionId, persona);
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
          persona={persona}
          country={country}
          channel={invoice.buyer.channel}
          channelLabel={meta?.channel}
          systemId={systemId}
          config={config}
          credentials={settings?.personas?.[persona]?.credentials}
          mode={mode}
          stages={stages}
          operation={operation}
        />

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
          onClick={() => void run(false)}
          className="rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker disabled:cursor-not-allowed disabled:opacity-60"
        >
          {send.phase === "idle" ? "Send to fiskaly" : "Send again"}
        </button>
        {busy && (
          <button
            type="button"
            onClick={stop}
            className="rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-brand hover:text-ink"
          >
            Stop polling
          </button>
        )}
        {send.outcome === "timeout" && !busy && (
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
      </div>
    </section>
  );
}

function unsupportedCountry(country: string): string {
  return `This preset targets ${country || "an unknown country"}; the backend has e-invoicing systems for ${SEND_COUNTRIES.join(" and ")} only.`;
}
