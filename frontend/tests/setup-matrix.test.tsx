import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { checkModel } from "../src/model-rules";
import { listPresets, preset, type PresetMeta } from "../src/presets";
import { store } from "../src/store";
import { WorkflowPane } from "../src/WorkflowPane";

const COUNTRIES: [string, string][] = [
  ["DE", "Germany"],
  ["IT", "Italy"],
  ["BE", "Belgium"],
];

const AUDIENCES = ["B2C", "B2B", "B2G"];

const DEFECTIVE = /\bbroken\b|\bdeliberate(ly)?\b|\bintentional(ly)?\b/i;

function failsModelRules(meta: PresetMeta): boolean {
  try {
    return checkModel(preset(meta.id)).length > 0;
  } catch {
    return false;
  }
}

function isDefective(meta: PresetMeta): boolean {
  return (
    DEFECTIVE.test(`${meta.id} ${meta.label} ${meta.group} ${meta.summary}`) ||
    failsModelRules(meta)
  );
}

function countries(): [string, string][] {
  const present = [...new Set(listPresets().map((meta) => meta.country as string))];
  const known = COUNTRIES.filter(([code]) => present.includes(code));
  const rest = present.filter((code) => !COUNTRIES.some(([listed]) => listed === code));
  return [...known, ...rest.map((code): [string, string] => [code, code])];
}

function audiences(): string[] {
  const present = listPresets().map((meta) => meta.audience as string);
  return [...AUDIENCES, ...present.filter((code) => !AUDIENCES.includes(code))];
}

function cellPresets(country: string, audience: string): PresetMeta[] {
  return listPresets().filter((meta) => meta.country === country && meta.audience === audience);
}

function cells(): { country: string; audience: string; presets: PresetMeta[] }[] {
  return countries().flatMap(([country]) =>
    audiences().map((audience) => ({ country, audience, presets: cellPresets(country, audience) })),
  );
}

function picker(): HTMLElement {
  return screen.getByRole("region", { name: "Preset picker" });
}

function cell(country: string, audience: string): HTMLElement {
  const found = picker().querySelector<HTMLElement>(`[data-cell="${country}:${audience}"]`);
  if (!found) throw new Error(`no matrix cell for ${country} ${audience}`);
  return found;
}

function card(id: string): HTMLElement {
  const found = picker().querySelector<HTMLElement>(`[data-preset="${id}"]`);
  if (!found) throw new Error(`no preset card for ${id}`);
  return found;
}

function narrowViewport() {
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => media,
  });
}

describe("preset matrix", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    store.dispatch({ type: "goToStep", step: "setup" });
  });

  it("renders a row per country in the order the walkthrough follows", () => {
    render(<WorkflowPane />);
    expect(
      within(picker())
        .getAllByRole("rowheader")
        .map((header) => header.textContent),
    ).toEqual(countries().map(([code, name]) => `${name}${code}`));
  });

  it("keeps a country the order does not mention rather than dropping its presets", () => {
    render(<WorkflowPane />);
    const rows = within(picker()).getAllByRole("rowheader").length;
    expect(rows).toBe(new Set(listPresets().map((meta) => meta.country)).size);
    expect(within(picker()).getAllByRole("button")).toHaveLength(listPresets().length);
  });

  it("renders a column per audience, consumer first", () => {
    render(<WorkflowPane />);
    const headers = within(picker())
      .getAllByRole("columnheader")
      .map((header) => header.textContent ?? "");
    expect(headers).toHaveLength(audiences().length);
    for (const [index, audience] of audiences().entries()) {
      expect(headers[index].startsWith(audience)).toBe(true);
    }
  });

  it("renders every preset of a cell that holds more than one", () => {
    const stacked = cells().find((entry) => entry.presets.length > 1);
    if (!stacked) throw new Error("no country/audience pair holds more than one preset");
    render(<WorkflowPane />);

    const buttons = within(cell(stacked.country, stacked.audience)).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("data-preset"))).toEqual(
      stacked.presets.map((meta) => meta.id),
    );
  });

  it("says an empty cell is empty instead of leaving a blank box", () => {
    const blank = cells().find((entry) => entry.presets.length === 0);
    if (!blank) throw new Error("every country/audience pair has a preset");
    render(<WorkflowPane />);

    const empty = cell(blank.country, blank.audience);
    expect(within(empty).queryAllByRole("button")).toHaveLength(0);
    expect(within(empty).getByText("No preset")).toBeInTheDocument();
  });

  it("drops the country and the audience the axes already carry", () => {
    const meta = listPresets()[0];
    render(<WorkflowPane />);

    const chosen = card(meta.id);
    expect(within(chosen).queryByText(meta.country, { exact: true })).toBeNull();
    expect(within(chosen).queryByText(meta.audience, { exact: true })).toBeNull();
    expect(within(chosen).getByText(meta.channel)).toBeInTheDocument();
    expect(within(chosen).getByText(meta.group)).toBeInTheDocument();
    expect(within(chosen).getByText(meta.summary)).toBeInTheDocument();
    expect(chosen.title).toContain(meta.formatLabel);
    expect(chosen.title).toContain(meta.legalBasis);
  });

  it("marks the presets that exist to fail, and only those", () => {
    const defective = listPresets().filter(isDefective);
    expect(defective.length).toBeGreaterThan(0);
    render(<WorkflowPane />);

    for (const meta of listPresets()) {
      const chip = within(card(meta.id)).queryByText(/broken on purpose/);
      if (isDefective(meta)) expect(chip).toBeInTheDocument();
      else expect(chip).toBeNull();
    }
  });

  it("reaches every preset with the keyboard", () => {
    render(<WorkflowPane />);
    for (const button of within(picker()).getAllByRole("button")) {
      expect(button.tabIndex).toBe(0);
    }
  });

  it("loads the invoice of the preset picked out of a cell and advances to Compose", () => {
    const target = cells().find((entry) => entry.presets.length > 0);
    if (!target) throw new Error("no preset to pick");
    const meta = target.presets[target.presets.length - 1];
    render(<WorkflowPane />);

    fireEvent.click(within(cell(target.country, target.audience)).getByText(meta.label));

    expect(store.getState().workflow).toMatchObject({ presetId: meta.id, step: "compose" });
    expect(screen.getByRole("region", { name: "Invoice viewer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: meta.label })).toBeInTheDocument();
  });

  it("marks the chosen preset as pressed when Setup is reopened", () => {
    const meta = listPresets()[1];
    render(<WorkflowPane />);

    fireEvent.click(card(meta.id));
    act(() => store.dispatch({ type: "goToStep", step: "setup" }));

    expect(card(meta.id)).toHaveAttribute("aria-pressed", "true");
    expect(card(listPresets()[0].id)).toHaveAttribute("aria-pressed", "false");
  });

  it("falls back to the country-grouped list on a narrow viewport", () => {
    narrowViewport();
    const { container } = render(<WorkflowPane />);

    expect(container.querySelector("table")).toBeNull();
    expect(within(picker()).queryAllByRole("columnheader")).toHaveLength(0);
    expect(within(picker()).getAllByRole("button")).toHaveLength(listPresets().length);

    for (const [, name] of countries()) {
      expect(within(picker()).getByRole("region", { name })).toBeInTheDocument();
    }

    const first = within(picker()).getAllByRole("region")[0];
    expect(first).toHaveAttribute("data-country", countries()[0][0]);
    const meta = listPresets().find((candidate) => candidate.country === countries()[0][0]);
    if (!meta) throw new Error("no preset for the first country");
    expect(within(card(meta.id)).getByText(meta.audience, { exact: true })).toBeInTheDocument();
  });
});
