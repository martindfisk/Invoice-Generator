import { useCallback, useState, type ReactNode } from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";

const STORE_PREFIX = "split:";

function read(id: string): Layout | undefined {
  try {
    const raw = localStorage.getItem(`${STORE_PREFIX}${id}`);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const layout = parsed as Layout;
    return Object.values(layout).every((size) => typeof size === "number") ? layout : undefined;
  } catch {
    return undefined;
  }
}

function write(id: string, layout: Layout): void {
  try {
    localStorage.setItem(`${STORE_PREFIX}${id}`, JSON.stringify(layout));
  } catch {
    // A viewer with site data disabled simply does not remember the layout.
  }
}

type SplitProps = {
  id: string;
  orientation: "horizontal" | "vertical";
  first: ReactNode;
  second: ReactNode;
  label: string;
  defaultFirst?: number;
  minFirst?: string;
  minSecond?: string;
  className?: string;
};

export function Split({
  id,
  orientation,
  first,
  second,
  label,
  defaultFirst = 50,
  minFirst = "15%",
  minSecond = "15%",
  className = "",
}: SplitProps) {
  const firstId = `${id}-a`;
  const secondId = `${id}-b`;
  const key = `${id}:${orientation}`;
  const [saved] = useState(() => read(key));
  const onLayoutChanged = useCallback((layout: Layout) => write(key, layout), [key]);
  const bar = orientation === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize";

  return (
    <Group
      orientation={orientation}
      className={`min-h-0 min-w-0 ${className}`}
      defaultLayout={saved ?? { [firstId]: defaultFirst, [secondId]: 100 - defaultFirst }}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id={firstId} minSize={minFirst} className="flex min-h-0 min-w-0 flex-col">
        {first}
      </Panel>
      <Separator
        aria-label={label}
        className={`${bar} shrink-0 rounded-full bg-line transition-colors hover:bg-brand focus-visible:bg-brand focus-visible:outline-none active:bg-brand`}
      />
      <Panel id={secondId} minSize={minSecond} className="flex min-h-0 min-w-0 flex-col">
        {second}
      </Panel>
    </Group>
  );
}
