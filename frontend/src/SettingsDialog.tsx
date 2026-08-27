import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Persona } from "./api-log";
import { Modal } from "./Modal";
import { store, useStore, type Mode, type Theme } from "./store";
import {
  clearCredentials,
  setMode as putMode,
  updateSettings,
  type BackendMode,
  type Config,
  type CredentialState,
  type Environment,
  type PersonaPatch,
  type PersonaSettings,
  type Settings,
  type SettingsCountry,
  type SettingsPatch,
} from "./uapi-client";

const TITLE_ID = "settings-dialog-title";
const DESCRIPTION_ID = "settings-dialog-blurb";

const COUNTRIES: SettingsCountry[] = ["IT", "BE"];

const PERSONAS: { id: Persona; label: string }[] = [
  { id: "seller", label: "Seller" },
  { id: "buyer", label: "Buyer" },
];

export const LIVE_CONFIRMATION =
  "I understand: LIVE posts to production. Invoices are really transmitted and records cannot " +
  "be recalled.";

export const LIVE_BANNER =
  "Requests hit production. Invoices are transmitted for real and records cannot be recalled.";

export const MOCK_BLURB =
  "MOCK replays recorded fixtures from the backend — no request leaves this machine.";

export const NO_SETTINGS_API =
  "The backend is not serving /api/settings, so environment, credentials and identifiers cannot " +
  "be changed from here.";

export const SECRET_BLURB =
  "Keys are posted to the backend and never stored in this browser. After a save the field is " +
  "emptied and only the masked fingerprint the backend returns is shown.";

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

type Identifiers = {
  systems: Record<SettingsCountry, { system_id: string; taxpayer_id: string }>;
  sdi_destination_code: string;
  peppol_id: string;
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

function personaOf(settings: Settings | null, persona: Persona): PersonaSettings | undefined {
  return settings?.personas?.[persona];
}

function identifiersOf(
  settings: Settings | null,
  config: Config | null,
  persona: Persona,
): Identifiers {
  const known = personaOf(settings, persona);
  const systems = known?.systems ?? config?.personas?.[persona];
  return {
    systems: {
      IT: {
        system_id: text(systems?.IT?.system_id),
        taxpayer_id: text(systems?.IT?.taxpayer_id),
      },
      BE: {
        system_id: text(systems?.BE?.system_id),
        taxpayer_id: text(systems?.BE?.taxpayer_id),
      },
    },
    sdi_destination_code: text(known?.recipients?.sdi_destination_code),
    peppol_id: text(known?.recipients?.peppol_id),
  };
}

function credentialLabel(credentials: CredentialState | undefined): string {
  if (!credentials?.configured) return "not configured";
  return `${credentials.source} · ${credentials.fingerprint ?? "no fingerprint"}`;
}

function patchFor(persona: Persona, patch: PersonaPatch): SettingsPatch["personas"] {
  return persona === "seller" ? { seller: patch } : { buyer: patch };
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

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-m border border-line px-3 pt-1 pb-3">
      <legend className="px-1 text-[11px] font-semibold text-ink">{label}</legend>
      {children}
    </fieldset>
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

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-m border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-ink"
      >
        <GearIcon />
        <span className="hidden md:inline">Settings</span>
      </button>
      <Modal open={open} labelledBy={TITLE_ID} describedBy={DESCRIPTION_ID} onClose={close}>
        <SettingsBody onClose={close} />
      </Modal>
    </>
  );
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const settings = useStore((state) => state.settings);
  const settingsError = useStore((state) => state.settingsError);
  const config = useStore((state) => state.config);
  const mode = useStore((state) => state.mode);
  const theme = useStore((state) => state.theme);

  const [environment, setEnvironment] = useState<Environment>(
    () => settings?.environment ?? config?.environment ?? "test",
  );
  const [confirmLive, setConfirmLive] = useState(false);
  const [secrets, setSecrets] = useState<Record<Persona, Secret>>({
    seller: { key: "", secret: "" },
    buyer: { key: "", secret: "" },
  });
  const [identifiers, setIdentifiers] = useState<Record<Persona, Identifiers>>(() => ({
    seller: identifiersOf(settings, config, "seller"),
    buyer: identifiersOf(settings, config, "buyer"),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = settings !== null;
  const currentEnvironment = settings?.environment ?? config?.environment ?? "test";
  const liveNeedsConfirmation = environment === "live" && !confirmLive;

  const reseed = (next: Settings) => {
    setEnvironment(next.environment);
    setConfirmLive(false);
    setIdentifiers({
      seller: identifiersOf(next, null, "seller"),
      buyer: identifiersOf(next, null, "buyer"),
    });
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

  const run = async (action: () => Promise<Settings>, success: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      store.applySettings(next);
      reseed(next);
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

  const applyEnvironment = async () => {
    if (!editable || environment === currentEnvironment) return;
    if (liveNeedsConfirmation) return;
    await run(
      () =>
        updateSettings(
          environment === "live"
            ? { environment: "live", confirm_live: true }
            : { environment: "test" },
        ),
      `Environment is now ${environment.toUpperCase()}.`,
    );
  };

  const applyMode = async (next: BackendMode) => {
    const current: Mode = next === "live" ? "LIVE" : "MOCK";
    if (mode === current) return;
    if (settings) {
      await run(() => updateSettings({ mode: next }), `Mode is now ${current}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await putMode(next);
      store.setMode(result.mode === "live" ? "LIVE" : "MOCK");
      await store.refreshConfig();
      setNotice(`Mode is now ${result.mode.toUpperCase()}.`);
    } catch (caught) {
      setError(reason(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveCredentials = async (persona: Persona) => {
    const draft = secrets[persona];
    // A key without its secret is not half a credential, it is a broken one: the backend replaces
    // the pair, so both halves have to travel together.
    if (!draft.key || !draft.secret) return;
    const patch: PersonaPatch = { api_key: draft.key, api_secret: draft.secret };
    const saved = await run(
      () => updateSettings({ personas: patchFor(persona, patch) }),
      `${persona} credentials saved on the backend. This browser kept nothing.`,
    );
    if (saved) {
      setSecrets((current) => ({ ...current, [persona]: { key: "", secret: "" } }));
    }
  };

  const forgetCredentials = async (persona: Persona) => {
    const cleared = await run(
      () => clearCredentials(persona),
      `${persona} credentials cleared on the backend.`,
    );
    if (cleared) {
      setSecrets((current) => ({ ...current, [persona]: { key: "", secret: "" } }));
    }
  };

  const saveIdentifiers = async (persona: Persona) => {
    const draft = identifiers[persona];
    const patch: PersonaPatch = { systems: draft.systems };
    if (persona === "buyer") {
      patch.recipients = {
        sdi_destination_code: draft.sdi_destination_code,
        peppol_id: draft.peppol_id,
      };
    }
    await run(
      () => updateSettings({ personas: patchFor(persona, patch) }),
      `${persona} identifiers saved.`,
    );
  };

  const editSecret = (persona: Persona, part: keyof Secret, value: string) => {
    setSecrets((current) => ({ ...current, [persona]: { ...current[persona], [part]: value } }));
  };

  const editSystem = (
    persona: Persona,
    country: SettingsCountry,
    part: "system_id" | "taxpayer_id",
    value: string,
  ) => {
    setIdentifiers((current) => ({
      ...current,
      [persona]: {
        ...current[persona],
        systems: {
          ...current[persona].systems,
          [country]: { ...current[persona].systems[country], [part]: value },
        },
      },
    }));
  };

  const editRecipient = (
    persona: Persona,
    part: "sdi_destination_code" | "peppol_id",
    value: string,
  ) => {
    setIdentifiers((current) => ({
      ...current,
      [persona]: { ...current[persona], [part]: value },
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
            Everything this tool talks to fiskaly with. No key or secret is ever stored in this
            browser.
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
        <Section
          id="settings-environment"
          title="Environment"
          blurb={
            <>
              Which fiskaly host every call goes to
              {settings?.base_url ? (
                <>
                  {" — currently "}
                  <span className="font-mono">{settings.base_url}</span>
                </>
              ) : null}
              .
            </>
          }
        >
          <fieldset>
            <legend className="sr-only">fiskaly environment</legend>
            <div className="flex flex-col gap-1.5">
              <Choice
                name="settings-environment"
                checked={environment === "test"}
                disabled={!editable || busy}
                onSelect={() => setEnvironment("test")}
              >
                <span className="font-mono font-semibold">TEST</span> — test.api.fiskaly.com.
                Validation is simulated and nothing reaches a tax authority.
              </Choice>
              <Choice
                name="settings-environment"
                checked={environment === "live"}
                disabled={!editable || busy}
                onSelect={() => setEnvironment("live")}
              >
                <span className="font-mono font-semibold">LIVE</span> — live.api.fiskaly.com.
                Production: invoices are really transmitted.
              </Choice>
            </div>
          </fieldset>
          {environment === "live" && (
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={
                !editable || busy || environment === currentEnvironment || liveNeedsConfirmation
              }
              onClick={() => void applyEnvironment()}
              className={PRIMARY}
            >
              Apply environment
            </button>
            {liveNeedsConfirmation && (
              <span className="text-[11px] text-muted">Tick the confirmation to switch.</span>
            )}
          </div>
        </Section>

        <Section id="settings-mode" title="Mode" blurb={MOCK_BLURB}>
          <fieldset>
            <legend className="sr-only">Backend mode</legend>
            <div className="flex flex-col gap-1.5">
              <Choice
                name="settings-mode"
                checked={mode === "LIVE"}
                disabled={busy}
                onSelect={() => void applyMode("live")}
              >
                <span className="font-mono font-semibold">LIVE</span> — real HTTP calls to the
                environment above.
              </Choice>
              <Choice
                name="settings-mode"
                checked={mode === "MOCK"}
                disabled={busy}
                onSelect={() => void applyMode("mock")}
              >
                <span className="font-mono font-semibold">MOCK</span> — recorded fixtures, replayed
                through the same client code.
              </Choice>
            </div>
          </fieldset>
        </Section>

        <Section id="settings-credentials" title="Credentials" blurb={SECRET_BLURB}>
          {PERSONAS.map(({ id, label }) => {
            const credentials = personaOf(settings, id)?.credentials;
            const draft = secrets[id];
            return (
              <Group key={id} label={`${label} credentials`}>
                <p className="mb-2 text-[11px] text-muted">
                  API key:{" "}
                  <span
                    data-credentials={id}
                    className={
                      credentials?.configured ? "font-mono text-ink" : "font-mono text-warning-ink"
                    }
                  >
                    {credentialLabel(credentials)}
                  </span>
                  {credentials && !credentials.configured && mode === "LIVE" && (
                    <span className="ml-2 text-warning-ink">
                      Mode is LIVE and this persona has no key — every call it makes will be
                      refused.
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <TextField
                    id={`settings-${id}-api-key`}
                    label="API key"
                    type="password"
                    value={draft.key}
                    disabled={!editable || busy}
                    onChange={(value) => editSecret(id, "key", value)}
                  />
                  <TextField
                    id={`settings-${id}-api-secret`}
                    label="API secret"
                    type="password"
                    value={draft.secret}
                    disabled={!editable || busy}
                    onChange={(value) => editSecret(id, "secret", value)}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!editable || busy || !draft.key || !draft.secret}
                    onClick={() => void saveCredentials(id)}
                    className={PRIMARY}
                  >
                    Save {label.toLowerCase()} credentials
                  </button>
                  <button
                    type="button"
                    disabled={!editable || busy}
                    onClick={() => void forgetCredentials(id)}
                    className={SECONDARY}
                  >
                    Clear {label.toLowerCase()} credentials
                  </button>
                  {(draft.key || draft.secret) && !(draft.key && draft.secret) && (
                    <span className="text-[11px] text-muted">
                      The backend replaces the pair, so both halves are needed.
                    </span>
                  )}
                </div>
              </Group>
            );
          })}
        </Section>

        <Section
          id="settings-identifiers"
          title="Identifiers"
          blurb="Routing identifiers, not secrets — shown in full so they can be checked against the invoice."
        >
          {PERSONAS.map(({ id, label }) => (
            <Group key={id} label={`${label} identifiers`}>
              <div className="flex flex-col gap-2">
                {COUNTRIES.map((country) => (
                  <div key={country} className="flex flex-wrap gap-2">
                    <TextField
                      id={`settings-${id}-${country}-system`}
                      label={`${country} system id`}
                      value={identifiers[id].systems[country].system_id}
                      disabled={!editable || busy}
                      onChange={(value) => editSystem(id, country, "system_id", value)}
                    />
                    <TextField
                      id={`settings-${id}-${country}-taxpayer`}
                      label={`${country} taxpayer id`}
                      value={identifiers[id].systems[country].taxpayer_id}
                      disabled={!editable || busy}
                      onChange={(value) => editSystem(id, country, "taxpayer_id", value)}
                    />
                  </div>
                ))}
                {id === "buyer" && (
                  <div className="flex flex-wrap gap-2">
                    <TextField
                      id="settings-buyer-sdi"
                      label="SDI destination code"
                      value={identifiers.buyer.sdi_destination_code}
                      disabled={!editable || busy}
                      placeholder="0000000"
                      onChange={(value) => editRecipient("buyer", "sdi_destination_code", value)}
                    />
                    <TextField
                      id="settings-buyer-peppol"
                      label="Peppol id"
                      value={identifiers.buyer.peppol_id}
                      disabled={!editable || busy}
                      placeholder="0208:0123456789"
                      onChange={(value) => editRecipient("buyer", "peppol_id", value)}
                    />
                  </div>
                )}
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  disabled={!editable || busy}
                  onClick={() => void saveIdentifiers(id)}
                  className={PRIMARY}
                >
                  Save {label.toLowerCase()} identifiers
                </button>
              </div>
            </Group>
          ))}
        </Section>

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
            This browser stores exactly three things: the theme, the pane layouts and the workflow
            you left off at. No API key or secret is ever written to localStorage, sessionStorage or
            the URL.
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
