import { defineConfig, devices } from "@playwright/test";

const backendPort = 8000;
const frontendPort = 5173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `.venv/bin/uvicorn app.main:app --port ${backendPort}`,
      cwd: "../backend",
      url: `http://localhost:${backendPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // System ids so the e2e exercises the typed backend choreography (POST /api/invoices and
      // /correction) — the mock accepts any id. Without them every send silently took the
      // /api/uapi passthrough fallback and the backend endpoints had zero e2e coverage.
      env: {
        UAPI_MODE: "mock",
        SELLER_SYSTEM_ID_IT: "e2e-system-it",
        SELLER_TAXPAYER_ID_IT: "e2e-taxpayer-it",
        SELLER_SYSTEM_ID_BE: "e2e-system-be",
        SELLER_TAXPAYER_ID_BE: "e2e-taxpayer-be",
        SELLER_SYSTEM_ID_DE: "e2e-system-de",
        SELLER_TAXPAYER_ID_DE: "e2e-taxpayer-de",
      },
    },
    {
      command: "npm run dev",
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
