// Playwright runs against the production build (`vite build` then `vite preview`): the service worker and the bundled
// match worker only mean something there. VITE_TEST_HOOKS=1 keeps the `window.__board` hook in that build (ui.md).

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vite build && vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_TEST_HOOKS: "1" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
