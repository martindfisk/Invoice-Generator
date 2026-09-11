import { afterEach, describe, expect, it, vi } from "vitest";

// Safari private mode and site-data-disabled browsers throw on any localStorage access. The
// store is created at module scope, so an unguarded read would blank the whole app at boot.

function throwingStorage(): Storage {
  const explode = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    get length(): number {
      return explode();
    },
    clear: explode,
    getItem: explode,
    key: explode,
    removeItem: explode,
    setItem: explode,
  };
}

describe("storage resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("boots the store and survives dispatch and setTheme when localStorage throws", async () => {
    vi.stubGlobal("localStorage", throwingStorage());
    vi.resetModules();
    const { createStore } = await import("../src/store");

    const store = createStore();
    expect(store.getState().theme).toBe("light");
    expect(store.getState().workflow.step).toBe("setup");

    expect(() => store.dispatch({ type: "showUncarried", show: false })).not.toThrow();
    expect(store.getState().workflow.groups.showUncarried).toBe(false);

    expect(() => store.setTheme("dark")).not.toThrow();
    expect(store.getState().theme).toBe("dark");

    expect(() => store.setSection("runner")).not.toThrow();
  });
});
