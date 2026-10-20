import { expect, test, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Agent mode end to end.
 *
 * 1. No LLM in the environment → the input is disabled and says what to set;
 *    direct mode is untouched. Always runs (uses the default webServer sim).
 * 2. A *scripted* OpenAI-compatible endpoint in front of the bundled example
 *    MCP server: proves the browser loop, the `/api/chat` proxy, the tool
 *    mapping, the MCP App mounting, the elicitation card, and that the
 *    configured skill file really reaches the system prompt.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SHOTS_DIR = join(ROOT, "docs");

test.beforeAll(() => {
  mkdirSync(SHOTS_DIR, { recursive: true });
});

// ---------------------------------------------------------------- helpers

function startFixture(port: number): ChildProcess {
  return spawn("npx", ["tsx", "test/fixtures/fixture-server.ts"], {
    cwd: ROOT,
    env: { ...process.env, FIXTURE_PORT: String(port) },
    stdio: "ignore",
  });
}

function startSim(options: {
  port: number;
  sandboxPort: number;
  mcpPort: number;
  llmBaseUrl: string;
  apiKey: string;
  model: string;
}): ChildProcess {
  return spawn("npx", ["tsx", "server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      MCP_URL: `http://127.0.0.1:${options.mcpPort}/mcp`,
      SIM_PORT: String(options.port),
      SANDBOX_PORT: String(options.sandboxPort),
      PRESETS_FILE: "test/fixtures/presets.fixture.json",
      SKILL_FILE: "skills/SKILL.example.md",
      LLM_BASE_URL: options.llmBaseUrl,
      LLM_API_KEY: options.apiKey,
      LLM_MODEL: options.model,
    },
    stdio: "ignore",
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function stopServer(process: ChildProcess | undefined): void {
  if (process && !process.killed) process.kill("SIGTERM");
}

/** Arguments the page sent, read back from the tool-call log entry. */
async function loggedArguments(entry: Locator): Promise<Record<string, unknown>> {
  const raw = await entry.locator("pre").textContent();
  const parsed = JSON.parse(raw ?? "{}") as { request?: { arguments?: Record<string, unknown> } };
  return parsed.request?.arguments ?? {};
}

/** Assistant bubbles only. The server's elicitation message is one of them too. */
function assistantBubbles(page: Page): Locator {
  return page.locator('[data-testid="utterance"][data-role="alexa"]');
}

/**
 * The turn is over only when the panel says so. Waiting for "some bubble is
 * non-empty" is not enough: the elicitation message is one, and it is there
 * long before the model's reply.
 */
async function waitForAgentIdle(page: Page): Promise<void> {
  await expect(page.locator("#agent-panel")).toHaveAttribute("data-busy", "false", {
    timeout: 120_000,
  });
}

// ---------------------------------------------------------------- 1. no LLM

test.describe("agent mode without an LLM endpoint", () => {
  test.skip(
    Boolean(process.env.LLM_API_KEY),
    "LLM_* is exported in this shell — the page is configured",
  );

  test("input is disabled and states what to set, direct mode still works", async ({ page }) => {
    await page.goto("/");

    const hint = "Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env to enable agent mode";
    await expect(page.getByTestId("agent-input")).toBeDisabled();
    await expect(page.getByTestId("agent-input")).toHaveAttribute("placeholder", hint);
    await expect(page.getByTestId("agent-hint")).toHaveText(hint);
    await expect(page.getByTestId("agent-send")).toBeDisabled();
    await page.screenshot({ path: join(SHOTS_DIR, "agent-00-disabled.png") });

    // The honest manual mode is untouched: the console still drives real tools.
    await page.locator("#console > summary").click();
    await page.getByLabel("Tool").selectOption("show_echo");
    await page.getByLabel("Arguments JSON").fill(JSON.stringify({ label: "still manual" }));
    await page.getByRole("button", { name: "Call tool" }).click();
    await expect(
      page.getByTestId("tool-call").filter({ hasText: "show_echo" }).first(),
    ).toHaveAttribute("data-status", "ok");
  });
});

// ---------------------------------------------------------------- 2. scripted model

test.describe("agent loop against the example server (scripted LLM)", () => {
  let fixture: ChildProcess | undefined;
  let sim: ChildProcess | undefined;
  let stub: Server | undefined;
  const requests: Array<Record<string, unknown>> = [];

  test.beforeAll(async () => {
    stub = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as {
          messages?: Array<{ role: string; content?: string }>;
        };
        requests.push(body as Record<string, unknown>);

        const messages = body.messages ?? [];
        // Only the tool results of THIS turn count: earlier turns stay in the
        // history the page resends.
        const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
        const thisTurn = messages.slice(lastUserIndex + 1);
        const sawToolResult = thisTurn.some((message) => message.role === "tool");
        const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
        const wantsChoice = (lastUser?.content ?? "").toLowerCase().includes("choice");

        const message = sawToolResult
          ? { role: "assistant", content: "Done — the tool answered on screen." }
          : {
              role: "assistant",
              content: null,
              tool_calls: [
                wantsChoice
                  ? {
                      id: "call_choice_1",
                      type: "function",
                      function: { name: "ask_choice", arguments: "{}" },
                    }
                  : {
                      id: "call_echo_1",
                      type: "function",
                      function: {
                        name: "show_echo",
                        arguments: JSON.stringify({ label: "Hello from the model" }),
                      },
                    },
              ],
            };

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ message }] }));
      });
    });
    await new Promise<void>((resolve) => stub!.listen(3299, "127.0.0.1", resolve));

    fixture = startFixture(3302);
    await waitFor("http://127.0.0.1:3302/health", 60_000);

    sim = startSim({
      port: 8280,
      sandboxPort: 8281,
      mcpPort: 3302,
      llmBaseUrl: "http://127.0.0.1:3299/v1",
      apiKey: "stub-key-not-a-secret",
      model: "stub-model",
    });
    await waitFor("http://127.0.0.1:8280/api/config", 60_000);
  });

  test.afterAll(async () => {
    stopServer(sim);
    stopServer(fixture);
    await new Promise<void>((resolve) => (stub ? stub.close(() => resolve()) : resolve()));
  });

  test("one sentence → tool call → App → elicitation → reply", async ({ page }) => {
    await page.goto("http://127.0.0.1:8280/");
    await expect(page.getByTestId("connection-badge")).toContainText("fixture-tower 0.1.0");
    await expect(page.getByTestId("agent-model")).toHaveText("stub-model");

    await page.getByTestId("agent-input").fill("Show a hello card");
    await page.getByTestId("agent-send").click();

    const echoCall = page.getByTestId("tool-call").filter({ hasText: "show_echo" }).first();
    await expect(echoCall).toHaveAttribute("data-source", "agent");
    // The turn is still in flight here.
    await expect(page.locator("#agent-panel")).toHaveAttribute("data-busy", "true");

    // The tool result carries a ui:// resource, so the App mounts on screen.
    const sandboxFrame = page.frameLocator("iframe.app-frame");
    const appFrame = sandboxFrame.frameLocator("iframe");
    await expect(appFrame.getByTestId("app-args")).toContainText("Hello from the model");
    await waitForAgentIdle(page);

    const args = await loggedArguments(echoCall);
    expect(args.label).toBe("Hello from the model");

    await expect(
      page.getByTestId("utterance").filter({ hasText: "the tool answered on screen" }),
    ).toBeVisible();
    await page.screenshot({ path: join(SHOTS_DIR, "agent-01-tool-call.png") });

    // What the proxy actually forwarded: the configured skill file in the
    // system prompt, the configured model, and the MCP tools as functions.
    const last = requests.at(-1) ?? {};
    const messages =
      (last as { messages?: Array<{ role: string; content?: string }> }).messages ?? [];
    const system = messages.find((message) => message.role === "system");
    expect(system?.content).toContain("# Example skill");
    expect(system?.content).toContain("tools/list");
    const tools = (last as { tools?: Array<{ function: { name: string } }> }).tools ?? [];
    expect(tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(["show_echo", "bump_counter", "ask_choice", "ask_enum"]),
    );

    // --- elicitation inside a tool call is answered by the person, not the model
    await page.getByTestId("agent-input").fill("Ask me a choice");
    await page.getByTestId("agent-send").click();

    const choiceCall = page.getByTestId("tool-call").filter({ hasText: "ask_choice" }).first();
    await expect(choiceCall).toHaveAttribute("data-source", "agent");

    const card = page.getByTestId("elicitation-card");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("elicitation-message")).toContainText(
      "The next step depends on your choice",
    );
    await page.screenshot({ path: join(SHOTS_DIR, "agent-02-elicitation.png") });

    await page.getByTestId("elicitation-option").first().click();
    await expect(card).toBeHidden();
    await expect(choiceCall).toHaveAttribute("data-status", "ok");
    await expect(choiceCall).toContainText("Choice: option-a");
    await waitForAgentIdle(page);

    await expect(assistantBubbles(page).last()).toContainText("the tool answered on screen");
  });
});
