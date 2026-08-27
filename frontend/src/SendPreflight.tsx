import type { ReactNode } from "react";
import { JsonView } from "./JsonView";
import type { Channel } from "./model";
import type { Persona } from "./api-log";
import { CORRECTION_PENDING_NOTE } from "./uapi-json";
import type { Mode } from "./store";
import type { Config, CredentialState } from "./uapi-client";
import { countBySeverity, type StageResult } from "./validation";
import type { OperationView } from "./workflow";

function channelText(channel: Channel): string {
  if (channel.kind === "SDI") {
    const inbox =
      channel.codiceDestinatario === "0000000"
        ? `PEC ${channel.pec ?? "— missing"}`
        : `destination code ${channel.codiceDestinatario}`;
    return `SDI · ${inbox}`;
  }
  if (channel.kind === "PEPPOL") return `Peppol · ${channel.participantId}`;
  return `Email · ${channel.email}${channel.format ? ` · ${channel.format}` : ""}`;
}

function verdict(stages: StageResult[]): { tone: string; text: string } {
  const counts = countBySeverity(stages.flatMap((stage) => stage.findings));
  const ran = stages.some((stage) => stage.status === "passed" || stage.status === "failed");
  const notRun = stages.filter((stage) => stage.status === "unavailable").length;
  const blocking = counts.fatal + counts.error;
  if (!ran) {
    return {
      tone: "bg-warning-soft text-warning-ink",
      text: "Not validated — nothing here says this will be accepted.",
    };
  }
  if (blocking > 0) {
    return {
      tone: "bg-error-soft text-error-ink",
      text: `${blocking} error${blocking === 1 ? "" : "s"} from local validation — sending anyway will likely be rejected.`,
    };
  }
  if (notRun > 0) {
    return {
      tone: "bg-warning-soft text-warning-ink",
      text: `${notRun} validation stage${notRun === 1 ? "" : "s"} could not run — this is not a clean bill of health.`,
    };
  }
  return { tone: "border border-line text-muted", text: "Every local validation stage passed." };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 border-b border-line py-1 last:border-b-0">
      <span className="w-40 shrink-0 text-[11px] tracking-wide text-muted uppercase">{label}</span>
      <span className="min-w-0 flex-1 text-xs text-ink">{children}</span>
    </div>
  );
}

export type SendPreflightProps = {
  open: boolean;
  persona: Persona;
  country: string;
  channel: Channel;
  channelLabel?: string;
  systemId?: string;
  config: Config | null;
  credentials?: CredentialState;
  mode?: Mode;
  stages: StageResult[];
  operation: OperationView;
};

export function SendPreflight({
  open,
  persona,
  country,
  channel,
  channelLabel,
  systemId,
  config,
  credentials,
  mode,
  stages,
  operation,
}: SendPreflightProps) {
  const state = verdict(stages);
  return (
    <details open={open} className="shrink-0 rounded-l border border-line bg-surface shadow-s">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ink">
        Preflight — the JSON this Send posts
      </summary>
      <div className="border-t border-line px-3 py-2">
        <Row label="Persona">
          <span className="font-mono">{persona}</span>
          {persona === "buyer" && (
            <span className="ml-2 text-warning-ink">
              the buyer normally receives; sending as the buyer is a demo of the wrong direction
            </span>
          )}
        </Row>
        <Row label="Target system">
          {systemId ? (
            <span className="font-mono">{systemId}</span>
          ) : (
            <span className="text-warning-ink">
              No system id for {country || "this country"} — set it under Settings → Identifiers, or
              as{" "}
              <span className="font-mono">{`${persona.toUpperCase()}_SYSTEM_ID_${country || "?"}`}</span>{" "}
              in .env
            </span>
          )}
        </Row>
        <Row label="Credentials">
          {credentials?.configured ? (
            <span className="font-mono">
              {credentials.source} · {credentials.fingerprint ?? "no fingerprint"}
            </span>
          ) : credentials ? (
            <span className="text-warning-ink">
              No API key for the {persona} — set one under Settings → Credentials, or as{" "}
              <span className="font-mono">{persona.toUpperCase()}_API_KEY</span> in .env
              {mode === "LIVE" ? ". LIVE mode cannot call fiskaly without it." : ""}
            </span>
          ) : (
            <span className="text-muted">
              unknown — the backend did not report the credential state
            </span>
          )}
        </Row>
        <Row label="Channel">
          <span className="font-mono">{channelText(channel)}</span>
          <span className="ml-2 text-muted">
            {country}
            {channelLabel ? ` · ${channelLabel}` : ""}
          </span>
        </Row>
        <Row label="API">
          <span className="font-mono">POST /api/invoices</span>
          <span className="ml-2 text-muted">
            → POST /records (INTENTION) → POST /records (TRANSACTION::INVOICE)
          </span>
          {config && (
            <span className="ml-2 font-mono text-muted">
              X-Api-Version {config.api_version} · {config.environment}
            </span>
          )}
        </Row>
        <Row label="Local validation">
          <span className={`rounded-m px-2 py-0.5 ${state.tone}`}>{state.text}</span>
        </Row>
        <div className="mt-2">
          <h4 className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
            {operation.label} — the operation posted as the request body
          </h4>
          <p className="mb-1 text-[11px] text-muted">
            This is the JSON you composed, posted unchanged. There is no mapping step between
            Compose and Send — the Unified API accepts this structure, and fiskaly generates the
            transmitted XML from it server-side.
          </p>
          {operation.correctionPending && (
            <p className="mb-1 text-[11px] text-warning-ink">{CORRECTION_PENDING_NOTE}</p>
          )}
          {operation.error ? (
            <p role="alert" className="rounded-m bg-error-soft px-2 py-1 text-xs text-error-ink">
              {operation.error}
            </p>
          ) : (
            <JsonView text={operation.text} label="Operation payload" maxHeight={260} />
          )}
        </div>
      </div>
    </details>
  );
}
