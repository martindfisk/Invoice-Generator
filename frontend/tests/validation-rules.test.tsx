import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RULES_FALLBACK_NOTE,
  SettingsMenu,
  VALIDATION_RULES_SECTION_ID,
  ValidationRulesSection,
} from "../src/SettingsDialog";
import { StageList } from "../src/StepValidate";
import { store } from "../src/store";
import type { StageResult } from "../src/validation";

function entry(id: string, version: string, licence: string, built: string, order: number) {
  return {
    id,
    title: `${id} rule set`,
    version,
    licence,
    formats: ["ubl"],
    order,
    sourceSha: "src",
    sef: { sha256: `sha-${id}`, bytes: 1, saxonVersion: "SaxonJS 2.7", buildDateTime: built },
  };
}

const MANIFEST = {
  generatedAt: "2026-09-01T12:00:00Z",
  saxonJs: "2.7.0",
  ruleSets: [
    entry("cen-ubl", "1.3.15", "EUPL-1.2", "2026-08-26T14:17:54Z", 0),
    entry("peppol-ubl", "3.0.20", "OpenPeppol AISBL", "2026-08-26T14:18:03Z", 1),
    entry("en16931-ubl", "1.3.15", "EUPL-1.2", "2026-08-26T14:18:10Z", 2),
    entry("en16931-cii", "1.3.15", "EUPL-1.2", "2026-08-26T14:18:21Z", 3),
    entry("xrechnung-ubl", "2.5.0", "Apache-2.0", "2026-08-26T14:18:30Z", 4),
    entry("xrechnung-cii", "2.5.0", "Apache-2.0", "2026-08-26T14:18:39Z", 5),
  ],
};

function manifestFetch() {
  return vi.fn((url: unknown) =>
    String(url).endsWith("/sef/manifest.json")
      ? Promise.resolve(
          new Response(JSON.stringify(MANIFEST), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      : Promise.reject(new TypeError("fetch failed")),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings → Validation rules", () => {
  it("lists every rule set from the manifest with version, licence and build date", async () => {
    vi.stubGlobal("fetch", manifestFetch());
    render(<ValidationRulesSection />);
    await waitFor(() => expect(screen.getByText("cen-ubl")).toBeInTheDocument());
    for (const ruleSet of MANIFEST.ruleSets) {
      const row = screen.getByText(ruleSet.id).closest("tr");
      expect(row).not.toBeNull();
      expect(row).toHaveTextContent(ruleSet.version);
      expect(row).toHaveTextContent(ruleSet.licence);
      expect(row).toHaveTextContent(ruleSet.sef.buildDateTime.slice(0, 10));
    }
    expect(screen.getAllByRole("row")).toHaveLength(MANIFEST.ruleSets.length + 1);
    expect(screen.getByRole("heading", { name: "Validation rules" })).toHaveAttribute(
      "id",
      VALIDATION_RULES_SECTION_ID,
    );
  });

  it("falls back to the built-in rule-set list when the manifest is missing", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("missing", { status: 404 })));
    render(<ValidationRulesSection />);
    await waitFor(() => expect(screen.getByText(RULES_FALLBACK_NOTE)).toBeInTheDocument());
    for (const id of ["cen-ubl", "peppol-ubl", "xrechnung-ubl", "en16931-cii"]) {
      expect(screen.getByText(id)).toBeInTheDocument();
    }
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("the Schematron stage's rule-set line", () => {
  const schematronStage: StageResult = {
    id: "schematron",
    label: "Schematron (EN 16931 / Peppol)",
    status: "passed",
    findings: [],
    durationMs: 5,
    note: "cen-ubl 1.3.15 (3 ms), peppol-ubl 3.0.20 (2 ms). predicted",
    ruleSets: [
      { id: "cen-ubl", version: "1.3.15" },
      { id: "peppol-ubl", version: "3.0.20" },
    ],
  };

  it("names the rule sets and versions and links into Settings → Validation rules", () => {
    render(<StageList stages={[schematronStage]} />);
    expect(screen.getByText("cen-ubl 1.3.15")).toBeInTheDocument();
    expect(screen.getByText("peppol-ubl 3.0.20")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "versions in Settings → Validation rules" }),
    );
    expect(store.getState().settingsRequest).toMatchObject({
      section: VALIDATION_RULES_SECTION_ID,
    });
  });

  it("opens the Settings dialog when the link fires", async () => {
    vi.stubGlobal("fetch", manifestFetch());
    render(<SettingsMenu />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    store.openSettings(VALIDATION_RULES_SECTION_ID);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument(),
    );
    expect(document.getElementById(VALIDATION_RULES_SECTION_ID)).not.toBeNull();
  });
});
