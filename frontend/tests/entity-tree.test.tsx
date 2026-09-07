import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityTree, PersonaTree, ProvisionDialog } from "../src/EntityTree";
import {
  DEGRADED_NO_CAUSE,
  availableCountries,
  countryRow,
  noCredentialsHint,
} from "../src/onboarding";
import { COUNTRY_LOCKED_WHILE_RUNNING, selectCollection } from "../src/runner-actions";
import { initialRunnerUi } from "../src/runner";
import { store } from "../src/store";
import type {
  Collection,
  CollectionSummary,
  OnboardingStatus,
  OnboardingSystem,
  ProvisionResult,
} from "../src/uapi-client";

const mocks = vi.hoisted(() => ({
  provisionCountry: vi.fn(),
  getOnboardingStatus: vi.fn(),
  getCollection: vi.fn(),
}));

vi.mock("../src/uapi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/uapi-client")>();
  return {
    ...actual,
    provisionCountry: mocks.provisionCountry,
    getOnboardingStatus: mocks.getOnboardingStatus,
    getCollection: mocks.getCollection,
  };
});

afterEach(() => {
  cleanup();
  mocks.provisionCountry.mockReset();
  mocks.getOnboardingStatus.mockReset();
  mocks.getCollection.mockReset();
  store.patchRunner(initialRunnerUi());
  localStorage.clear();
});

const germany = countryRow("DE");
const italy = countryRow("IT");

function system(overrides: Partial<OnboardingSystem> = {}): OnboardingSystem {
  return {
    id: "sys-de",
    type: "E_INVOICE_SERVICE",
    state: "COMMISSIONED",
    mode: "OPERATIVE",
    taxpayer_id: "tp-de",
    compliance_state: "TRANSMISSION_RECEPTION",
    peppol_id: "9930:DE123456789",
    registrations: [{ type: "PEPPOL" }],
    blocked_by: null,
    ...overrides,
  };
}

function status(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    persona: "seller",
    environment: "test",
    credentials: { configured: true, source: "env", fingerprint: "test***" },
    counts: { organizations: 1, subjects: 1, taxpayers: 1, systems: 1 },
    organizations: [{ id: "org-1", type: "UNIT", state: "ENABLED", name: "Demo Org" }],
    subjects: [{ id: "sub-1", type: "API_KEY", state: "ENABLED" }],
    taxpayers: [
      {
        id: "tp-de",
        state: "COMMISSIONED",
        country: "DE",
        name: "Musterfirma GmbH",
        vat_id: "DE123456789",
      },
    ],
    systems: [system()],
    ready: { DE: true, IT: false, BE: false },
    missing: ["IT: no taxpayer", "BE: no taxpayer"],
    ...overrides,
  };
}

function summaries(): CollectionSummary[] {
  return [
    { id: "de", name: "e-invoice-de", version: "2026-06-01", steps: 3, notes: 0 },
    { id: "it", name: "e-invoice-it", version: "2026-06-01", steps: 3, notes: 0 },
    { id: "be", name: "e-invoice-be", version: "2026-06-01", steps: 3, notes: 0 },
  ];
}

function collection(id: string): Collection {
  return { id, name: `e-invoice-${id}`, version: "2026-06-01", steps: [], notes: [] };
}

function renderTree(state: OnboardingStatus, mode: "MOCK" | "LIVE" = "MOCK") {
  return render(
    <PersonaTree
      persona="seller"
      label="Seller"
      active
      mode={mode}
      country={germany}
      fetch={{ status: state, error: null, loading: false }}
      onProvision={() => {}}
    />,
  );
}

describe("availableCountries", () => {
  it("derives the selectable list from the collections, not a hardcoded array", () => {
    const rows = availableCountries(summaries(), []);
    expect(rows.map((row) => row.code)).toEqual(["DE", "IT", "BE"]);
    expect(availableCountries([{ id: "it" }], []).map((row) => row.code)).toEqual(["IT"]);
  });

  it("falls back to the status ready keys when there are no collections", () => {
    const rows = availableCountries(null, [status({ ready: { DE: true, BE: false } })]);
    expect(rows.map((row) => row.code)).toEqual(["DE", "BE"]);
    expect(rows[0].label).toBe("Germany");
  });
});

describe("PersonaTree", () => {
  it("renders only the selected country, one line per entity", () => {
    renderTree(status());

    const groups = document.querySelectorAll("[data-country]");
    expect(groups).toHaveLength(1);
    const de = groups[0] as HTMLElement;
    expect(de).toHaveAttribute("data-country", "DE");
    expect(de).toHaveAttribute("data-ready", "true");
    expect(within(de).getByText("Ready")).toBeInTheDocument();
    const deTaxpayer = de.querySelector("[data-entity='taxpayer-DE']") as HTMLElement;
    expect(deTaxpayer).toHaveAttribute("data-entity-state", "COMMISSIONED");
    expect(within(deTaxpayer).getByText("DE123456789")).toBeInTheDocument();
    const deSystem = de.querySelector("[data-entity='system-DE']") as HTMLElement;
    expect(deSystem).toHaveAttribute("data-entity-state", "COMMISSIONED / OPERATIVE");
    expect(
      screen.getByRole("button", { name: "Provision Germany for seller" }),
    ).toBeInTheDocument();
  });

  it("keeps a healthy country quiet: facts move to the tooltip, no extra lines", () => {
    renderTree(status());
    const deSystem = document.querySelector("[data-entity='system-DE']") as HTMLElement;
    expect(deSystem.querySelector("[data-blocked-by]")).toBeNull();
    expect(deSystem.querySelector("[data-compliance]")).toBeNull();
    expect(within(deSystem).queryByText(/sends and receives/)).toBeNull();
    const chip = within(deSystem).getByText("COMMISSIONED / OPERATIVE");
    expect(chip).toHaveAttribute(
      "title",
      "PEPPOL · 9930:DE123456789 · TRANSMISSION_RECEPTION — sends and receives",
    );
    expect(document.querySelector("[data-missing='DE']")).toBeNull();
  });

  it("names a listing the backend could not fetch instead of showing it as empty", () => {
    renderTree(
      status({
        organizations: [],
        counts: { organizations: 0, subjects: 1, taxpayers: 1, systems: 1 },
        errors: { organizations: "403 E_FORBIDDEN: no access" },
      }),
    );
    const block = document.querySelector("[data-listing-errors='seller']") as HTMLElement;
    expect(block).not.toBeNull();
    expect(within(block).getByText(/organizations could not be listed/)).toBeInTheDocument();
    expect(within(block).getByText(/403 E_FORBIDDEN: no access/)).toBeInTheDocument();
  });

  it("reduces Organization and Subject to one quiet line each", () => {
    renderTree(
      status({
        organizations: [],
        subjects: [],
        counts: { organizations: 0, subjects: 0, taxpayers: 1, systems: 1 },
      }),
    );
    const organization = document.querySelector("[data-entity='organization']") as HTMLElement;
    expect(organization).toHaveAttribute("data-entity-state", "none reported");
    expect(within(organization).queryByText(/comes with the account credentials/)).toBeNull();
    expect(within(organization).getByText("none reported")).toHaveAttribute(
      "title",
      expect.stringContaining("comes with the account credentials"),
    );
    expect(document.querySelector("[data-entity='subject']")).toHaveAttribute(
      "data-entity-state",
      "none reported",
    );
  });

  it("renders DEGRADED unlike OPERATIVE and surfaces blocked_by with the curated guidance", () => {
    // The exact value the backend emits (onboarding.py PEPPOL_BLOCKER) — a made-up fixture
    // value here once hid a key-normalization bug that made the curated string unreachable.
    renderTree(
      status({
        systems: [system({ mode: "DEGRADED", blocked_by: "peppol-proof-of-ownership" })],
        ready: { DE: false, IT: false, BE: false },
        missing: ["DE: system sys-de is COMMISSIONED/DEGRADED, needs COMMISSIONED/OPERATIVE"],
      }),
    );
    const row = document.querySelector("[data-entity='system-DE']") as HTMLElement;
    expect(row).toHaveAttribute("data-entity-state", "COMMISSIONED / DEGRADED");
    const blocked = row.querySelector(
      "[data-blocked-by='peppol-proof-of-ownership']",
    ) as HTMLElement;
    // The curated wording, not the generic "blocked by …" fallback.
    expect(blocked).toHaveTextContent(/ownership verification unblocks transmission/);
    expect(blocked).not.toHaveTextContent(/blocked by peppol proof of ownership/);
  });

  it("glosses a compliance state other than sends-and-receives visibly", () => {
    renderTree(
      status({
        systems: [system({ compliance_state: "TRANSMISSION_ONLY" })],
        ready: { DE: false, IT: false, BE: false },
        missing: [],
      }),
    );
    const gloss = document.querySelector("[data-compliance='TRANSMISSION_ONLY']") as HTMLElement;
    expect(gloss).toHaveTextContent("sends only — the account cannot receive inbound documents");
  });

  it("states DEGRADED without inventing a cause when blocked_by is null", () => {
    renderTree(
      status({
        systems: [system({ mode: "DEGRADED", blocked_by: null })],
        ready: { DE: false, IT: false, BE: false },
        missing: [],
      }),
    );
    const row = document.querySelector("[data-entity='system-DE']") as HTMLElement;
    expect(within(row).getByText(DEGRADED_NO_CAUSE)).toBeInTheDocument();
    expect(row.querySelector("[data-blocked-by]")).toBeNull();
  });

  it("shows the backend's missing line when ready is false although everything looks created", () => {
    renderTree(
      status({
        ready: { DE: false, IT: false, BE: false },
        missing: ["DE: system sys-de is COMMISSIONED/DEGRADED, needs COMMISSIONED/OPERATIVE"],
      }),
    );
    const de = document.querySelector("[data-country='DE']") as HTMLElement;
    expect(within(de).getByText("Not ready")).toBeInTheDocument();
    expect(de.querySelector("[data-missing='DE']")).toHaveTextContent(
      "DE: system sys-de is COMMISSIONED/DEGRADED, needs COMMISSIONED/OPERATIVE",
    );
  });

  it("points at Settings → Credentials instead of showing an empty account in LIVE", () => {
    renderTree(
      status({
        credentials: { configured: false, source: "none", fingerprint: null },
        counts: { organizations: 0, subjects: 0, taxpayers: 0, systems: 0 },
        organizations: [],
        subjects: [],
        taxpayers: [],
        systems: [],
        ready: { DE: false, IT: false, BE: false },
        missing: ["no API credentials configured"],
      }),
      "LIVE",
    );
    expect(screen.getByText(noCredentialsHint("seller"))).toBeInTheDocument();
    expect(document.querySelectorAll("[data-entity]")).toHaveLength(0);
  });

  it("still shows the tree without credentials in MOCK, where none are needed", () => {
    renderTree(
      status({
        credentials: { configured: false, source: "none", fingerprint: null },
        taxpayers: [],
        systems: [],
        organizations: [],
        subjects: [],
        ready: { DE: false, IT: false, BE: false },
        missing: ["DE: no taxpayer", "IT: no taxpayer", "BE: no taxpayer"],
      }),
      "MOCK",
    );
    expect(screen.queryByText(noCredentialsHint("seller"))).not.toBeInTheDocument();
    expect(document.querySelector("[data-entity='taxpayer-DE']")).toHaveAttribute(
      "data-entity-state",
      "not created",
    );
  });
});

describe("EntityTree", () => {
  function seed(collectionId = "de") {
    mocks.getOnboardingStatus.mockResolvedValue(status());
    mocks.getCollection.mockImplementation((id: string) => Promise.resolve(collection(id)));
    store.patchRunner({
      ...initialRunnerUi(collectionId),
      collections: summaries(),
      collection: collection(collectionId),
    });
  }

  it("shows only the selected country and switches the collection with the country", async () => {
    seed("de");
    render(<EntityTree />);
    await screen.findByRole("group", { name: "Country" });
    await waitFor(() => expect(document.querySelectorAll("[data-persona-tree]")).toHaveLength(2));

    const groups = document.querySelectorAll("[data-country]");
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group).toHaveAttribute("data-country", "DE");

    fireEvent.click(screen.getByRole("button", { name: "Italy" }));
    await waitFor(() => expect(store.getState().runner.collectionId).toBe("it"));
    await waitFor(() => expect(store.getState().runner.collection?.id).toBe("it"));
    await waitFor(() => {
      const after = document.querySelectorAll("[data-country]");
      expect(after).toHaveLength(2);
      for (const group of after) expect(group).toHaveAttribute("data-country", "IT");
    });
  });

  it("follows a collection picked in the runner", async () => {
    seed("de");
    render(<EntityTree />);
    await screen.findByRole("group", { name: "Country" });

    await act(async () => {
      await selectCollection("be");
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Belgium" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(document.querySelector("[data-country='BE']")).not.toBeNull();
  });

  it("refuses to switch country while a run is in progress and says why", async () => {
    seed("de");
    store.patchRunner({ running: true });
    render(<EntityTree />);
    await screen.findByRole("group", { name: "Country" });

    const italyButton = screen.getByRole("button", { name: "Italy" });
    expect(italyButton).toBeDisabled();
    expect(italyButton).toHaveAttribute("title", COUNTRY_LOCKED_WHILE_RUNNING);
    expect(screen.getByText(COUNTRY_LOCKED_WHILE_RUNNING)).toBeInTheDocument();
    expect(await selectCollection("it")).toBe(false);
    expect(store.getState().runner.collectionId).toBe("de");
  });

  it("folds to a summary that still names the country and its readiness, and persists", async () => {
    seed("de");
    const first = render(<EntityTree />);
    await screen.findByRole("group", { name: "Country" });
    await waitFor(() => expect(document.querySelectorAll("[data-persona-tree]")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "fiskaly entities" }));
    expect(document.querySelectorAll("[data-persona-tree]")).toHaveLength(0);
    const summary = document.querySelector("[data-tree-summary]") as HTMLElement;
    expect(summary).toHaveTextContent("Germany");
    await waitFor(() =>
      expect(summary.querySelector("[data-summary-persona='seller']")).toHaveAttribute(
        "data-summary-ready",
        "true",
      ),
    );

    first.unmount();
    render(<EntityTree />);
    await screen.findByRole("button", { name: "fiskaly entities" });
    expect(screen.getByRole("button", { name: "fiskaly entities" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.querySelector("[data-tree-summary]")).not.toBeNull();
    expect(document.querySelectorAll("[data-persona-tree]")).toHaveLength(0);
  });
});

describe("ProvisionDialog", () => {
  it("requires the FISCONLINE secrets for Italy", () => {
    render(
      <ProvisionDialog
        persona="seller"
        country={italy}
        environment="test"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Provision Italy" });
    expect(confirm).toBeDisabled();
    const pin = screen.getByLabelText("FISCONLINE PIN") as HTMLInputElement;
    const password = screen.getByLabelText("FISCONLINE password") as HTMLInputElement;
    expect(pin.type).toBe("password");
    expect(password.type).toBe("password");
    fireEvent.change(pin, { target: { value: "1234" } });
    fireEvent.change(password, { target: { value: "secret" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("FISCONLINE tax id (codice fiscale)"), {
      target: { value: "99999999990" },
    });
    expect(confirm).toBeEnabled();
  });

  it("asks for no secrets outside Italy and states the one-way transition and TEST billing", () => {
    render(
      <ProvisionDialog
        persona="seller"
        country={germany}
        environment="test"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(screen.queryByLabelText("FISCONLINE PIN")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Provision Germany" })).toBeEnabled();
    expect(screen.getByText(/one-way state transition/)).toBeInTheDocument();
    expect(screen.getByText(/TEST resources are not billed/)).toBeInTheDocument();
  });

  it("shows the failing step's upstream error verbatim", async () => {
    const outcome: ProvisionResult = {
      steps: [
        {
          name: "create taxpayer",
          method: "POST",
          path: "/taxpayers",
          status: "failed",
          error: {
            status: 422,
            code: "E_UNPROCESSABLE_CONTENT",
            message: "fiscalization.credentials.pin is required",
          },
        },
        { name: "create system", method: "POST", path: "/systems", status: "skipped" },
      ],
      created: { taxpayer_id: null, location_id: null, system_id: null },
      ready: false,
    };
    mocks.provisionCountry.mockResolvedValue(outcome);
    const onDone = vi.fn();
    render(
      <ProvisionDialog
        persona="seller"
        country={germany}
        environment="test"
        onClose={() => {}}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Provision Germany" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const failed = document.querySelector("[data-provision-step='create taxpayer']") as HTMLElement;
    expect(failed).toHaveAttribute("data-status", "failed");
    expect(failed).toHaveTextContent(
      JSON.stringify({
        status: 422,
        code: "E_UNPROCESSABLE_CONTENT",
        message: "fiscalization.credentials.pin is required",
      }),
    );
    expect(screen.getByText(/not ready yet/)).toBeInTheDocument();
  });

  it("reports a request-level failure without pretending anything ran", async () => {
    mocks.provisionCountry.mockRejectedValue(
      new Error("refusing to provision in the test environment without confirm=true"),
    );
    render(
      <ProvisionDialog
        persona="seller"
        country={germany}
        environment="test"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Provision Germany" }));
    expect(
      await screen.findByText("refusing to provision in the test environment without confirm=true"),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-provision-step]")).toBeNull();
  });

  it("sends the Italian secrets only for Italy and clears them after success", async () => {
    mocks.provisionCountry.mockResolvedValue({
      steps: [],
      created: { taxpayer_id: "tp-1", location_id: null, system_id: "sys-1" },
      ready: true,
    });
    render(
      <ProvisionDialog
        persona="seller"
        country={italy}
        environment="test"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("FISCONLINE PIN"), { target: { value: "1234" } });
    fireEvent.change(screen.getByLabelText("FISCONLINE password"), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("FISCONLINE tax id (codice fiscale)"), {
      target: { value: "99999999990" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Provision Italy" }));
    await screen.findByText(/Italy is ready/);
    expect(mocks.provisionCountry).toHaveBeenCalledWith({
      persona: "seller",
      country: "IT",
      confirm: true,
      reuse: true,
      taxpayer: {
        fiscalization: {
          credentials: { pin: "1234", password: "secret", tax_id_number: "99999999990" },
        },
      },
    });
    expect(screen.queryByLabelText("FISCONLINE PIN")).not.toBeInTheDocument();
  });

  it("keeps the secrets and offers Retry when the provision did not finish ready", async () => {
    mocks.provisionCountry.mockResolvedValue({
      steps: [{ name: "create taxpayer", method: "POST", path: "/taxpayers", status: "failed" }],
      created: { taxpayer_id: null, location_id: null, system_id: null },
      ready: false,
    });
    render(
      <ProvisionDialog
        persona="seller"
        country={italy}
        environment="test"
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("FISCONLINE PIN"), { target: { value: "1234" } });
    fireEvent.change(screen.getByLabelText("FISCONLINE password"), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("FISCONLINE tax id (codice fiscale)"), {
      target: { value: "99999999990" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Provision Italy" }));
    await screen.findByText(/not ready yet/);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeEnabled();
    expect((screen.getByLabelText("FISCONLINE PIN") as HTMLInputElement).value).toBe("1234");
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.provisionCountry).toHaveBeenCalledTimes(2));
    expect(mocks.provisionCountry).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taxpayer: {
          fiscalization: {
            credentials: { pin: "1234", password: "secret", tax_id_number: "99999999990" },
          },
        },
      }),
    );
  });

  it("ignores dismissal while a provision is running", async () => {
    let settle: (value: ProvisionResult) => void = () => {};
    mocks.provisionCountry.mockReturnValue(
      new Promise<ProvisionResult>((resolve) => {
        settle = resolve;
      }),
    );
    const onClose = vi.fn();
    render(
      <ProvisionDialog
        persona="seller"
        country={germany}
        environment="test"
        onClose={onClose}
        onDone={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Provision Germany" }));
    await screen.findByText("Provisioning…");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    settle({
      steps: [],
      created: { taxpayer_id: "tp-1", location_id: null, system_id: "sys-1" },
      ready: true,
    });
    await screen.findByText(/Germany is ready/);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
