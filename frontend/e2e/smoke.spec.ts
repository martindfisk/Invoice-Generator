import { expect, test, type Page } from "@playwright/test";

function picker(page: Page) {
  return page.getByRole("region", { name: "Preset picker" });
}

type Mode = "Fields" | "fiskaly JSON" | "Predicted XML" | "Split";

async function viewMode(page: Page, mode: Mode) {
  await page
    .getByRole("tablist", { name: "Invoice view mode" })
    .getByRole("tab", { name: mode, exact: true })
    .click();
}

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
    // Setup, Compose and Validate make no fiskaly calls, so the pane would only take space.
    await expect(page.getByRole("region", { name: "API log" })).toHaveCount(0);
  });

  test("reaches the backend and reports MOCK mode", async ({ page }) => {
    await expect(page.getByTitle("Backend mode from GET /api/config")).toHaveText("MOCK");
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("switches persona", async ({ page }) => {
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
    await expect(matrix.getByRole("rowheader")).toHaveText([
      /^Germany/,
      /^Italy/,
      /^Belgium/,
      /^France/,
    ]);

    const empty = matrix.locator("[data-cell]", { hasText: "No preset" }).first();
    await expect(empty).toBeVisible();
    await expect(empty.getByRole("button")).toHaveCount(0);
    await expect(picker(page).getByText("broken on purpose").first()).toBeVisible();
  });

  test("loads the preset picked out of the Italian B2G cell into Compose", async ({ page }) => {
    const card = picker(page).locator("[data-cell='IT:B2G']").getByRole("button").first();
    const label = (await card.locator("span").first().innerText()).trim();
    const format = (await card.getAttribute("title"))?.split("\n")[2] ?? "";
    // Every card is a button in its cell, so the matrix is operable without a pointer.
    await card.press("Enter");

    await expect(page.getByRole("region", { name: "Invoice viewer" })).toBeVisible();
    await expect(page.getByRole("heading", { name: label })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "fiskaly JSON view" })).toBeVisible();
    expect(format).not.toEqual("");
    await expect(page.getByText(format, { exact: true })).toBeVisible();
  });
});

test.describe("compose", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("keeps the later steps locked until a preset is chosen", async ({ page }) => {
    const stepper = page.getByRole("region", { name: "Workflow" }).getByRole("list");
    const compose = stepper.getByRole("button", { name: /Compose$/ });
    await expect(compose).toBeDisabled();
    await expect(compose).toHaveAttribute("title", /preset/i);

    await chooseItalianPreset(page);
    await expect(stepper.getByRole("button", { name: /Compose$/ })).toBeEnabled();
    await expect(stepper.getByRole("button", { name: /Receive$/ })).toBeEnabled();
  });

  test("opens on the fiskaly JSON and toggles Fields, Predicted XML and Split", async ({
    page,
  }) => {
    await chooseItalianPreset(page);
    await expect(page.getByRole("tabpanel", { name: "fiskaly JSON view" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Fields view" })).toHaveCount(0);
    await expect(page.getByRole("tabpanel", { name: "Predicted XML view" })).toHaveCount(0);
    await expect(page.getByText(/The Unified API accepts this JSON, not XML/)).toBeVisible();

    await viewMode(page, "Predicted XML");
    await expect(page.getByRole("tabpanel", { name: "fiskaly JSON view" })).toHaveCount(0);
    await expect(page.getByRole("tabpanel", { name: "Predicted XML view" })).toBeVisible();
    await expect(page.getByText(/what this browser expects fiskaly to generate/)).toBeVisible();

    await viewMode(page, "Fields");
    await expect(page.getByRole("tabpanel", { name: "Predicted XML view" })).toHaveCount(0);
    await expect(page.getByRole("tabpanel", { name: "Fields view" })).toBeVisible();
    await expect(
      page.getByText("Visualisation for review — the XML is the legally valid invoice."),
    ).toBeVisible();

    await viewMode(page, "Split");
    await expect(page.getByRole("tabpanel", { name: "Fields view" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "fiskaly JSON view" })).toBeVisible();
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
    await expect(page.locator(".cm-content")).toContainText("ActualDeliveryDate");
    await expect(page.locator(".cm-content")).toContainText("2026-09-01");
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

  test("says what the later steps will do without faking a result", async ({ page }) => {
    await chooseItalianPreset(page);
    const stepper = page.getByRole("region", { name: "Workflow" }).getByRole("list");

    await stepper.getByRole("button", { name: /Send$/ }).click();
    await expect(page.getByText("POST /api/invoices")).toBeVisible();
    await stepper.getByRole("button", { name: /Receive$/ }).click();
    await expect(page.getByText("GET /api/inbox")).toBeVisible();
  });
});

async function splitView(page: Page) {
  await viewMode(page, "Split");
  await expect(page.getByRole("tabpanel", { name: "fiskaly JSON view" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Fields view" })).toBeVisible();
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
    getBoundingClientRect(): { left: number; top: number; height: number };
  };
};

const SHOW_TEXT = 4;

async function tokenEdge(page: Page, token: string, edge: "start" | "end") {
  const point = await page.evaluate(
    ({ needle, side, show }) => {
      const content = document.querySelector(".cm-content");
      if (!content) return null;
      const walker = document.createTreeWalker(content, show);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = (node.textContent ?? "").indexOf(needle);
        if (index === -1) continue;
        const offset = side === "start" ? index : index + needle.length;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset);
        const rect = range.getBoundingClientRect();
        return { x: rect.left, y: rect.top + rect.height / 2 };
      }
      return null;
    },
    { needle: token, side: edge, show: SHOW_TEXT },
  );
  if (!point) throw new Error(`e2e: "${token}" is not rendered in the XML pane`);
  return point;
}

async function replaceInXml(page: Page, token: string, replacement: string) {
  const start = await tokenEdge(page, token, "start");
  const end = await tokenEdge(page, token, "end");
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
    await expect(page.locator(".cm-content")).toContainText("E2E-1234");
    expect(before).not.toContain("E2E-1234");

    await replaceInXml(page, "E2E-1234", "E2E-9999");
    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-9999");
    await expect(page.locator(".cm-content")).toContainText("E2E-9999");
  });

  test("an unparseable JSON edit reports the parser and keeps the last good invoice", async ({
    page,
  }) => {
    const field = page.locator("[data-field='number']").first();
    await field.click();
    const input = page.getByRole("textbox", { name: "Invoice number" });
    await input.fill("E2E-KEEP");
    await input.press("Enter");
    await expect(page.locator(".cm-content")).toContainText("E2E-KEEP");

    await replaceInXml(page, '"E2E-KEEP"', '"E2E-KEEP');
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-KEEP");

    await replaceInXml(page, '"E2E-KEEP', '"E2E-BACK"');
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
    await expect(page.locator(".cm-content")).toContainText("E2E-XML");
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

test.describe("the JSON is the artifact", () => {
  test("authors the operation, and the fields and predicted XML follow it to Send", async ({
    page,
  }) => {
    await page.goto("/");
    await chooseItalianPreset(page);

    // The Unified API takes JSON, so that is what the tool opens on.
    await expect(page.getByRole("tabpanel", { name: "fiskaly JSON view" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Predicted XML view" })).toHaveCount(0);

    await splitView(page);
    const composed = await page.locator(".cm-content").innerText();
    const before = /"number":\s*"([^"]+)"/.exec(composed)?.[1];
    if (!before) throw new Error("e2e: the JSON pane shows no document number");
    await replaceInXml(page, before, "E2E-JSON-FIRST");

    await expect(page.locator("[data-field='number']").first()).toContainText("E2E-JSON-FIRST");
    await viewMode(page, "Predicted XML");
    await expect(page.locator(".cm-content")).toContainText("E2E-JSON-FIRST");

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
  test("drags the compose splitter and remembers the size", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await chooseItalianPreset(page);
    await page.getByRole("tab", { name: "Split" }).click();

    const fields = page.getByRole("tabpanel", { name: "Fields view" });
    const separator = page.getByRole("separator", { name: /Resize the fields and JSON/i }).first();
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
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await chooseItalianPreset(page);
    await page.getByRole("button", { name: /Send/i }).first().click();

    const log = page.getByRole("region", { name: "API log" });
    await expect(log).toBeVisible();
    // Whatever the recorder already held is not this send, so it must not be shown as if it were.
    await expect(log.locator("[data-group]")).toHaveCount(0);

    await page
      .getByRole("button", { name: /Send to fiskaly|Send anyway/i })
      .last()
      .click();
    await expect.poll(async () => log.locator("[data-group]").count()).toBeGreaterThan(0);

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
