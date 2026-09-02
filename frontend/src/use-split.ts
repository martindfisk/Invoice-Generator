import { useCallback, useMemo, useState } from "react";

const STORE_PREFIX = "split:";
const MIN = 15;
const MAX = 85;

function load(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(`${STORE_PREFIX}${key}`);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value >= MIN && value <= MAX ? value : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, ratio: number): void {
  try {
    localStorage.setItem(`${STORE_PREFIX}${key}`, String(Math.round(ratio)));
  } catch {
    // Site data disabled: the layout simply is not remembered.
  }
}

export type GridSplit = {
  ratio: number;
  measure: (node: HTMLElement | null) => void;
  separatorProps: {
    role: "separator";
    tabIndex: 0;
    "aria-orientation": "horizontal" | "vertical";
    "aria-valuenow": number;
    "aria-valuemin": number;
    "aria-valuemax": number;
    "aria-label": string;
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };
};

// `bounds` exists for the three-pane Mapper: each separator is limited by where its neighbour
// sits, so dragging one can never push it past the other and invert the columns.
export function useGridSplit(
  key: string,
  horizontal: boolean,
  label: string,
  fallback = 50,
  bounds?: { min?: number; max?: number },
): GridSplit {
  const lo = Math.max(MIN, bounds?.min ?? MIN);
  const hi = Math.min(MAX, bounds?.max ?? MAX);
  const [ratio, setRatio] = useState(() => load(key, fallback));
  // Deliberately state, not a ref: the container is read inside a pointer handler, and a ref
  // would make every consumer of this hook look ref-like to the React compiler.
  const [box, measure] = useState<HTMLElement | null>(null);

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(hi, Math.max(lo, next));
      setRatio(clamped);
      save(key, clamped);
    },
    [hi, key, lo],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!box) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const move = (moved: PointerEvent) => {
        const rect = box.getBoundingClientRect();
        const span = horizontal ? rect.width : rect.height;
        if (span <= 0) return;
        const offset = horizontal ? moved.clientX - rect.left : moved.clientY - rect.top;
        const clamped = Math.min(hi, Math.max(lo, (offset / span) * 100));
        setRatio(clamped);
      };
      const done = () => {
        handle.releasePointerCapture?.(event.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", done);
        setRatio((current) => {
          save(key, current);
          return current;
        });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", done);
    },
    [box, hi, horizontal, key, lo],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const back = horizontal ? "ArrowLeft" : "ArrowUp";
      const forward = horizontal ? "ArrowRight" : "ArrowDown";
      const step = event.shiftKey ? 10 : 2;
      if (event.key === back) commit(ratio - step);
      else if (event.key === forward) commit(ratio + step);
      else if (event.key === "Home") commit(lo);
      else if (event.key === "End") commit(hi);
      else return;
      event.preventDefault();
    },
    [commit, hi, horizontal, lo, ratio],
  );

  const separatorProps = useMemo(
    () =>
      ({
        role: "separator",
        tabIndex: 0,
        "aria-orientation": horizontal ? "vertical" : "horizontal",
        "aria-valuenow": Math.round(ratio),
        "aria-valuemin": Math.round(lo),
        "aria-valuemax": Math.round(hi),
        "aria-label": label,
        onPointerDown,
        onKeyDown,
        onDoubleClick: () => commit(fallback),
      }) as GridSplit["separatorProps"],
    [commit, fallback, hi, horizontal, label, lo, onKeyDown, onPointerDown, ratio],
  );

  const bounded = Math.min(hi, Math.max(lo, ratio));
  return useMemo(
    () => ({ ratio: bounded, measure, separatorProps }),
    [bounded, measure, separatorProps],
  );
}
