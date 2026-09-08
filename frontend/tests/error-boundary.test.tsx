import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/ErrorBoundary";
import { WORKFLOW_KEY } from "../src/workflow";

function Bomb(): never {
  throw new Error("vatBreakdown is not iterable");
}

describe("error boundary", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>alive</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("alive")).toBeInTheDocument();
  });

  it("catches a render crash and offers to reset the saved workflow", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.setItem(WORKFLOW_KEY, "{corrupted");
    const reload = vi.fn();
    render(
      <ErrorBoundary reload={reload}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("vatBreakdown is not iterable");

    fireEvent.click(screen.getByRole("button", { name: /Reset saved workflow/ }));
    expect(localStorage.getItem(WORKFLOW_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
