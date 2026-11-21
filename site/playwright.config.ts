import { defineConfig } from "@playwright/test";

const PORT = 4329;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the Chrome already on the machine or CI runner, so no browser download is needed.
    channel: "chrome",
    headless: true,
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: `pnpm exec astro preview --port ${PORT}`,
    url: `http://localhost:${PORT}/plumbline/`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
