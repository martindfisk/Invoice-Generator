import { defineConfig, devices } from "@playwright/test";

// Overridable so the suite can run beside a dev or docker stack already holding the defaults.
const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8000);
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 5173);

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
        // Never the real persisted store: a spec that saves settings or provisions would
        // otherwise write mock ids into backend/.uapi-settings.json and poison a later LIVE run.
        UAPI_SETTINGS_FILE: `/tmp/uapi-settings-e2e-${backendPort}.json`,
        UAPI_SYSTEM_ID_IT: "e2e-system-it",
        UAPI_TAXPAYER_ID_IT: "e2e-taxpayer-it",
        UAPI_SYSTEM_ID_BE: "e2e-system-be",
        UAPI_TAXPAYER_ID_BE: "e2e-taxpayer-be",
        UAPI_SYSTEM_ID_DE: "e2e-system-de",
        UAPI_TAXPAYER_ID_DE: "e2e-taxpayer-de",
      },
    },
    {
      command: `npm run dev -- --port ${frontendPort} --strictPort`,
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { BACKEND_URL: `http://localhost:${backendPort}` },
    },
  ],
});
