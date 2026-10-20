import { defineConfig } from "@playwright/test";

// E2E is always headless. Playwright starts the fixture MCP server and the
// host server itself, so `npm run test:e2e` needs nothing else running.
// Ports are the repository defaults (fixture 3301, host 8180, sandbox 8181).
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8180",
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx tsx test/fixtures/fixture-server.ts",
      url: "http://127.0.0.1:3301/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { FIXTURE_PORT: "3301" },
    },
    {
      command: "npx tsx server.ts",
      url: "http://127.0.0.1:8180/api/config",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        MCP_URL: "http://127.0.0.1:3301/mcp",
        SIM_PORT: "8180",
        SANDBOX_PORT: "8181",
        // A fixture preset file so the test exercises the file format,
        // including a chip whose tool the fixture does not expose.
        PRESETS_FILE: "test/fixtures/presets.fixture.json",
      },
    },
  ],
});
