import { useSyncExternalStore } from "react";
import type { ApiCall, Persona } from "./api-log";
import {
  initialWorkflow,
  persistWorkflow,
  workflowReducer,
  type WorkflowAction,
  type WorkflowState,
} from "./workflow";

export type Mode = "LIVE" | "MOCK" | "unknown";
export type Theme = "light" | "dark";

export type LogFocus = { recordId: string; nonce: number } | null;

export type State = {
  workflow: WorkflowState;
  mode: Mode;
  calls: ApiCall[];
  theme: Theme;
  focus: LogFocus;
};

const MAX_CALLS = 500;
const THEME_KEY = "theme";

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
    mode: "unknown",
    calls: [],
    theme: localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light",
    focus: null,
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
    setTheme(theme: Theme) {
      localStorage.setItem(THEME_KEY, theme);
      document.documentElement.dataset.theme = theme;
      update({ theme });
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export const store = createStore();

export function useStore<T>(select: (state: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
