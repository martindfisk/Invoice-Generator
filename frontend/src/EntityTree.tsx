import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Persona } from "./api-log";
import { Modal } from "./Modal";
import {
  ACCOUNT_LIFECYCLE_HINT,
  ACCOUNT_NOT_REPORTED,
  DEGRADED_NO_CAUSE,
  IDLE_FETCH,
  IT_SECRETS_NOTE,
  LIVE_BILLING_NOTE,
  ONE_WAY_NOTE,
  TEST_BILLING_NOTE,
  accountTone,
  availableCountries,
  blockedByLine,
  complianceGloss,
  countryEntities,
  countryRow,
  missingLines,
  noCredentialsHint,
  systemHint,
  systemStateText,
  systemTone,
  taxpayerTone,
  verbatim,
  type CountryRow,
  type NodeTone,
  type TreeFetch,
} from "./onboarding";
import { COUNTRY_LOCKED_WHILE_RUNNING, selectCountry } from "./runner-actions";
import { useStore, type Mode } from "./store";
import {
  getOnboardingStatus,
  provisionCountry,
  type Environment,
  type OnboardingEntity,
  type OnboardingStatus,
  type OnboardingSystem,
  type ProvisionRequest,
  type ProvisionResult,
  type ProvisionStep,
} from "./uapi-client";

const PERSONAS: { id: Persona; label: string }[] = [
  { id: "seller", label: "Seller" },
  { id: "buyer", label: "Buyer" },
];

const TONE: Record<NodeTone, { glyph: string; chip: string; mark: string }> = {
  success: { glyph: "●", chip: "border-success text-success", mark: "text-success" },
  warning: {
    glyph: "▲",
    chip: "border-warning bg-warning-soft text-warning-ink",
    mark: "text-warning-ink",
  },
  neutral: { glyph: "◍", chip: "border-line text-muted", mark: "text-muted" },
  missing: { glyph: "○", chip: "border-dashed border-line text-muted", mark: "text-muted" },
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function NodeRow({
  entity,
  label,
  tone,
  stateText,
  stateHint,
  detail,
  note,
}: {
  entity: string;
  label: string;
  tone: NodeTone;
  stateText: string;
  stateHint?: string;
  detail?: ReactNode;
  note?: ReactNode;
}) {
  const look = TONE[tone];
  return (
    <li
      data-entity={entity}
      data-entity-state={stateText}
      className={`group relative py-1.5 pr-2 pl-9 ${tone === "missing" ? "opacity-70" : ""}`}
    >
      <span
        aria-hidden="true"
        className="absolute top-0 bottom-0 left-[1.05rem] w-px bg-line group-first:top-2.5 group-last:bottom-auto group-last:h-2.5 group-only:hidden"
      />
      <span
        aria-hidden="true"
        className={`absolute top-2 left-2 grid h-4 w-4 place-items-center rounded-full border-2 border-canvas bg-surface font-mono text-[10px] leading-none ${look.mark}`}
      >
        {look.glyph}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={`font-mono text-[11px] ${tone === "missing" ? "text-muted" : "text-ink"}`}>
          {label}
        </span>
        <span
          title={stateHint}
          className={`rounded-m border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${look.chip}`}
        >
          {stateText}
        </span>
        {detail}
      </div>
      {note}
    </li>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10px] break-all text-muted">{children}</span>;
}

function AccountRows({
  kind,
  entities,
  count,
}: {
  kind: "Organization" | "Subject";
  entities: OnboardingEntity[] | null | undefined;
  count: number;
}) {
  const entityKey = kind.toLowerCase();
  if (Array.isArray(entities) && entities.length > 0) {
    return (
      <>
        {entities.map((entity) => (
          <NodeRow
            key={entity.id}
            entity={entityKey}
            label={entity.type ? `${kind} · ${entity.type}` : kind}
            tone={accountTone(entity.state)}
            stateText={entity.state ?? "unknown state"}
            stateHint={ACCOUNT_LIFECYCLE_HINT}
            detail={entity.name ? <Detail>{entity.name}</Detail> : undefined}
          />
        ))}
      </>
    );
  }
  if (count > 0) {
    return (
      <NodeRow
        entity={entityKey}
        label={kind}
        tone="neutral"
        stateText={`${count} present`}
        stateHint={`${ACCOUNT_LIFECYCLE_HINT} Details are not reported by this backend version.`}
      />
    );
  }
  return (
    <NodeRow
      entity={entityKey}
      label={kind}
      tone="missing"
      stateText="none reported"
      stateHint={`${ACCOUNT_LIFECYCLE_HINT} These ${ACCOUNT_NOT_REPORTED}.`}
    />
  );
}

// Healthy facts (registrations, Peppol id, "sends and receives") live in the state chip's
// tooltip; a visible line appears only when something actually blocks a send.
function SystemIssues({ system }: { system: OnboardingSystem }) {
  const compliance = system.compliance_state ?? null;
  const limited = compliance !== null && compliance !== "TRANSMISSION_RECEPTION";
  const degraded = system.state === "COMMISSIONED" && system.mode === "DEGRADED";
  if (!system.blocked_by && !limited && !degraded) return null;
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      {limited && (
        <p data-compliance={compliance} className="text-[11px] text-warning-ink">
          {complianceGloss(compliance)}
        </p>
      )}
      {system.blocked_by ? (
        <p
          data-blocked-by={system.blocked_by}
          className="rounded-m bg-warning-soft px-2 py-1 text-[11px] text-warning-ink"
        >
          {blockedByLine(system.blocked_by)}
        </p>
      ) : (
        degraded && <p className="text-[11px] text-warning-ink">{DEGRADED_NO_CAUSE}</p>
      )}
    </div>
  );
}

function CountryGroup({
  persona,
  country,
  status,
  onProvision,
}: {
  persona: Persona;
  country: CountryRow;
  status: OnboardingStatus;
  onProvision: (persona: Persona, country: CountryRow) => void;
}) {
  const { taxpayers, systems } = countryEntities(status, country.code);
  const ready = status.ready?.[country.code] === true;
  const missing = ready ? [] : missingLines(status, country.code);
  return (
    <li data-country={country.code} data-ready={ready} className="py-1.5 pr-2 pl-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink">{country.label}</span>
        {ready ? (
          <span className="rounded-m border border-success px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-success uppercase">
            Ready
          </span>
        ) : (
          <span className="rounded-m border border-line px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
            Not ready
          </span>
        )}
        <button
          type="button"
          aria-label={`Provision ${country.label} for ${persona}`}
          onClick={() => onProvision(persona, country)}
          className="ml-auto rounded-m border border-line px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-brand hover:text-ink"
        >
          Provision
        </button>
      </div>
      <ul aria-label={`${country.label} entities`} className="mt-1">
        {taxpayers.length === 0 && (
          <NodeRow
            entity={`taxpayer-${country.code}`}
            label="Taxpayer::COMPANY"
            tone="missing"
            stateText="not created"
          />
        )}
        {taxpayers.map((taxpayer) => (
          <NodeRow
            key={taxpayer.id}
            entity={`taxpayer-${country.code}`}
            label="Taxpayer::COMPANY"
            tone={taxpayerTone(taxpayer)}
            stateText={taxpayer.state ?? "unknown state"}
            detail={
              <>
                {taxpayer.name && <Detail>{taxpayer.name}</Detail>}
                {taxpayer.vat_id && <Detail>{taxpayer.vat_id}</Detail>}
              </>
            }
          />
        ))}
        {systems.length === 0 && (
          <NodeRow
            entity={`system-${country.code}`}
            label="System::E_INVOICE_SERVICE"
            tone="missing"
            stateText="not created"
          />
        )}
        {systems.map((system) => (
          <NodeRow
            key={system.id}
            entity={`system-${country.code}`}
            label={`System::${system.type ?? "E_INVOICE_SERVICE"}`}
            tone={systemTone(system)}
            stateText={systemStateText(system)}
            stateHint={systemHint(system) || undefined}
            note={<SystemIssues system={system} />}
          />
        ))}
      </ul>
      {missing.length > 0 && (
        <div data-missing={country.code} className="mt-1 ml-9">
          {missing.map((line) => (
            <p
              key={line}
              className="rounded-m bg-warning-soft px-2 py-1 text-[11px] text-warning-ink"
            >
              Backend says not ready: <span className="font-mono">{line}</span>
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

export function PersonaTree({
  persona,
  label,
  active,
  mode,
  country,
  fetch,
  onProvision,
}: {
  persona: Persona;
  label: string;
  active: boolean;
  mode: Mode;
  country: CountryRow;
  fetch: TreeFetch;
  onProvision: (persona: Persona, country: CountryRow) => void;
}) {
  const status = fetch.status;
  const credentials = status?.credentials;
  const credentialText = credentials?.configured
    ? `credentials ${credentials.source} · ${credentials.fingerprint ?? "no fingerprint"}`
    : "no credentials";
  const withheld = mode === "LIVE" && credentials !== undefined && !credentials.configured;
  return (
    <section
      aria-label={`${label} entities`}
      data-persona-tree={persona}
      className={`rounded-l border bg-surface ${active ? "border-brand" : "border-line"}`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h4 className="text-xs font-semibold text-ink">{label}</h4>
        {active && (
          <span
            title="The workflow currently acts as this persona — sends and runner calls use its credentials and identifiers. Switch with the persona control in the workflow header."
            className="rounded-m bg-select-bg px-1.5 py-0.5 text-[10px] font-medium text-ink"
          >
            active persona
          </span>
        )}
        <span
          className={`font-mono text-[10px] ${
            credentials?.configured ? "text-muted" : "text-warning-ink"
          }`}
        >
          {status ? credentialText : ""}
        </span>
        {status?.environment && (
          <span className="ml-auto font-mono text-[10px] text-muted uppercase">
            {status.environment}
          </span>
        )}
      </header>
      <div className="px-1 py-1">
        {fetch.loading && !status && (
          <p role="status" className="px-2 py-1 text-[11px] text-muted">
            Loading entities…
          </p>
        )}
        {fetch.error && (
          <p className="mx-2 my-1 rounded-m bg-error-soft px-2 py-1.5 text-[11px] text-error-ink">
            {fetch.error}
          </p>
        )}
        {status && withheld && (
          <p
            data-no-credentials={persona}
            className="mx-2 my-1 rounded-m bg-warning-soft px-2 py-1.5 text-[11px] text-warning-ink"
          >
            {noCredentialsHint(persona)}
          </p>
        )}
        {status && !withheld && (
          <ul aria-label={`${label} entity tree`}>
            <AccountRows
              kind="Organization"
              entities={status.organizations}
              count={status.counts?.organizations ?? 0}
            />
            <AccountRows
              kind="Subject"
              entities={status.subjects}
              count={status.counts?.subjects ?? 0}
            />
            <CountryGroup
              persona={persona}
              country={country}
              status={status}
              onProvision={onProvision}
            />
          </ul>
        )}
      </div>
    </section>
  );
}

const PRIMARY =
  "rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker transition-opacity " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const SECONDARY =
  "rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors " +
  "hover:border-brand hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

const INPUT =
  "rounded-m border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink " +
  "disabled:cursor-not-allowed disabled:opacity-60";

function StepLine({ step }: { step: ProvisionStep }) {
  const chip =
    step.status === "passed"
      ? "border-success text-success"
      : step.status === "failed"
        ? "border-error bg-error-soft text-error-ink"
        : "border-dashed border-line text-muted";
  return (
    <li data-provision-step={step.name} data-status={step.status} className="py-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] text-ink">{step.name}</span>
        <span
          className={`rounded-m border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${chip}`}
        >
          {step.status}
        </span>
        <span className="font-mono text-[10px] break-all text-muted">
          {step.method} {step.path}
        </span>
        {step.id && <span className="font-mono text-[10px] break-all text-muted">{step.id}</span>}
      </div>
      {step.error !== undefined && step.error !== null && (
        <p className="mt-0.5 rounded-m bg-error-soft px-2 py-1 font-mono text-[10px] break-all text-error-ink">
          {verbatim(step.error)}
        </p>
      )}
    </li>
  );
}

export function ProvisionDialog({
  persona,
  country,
  environment,
  onClose,
  onDone,
}: {
  persona: Persona;
  country: CountryRow;
  environment: Environment | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [taxId, setTaxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);

  const needsSecrets = country.code === "IT";
  const secretsMissing = needsSecrets && (pin === "" || password === "" || taxId === "");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: ProvisionRequest = {
        persona,
        country: country.code,
        confirm: true,
        reuse: true,
      };
      if (needsSecrets) {
        body.taxpayer = {
          fiscalization: {
            credentials: { pin, password, tax_id_number: taxId },
          },
        };
      }
      const outcome = await provisionCountry(body);
      // Secrets are cleared only once they are no longer needed — a failed provision keeps
      // them in the fields so Retry does not force the user to re-enter them.
      if (outcome.ready) {
        setPin("");
        setPassword("");
        setTaxId("");
      }
      setResult(outcome);
      onDone();
    } catch (caught) {
      setError(reason(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      labelledBy="provision-title"
      describedBy="provision-blurb"
      // Provisioning creates real entities; dismissing mid-flight would hide its outcome, so
      // Escape/backdrop are inert while a request is running.
      onClose={busy ? () => {} : onClose}
      className="max-w-lg p-4"
    >
      <h3 id="provision-title" className="text-sm font-semibold text-ink">
        Provision {country.label} for the {persona}
      </h3>
      <div id="provision-blurb" className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
        <p>
          This creates and commissions a <span className="font-mono">Taxpayer::COMPANY</span> for{" "}
          {country.label} and a <span className="font-mono">System::E_INVOICE_SERVICE</span>{" "}
          registered for <span className="font-mono">{country.registration}</span>
          {environment ? (
            <>
              {" "}
              in the <span className="font-mono uppercase">{environment}</span> environment
            </>
          ) : null}
          . A matching taxpayer or system that already exists is reused, not duplicated.
        </p>
        <p>{ONE_WAY_NOTE}</p>
        {environment === "live" ? (
          <p className="rounded-m bg-error-soft px-2 py-1.5 text-error-ink">{LIVE_BILLING_NOTE}</p>
        ) : (
          <p>{TEST_BILLING_NOTE}</p>
        )}
      </div>

      {needsSecrets && (result === null || !result.ready) && (
        <fieldset className="mt-3 rounded-m border border-line px-3 pt-1 pb-3">
          <legend className="px-1 text-[11px] font-semibold text-ink">
            FISCONLINE credentials
          </legend>
          <p className="mb-2 text-[11px] text-muted">{IT_SECRETS_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="provision-it-pin" className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[11px] text-muted">FISCONLINE PIN</span>
              <input
                id="provision-it-pin"
                type="password"
                value={pin}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(event) => setPin(event.target.value)}
                className={INPUT}
              />
            </label>
            <label htmlFor="provision-it-password" className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[11px] text-muted">FISCONLINE password</span>
              <input
                id="provision-it-password"
                type="password"
                value={password}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                className={INPUT}
              />
            </label>
            <label htmlFor="provision-it-taxid" className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[11px] text-muted">FISCONLINE tax id (codice fiscale)</span>
              <input
                id="provision-it-taxid"
                type="text"
                value={taxId}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(event) => setTaxId(event.target.value)}
                className={INPUT}
              />
            </label>
          </div>
          {secretsMissing && (
            <p className="mt-1 text-[11px] text-muted">
              Italy cannot be provisioned without them — they are never defaulted.
            </p>
          )}
        </fieldset>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-m bg-error-soft px-3 py-2 font-mono text-[11px] break-all text-error-ink"
        >
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3">
          <ol aria-label="Provision steps" className="rounded-m border border-line px-3 py-1">
            {result.steps.map((step, index) => (
              <StepLine key={`${index}-${step.name}`} step={step} />
            ))}
          </ol>
          <p
            data-provision-ready={result.ready}
            className={`mt-2 text-xs ${result.ready ? "text-success" : "text-warning-ink"}`}
          >
            {result.ready
              ? `${country.label} is ready — the system is COMMISSIONED / OPERATIVE.`
              : `${country.label} is not ready yet — see the step results above; the tree shows the backend's missing line.`}
          </p>
        </div>
      )}

      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-[11px] text-muted">
        {busy ? "Provisioning…" : ""}
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={SECONDARY} disabled={busy} onClick={onClose}>
          {result ? "Close" : "Cancel"}
        </button>
        {result === null ? (
          <button
            type="button"
            className={PRIMARY}
            disabled={busy || secretsMissing}
            onClick={() => void submit()}
          >
            Provision {country.label}
          </button>
        ) : (
          !result.ready && (
            <button
              type="button"
              className={PRIMARY}
              disabled={busy || secretsMissing}
              onClick={() => void submit()}
            >
              Retry
            </button>
          )
        )}
      </div>
    </Modal>
  );
}

const TREE_OPEN_KEY = "entity-tree:open";

function readTreeOpen(): boolean {
  try {
    return localStorage.getItem(TREE_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveTreeOpen(open: boolean): void {
  try {
    localStorage.setItem(TREE_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Site data disabled: the fold simply is not remembered.
  }
}

// Folded, the panel still answers its one question: which country is selected and is it ready.
function FoldedSummary({
  country,
  trees,
}: {
  country: CountryRow | null;
  trees: Record<Persona, TreeFetch>;
}) {
  if (!country) {
    return (
      <p data-tree-summary className="w-full text-[11px] text-muted">
        No country selected yet.
      </p>
    );
  }
  return (
    <p data-tree-summary className="flex w-full flex-wrap items-center gap-1.5 text-[11px]">
      <span className="font-medium text-ink">{country.label}</span>
      {PERSONAS.map(({ id, label }) => {
        const ready = trees[id].status?.ready?.[country.code];
        const chip =
          ready === true
            ? "border-success text-success"
            : ready === false
              ? "border-line text-muted"
              : "border-dashed border-line text-muted";
        return (
          <span
            key={id}
            data-summary-persona={id}
            data-summary-ready={String(ready ?? "unknown")}
            className={`rounded-m border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${chip}`}
          >
            {label} {ready === true ? "ready" : ready === false ? "not ready" : "unknown"}
          </span>
        );
      })}
    </p>
  );
}

export function EntityTree() {
  const settings = useStore((state) => state.settings);
  const mode = useStore((state) => state.mode);
  const activePersona = useStore((state) => state.workflow.persona);
  const environment = useStore((state) => state.settings?.environment ?? state.config?.environment);
  const collections = useStore((state) => state.runner.collections);
  const collectionId = useStore((state) => state.runner.collectionId);
  const running = useStore((state) => state.runner.running);
  const [trees, setTrees] = useState<Record<Persona, TreeFetch>>({
    seller: IDLE_FETCH,
    buyer: IDLE_FETCH,
  });
  const [open, setOpen] = useState(readTreeOpen);
  const [provisioning, setProvisioning] = useState<{
    persona: Persona;
    country: CountryRow;
  } | null>(null);

  const refresh = useCallback(async () => {
    setTrees((current) => ({
      seller: { ...current.seller, loading: true },
      buyer: { ...current.buyer, loading: true },
    }));
    await Promise.all(
      PERSONAS.map(async ({ id }) => {
        try {
          const status = await getOnboardingStatus(id);
          setTrees((current) => ({
            ...current,
            [id]: { status, error: null, loading: false },
          }));
        } catch (caught) {
          setTrees((current) => ({
            ...current,
            [id]: { ...current[id], error: reason(caught), loading: false },
          }));
        }
      }),
    );
  }, []);

  // The account contents can only change when the backend-facing settings document or the
  // mode changes, so those two are the refetch triggers besides the explicit button.
  useEffect(() => {
    void refresh();
  }, [refresh, settings, mode]);

  const countries = useMemo(
    () => availableCountries(collections, [trees.seller.status, trees.buyer.status]),
    [collections, trees],
  );
  const selectedCode = collectionId?.toUpperCase() ?? null;
  const selected =
    countries.find((entry) => entry.code === selectedCode) ??
    (selectedCode !== null ? countryRow(selectedCode) : (countries[0] ?? null));

  const loading = trees.seller.loading || trees.buyer.loading;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    saveTreeOpen(next);
  };

  return (
    <section
      aria-label="Entity tree"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-canvas"
    >
      <header className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <h3 className="min-w-0 text-sm font-semibold text-ink">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="entity-tree-body"
            onClick={toggle}
            title="What exists on the fiskaly account each persona talks to — and what a send still needs."
            className="flex items-center gap-1.5 text-left hover:text-brand"
          >
            <span aria-hidden="true" className="w-2 shrink-0 text-muted">
              {open ? "▾" : "▸"}
            </span>
            fiskaly entities
          </button>
        </h3>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="ml-auto rounded-m border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refresh
        </button>
        <p role="status" aria-live="polite" className="text-[11px] text-muted">
          {loading ? "Refreshing…" : ""}
        </p>
        {open ? (
          countries.length > 0 && (
            <div
              role="group"
              aria-label="Country"
              className="flex w-full flex-wrap items-center gap-1.5"
            >
              {countries.map((entry) => (
                <button
                  key={entry.code}
                  type="button"
                  data-country-pick={entry.code}
                  aria-pressed={selected?.code === entry.code}
                  disabled={running}
                  title={
                    running
                      ? COUNTRY_LOCKED_WHILE_RUNNING
                      : `One choice, two controls: this also selects the ${entry.label} collection in the runner.`
                  }
                  onClick={() => void selectCountry(entry.code)}
                  className={`rounded-m border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected?.code === entry.code
                      ? "border-brand bg-select-bg text-ink"
                      : "border-line text-muted hover:border-brand hover:text-ink"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
              {running && (
                <span className="text-[10px] text-muted">{COUNTRY_LOCKED_WHILE_RUNNING}</span>
              )}
            </div>
          )
        ) : (
          <FoldedSummary country={selected} trees={trees} />
        )}
      </header>
      {open && (
        <div id="entity-tree-body" className="flex flex-col gap-3 p-3">
          {selected === null ? (
            <p className="text-xs text-muted">
              No countries reported yet — the selectable list comes from the backend&apos;s
              collections and onboarding status.
            </p>
          ) : (
            PERSONAS.map(({ id, label }) => (
              <PersonaTree
                key={id}
                persona={id}
                label={label}
                active={activePersona === id}
                mode={mode}
                country={selected}
                fetch={trees[id]}
                onProvision={(persona, country) => setProvisioning({ persona, country })}
              />
            ))
          )}
        </div>
      )}
      {provisioning && (
        <ProvisionDialog
          persona={provisioning.persona}
          country={provisioning.country}
          environment={environment}
          onClose={() => setProvisioning(null)}
          onDone={() => void refresh()}
        />
      )}
    </section>
  );
}
