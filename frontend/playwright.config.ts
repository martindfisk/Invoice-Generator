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
      env: { UAPI_MODE: "mock" },
    },
    {
      command: "npm run dev",
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
