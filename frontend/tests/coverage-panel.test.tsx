import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoveragePanel } from "../src/CoveragePanel";
import type { SpecField, SpecFields } from "../src/uapi-fields-client";

// A plain delegate, not a vi.fn(): the spy's settled-result tracking leaves an internally
// created rejected promise unhandled, which vitest then attributes to the test.
const mocks = vi.hoisted(() => {
  const holder = {
    impl: (async () => ({ status: "unavailable", reason: "not stubbed" })) as (
      ...args: unknown[]
    ) => Promise<unknown>,
    calls: 0,
  };
  return {
    holder,
    loadSpecFields: (...args: unknown[]) => {
      holder.calls += 1;
      return holder.impl(...args);
    },
  };
});

vi.mock("../src/uapi-fields-client", () => ({
  loadSpecFields: mocks.loadSpecFields,
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.holder.calls = 0;
});

function field(overrides: Partial<SpecField>): SpecField {
  return {
    pointer: "/document/number",
    kind: "leaf",
    type: "string",
    schema: null,
    required: false,
    optional_ancestor: null,
    constraints: {},
    description: null,
    example: "INV-1",
    example_source: "spec",
    bt: [],
    applicability: {},
    applicable: true,
    variants: {},
    ...overrides,
  };
}

function spec(fields: SpecField[]): SpecFields {
  return {
    api_version: "2026-06-01",
    source: "fiskaly.unified-api.all.yaml",
    source_sha256: "abc",
    country: "IT",
    operation: "INVOICE",
    profile: null,
    fields,
    unions: [],
    warnings: [],
  };
}

describe("CoveragePanel", () => {
  it("turns a rejected catalogue fetch into the unavailable state with Retry", async () => {
    mocks.holder.impl = () => Promise.reject(new Error("network down"));
    render(
      <CoveragePanel
        operation={{}}
        country="IT"
        formatId="fatturapa"
        jsonPrefix=""
        onInsert={() => null}
      />,
    );
    expect(await screen.findByText(/Spec field coverage unavailable — network down/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps a partial-failure notice until dismissed, not until the next success", async () => {
    mocks.holder.impl = () =>
      Promise.resolve({
        status: "ok",
        spec: spec([
          field({ pointer: "/document/number" }),
          field({ pointer: "/document/issue_date", example: "2026-01-01" }),
        ]),
      });
    const onInsert = vi
      .fn()
      .mockReturnValueOnce("Not inserted: /document/number — the JSON does not parse")
      .mockReturnValue(null);
    render(
      <CoveragePanel
        operation={{}}
        country="IT"
        formatId="fatturapa"
        jsonPrefix=""
        onInsert={onInsert}
      />,
    );
    fireEvent.click((await screen.findByText(/spec fields populated/)).closest("summary")!);
    const inserts = screen.getAllByRole("button", { name: /^Insert/ });
    fireEvent.click(inserts[0]);
    expect(
      screen.getByText(/Not inserted: \/document\/number — the JSON does not parse/),
    ).toBeVisible();
    // A later successful insert must not clear the unread failure.
    fireEvent.click(inserts[1]);
    expect(
      screen.getByText(/Not inserted: \/document\/number — the JSON does not parse/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Not inserted/)).not.toBeInTheDocument();
  });
});
