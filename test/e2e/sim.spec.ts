import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Screenshots land in docs/ (test/e2e → repo root/docs).
const SHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../docs");

test.beforeAll(() => {
  mkdirSync(SHOTS_DIR, { recursive: true });
});

test("the host is a real MCP client and MCP Apps host", async ({ page }) => {
  await page.goto("/");

  // --- connection badge: server name/version, negotiated protocol, session id
  const badge = page.getByTestId("connection-badge");
  await expect(badge).toContainText("fixture-tower 0.1.0");
  await expect(badge).toContainText("MCP 2025-11-25");
  await expect(badge).toContainText("Streamable HTTP");
  await expect(badge).toContainText(/session [0-9a-f]{8}\b/);

  // --- tool list from tools/list
  await expect(page.getByTestId("tool-item")).toHaveCount(4);
  for (const name of ["show_echo", "bump_counter", "ask_choice", "ask_enum"]) {
    await expect(page.getByTestId("tool-item").filter({ hasText: name })).toBeVisible();
  }

  // --- direct-mode chips come from presets.json: 3 tools the fixture has,
  // one it does not, which must be greyed out with the reason in its title.
  await expect(page.getByTestId("preset")).toHaveCount(4);
  await expect(page.getByTestId("preset").filter({ hasText: "Show echo" })).toBeEnabled();
  await expect(page.getByTestId("preset").filter({ hasText: "Bump counter" })).toBeEnabled();
  await expect(page.getByTestId("preset").filter({ hasText: "Ask a choice" })).toBeEnabled();
  const missing = page.getByTestId("preset").filter({ hasText: "Fetch weather" });
  await expect(missing).toBeDisabled();
  await expect(missing).toHaveAttribute("title", "Server has no get_weather tool");

  // --- this server has no /demo/clock, so the clock control must stay hidden
  await expect(page.locator("#clock-control")).toBeHidden();

  await expect(page.locator(".footer")).toHaveText(
    "Simulated Alexa+ experience · unofficial demo",
  );

  await page.screenshot({ path: join(SHOTS_DIR, "01-connected.png") });

  // --- generic tool console → tools/call → log entry with duration
  await page.locator("#console > summary").click();
  await page.getByLabel("Tool").selectOption("show_echo");
  await page.getByLabel("Arguments JSON").fill(JSON.stringify({ label: "Hello from the console" }));
  await page.getByRole("button", { name: "Call tool" }).click();

  const echoCall = page.getByTestId("tool-call").filter({ hasText: "show_echo" });
  await expect(echoCall).toHaveAttribute("data-status", "ok");
  await expect(echoCall).toContainText(/\d+ ms/);

  // --- the UI tool's result mounted the App in the double-iframe sandbox
  const sandboxFrame = page.frameLocator("iframe.app-frame");
  const appFrame = sandboxFrame.frameLocator("iframe");
  await expect(appFrame.getByTestId("app-args")).toContainText("Hello from the console");
  await expect(appFrame.getByTestId("app-result")).toContainText("show_echo");

  await page.screenshot({ path: join(SHOTS_DIR, "02-app-rendered.png") });

  // --- a tool call started inside the App comes back through the host and is logged
  await appFrame.getByTestId("app-ping").click();
  const appCall = page.getByTestId("tool-call").filter({ hasText: "bump_counter" });
  await expect(appCall).toHaveAttribute("data-status", "ok");
  await expect(appCall).toContainText("app");
  await expect(appCall).toContainText(/\d+ ms/);

  // --- elicitation (titled enum, oneOf) → choice card → accept carries the value
  await page.getByLabel("Tool").selectOption("ask_choice");
  await page.getByLabel("Arguments JSON").fill("{}");
  await page.getByRole("button", { name: "Call tool" }).click();

  const card = page.getByTestId("elicitation-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("elicitation-message")).toContainText(
    "The next step depends on your choice",
  );
  await expect(page.getByTestId("elicitation-option")).toHaveCount(2);
  await expect(page.getByTestId("elicitation-option").first()).toContainText("Continue with option A");

  await page.screenshot({ path: join(SHOTS_DIR, "03-elicitation.png") });

  await page.getByTestId("elicitation-option").first().click();
  await expect(card).toBeHidden();

  const choiceCall = page.getByTestId("tool-call").filter({ hasText: "ask_choice" });
  await expect(choiceCall).toHaveAttribute("data-status", "ok");
  await expect(choiceCall).toContainText("Choice: option-a");
  await expect(choiceCall).toContainText(/\d+ ms/);

  await page.screenshot({ path: join(SHOTS_DIR, "04-elicitation-answered.png") });

  // --- the legacy enum + enumNames card renders too
  await page.getByLabel("Tool").selectOption("ask_enum");
  await page.getByLabel("Arguments JSON").fill("{}");
  await page.getByRole("button", { name: "Call tool" }).click();
  await expect(card).toBeVisible();
  await expect(page.getByTestId("elicitation-option")).toHaveCount(2);
  await expect(page.getByTestId("elicitation-option").first()).toContainText(
    "Continue with option A (legacy)",
  );
  await page.screenshot({ path: join(SHOTS_DIR, "05-elicitation-legacy-enum.png") });
  await page.getByTestId("elicitation-option").nth(1).click();
  await expect(card).toBeHidden();
  const legacyCall = page.getByTestId("tool-call").filter({ hasText: "ask_enum" });
  await expect(legacyCall).toHaveAttribute("data-status", "ok");
  await expect(legacyCall).toContainText("Choice: option-b");
});

test("demo clock control shows up only when the server exposes /demo/clock", async ({
  page,
  request,
}) => {
  // The fixture server starts without a demo clock; enable it for this test.
  const enabled = await request.post("http://127.0.0.1:3301/__demo-clock/enable");
  expect(enabled.ok()).toBe(true);

  await page.goto("/");
  await expect(page.getByTestId("connection-badge")).toContainText("fixture-tower 0.1.0");

  const clock = page.locator("#clock-control");
  await expect(clock).toBeVisible();
  await expect(page.locator("#idle-time")).toHaveText("1:00 PM");

  await page.locator("#clock-input").fill("18:20");
  await page.getByRole("button", { name: "Set" }).click();
  await expect(page.locator("#idle-time")).toHaveText("6:20 PM");

  const clockResponse = await request.get("http://127.0.0.1:3301/demo/clock");
  expect(await clockResponse.json()).toEqual({ time: "18:20" });

  await page.screenshot({ path: join(SHOTS_DIR, "06-demo-clock.png") });
});
