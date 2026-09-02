import { useSyncExternalStore } from "react";
import { normaliseMode, type ApiCall, type Persona } from "./api-log";
import { getConfig, getSettings, type Config, type Settings } from "./uapi-client";
import { initialRunnerUi, savedCollectionId, type RunnerUiState } from "./runner";
import {
  initialWorkflow,
  persistWorkflow,
  workflowReducer,
  type WorkflowAction,
  type WorkflowState,
} from "./workflow";

export type Mode = "LIVE" | "MOCK" | "unknown";
export type Section = "flow" | "runner";
export type Theme = "light" | "dark";

export type LogFocus = { recordId: string; nonce: number } | null;

export type SettingsRequest = { section: string; nonce: number } | null;

export type State = {
  workflow: WorkflowState;
  section: Section;
  runner: RunnerUiState;
  mode: Mode;
  calls: ApiCall[];
  theme: Theme;
  focus: LogFocus;
  config: Config | null;
  settings: Settings | null;
  settingsError: string | null;
  settingsRequest: SettingsRequest;
  layoutNonce: number;
};

const MAX_CALLS = 1000;
const THEME_KEY = "theme";
const SECTION_KEY = "section";
const SPLIT_PREFIX = "split:";

function modeOf(value: unknown): Mode {
  try {
    return normaliseMode(value);
  } catch {
    return "unknown";
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSection(): Section {
  try {
    return localStorage.getItem(SECTION_KEY) === "runner" ? "runner" : "flow";
  } catch {
    return "flow";
  }
}

function splitKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(SPLIT_PREFIX)) keys.push(key);
    }
  } catch {
    // Site data disabled: there is nothing saved to reset.
  }
  return keys;
}

function byNewest(a: ApiCall, b: ApiCall): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
  // Several calls routinely share a timestamp. The recorder numbers them in order, so the id is
  // the only reliable tiebreak — without it the Send timeline shows same-second calls jumbled.
  const left = Number(a.id);
  const right = Number(b.id);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
  return 0;
}

export function createStore(initial: Partial<State> = {}) {
  let state: State = {
    workflow: initialWorkflow(),
    section: readSection(),
    runner: initialRunnerUi(savedCollectionId()),
    mode: "unknown",
    calls: [],
    theme: localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light",
    focus: null,
    config: null,
    settings: null,
    settingsError: null,
    settingsRequest: null,
    layoutNonce: 0,
    ...initial,
  };
  const listeners = new Set<() => void>();

  const update = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const dispatch = (action: WorkflowAction) => {
    const workflow = workflowReducer(state.workflow, action);
    if (workflow === state.workflow) return;
    persistWorkflow(workflow);
    update({ workflow });
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    setPersona: (persona: Persona) => dispatch({ type: "setPersona", persona }),
    setSection(section: Section) {
      try {
        localStorage.setItem(SECTION_KEY, section);
      } catch {
        // Site data disabled: the section simply is not remembered.
      }
      update({ section });
    },
    patchRunner(patch: Partial<RunnerUiState>) {
      update({ runner: { ...state.runner, ...patch } });
    },
    setMode: (mode: Mode) => update({ mode }),
    addCall(call: ApiCall) {
      const others = state.calls.filter((c) => c.id !== call.id);
      update({ calls: [call, ...others].sort(byNewest).slice(0, MAX_CALLS) });
    },
    clearCalls() {
      update({ calls: [], focus: null });
    },
    focusRecord(recordId: string) {
      update({ focus: { recordId, nonce: (state.focus?.nonce ?? 0) + 1 } });
    },
    // Anything in the app can send the user to a specific Settings section (e.g. the Validate
    // step's rule-set versions link); the SettingsMenu opens the dialog and scrolls there.
    openSettings(section: string) {
      update({ settingsRequest: { section, nonce: (state.settingsRequest?.nonce ?? 0) + 1 } });
    },
    setTheme(theme: Theme) {
      localStorage.setItem(THEME_KEY, theme);
      document.documentElement.dataset.theme = theme;
      update({ theme });
    },
    // Every pane remembers its own ratio under a "split:" key and reads it once, on mount, so
    // forgetting them only takes effect when the panes remount — hence the nonce.
    resetLayouts() {
      for (const key of splitKeys()) localStorage.removeItem(key);
      update({ layoutNonce: state.layoutNonce + 1 });
    },
    // The answer to a PUT/DELETE is the whole settings document, so the mode badge and the
    // environment banner follow a save without anyone asking the backend a second time.
    applySettings(settings: Settings) {
      update({ settings, settingsError: null, mode: modeOf(settings.mode) });
    },
    async refreshConfig() {
      try {
        const config = await getConfig();
        update({ config, mode: modeOf(config.mode) });
      } catch {
        // Keep the last good config; the shell's own retry loop reports the outage.
      }
    },
    async refreshBackend() {
      const config = await getConfig();
      update({ config, mode: modeOf(config.mode) });
      try {
        update({ settings: await getSettings(), settingsError: null });
      } catch (error) {
        update({ settings: null, settingsError: reason(error) });
      }
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export const store = createStore();

export function useStore<T>(select: (state: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
