import { useEffect, useState } from "react";
import { ApiLogPane } from "./ApiLogPane";
import { Split } from "./Split";
import { normaliseMode, subscribeApiLog } from "./api-log";
import { ModeBadge } from "./ModeBadge";
import { PersonaSwitch } from "./PersonaSwitch";
import { store, useStore } from "./store";
import { getConfig, listCalls } from "./uapi-client";
import { WorkflowPane } from "./WorkflowPane";

const CONFIG_RETRY_MS = 5000;

export function App() {
  const theme = useStore((state) => state.theme);
  const step = useStore((state) => state.workflow.step);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const loadConfig = async () => {
      try {
        const config = await getConfig();
        if (cancelled) return;
        store.setMode(normaliseMode(config.mode));
        setOffline(false);
        for (const call of await listCalls()) store.addCall(call);
      } catch {
        if (cancelled) return;
        setOffline(true);
        retry = setTimeout(loadConfig, CONFIG_RETRY_MS);
      }
    };

    void loadConfig();
    const unsubscribe = subscribeApiLog(store.addCall);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      unsubscribe();
    };
  }, []);

  const nextTheme = theme === "dark" ? "light" : "dark";
  // The pane only ever has something to say once we start talking to fiskaly.
  const showApiLog = step === "send" || step === "receive";

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <h1 className="text-sm font-semibold">Invoice Generator</h1>
        <p className="hidden text-xs text-muted md:block">
          e-invoice flow &amp; fiskaly UAPI harness
        </p>
        <div className="ml-auto flex items-center gap-3">
          {offline && (
            <span
              role="status"
              className="rounded-m bg-error px-2 py-0.5 text-xs font-medium text-white"
            >
              backend offline
            </span>
          )}
          <PersonaSwitch />
          <ModeBadge />
          <button
            type="button"
            onClick={() => store.setTheme(nextTheme)}
            className="rounded-m border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-ink"
          >
            {nextTheme === "dark" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </header>
      {showApiLog ? (
        <Split
          id="shell"
          orientation="horizontal"
          label="Resize the workflow and API log panes"
          defaultFirst={55}
          minFirst="30%"
          minSecond="25%"
          className="flex-1"
          first={<WorkflowPane />}
          second={<ApiLogPane />}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <WorkflowPane />
        </div>
      )}
    </div>
  );
}
