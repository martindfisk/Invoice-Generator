import { chromium } from "@playwright/test";

const out =
  "/private/tmp/claude-502/-Users-martin-dutzler-Documents-GitHub-Invoice-Generator/3ab6d7c3-bc93-4ba6-ba90-841f47e39877/scratchpad";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

await page.goto("http://localhost:5173/");
await page.getByRole("region", { name: "Preset picker" }).waitFor();
await page.screenshot({ path: `${out}/1-setup.png` });

await page.locator("[data-preset='it-b2b-sdi']").click();
await page.getByRole("region", { name: "Invoice viewer" }).waitFor();
await page.screenshot({ path: `${out}/2-mapper.png` });

const stepper = page
  .getByRole("region", { name: "Workflow" })
  .getByRole("list");
await stepper.getByRole("button", { name: /Validate$/ }).click();
await page.getByRole("region", { name: "Validation stages" }).waitFor();
// let the debounced pipeline settle
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/3-validate.png` });

await page
  .getByRole("button", { name: /Continue to Send|Send anyway/ })
  .click();
await page.getByRole("region", { name: "Send" }).waitFor();
await page.getByRole("button", { name: "Send to fiskaly" }).click();
await page.locator("[data-outcome='transmitted']").waitFor({ timeout: 90_000 });
await page
  .getByRole("region", { name: "Compliance artifact diff" })
  .waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/4-send-diff.png` });

console.log(
  "outcome:",
  await page.locator("[data-outcome]").getAttribute("data-outcome"),
);
console.log(
  "status line:",
  (
    await page
      .getByRole("region", { name: "Send" })
      .getByRole("status")
      .allTextContents()
  )
    .join(" | ")
    .slice(0, 300),
);
await browser.close();
