import { useEffect } from "react";
import { ApiLogPane } from "./ApiLogPane";
import { Split } from "./Split";
import { subscribeApiLog } from "./api-log";
import { EnvironmentBadge, ModeBadge } from "./ModeBadge";
import { PersonaSwitch } from "./PersonaSwitch";
import { LIVE_BANNER, SettingsMenu } from "./SettingsDialog";
import { RunnerPane } from "./RunnerPane";
import { store, useStore, type Section } from "./store";
import { listCalls } from "./uapi-client";
import { WorkflowPane } from "./WorkflowPane";

const CONFIG_RETRY_MS = 5000;

const SECTIONS: { id: Section; label: string }[] = [
  { id: "flow", label: "Invoice flow" },
  { id: "runner", label: "Test runner" },
];

function SectionSwitch({ section }: { section: Section }) {
  return (
    <div
      role="group"
      aria-label="Section"
      className="ml-2 flex rounded-m border border-line bg-canvas p-0.5 text-xs"
    >
      {SECTIONS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={section === id}
          onClick={() => store.setSection(id)}
          className={`rounded-m px-2.5 py-1 font-medium transition-colors ${
            section === id ? "bg-surface text-ink shadow-s" : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const theme = useStore((state) => state.theme);
  const step = useStore((state) => state.workflow.step);
  const section = useStore((state) => state.section);
  const layoutNonce = useStore((state) => state.layoutNonce);
  const environment = useStore((state) => state.settings?.environment ?? state.config?.environment);
  const offline = useStore((state) => state.offline);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const loadConfig = async () => {
      try {
        await store.refreshBackend();
        if (cancelled) return;
        store.setOffline(false);
        for (const call of await listCalls()) store.addCall(call);
      } catch {
        if (cancelled) return;
        store.setOffline(true);
        retry = setTimeout(loadConfig, CONFIG_RETRY_MS);
      }
    };

    void loadConfig();
    const unsubscribe = subscribeApiLog(store.addCall, (connected) =>
      store.setEventsDown(!connected),
    );
    return () => {
      cancelled = true;
      clearTimeout(retry);
      unsubscribe();
    };
  }, []);

  const nextTheme = theme === "dark" ? "light" : "dark";
  // The pane only ever has something to say once we start talking to fiskaly. The runner
  // talks to fiskaly with every step, so it always keeps the log beside it.
  const showApiLog = section === "runner" || step === "send";
  const main = section === "runner" ? <RunnerPane /> : <WorkflowPane />;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex h-12 items-center gap-3 px-4">
          <h1 className="text-sm font-semibold">Invoice Generator</h1>
          <p className="hidden text-xs text-muted md:block">
            e-invoice flow &amp; fiskaly UAPI harness
          </p>
          <SectionSwitch section={section} />
          <div className="ml-auto flex items-center gap-3">
            {offline && (
              <span
                role="status"
                className="rounded-m bg-error px-2 py-0.5 text-xs font-medium text-white"
              >
                backend offline
              </span>
            )}
            {/* The flow always sends as the seller since the Receive step went away; the persona
                switch only matters where both credentials are exercised — the test runner. */}
            {section === "runner" && <PersonaSwitch />}
            <EnvironmentBadge />
            <ModeBadge />
            <button
              type="button"
              onClick={() => store.setTheme(nextTheme)}
              className="rounded-m border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-ink"
            >
              {nextTheme === "dark" ? "Dark mode" : "Light mode"}
            </button>
            <SettingsMenu />
          </div>
        </div>
        {environment === "live" && (
          <p
            role="status"
            className="border-t border-error bg-error-soft px-4 py-1.5 text-xs font-medium text-error-ink"
          >
            <span className="font-mono font-bold">LIVE environment</span> — {LIVE_BANNER}
          </p>
        )}
      </header>
      {showApiLog ? (
        <Split
          key={layoutNonce}
          id="shell"
          orientation="horizontal"
          label="Resize the workflow and API log panes"
          defaultFirst={55}
          minFirst="30%"
          minSecond="25%"
          className="flex-1"
          first={main}
          second={<ApiLogPane />}
        />
      ) : (
        <div key={layoutNonce} className="min-h-0 flex-1">
          {main}
        </div>
      )}
    </div>
  );
}
