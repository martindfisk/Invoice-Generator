import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FIELD_FATE_PROVENANCE } from "./field-fate";
import { Modal } from "./Modal";
import { IDENTIFIERS_SECTION_ID } from "./runner";
import {
  loadSefManifest,
  ruleSetsByOrder,
  SCHEMATRON_RULE_SETS,
  type SefManifest,
} from "./schematron-sets";
import { store, useStore, type Mode, type Theme } from "./store";
import {
  clearCredentials,
  setMode as putMode,
  updateSettings,
  type BackendMode,
  type Config,
  type CredentialState,
  type Environment,
  type Settings,
  type SettingsCountry,
  type SettingsPatch,
} from "./uapi-client";

const TITLE_ID = "settings-dialog-title";
const DESCRIPTION_ID = "settings-dialog-blurb";

const COUNTRIES: SettingsCountry[] = ["DE", "IT", "BE"];

export const LIVE_CONFIRMATION =
  "I understand: this targets production (live.api.fiskaly.com). Invoices are really " +
  "transmitted and records cannot be recalled.";

export const LIVE_BANNER =
  "Requests hit production. Invoices are transmitted for real and records cannot be recalled.";

export const MOCK_BLURB =
  "MOCK is an on-device mocked run — fixture replay, no credentials needed. LIVE makes real " +
  "calls against the fiskaly environment your credentials below point at.";

export const NO_SETTINGS_API =
  "The backend is not serving /api/settings, so environment, credentials and identifiers cannot " +
  "be changed from here.";

export const VALIDATION_RULES_SECTION_ID = "settings-validation-rules";

export const CREDENTIALS_SECTION_ID = "settings-credentials";

export const RULES_FALLBACK_NOTE =
  "public/sef/manifest.json is not built yet — run make sef. Validation falls back to the " +
  "built-in rule-set list below; versions are unknown until the manifest exists.";

export const RULES_BLURB =
  "The compiled Schematron rule sets the Validate step runs, read-only. Versions are pinned " +
  "in tools/rulesets.json and rebuilt by make schemas && make sef.";

export const SECRET_BLURB =
  "One credential set, like a Postman environment: filled in once, saved on the backend " +
  "(backend/.uapi-settings.json, git-ignored, survives restarts). Keys are posted to the " +
  "backend and never stored in this browser — after a save the field is emptied and only the " +
  "masked fingerprint the backend returns is shown.";

export const CLEAR_NOTE =
  "Removes the stored key; .env values are overridden until you save a new one.";

export const IDENTIFIERS_BLURB =
  "Routing identifiers, not secrets — shown in full so they can be checked against the invoice. " +
  "Guided provisioning in the Test runner fills these automatically; saved values persist on " +
  "the backend.";

const PRIMARY =
  "rounded-m bg-brand px-3 py-1.5 text-xs font-semibold text-bunker transition-opacity " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const SECONDARY =
  "rounded-m border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors " +
  "hover:border-brand hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

const INPUT =
  "rounded-m border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink " +
  "disabled:cursor-not-allowed disabled:opacity-60";

type Secret = { key: string; secret: string };

type Identifiers = Record<SettingsCountry, { system_id: string; taxpayer_id: string }>;

type ReseedScope = "all" | "environment" | "identifiers";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

function identifiersOf(settings: Settings | null, config: Config | null): Identifiers {
  const systems = settings?.systems ?? config?.systems;
  // Built from COUNTRIES so a new country cannot be added to the list and silently miss a field.
  return Object.fromEntries(
    COUNTRIES.map((country) => [
      country,
      {
        system_id: text(systems?.[country]?.system_id),
        taxpayer_id: text(systems?.[country]?.taxpayer_id),
      },
    ]),
  ) as Identifiers;
}

function credentialLabel(credentials: CredentialState | undefined): string {
  if (!credentials?.configured) return "not configured";
  const source =
    credentials.source === "stored"
      ? "saved on this backend (survives restarts)"
      : credentials.source === "env"
        ? "from .env"
        : credentials.source;
  return `${source} · ${credentials.fingerprint ?? "no fingerprint"}`;
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  );
}

function Section({
  id,
  title,
  blurb,
  children,
}: {
  id: string;
  title: string;
  blurb?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="border-t border-line px-4 py-3">
      <h3 id={id} className="text-xs font-semibold tracking-wide text-muted uppercase">
        {title}
      </h3>
      {blurb && <p className="mt-1 text-[11px] text-muted">{blurb}</p>}
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  disabled,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT}
      />
    </label>
  );
}

function Choice({
  name,
  checked,
  disabled,
  onSelect,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-ink">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 accent-brand"
      />
      <span>{children}</span>
    </label>
  );
}

export function ValidationRulesSection() {
  const [manifest, setManifest] = useState<SefManifest | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    void loadSefManifest().then((loaded) => {
      if (mounted) setManifest(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Section id={VALIDATION_RULES_SECTION_ID} title="Validation rules" blurb={RULES_BLURB}>
      {manifest === undefined ? (
        <p role="status" className="text-[11px] text-muted">
          Loading the rule-set manifest…
        </p>
      ) : manifest === null ? (
        <div>
          <p
            role="status"
            className="rounded-m bg-warning-soft px-3 py-2 text-[11px] text-warning-ink"
          >
            {RULES_FALLBACK_NOTE}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {[...new Set(Object.values(SCHEMATRON_RULE_SETS).flat())].map((id) => (
              <li key={id} className="font-mono text-xs text-ink">
                {id}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[11px] text-muted">
              <th scope="col" className="py-1 pr-2 font-medium">
                Rule set
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Version
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Licence
              </th>
              <th scope="col" className="py-1 font-medium">
                Built
              </th>
            </tr>
          </thead>
          <tbody>
            {ruleSetsByOrder(manifest).map((entry) => (
              <tr
                key={entry.id}
                data-rule-set={entry.id}
                className="border-t border-line align-top"
              >
                <td className="py-1 pr-2">
                  <span className="font-mono text-ink">{entry.id}</span>
                  <span className="block text-[10px] text-muted">{entry.title}</span>
                </td>
                <td className="py-1 pr-2 font-mono text-ink">{entry.version}</td>
                <td className="py-1 pr-2 text-muted">{entry.licence}</td>
                <td className="py-1 font-mono text-muted">
                  {entry.sef.buildDateTime?.slice(0, 10) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p data-provenance="field-fate" className="mt-3 text-[11px] text-muted">
        {FIELD_FATE_PROVENANCE}
      </p>
    </Section>
  );
}

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [focusSection, setFocusSection] = useState<string | undefined>(undefined);
  const request = useStore((state) => state.settingsRequest);
  // Seeded with the nonce at mount: only a request made after this menu exists opens it.
  const handled = useRef(store.getState().settingsRequest?.nonce ?? 0);
  const close = useCallback(() => {
    setOpen(false);
    setFocusSection(undefined);
  }, []);

  useEffect(() => {
    if (request && request.nonce !== handled.current) {
      handled.current = request.nonce;
      setFocusSection(request.section);
      setOpen(true);
    }
  }, [request]);

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setFocusSection(undefined);
          setOpen(true);
        }}
        className="flex items-center gap-1.5 rounded-m border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-ink"
      >
        <GearIcon />
        <span className="hidden md:inline">Settings</span>
      </button>
      <Modal open={open} labelledBy={TITLE_ID} describedBy={DESCRIPTION_ID} onClose={close}>
        <SettingsBody onClose={close} focusSection={focusSection} />
      </Modal>
    </>
  );
}

function SettingsBody({ onClose, focusSection }: { onClose: () => void; focusSection?: string }) {
  const settings = useStore((state) => state.settings);
  const settingsError = useStore((state) => state.settingsError);
  const config = useStore((state) => state.config);
  const mode = useStore((state) => state.mode);
  const theme = useStore((state) => state.theme);

  const [environment, setEnvironment] = useState<Environment>(
    () => settings?.environment ?? config?.environment ?? "test",
  );
  const [confirmLive, setConfirmLive] = useState(false);
  const [pendingLiveMode, setPendingLiveMode] = useState(false);
  const [confirmLiveMode, setConfirmLiveMode] = useState(false);
  const [secret, setSecret] = useState<Secret>({ key: "", secret: "" });
  const [identifiers, setIdentifiers] = useState<Identifiers>(() =>
    identifiersOf(settings, config),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = settings !== null;
  const credentials = settings?.credentials;
  const currentEnvironment = settings?.environment ?? config?.environment ?? "test";
  // The confirm checkbox guards the production host, not LIVE mode as such: switching mode to
  // LIVE while the environment is TEST asks for nothing.
  const productionEnvironment = currentEnvironment === "live";
  const environmentChanged = editable && environment !== currentEnvironment;
  const hasSecretPair = secret.key !== "" && secret.secret !== "";
  const halfSecret = (secret.key !== "" || secret.secret !== "") && !hasSecretPair;
  const liveNeedsConfirmation = environmentChanged && environment === "live" && !confirmLive;

  // scope: reseed everything on open, but after a save only the block that was saved —
  // "Save identifiers" must not snap an unsaved environment draft back to server values.
  const reseed = (next: Settings, scope: ReseedScope = "all") => {
    if (scope !== "identifiers") {
      setEnvironment(next.environment);
      setConfirmLive(false);
    }
    if (scope !== "environment") setIdentifiers(identifiersOf(next, null));
  };

  // The dialog mounts when it opens, so this is the "opened" hook: ask the backend what is true
  // now and re-seed the drafts from the answer rather than from whatever the shell last saw.
  useEffect(() => {
    void store.refreshBackend().then(
      () => {
        const fresh = store.getState().settings;
        if (fresh) reseed(fresh);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!focusSection) return;
    document.getElementById(focusSection)?.scrollIntoView?.({ block: "start" });
  }, [focusSection]);

  const run = async (
    action: () => Promise<Settings>,
    success: string,
    scope: ReseedScope = "all",
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      store.applySettings(next);
      reseed(next, scope);
      await store.refreshConfig();
      setNotice(success);
      return true;
    } catch (caught) {
      setError(reason(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const applyMode = async (next: BackendMode) => {
    const target: Mode = next === "live" ? "LIVE" : "MOCK";
    if (mode === target) return;
    if (settings) {
      // Mode LIVE without credentials is refused by the backend with a 409; its message is
      // surfaced verbatim below instead of being second-guessed here.
      const done = await run(() => updateSettings({ mode: next }), `Mode is now ${target}.`);
      if (done) {
        setPendingLiveMode(false);
        setConfirmLiveMode(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await putMode(next);
      store.setMode(result.mode === "live" ? "LIVE" : "MOCK");
      await store.refreshConfig();
      setPendingLiveMode(false);
      setConfirmLiveMode(false);
      setNotice(`Mode is now ${result.mode.toUpperCase()}.`);
    } catch (caught) {
      setError(reason(caught));
    } finally {
      setBusy(false);
    }
  };

  const selectLiveMode = () => {
    if (mode === "LIVE") return;
    if (productionEnvironment) {
      setPendingLiveMode(true);
      return;
    }
    void applyMode("live");
  };

  const saveEnvironment = async () => {
    if (!editable || busy || halfSecret || liveNeedsConfirmation) return;
    if (!environmentChanged && !hasSecretPair) return;
    const patch: SettingsPatch = {};
    if (environmentChanged) {
      patch.environment = environment;
      if (environment === "live") patch.confirm_live = true;
    }
    if (hasSecretPair) {
      patch.api_key = secret.key;
      patch.api_secret = secret.secret;
    }
    const parts = [
      ...(environmentChanged ? [`environment ${environment.toUpperCase()}`] : []),
      ...(hasSecretPair ? ["credentials"] : []),
    ];
    const saved = await run(
      () => updateSettings(patch),
      `Saved ${parts.join(" and ")} on the backend — persists across restarts. This browser ` +
        `kept nothing.`,
      "environment",
    );
    if (saved) setSecret({ key: "", secret: "" });
  };

  const forgetCredentials = async () => {
    const cleared = await run(
      () => clearCredentials(),
      "Credentials cleared on the backend. " + CLEAR_NOTE,
      "environment",
    );
    if (cleared) setSecret({ key: "", secret: "" });
  };

  const saveIdentifiers = async () => {
    await run(
      () => updateSettings({ systems: identifiers }),
      "Identifiers saved on the backend — persists across restarts.",
      "identifiers",
    );
  };

  const editSystem = (
    country: SettingsCountry,
    part: "system_id" | "taxpayer_id",
    value: string,
  ) => {
    setIdentifiers((current) => ({
      ...current,
      [country]: { ...current[country], [part]: value },
    }));
  };

  return (
    <div className="flex max-h-[85vh] flex-col overflow-hidden">
      <div className="flex shrink-0 items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={TITLE_ID} className="text-sm font-semibold text-ink">
            Settings
          </h2>
          <p id={DESCRIPTION_ID} className="mt-0.5 text-[11px] text-muted">
            Everything this tool talks to fiskaly with — one environment, filled in once. Saved
            values persist on the backend (backend/.uapi-settings.json, git-ignored) and survive
            restarts. No key or secret is ever stored in this browser.
          </p>
        </div>
        <button type="button" onClick={onClose} className={SECONDARY}>
          Close
        </button>
      </div>

      {!editable && (
        <p
          role="status"
          className="mx-4 mb-3 rounded-m bg-warning-soft px-3 py-2 text-[11px] text-warning-ink"
        >
          {NO_SETTINGS_API} Mode and local preferences still work.
          {settingsError ? ` (${settingsError})` : ""}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section id="settings-mode" title="Mode" blurb={MOCK_BLURB}>
          <fieldset>
            <legend className="sr-only">Backend mode</legend>
            <div className="flex flex-col gap-1.5">
              <Choice
                name="settings-mode"
                checked={mode === "MOCK" && !pendingLiveMode}
                disabled={busy}
                onSelect={() => {
                  setPendingLiveMode(false);
                  setConfirmLiveMode(false);
                  void applyMode("mock");
                }}
              >
                <span className="font-mono font-semibold">MOCK</span> — on-device mocked run:
                fixture replay, no credentials needed. Applies immediately.
              </Choice>
              {/* Only the production host stages LIVE behind a confirmation; against the TEST
                  environment the switch applies directly, gated solely by the backend's
                  credentials check. */}
              <Choice
                name="settings-mode"
                checked={mode === "LIVE" || pendingLiveMode}
                disabled={busy}
                onSelect={selectLiveMode}
              >
                <span className="font-mono font-semibold">LIVE</span> — real calls against the
                fiskaly environment your credentials below point at
                {productionEnvironment ? ". Production: needs confirmation below" : ""}. Requires
                configured credentials — the backend refuses the switch without them.
              </Choice>
            </div>
          </fieldset>
          {pendingLiveMode && mode !== "LIVE" && (
            <>
              <label className="flex items-start gap-2 rounded-m bg-error-soft px-3 py-2 text-[11px] text-error-ink">
                <input
                  type="checkbox"
                  checked={confirmLiveMode}
                  disabled={busy}
                  onChange={(event) => setConfirmLiveMode(event.target.checked)}
                  className="mt-0.5 accent-brand"
                />
                <span>{LIVE_CONFIRMATION}</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !confirmLiveMode}
                  onClick={() => void applyMode("live")}
                  className={PRIMARY}
                >
                  Apply LIVE mode
                </button>
                {!confirmLiveMode && (
                  <span className="text-[11px] text-muted">Tick the confirmation to switch.</span>
                )}
              </div>
            </>
          )}
        </Section>

        <Section id={CREDENTIALS_SECTION_ID} title="Environment credentials" blurb={SECRET_BLURB}>
          <fieldset>
            <legend className="sr-only">fiskaly environment</legend>
            <div className="flex flex-col gap-1.5">
              <Choice
                name="settings-environment"
                checked={environment === "test"}
                disabled={!editable || busy}
                onSelect={() => setEnvironment("test")}
              >
                <span className="font-mono font-semibold">TEST api</span> — test.api.fiskaly.com.
                Validation is simulated and nothing reaches a tax authority.
              </Choice>
              <Choice
                name="settings-environment"
                checked={environment === "live"}
                disabled={!editable || busy}
                onSelect={() => setEnvironment("live")}
              >
                <span className="font-mono font-semibold">LIVE api</span> — live.api.fiskaly.com.
                Production: invoices are really transmitted.
              </Choice>
            </div>
          </fieldset>
          {settings?.base_url && (
            <p className="text-[11px] text-muted">
              Currently <span className="font-mono">{settings.base_url}</span>.
            </p>
          )}
          {environmentChanged && environment === "live" && (
            <label className="flex items-start gap-2 rounded-m bg-error-soft px-3 py-2 text-[11px] text-error-ink">
              <input
                type="checkbox"
                checked={confirmLive}
                disabled={!editable || busy}
                onChange={(event) => setConfirmLive(event.target.checked)}
                className="mt-0.5 accent-brand"
              />
              <span>{LIVE_CONFIRMATION}</span>
            </label>
          )}
          <p className="text-[11px] text-muted">
            API key:{" "}
            <span
              data-credentials=""
              className={
                credentials?.configured ? "font-mono text-ink" : "font-mono text-warning-ink"
              }
            >
              {credentialLabel(credentials)}
            </span>
            {credentials && !credentials.configured && mode === "LIVE" && (
              <span className="ml-2 text-warning-ink">
                Mode is LIVE and no key is configured — every call will be refused.
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <TextField
              id="settings-api-key"
              label="API key"
              type="password"
              value={secret.key}
              disabled={!editable || busy}
              onChange={(value) => setSecret((current) => ({ ...current, key: value }))}
            />
            <TextField
              id="settings-api-secret"
              label="API secret"
              type="password"
              value={secret.secret}
              disabled={!editable || busy}
              onChange={(value) => setSecret((current) => ({ ...current, secret: value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                !editable ||
                busy ||
                halfSecret ||
                liveNeedsConfirmation ||
                (!environmentChanged && !hasSecretPair)
              }
              onClick={() => void saveEnvironment()}
              className={PRIMARY}
            >
              Save environment
            </button>
            <button
              type="button"
              disabled={!editable || busy}
              onClick={() => void forgetCredentials()}
              className={SECONDARY}
            >
              Clear credentials
            </button>
            {halfSecret ? (
              <span className="text-[11px] text-muted">
                The backend replaces the pair, so both halves are needed.
              </span>
            ) : liveNeedsConfirmation ? (
              <span className="text-[11px] text-muted">Tick the confirmation to save.</span>
            ) : null}
          </div>
          <p className="text-[11px] text-muted">Clear: {CLEAR_NOTE}</p>
        </Section>

        <Section id={IDENTIFIERS_SECTION_ID} title="Identifiers" blurb={IDENTIFIERS_BLURB}>
          <div className="flex flex-col gap-2">
            {COUNTRIES.map((country) => (
              <div key={country} className="flex flex-wrap gap-2">
                <TextField
                  id={`settings-${country}-system`}
                  label={`${country} system id`}
                  value={identifiers[country].system_id}
                  disabled={!editable || busy}
                  onChange={(value) => editSystem(country, "system_id", value)}
                />
                <TextField
                  id={`settings-${country}-taxpayer`}
                  label={`${country} taxpayer id`}
                  value={identifiers[country].taxpayer_id}
                  disabled={!editable || busy}
                  onChange={(value) => editSystem(country, "taxpayer_id", value)}
                />
              </div>
            ))}
          </div>
          <div>
            <button
              type="button"
              disabled={!editable || busy}
              onClick={() => void saveIdentifiers()}
              className={PRIMARY}
            >
              Save identifiers
            </button>
          </div>
        </Section>

        <ValidationRulesSection />

        <Section
          id="settings-local"
          title="Local preferences"
          blurb="Kept in this browser only, and never sent anywhere."
        >
          <fieldset>
            <legend className="mb-1 text-[11px] font-semibold text-ink">Theme</legend>
            <div className="flex gap-4">
              {(["light", "dark"] as Theme[]).map((option) => (
                <Choice
                  key={option}
                  name="settings-theme"
                  checked={theme === option}
                  onSelect={() => store.setTheme(option)}
                >
                  {option === "light" ? "Light" : "Dark"}
                </Choice>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                store.resetLayouts();
                setError(null);
                setNotice("Pane layouts reset to their defaults.");
              }}
              className={SECONDARY}
            >
              Reset pane layouts
            </button>
            <span className="text-[11px] text-muted">
              Forgets every <span className="font-mono">split:</span> ratio saved by the resizable
              panes.
            </span>
          </div>
          <p className="text-[11px] text-muted">
            This browser stores UI state only: the theme, the pane layouts, the section and
            collection you were on, and the workflow you left off at (invoice, edits, send record
            ids). No API key, secret or token is ever written to localStorage, sessionStorage or the
            URL.
          </p>
        </Section>
      </div>

      <div className="shrink-0 border-t border-line px-4 py-2">
        {error && (
          <p role="alert" className="rounded-m bg-error-soft px-3 py-2 text-[11px] text-error-ink">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-4 text-[11px] text-muted">
          {busy ? "Saving…" : (notice ?? "")}
        </p>
      </div>
    </div>
  );
}
