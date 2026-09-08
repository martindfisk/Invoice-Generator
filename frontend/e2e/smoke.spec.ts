import { expect, test, type Page } from "@playwright/test";

function picker(page: Page) {
  return page.getByRole("region", { name: "Preset picker" });
}

type Pane = "Fields" | "Predicted XML";

function paneToggle(page: Page, pane: Pane) {
  return page
    .getByRole("group", { name: "Mapper panes" })
    .getByRole("button", { name: pane, exact: true });
}

async function showOnly(page: Page, ...panes: Pane[]) {
  for (const pane of ["Fields", "Predicted XML"] as Pane[]) {
    const toggle = paneToggle(page, pane);
    const shown = (await toggle.getAttribute("aria-pressed")) === "true";
    if (shown !== panes.includes(pane)) await toggle.click();
  }
}

// The old single-mode helper, expressed as pane sets: "Split" was fields + JSON.
async function viewMode(page: Page, mode: "Fields" | "fiskaly JSON" | "Predicted XML" | "Split") {
  if (mode === "Fields" || mode === "Split") return showOnly(page, "Fields");
  if (mode === "Predicted XML") return showOnly(page, "Predicted XML");
  return showOnly(page);
}

const XML_EDITOR = ".cm-content[data-language='xml']";
const JSON_EDITOR = ".cm-content[data-language='json']";

async function chooseItalianPreset(page: Page) {
  await picker(page).locator("[data-preset='it-b2b-sdi']").click();
  await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();
}

function stepper(page: Page) {
  return page.getByRole("region", { name: "Workflow" }).getByRole("list");
}

test.describe("shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("offers the presets and keeps the API log out of the way until Send", async ({ page }) => {
    await expect(page).toHaveTitle(/Invoice Generator/);
    await expect(picker(page)).toBeVisible();
    expect(await picker(page).getByRole("button").count()).toBeGreaterThan(0);
    // Setup, Mapper and Validate make no fiskaly calls, so the pane would only take space.
    await expect(page.getByRole("region", { name: "API log" })).toHaveCount(0);
  });

  test("reaches the backend and reports MOCK mode", async ({ page }) => {
    await expect(page.getByTitle("Backend mode from GET /api/config")).toHaveText("MOCK");
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("offers the persona switch only in the runner — the flow always sends as the seller", async ({
    page,
  }) => {
    await expect(page.getByRole("group", { name: "Persona" })).toHaveCount(0);
    await page.getByRole("button", { name: "Test runner" }).click();
    const group = page.getByRole("group", { name: "Persona" });
    const buyer = group.getByRole("button", { name: "Buyer" });
    await expect(group.getByRole("button", { name: "Seller" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await buyer.click();
    await expect(buyer).toHaveAttribute("aria-pressed", "true");
  });

  test("toggles the theme", async ({ page }) => {
    const root = page.locator("html");
    const before = await root.getAttribute("data-theme");
    await page.getByRole("button", { name: /mode$/ }).click();
    await expect(root).not.toHaveAttribute("data-theme", before ?? "");
  });
});

test.describe("setup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("lays the scenarios out as a country by audience matrix", async ({ page }) => {
    const matrix = picker(page).getByRole("table");
    await expect(matrix.getByRole("columnheader")).toHaveText([/^B2C/, /^B2B/, /^B2G/]);
    // Rows derive from the presets present; France is gone because the UAPI has no e-invoice-fr.
    await expect(matrix.getByRole("rowheader")).toHaveText([/^Germany/, /^Italy/, /^Belgium/]);

    const empty = matrix.locator("[data-cell]", { hasText: "No preset" }).first();
    await expect(empty).toBeVisible();
    await expect(empty.getByRole("button")).toHaveCount(0);
    await expect(picker(page).getByText("broken on purpose").first()).toBeVisible();
  });

  test("loads the preset picked out of the Italian B2G cell into the Mapper", async ({ page }) => {
    const card = picker(page).locator("[data-cell='IT:B2G']").getByRole("button").first();
    const label = (await card.locator("span").first().innerText()).trim();
    const format = (await card.getAttribute("title"))?.split("\n")[2] ?? "";
    // Every card is a button in its cell, so the matrix is operable without a pointer.
    await card.press("Enter");

    await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();
    await expect(page.getByRole("heading", { name: label })).toBeVisible();
    await expect(page.getByRole("region", { name: "fiskaly JSON view" })).toBeVisible();
    expect(format).not.toEqual("");
    await expect(page.getByText(format, { exact: true })).toBeVisible();
  });
});

test.describe("mapper", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("keeps the later steps locked until a preset is chosen", async ({ page }) => {
    const stepper = page.getByRole("region", { name: "Workflow" }).getByRole("list");
    const mapper = stepper.getByRole("button", { name: /Mapper$/ });
    await expect(mapper).toBeDisabled();
    await expect(mapper).toHaveAttribute("title", /preset/i);

    await chooseItalianPreset(page);
    await expect(stepper.getByRole("button", { name: /Mapper$/ })).toBeEnabled();
    await expect(stepper.getByRole("button", { name: /Send$/ })).toBeEnabled();
  });

  test("keeps the JSON editor full height and puts the caveats past the payload", async ({
    page,
  }) => {
    await chooseItalianPreset(page);
    const pane = page.getByRole("region", { name: "fiskaly JSON view" });
    const scroller = pane.locator("div.overflow-y-auto").first();
    const caveat = pane.locator("[data-uncarried-by-operation]");

    // One scrollbar for the pane, and the editor is taller than it — the caveats are past the end.
    const box = await pane.boundingBox();
    const paneBottom = box!.y + box!.height;
    expect((await caveat.boundingBox())!.y).toBeGreaterThan(paneBottom);

    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(async () => (await caveat.boundingBox())!.y < paneBottom).toBe(true);

    // Scrolling is still driven by selection: a field deep in the payload brings itself into view.
    await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
    await page.locator("[data-field='payment.iban']").first().click();
    await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(pane.locator(".cm-selected-range")).not.toHaveCount(0);
  });

  test("maps the selected field across the three panes and names what is missing", async ({
    page,
  }) => {
    await chooseItalianPreset(page);
    const strip = page.locator("[data-presence-strip]");
    await expect(strip).toContainText(/Select a field in any pane/);

    await page.locator("[data-field='number']").first().click();
    await expect(strip).toHaveAttribute("data-presence-strip", "number");
    await expect(strip).toHaveAttribute("data-missing", "0");
    // The same field is highlighted in the JSON and the predicted XML at once.
    await expect(page.locator(JSON_EDITOR).locator(".cm-selected-range")).not.toHaveCount(0);
    await expect(page.locator(XML_EDITOR).locator(".cm-selected-range")).not.toHaveCount(0);

    // The seller is the commissioned taxpayer, so BT-27 reaches the XML but never the payload.
    await page.locator("[data-field='seller.name']").first().click();
    await expect(strip).toHaveAttribute("data-missing", "1");
    await expect(strip.locator("[data-structure='json']")).toHaveAttribute("data-present", "false");
    await expect(strip.locator("[data-structure='xml']")).toHaveAttribute("data-present", "true");
    await expect(strip).toContainText(/taxpayer resource/);
  });

  test("opens with all three structures and folds each flank away", async ({ page }) => {
    await chooseItalianPreset(page);
    await expect(page.getByRole("region", { name: "Fields view" })).toBeVisible();
    await expect(page.getByRole("region", { name: "fiskaly JSON view" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Predicted XML view" })).toBeVisible();
    await expect(page.locator("[data-panes]")).toHaveAttribute("data-panes", "human+json+xml");
    await expect(page.getByText(/The Unified API accepts this JSON, not XML/)).toBeVisible();
    await expect(page.getByText(/what this browser expects fiskaly to generate/)).toBeVisible();

    await paneToggle(page, "Fields").click();
    await expect(page.getByRole("region", { name: "Fields view" })).toHaveCount(0);
    await expect(page.locator("[data-panes]")).toHaveAttribute("data-panes", "json+xml");

    await paneToggle(page, "Predicted XML").click();
    await expect(page.getByRole("region", { name: "Predicted XML view" })).toHaveCount(0);
    // The JSON is the payload the step explains, so it can never be folded away.
    await expect(page.getByRole("region", { name: "fiskaly JSON view" })).toBeVisible();
    await expect(page.locator("[data-panes]")).toHaveAttribute("data-panes", "json");

    await paneToggle(page, "Fields").click();
    await expect(page.getByRole("region", { name: "Fields view" })).toBeVisible();
  });

  test("highlights the JSON range of the field the user clicks", async ({ page }) => {
    await chooseItalianPreset(page);
    await splitView(page);
    await expect(page.locator(".cm-selected-range")).toHaveCount(0);

    const field = page.locator("[data-field='number']").first();
    await field.click();
    await expect(page.locator(".cm-selected-range").first()).toBeVisible();
    await expect(page.locator(".cm-selected-line").first()).toBeVisible();

    await page.getByRole("textbox", { name: "Invoice number" }).press("Escape");
    await expect(page.locator("[data-field='number']").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("keeps the selection when the reader switches to the predicted XML", async ({ page }) => {
    await chooseItalianPreset(page);
    await splitView(page);
    await page.locator("[data-field='number']").first().click();
    await page.getByRole("textbox", { name: "Invoice number" }).press("Escape");

    await viewMode(page, "Predicted XML");
    await expect(page.locator(".cm-selected-range").first()).toBeVisible();
    await expect(page.locator(".cm-selected-line").first()).toBeVisible();
  });

  test("highlights back from a click inside the XML", async ({ page }) => {
    await chooseItalianPreset(page);
    await viewMode(page, "Predicted XML");
    await page.locator(".cm-line").nth(4).click();
    await expect(page.locator(".cm-selected-range").first()).toBeVisible();
  });

  test("keeps the chosen preset across a reload", async ({ page }) => {
    await chooseItalianPreset(page);
    await page.reload();
    await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();
  });

  test("opens a collapsed group and writes a field the preset left empty into the XML", async ({
    page,
  }) => {
    await picker(page).locator("[data-preset='be-peppol']").click();
    await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();
    await splitView(page);

    const delivery = page.getByRole("region", { name: "Delivery", exact: true });
    const head = delivery.getByRole("button", { name: /^BG-13/ });
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(head).toHaveAccessibleName(/0 of 1 set/);
    await expect(page.locator("[data-field='delivery.date']")).toHaveCount(0);

    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    const field = page.locator("[data-field='delivery.date']");
    await expect(field).toHaveText(/—/);

    await field.click();
    const input = page.getByRole("textbox", { name: "Actual delivery date" });
    await expect(input).toHaveValue("");
    await input.fill("2026-09-01");
    await input.press("Enter");

    await viewMode(page, "Predicted XML");
    await expect(page.locator(XML_EDITOR)).toContainText("ActualDeliveryDate");
    await expect(page.locator(XML_EDITOR)).toContainText("2026-09-01");
    await viewMode(page, "Split");
    await expect(page.locator("[data-field='delivery.date']")).not.toHaveText(/—/);
    await expect(head).toHaveAccessibleName(/1 of 1 set/);
  });

  test("marks what the format cannot carry and hides it on demand", async ({ page }) => {
    await chooseItalianPreset(page);
    await viewMode(page, "Fields");
    const uncarried = page.locator("[data-uncarried]");
    expect(await uncarried.count()).toBeGreaterThan(0);
    await expect(uncarried.first()).toContainText("not carried by FatturaPA");

    await page.getByRole("checkbox", { name: /cannot carry/ }).uncheck();
    await expect(page.locator("[data-uncarried]")).toHaveCount(0);
    await expect(page.locator("[data-field='number']")).toBeVisible();
  });

  test("admits the FatturaPA totals are discarded and drops the claim for Peppol", async ({
    page,
  }) => {
    await chooseItalianPreset(page);
    const pane = page.getByRole("region", { name: "fiskaly JSON view" });
    await expect(pane.locator("[data-fate-notice='totals']")).toBeVisible();
    await expect(pane.locator("[data-fate-notice='totals']")).toContainText(
      "breakdown and totals are discarded",
    );
    await expect(pane.locator("[data-fate-notice='seller']")).toBeVisible();

    await page
      .getByRole("group", { name: "Predicted XML format" })
      .getByRole("button", { name: "Peppol BIS Billing 3.0 (UBL 2.1)" })
      .click();
    await expect(pane.locator("[data-fate-notice='totals']")).toHaveCount(0);
    await expect(pane.locator("[data-fate-notice='seller']")).toHaveCount(0);
  });

  test("says what the later steps will do without faking a result", async ({ page }) => {
    await chooseItalianPreset(page);
    const stepper = page.getByRole("region", { name: "Workflow" }).getByRole("list");

    await stepper.getByRole("button", { name: /Send$/ }).click();
    await expect(page.getByText("POST /api/invoices")).toBeVisible();
  });
});

async function splitView(page: Page) {
  await viewMode(page, "Split");
  await expect(page.getByRole("region", { name: "fiskaly JSON view" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Fields view" })).toBeVisible();
}

declare const document: {
  querySelector(selectors: string): unknown;
  createTreeWalker(
    root: unknown,
    whatToShow: number,
  ): { nextNode(): { textContent: string | null } | null };
  createRange(): {
    setStart(node: unknown, offset: number): void;
    setEnd(node: unknown, offset: number): void;
    getBoundingClientRect(): { left: number; right: number; top: number; height: number };
  };
};

const SHOW_TEXT = 4;

// Both edges are measured in one pass: CodeMirror re-renders between evaluate() calls, and two
// independent DOM walks could return coordinates from different renders.
//
// The rect is also polled until it stops moving. The JSON pane's header grows after first paint —
// the field-fate table is a lazy import and the spec coverage panel is a fetch — so a rect taken
// too early is ~30px above where the token ends up, and the drag then selects the wrong range.
async function tokenBox(page: Page, token: string, editor: string = XML_EDITOR) {
  const measure = () =>
    page.evaluate(
      ({ needle, show, selector }) => {
        const content = document.querySelector(selector);
        if (!content) return null;
        const walker = document.createTreeWalker(content, show);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const index = (node.textContent ?? "").indexOf(needle);
          if (index === -1) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + needle.length);
          const rect = range.getBoundingClientRect();
          return { left: rect.left, right: rect.right, middle: rect.top + rect.height / 2 };
        }
        return null;
      },
      { needle: token, show: SHOW_TEXT, selector: editor },
    );

  // Wait for the two things that grow the JSON pane's header after first paint: the spec
  // coverage fetch and the lazily imported field-fate table. Until both land, the editor is
  // ~30px lower than it will be, and a drag measured now selects the wrong range.
  await page
    .locator("[data-spec-coverage]:not([data-spec-coverage='pending'])")
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);

  let previous = await measure();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(100);
    const current = await measure();
    if (
      previous &&
      current &&
      current.middle === previous.middle &&
      current.left === previous.left
    ) {
      return {
        start: { x: current.left, y: current.middle },
        end: { x: current.right, y: current.middle },
      };
    }
    previous = current;
  }
  throw new Error(`e2e: "${token}" never settled in ${editor}`);
}

async function replaceInXml(
  page: Page,
  token: string,
  replacement: string,
  editor: string = XML_EDITOR,
) {
  const { start, end } = await tokenBox(page, token, editor);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await page.keyboard.insertText(replacement);
}

async function chooseBrokenPreset(page: Page) {
  await picker(page).locator("[data-preset='broken']").click();
  await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();
  await page
    .getByRole("region", { name: "Workflow" })
    .getByRole("list")
    .getByRole("button", { name: /Validate$/ })
    .click();
  await expect(page.getByRole("region", { name: "Validation stages" })).toBeVisible();
}

test.describe("validate", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await chooseBrokenPreset(page);
  });

  test("runs the pipeline and lists what the broken preset breaks", async ({ page }) => {
    const stages = page.getByRole("region", { name: "Validation stages" });
    await expect(stages.getByText("Model rules")).toBeVisible();
    await expect(stages.getByText("Well-formedness")).toBeVisible();

    const findings = page.getByRole("region", { name: "Findings" });
    await expect(findings.getByRole("option").first()).toBeVisible();
    await expect(findings.getByRole("option", { name: /BR-11/ })).toBeVisible();
    expect(await findings.getByRole("option").count()).toBeGreaterThan(1);
  });

  test("leads with the fiskaly contract and calls the XML stages a prediction", async ({
    page,
  }) => {
    const stages = page.getByRole("region", { name: "Validation stages" });
    await expect(stages.locator("[data-tier='contract']")).toBeVisible();
    await expect(stages.getByRole("heading", { name: "fiskaly API contract" })).toBeVisible();
    await expect(stages.getByText(/A pass here is not fiskaly accepting anything/)).toBeVisible();
    const tiers = await stages
      .locator("[data-tier]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tier")));
    expect(tiers).toEqual(["contract", "document"]);
  });

  test("selecting a finding highlights its field, and its range in the predicted XML", async ({
    page,
  }) => {
    await splitView(page);
    await expect(page.locator(".cm-selected-range")).toHaveCount(0);

    const finding = page.getByRole("option", { name: /BR-11/ });
    await finding.click();
    await expect(finding).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-field='buyer.address.country']").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await viewMode(page, "Predicted XML");
    await expect(page.locator(".cm-selected-range").first()).toBeVisible();
    await expect(page.locator(".cm-selected-line").first()).toBeVisible();
  });

  test("warns about the errors but still lets the invoice go to Send", async ({ page }) => {
    const warning = page.getByText(/sending anyway will likely be rejected/);
    await expect(warning).toBeVisible();
    await page.getByRole("button", { name: "Send anyway" }).click();
    await expect(page.getByText("POST /api/invoices")).toBeVisible();
    await expect(page.getByText(/sending anyway will likely be rejected/)).toBeVisible();
  });
});

test.describe("two-way editing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await chooseItalianPreset(page);
    await splitView(page);
  });

  test("a field edit rewrites the JSON, and a JSON edit rewrites the fields", async ({ page }) => {
    const field = page.locator("[data-field='number']").first();
    const before = (await field.innerText()).trim();

    await field.click();
    const input = page.getByRole("textbox", { name: "Invoice number" });
    await input.fill("E2E-1234");
    await input.press("Enter");

    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-1234");
    await expect(page.locator(JSON_EDITOR)).toContainText("E2E-1234");
    expect(before).not.toContain("E2E-1234");

    await replaceInXml(page, "E2E-1234", "E2E-9999", JSON_EDITOR);
    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-9999");
    await expect(page.locator(JSON_EDITOR)).toContainText("E2E-9999");
  });

  test("an unparseable JSON edit reports the parser and keeps the last good invoice", async ({
    page,
  }) => {
    const field = page.locator("[data-field='number']").first();
    await field.click();
    const input = page.getByRole("textbox", { name: "Invoice number" });
    await input.fill("E2E-KEEP");
    await input.press("Enter");
    await expect(page.locator(JSON_EDITOR)).toContainText("E2E-KEEP");

    await replaceInXml(page, '"E2E-KEEP"', '"E2E-KEEP', JSON_EDITOR);
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-KEEP");

    await replaceInXml(page, '"E2E-KEEP', '"E2E-BACK"', JSON_EDITOR);
    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-BACK");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("an unparseable XML edit reports the parser and keeps the last good invoice", async ({
    page,
  }) => {
    const field = page.locator("[data-field='number']").first();
    await field.click();
    const input = page.getByRole("textbox", { name: "Invoice number" });
    await input.fill("E2E-XML");
    await input.press("Enter");

    await viewMode(page, "Predicted XML");
    await expect(page.locator(XML_EDITOR)).toContainText("E2E-XML");
    await replaceInXml(page, "E2E-XML", "<<<");
    await expect(page.getByRole("alert").first()).toBeVisible();

    await replaceInXml(page, "<<<", "E2E-BACK");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await viewMode(page, "Split");
    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-BACK");
  });

  test("keeps the cross-highlight working while a field is being edited", async ({ page }) => {
    const field = page.locator("[data-field='number']").first();
    await field.click();
    await expect(page.getByRole("textbox", { name: "Invoice number" })).toBeVisible();
    await expect(page.locator(".cm-selected-range").first()).toBeVisible();
  });
});

test.describe("send", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await chooseItalianPreset(page);
    await page
      .getByRole("region", { name: "Workflow" })
      .getByRole("list")
      .getByRole("button", { name: /Validate$/ })
      .click();
    await expect(page.getByRole("region", { name: "Validation stages" })).toBeVisible();
    await page.getByRole("button", { name: /Continue to Send|Send anyway/ }).click();
    await expect(page.getByRole("region", { name: "Send" })).toBeVisible();
  });

  test("shows what will be posted before anything is sent", async ({ page }) => {
    await expect(page.getByText(/no request leaves this machine/i)).toBeVisible();
    await expect(page.getByText("POST /api/invoices")).toBeVisible();
    await expect(page.getByRole("group", { name: "Operation payload" })).toBeVisible();
    await expect(page.getByText(/This is the JSON you composed, posted unchanged/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Transmission lifecycle" })).toHaveCount(0);
  });

  test("runs the lifecycle to a terminal state and diffs the transmitted XML", async ({ page }) => {
    await page.getByRole("button", { name: "Send to fiskaly" }).click();

    const timeline = page.getByRole("region", { name: "Transmission lifecycle" });
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('[data-stage="intention"]')).toHaveAttribute(
      "data-status",
      "done",
      { timeout: 30_000 },
    );
    await expect(timeline.locator('[data-stage="transmission"]')).toHaveAttribute(
      "data-status",
      "done",
      { timeout: 90_000 },
    );
    await expect(page.locator('[data-outcome="transmitted"]')).toBeVisible();

    const diff = page.getByRole("region", { name: "Compliance artifact diff" });
    await expect(diff).toBeVisible({ timeout: 30_000 });
    await expect(diff.locator(".cm-editor")).toHaveCount(2);
    await expect(diff.getByRole("status")).toBeVisible();
    await expect(diff.getByText(/Predicted XML/).first()).toBeVisible();
    await expect(diff.locator("[data-diff-caveat]")).toContainText(
      /static fixture of a different invoice/,
    );

    const intentionId = (
      await timeline.locator('[data-stage="intention"] button').innerText()
    ).trim();
    const transactionId = (
      await timeline.locator('[data-stage="transaction"] button').first().innerText()
    ).trim();
    const log = page.getByRole("region", { name: "API log" });
    const posts = log.locator("[data-group]").filter({ hasText: "POST" });
    await expect(posts.filter({ hasText: intentionId })).toHaveCount(1);
    await expect(posts.filter({ hasText: transactionId })).toHaveCount(1);
    // The lifecycle reads are correlated back to the record. How many of them the client needs,
    // and whether they land adjacently in a log shared with the other parallel send tests, is
    // timing; the "polled N×" grouping itself is asserted deterministically in send-ui.test.tsx.
    const gets = log.locator("[data-group]").filter({ hasText: "GET" });
    await expect(gets.filter({ hasText: transactionId }).first()).toBeVisible();
  });

  test("links a lifecycle node to the calls that produced it", async ({ page }) => {
    await page.getByRole("button", { name: "Send to fiskaly" }).click();
    const timeline = page.getByRole("region", { name: "Transmission lifecycle" });
    const node = timeline.locator('[data-stage="transaction"] button').first();
    await expect(node).toBeVisible({ timeout: 30_000 });

    const recordId = (await node.innerText()).trim();
    await node.click();
    const card = page
      .getByRole("region", { name: "API log" })
      .locator(`[data-record="${recordId}"]`);
    await expect(card.first()).toBeVisible();
    await expect(
      card
        .first()
        .getByRole("button", { name: /records/ })
        .first(),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("send · Germany", () => {
  test("a German preset reaches a terminal state and the artifact diff", async ({ page }) => {
    await page.goto("/");
    await picker(page).locator("[data-preset='de-hotel-b2g-xrechnung']").click();
    await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();

    await stepper(page).getByRole("button", { name: /Send$/ }).click();
    await expect(page.getByRole("region", { name: "Send" })).toBeVisible();

    const send = page.getByRole("button", { name: /Send to fiskaly|Send again/ });
    await expect(send).toBeEnabled();
    await send.click();

    const timeline = page.getByRole("region", { name: "Transmission lifecycle" });
    await expect(timeline.locator('[data-stage="transmission"]')).toHaveAttribute(
      "data-status",
      "done",
      { timeout: 90_000 },
    );
    await expect(page.locator('[data-outcome="transmitted"]')).toBeVisible();
    await expect(page.getByRole("region", { name: "Compliance artifact diff" })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("send · correction", () => {
  test("a credit note is blocked until an invoice was sent, then posts a TRANSACTION::CORRECTION", async ({
    page,
  }) => {
    await page.goto("/");
    await picker(page).locator("[data-preset='it-restaurant-td04-credit']").click();
    await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();
    await stepper(page).getByRole("button", { name: /Send$/ }).click();

    const send = page.getByRole("button", { name: /Send to fiskaly|Send again/ });
    await expect(send).toBeDisabled();
    await expect(page.getByText(/Send the original invoice first/)).toBeVisible();

    // Send the original invoice, whose record id the credit note will reference.
    await stepper(page)
      .getByRole("button", { name: /Setup$/ })
      .click();
    await picker(page).locator("[data-preset='it-restaurant-b2b-fattura']").click();
    await stepper(page).getByRole("button", { name: /Send$/ }).click();
    await page.getByRole("button", { name: "Send to fiskaly" }).click();
    await expect(page.locator('[data-outcome="transmitted"]')).toBeVisible({ timeout: 90_000 });

    // Back to the credit note: it now composes a CORRECTION and can be sent.
    await stepper(page)
      .getByRole("button", { name: /Setup$/ })
      .click();
    await expect(page.getByText(/Last invoice transmitted/)).toBeVisible();
    await picker(page).locator("[data-preset='it-restaurant-td04-credit']").click();
    await stepper(page).getByRole("button", { name: /Send$/ }).click();
    await expect(page.getByText(/TRANSACTION::CORRECTION — the operation posted/)).toBeVisible();
    // The preflight names the record this credit note corrects.
    await expect(page.getByText("Corrects", { exact: true })).toBeVisible();
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator('[data-outcome="transmitted"]')).toBeVisible({ timeout: 90_000 });
    // Through the typed backend endpoint (POST /api/invoices/{id}/correction), not the
    // passthrough fallback: the upstream calls are recorded under the "correction" step.
    // Two matches prove the point twice: the step-filter chip and the call card's step chip.
    await expect(
      page
        .getByRole("region", { name: "API log" })
        .getByRole("button", { name: "correction", exact: true })
        .first(),
    ).toBeVisible();
  });
});

test.describe("the JSON is the artifact", () => {
  test("authors the operation, and the fields and predicted XML follow it to Send", async ({
    page,
  }) => {
    await page.goto("/");
    await chooseItalianPreset(page);

    // The Unified API takes JSON, so it is the pane that can never be folded away — and the
    // Mapper opens with the two structures it is mapped against already beside it.
    await expect(page.getByRole("region", { name: "fiskaly JSON view" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Fields view" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Predicted XML view" })).toBeVisible();

    await splitView(page);
    const composed = await page.locator(JSON_EDITOR).innerText();
    const before = /"number":\s*"([^"]+)"/.exec(composed)?.[1];
    if (!before) throw new Error("e2e: the JSON pane shows no document number");
    await replaceInXml(page, before, "E2E-JSON-FIRST", JSON_EDITOR);

    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-JSON-FIRST");
    await viewMode(page, "Predicted XML");
    await expect(page.locator(XML_EDITOR)).toContainText("E2E-JSON-FIRST");

    await stepper(page)
      .getByRole("button", { name: /Validate$/ })
      .click();
    const stages = page.getByRole("region", { name: "Validation stages" });
    await expect(stages.locator("[data-tier='contract']")).toBeVisible();
    await expect(stages.getByRole("heading", { name: "fiskaly API contract" })).toBeVisible();

    await page.getByRole("button", { name: /Continue to Send|Send anyway/ }).click();
    await expect(page.getByRole("region", { name: "Send" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Operation payload" })).toContainText(
      "E2E-JSON-FIRST",
    );
  });
});

test.describe("resizable panes", () => {
  test("drags the mapper splitters and remembers the sizes", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await chooseItalianPreset(page);

    const fields = page.getByRole("region", { name: "Fields view" });
    const separator = page.getByRole("separator", { name: /Resize the fields pane/i }).first();
    const before = (await fields.boundingBox())!.width;
    const bar = (await separator.boundingBox())!;
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x - 220, bar.y + bar.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await fields.boundingBox())!.width;
    expect(after).toBeLessThan(before - 100);

    // Remembered across a reload; a few pixels of layout rounding are immaterial.
    await page.reload();
    await expect
      .poll(async () => Math.abs((await fields.boundingBox())!.width - after))
      .toBeLessThan(25);

    // The second separator moves the predicted XML pane independently of the first.
    const xml = page.getByRole("region", { name: "Predicted XML view" });
    const wide = (await xml.boundingBox())!.width;
    const right = page.getByRole("separator", { name: /Resize the predicted XML pane/i }).first();
    const handle = (await right.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 200, handle.y + handle.height / 2, { steps: 10 });
    await page.mouse.up();
    expect((await xml.boundingBox())!.width).toBeGreaterThan(wide + 100);
  });

  test("resizes the validate panes vertically", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await chooseItalianPreset(page);
    await page
      .getByRole("button", { name: /Validate/i })
      .first()
      .click();
    await expect(page.getByRole("region", { name: "Validation stages" })).toBeVisible();

    const separator = page
      .getByRole("separator", { name: /invoice and the validation results/i })
      .first();
    const bar = (await separator.boundingBox())!;
    const heights = () =>
      page
        .locator("[data-panel]")
        .evaluateAll((nodes) =>
          nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
        );
    const before = (await heights())[0];

    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.down();
    for (const dy of [-50, -110, -170]) {
      await page.mouse.move(bar.x + bar.width / 2, bar.y + dy);
    }
    await page.mouse.up();

    expect((await heights())[0]).toBeLessThan(before - 80);
  });
});

test.describe("api log lifecycle", () => {
  test("starts empty on arriving at Send and fills only once Send is pressed", async ({ page }) => {
    // The recorder is shared, so parallel tests stream their calls to every open page. Hold
    // the event stream back until this page has shown its cleared log, then let it flow.
    await page.route("**/api/events", (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }),
    );
    // Same for the history seed: under parallel load (the entity tree alone records dozens of
    // onboarding calls per runner page) GET /api/calls can resolve after Send's clear and
    // repopulate the log with other workers' history.
    await page.route("**/api/calls", (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" }),
    );
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await chooseItalianPreset(page);
    await page.getByRole("button", { name: /Send/i }).first().click();

    const log = page.getByRole("region", { name: "API log" });
    await expect(log).toBeVisible();
    // Whatever the recorder already held is not this send, so it must not be shown as if it were.
    await expect(log.locator("[data-group]")).toHaveCount(0);
    await page.unroute("**/api/events");
    await page.unroute("**/api/calls");

    await page
      .getByRole("button", { name: /Send to fiskaly|Send anyway/i })
      .last()
      .click();
    await expect
      .poll(async () => log.locator("[data-group]").count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    // Leaving and coming back after a send keeps that send's calls on screen.
    const sent = await log.locator("[data-group]").count();
    await page
      .getByRole("button", { name: /Validate/i })
      .first()
      .click();
    await page.getByRole("button", { name: /Send/i }).first().click();
    // Not wiped: polls may still be arriving, so the count can only have grown.
    await expect.poll(async () => log.locator("[data-group]").count()).toBeGreaterThanOrEqual(sent);
  });
});

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("opens from the top bar, holds every section and closes on Esc", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Settings" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    for (const name of ["Environment", "Mode", "Credentials", "Identifiers", "Local preferences"]) {
      await expect(dialog.getByRole("region", { name })).toBeVisible();
    }
    await expect(dialog.getByRole("region", { name: "Mode" }).getByRole("radio")).toHaveCount(2);
    await expect(
      dialog.getByRole("region", { name: "Mode" }).getByRole("radio", { name: /^MOCK/ }),
    ).toBeChecked();

    // Secrets are write-only: the fields start empty and only a fingerprint is ever shown back.
    const seller = dialog.getByRole("group", { name: "Seller credentials" });
    await expect(seller.getByLabel("API key")).toHaveValue("");
    await expect(seller.getByLabel("API secret")).toHaveAttribute("type", "password");
    await expect(
      dialog.getByRole("group", { name: "Buyer identifiers" }).getByLabel("SDI destination code"),
    ).toBeVisible();

    // LIVE is guarded: picking it is not applying it.
    const environment = dialog.getByRole("region", { name: "Environment" });
    await environment.getByRole("radio", { name: /^LIVE/ }).check();
    await expect(environment.getByRole("button", { name: "Apply environment" })).toBeDisabled();
    await expect(environment.getByRole("checkbox")).not.toBeChecked();

    // Nothing behind the dialog is reachable by Tab: focus never leaves the panel.
    for (let press = 0; press < 30; press += 1) {
      await page.keyboard.press("Tab");
      await expect(dialog.locator(":focus")).toHaveCount(1);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe("test runner", () => {
  test("runs the German collection in MOCK and logs each call under its own step", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("group", { name: "Section" })
      .getByRole("button", { name: "Test runner" })
      .click();

    const runner = page.getByRole("region", { name: "Test runner" });
    await expect(runner).toBeVisible();
    // The API log is the point of the runner, so it is beside it from the start.
    await expect(page.getByRole("region", { name: "API log" })).toBeVisible();

    await runner.locator("[data-collection='de']").click();
    const steps = runner.getByRole("list", { name: "Collection steps" });
    await expect(steps).toBeVisible();
    expect(await steps.locator("[data-runner-step]").count()).toBeGreaterThan(0);

    // The published DE collection's defects are surfaced as fiskaly's, not fixed or hidden.
    const notes = runner.getByRole("region", { name: "Published collection notes" });
    await expect(notes).toBeVisible();
    await expect(notes).toContainText("This is what fiskaly publishes");
    await expect(notes).toContainText('"22.00"');
    await expect(notes).toContainText("asserted value, not the label");
    expect(await notes.getByRole("listitem").count()).toBe(6);
    await notes.getByRole("button", { name: "Dismiss" }).click();
    await expect(notes).toHaveCount(0);

    // Excluded requests are listed and inspectable, not hidden.
    const excluded = steps.locator("[data-runner-step][data-runnable='false']");
    expect(await excluded.count()).toBeGreaterThan(0);

    await runner.getByRole("button", { name: "Run all" }).click();
    const finished = runner.getByRole("status").filter({ hasText: /^Finished/ });
    await expect(finished).toBeVisible({ timeout: 120_000 });
    await expect(finished).toContainText(/ in \d+(\.\d+)? s| in \d+ min/);

    const runnable = steps.locator("[data-runner-step][data-runnable='true']");
    const runnableCount = await runnable.count();
    expect(runnableCount).toBeGreaterThan(0);
    for (let index = 0; index < runnableCount; index += 1) {
      await expect(runnable.nth(index)).toHaveAttribute("data-status", "passed");
    }
    const excludedCount = await excluded.count();
    for (let index = 0; index < excludedCount; index += 1) {
      await expect(excluded.nth(index)).toHaveAttribute("data-status", "skipped");
    }

    // An id captured from one response is substituted into a later step's path.
    const capture = steps.locator("[data-captured='eInvoiceId']").first();
    await expect(capture).toBeVisible();
    const capturedId = ((await capture.innerText()).split("=")[1] ?? "").trim();
    expect(capturedId).not.toBe("");
    const retrieve = steps
      .locator("[data-runner-step]")
      .filter({ hasText: "Retrieve TRANSACTION::INVOICE" })
      .first();
    await expect(retrieve.locator("[data-resolved-path]")).toContainText(capturedId);

    // The captured value also lands in the variable panel, labelled as runtime data.
    const variables = page.getByRole("region", { name: "Runner variables" });
    await expect(variables.locator("[data-variable='eInvoiceId']")).toContainText(capturedId);

    // A finished step offers its recorded cURL — masked by the backend, never a real token.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await runnable.first().getByRole("button", { name: "Copy as cURL" }).click();
    await expect(runnable.first().getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await page.evaluate<string>("navigator.clipboard.readText()");
    expect(copied).toMatch(/^curl -X GET/);
    expect(copied).toContain("Bearer $FISKALY_TOKEN");
    expect(copied).not.toMatch(/Bearer ey/);

    await runner.getByRole("button", { name: "Copy run as cURL" }).click();
    const script = await page.evaluate<string>("navigator.clipboard.readText()");
    expect(script).toContain("# 1. ");
    expect(script).toContain("Create INTENTION::TRANSACTION");
    expect(script).toContain("skipped");
    expect((script.match(/^curl -X /gm) ?? []).length).toBeGreaterThan(10);
    expect(script).not.toMatch(/Bearer ey/);

    // The passthrough labels each call with its step name, so the log filters per step.
    const filters = page
      .getByRole("region", { name: "API log" })
      .getByRole("group", { name: "Call filters" });
    await expect(
      filters.getByRole("button", { name: "Create INTENTION::TRANSACTION", exact: true }),
    ).toBeVisible();
    await expect(
      filters.getByRole("button", { name: "Create TRANSACTION::INVOICE", exact: true }),
    ).toBeVisible();
  });

  test("keeps the invoice flow intact behind the section switch", async ({ page }) => {
    await page.goto("/");
    const sections = page.getByRole("group", { name: "Section" });
    await sections.getByRole("button", { name: "Test runner" }).click();
    await expect(page.getByRole("region", { name: "Test runner" })).toBeVisible();
    await sections.getByRole("button", { name: "Invoice flow" }).click();
    await expect(picker(page)).toBeVisible();
    await expect(page.getByRole("region", { name: "Test runner" })).toHaveCount(0);
  });
});

test.describe("entity tree", () => {
  test("selects one country, drives the collection, and provisions Germany to COMMISSIONED/OPERATIVE", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("group", { name: "Section" })
      .getByRole("button", { name: "Test runner" })
      .click();

    const tree = page.getByRole("region", { name: "Entity tree" });
    await expect(tree).toBeVisible();
    const seller = tree.locator("[data-persona-tree='seller']");
    await expect(seller).toBeVisible();
    // Both personas are in view — the round trip needs the buyer's account too.
    await expect(tree.locator("[data-persona-tree='buyer']")).toBeVisible();

    // One country at a time: picking Germany renders only Germany, per persona…
    await tree
      .getByRole("group", { name: "Country" })
      .getByRole("button", { name: "Germany" })
      .click();
    await expect(seller.locator("[data-country]")).toHaveCount(1);
    await expect(seller.locator("[data-country='DE']")).toBeVisible();

    // …and the same choice selects the German collection in the runner.
    const runner = page.getByRole("region", { name: "Test runner" });
    await expect(runner.locator("[data-collection='de']")).toHaveAttribute("aria-pressed", "true");

    await seller.getByRole("button", { name: "Provision Germany for seller" }).click();
    const dialog = page.getByRole("dialog", { name: /Provision Germany/ });
    await expect(dialog).toContainText("one-way state transition");
    await expect(dialog).toContainText("TEST resources are not billed");
    await dialog.getByRole("button", { name: "Provision Germany" }).click();

    await expect(dialog.getByRole("list", { name: "Provision steps" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(dialog.locator("[data-provision-ready='true']")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();

    const germany = seller.locator("[data-country='DE']");
    await expect(germany).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(germany.locator("[data-entity='taxpayer-DE']").first()).toHaveAttribute(
      "data-entity-state",
      "COMMISSIONED",
    );
    await expect(germany.locator("[data-entity='system-DE']").first()).toHaveAttribute(
      "data-entity-state",
      "COMMISSIONED / OPERATIVE",
    );

    // Folded, the panel still names the selected country and whether it is ready.
    await tree.getByRole("button", { name: "fiskaly entities" }).click();
    const summary = tree.locator("[data-tree-summary]");
    await expect(summary).toContainText("Germany");
    await expect(summary.locator("[data-summary-persona='seller']")).toHaveAttribute(
      "data-summary-ready",
      "true",
    );
    await expect(tree.locator("[data-persona-tree='seller']")).toHaveCount(0);
    await tree.getByRole("button", { name: "fiskaly entities" }).click();
    await expect(tree.locator("[data-persona-tree='seller']")).toBeVisible();
  });
});
