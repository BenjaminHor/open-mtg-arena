// Playwright runs against the production build (`vite build` then `vite preview`): the service worker and the bundled
// match worker only mean something there. VITE_TEST_HOOKS=1 keeps the `window.__board` hook in that build (ui.md).

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Its own output folder, so the test hooks never end up in `dist`, what `pnpm preview` serves and a deploy ships.
    command: `vite build --outDir dist-e2e && vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_TEST_HOOKS: "1" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
