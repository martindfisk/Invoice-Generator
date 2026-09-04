import "@testing-library/jest-dom/vitest";

class MemoryStorage {
  #items = new Map<string, string>();

  get length() {
    return this.#items.size;
  }

  clear() {
    this.#items.clear();
  }

  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#items.delete(key);
  }

  setItem(key: string, value: string) {
    this.#items.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

// react-resizable-panels measures its panels; jsdom has no ResizeObserver.
if (!("ResizeObserver" in globalThis)) {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
}

// CodeMirror schedules a measure cycle via requestAnimationFrame that jsdom fires after the
// test that mounted the editor has finished. jsdom's Range lacks getClientRects, so that late
// callback throws an unhandled TypeError — every test passes but Vitest exits 1 (exactly the
// CI "Unit tests" failure). Geometry is meaningless in jsdom; empty rects satisfy the measure.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  const emptyRects = () => {
    const list = [] as unknown as DOMRectList;
    (list as unknown as { item: (i: number) => DOMRect | null }).item = () => null;
    return list;
  };
  Range.prototype.getClientRects = emptyRects;
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
}
