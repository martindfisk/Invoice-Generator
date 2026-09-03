import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCall } from "../src/api-log";
import { listPresets } from "../src/presets";
import { createStore } from "../src/store";
import { WORKFLOW_KEY } from "../src/workflow";

function call(id: string, ts: string, extra: Partial<ApiCall> = {}): ApiCall {
  return {
    id,
    ts,
    step: "setup",
    persona: "seller",
    mode: "MOCK",
    method: "GET",
    url: "https://test.api.fiskaly.com/api/v5/systems/sys-1",
    request: { headers: {} },
    response: { status: 200, headers: {} },
    duration_ms: 12,
    curl: "curl https://test.api.fiskaly.com/api/v5/systems/sys-1",
    ...extra,
  };
}

describe("store", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("starts as seller, unknown mode, light theme, no calls and no preset", () => {
    expect(createStore().getState()).toMatchObject({
      mode: "unknown",
      calls: [],
      theme: "light",
      workflow: { persona: "seller", step: "setup", presetId: null, invoice: null },
    });
  });

  it("reads the persisted theme", () => {
    localStorage.setItem("theme", "dark");
    expect(createStore().getState().theme).toBe("dark");
  });

  it("setPersona and setMode replace the field and notify subscribers", () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setPersona("buyer");
    store.setMode("LIVE");
    expect(store.getState()).toMatchObject({ mode: "LIVE", workflow: { persona: "buyer" } });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("dispatch runs the workflow reducer, persists it after the debounce and notifies once", () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      const listener = vi.fn();
      store.subscribe(listener);
      const presetId = listPresets()[0].id;
      store.dispatch({ type: "choosePreset", presetId, fresh: true });
      expect(store.getState().workflow).toMatchObject({ presetId, step: "mapper" });
      expect(localStorage.getItem(WORKFLOW_KEY)).toBeNull();
      vi.runAllTimers();
      expect(JSON.parse(localStorage.getItem(WORKFLOW_KEY) ?? "{}")).toMatchObject({ presetId });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatch keeps the state and stays quiet when the reducer changes nothing", () => {
    const store = createStore();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "goToStep", step: "send" });
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rehydrates the persisted workflow", () => {
    vi.useFakeTimers();
    try {
      const presetId = listPresets()[0].id;
      createStore().dispatch({ type: "choosePreset", presetId, fresh: true });
      vi.runAllTimers();
      expect(createStore().getState().workflow).toMatchObject({ presetId, step: "mapper" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("addCall orders newest first and replaces an existing id in place", () => {
    const store = createStore();
    store.addCall(call("a", "2026-08-26T09:00:00Z"));
    store.addCall(call("b", "2026-08-26T09:00:02Z"));
    store.addCall(call("c", "2026-08-26T09:00:01Z"));
    expect(store.getState().calls.map((c) => c.id)).toEqual(["b", "c", "a"]);

    store.addCall(call("a", "2026-08-26T09:00:00Z", { duration_ms: 99 }));
    expect(store.getState().calls.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(store.getState().calls[2].duration_ms).toBe(99);
  });

  it("setTheme persists to localStorage and applies data-theme", () => {
    const store = createStore();
    store.setTheme("dark");
    expect(store.getState().theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("unsubscribe stops notifications", () => {
    const store = createStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setPersona("buyer");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("call ordering", () => {
  it("breaks timestamp ties on the recorder's own sequence", () => {
    const store = createStore();
    const at = "2026-08-27T10:00:00.000Z";
    const call = (id: string) =>
      ({
        id,
        ts: at,
        step: "poll",
        persona: "seller",
        mode: "MOCK",
        method: "GET",
        url: `https://test.api.fiskaly.com/records/${id}`,
        request: { headers: {} },
        duration_ms: 1,
        curl: "",
      }) as Parameters<typeof store.addCall>[0];
    for (const id of ["3", "1", "2"]) store.addCall(call(id));
    expect(store.getState().calls.map((entry) => entry.id)).toEqual(["3", "2", "1"]);
  });
});
