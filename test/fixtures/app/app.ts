/**
 * Test-only MCP App served by the fixture server.
 * It proves the host plumbing end to end: it shows the tool arguments the host
 * sent, the tool result, and a button whose `callServerTool` must come back
 * through the host (and be logged there).
 */
import { App } from "@modelcontextprotocol/ext-apps";

const argsEl = document.getElementById("args")!;
const resultEl = document.getElementById("result")!;
const pingButton = document.getElementById("ping") as HTMLButtonElement;
const pingResult = document.getElementById("ping-result")!;

const app = new App({ name: "fixture-app", version: "1.0.0" });

app.ontoolinput = (params) => {
  argsEl.textContent = JSON.stringify(params.arguments ?? {}, null, 2);
  document.body.dataset.gotInput = "true";
};

app.ontoolresult = (result) => {
  resultEl.textContent = JSON.stringify(result.structuredContent ?? {}, null, 2);
  document.body.dataset.gotResult = "true";
};

pingButton.addEventListener("click", async () => {
  pingButton.disabled = true;
  pingResult.textContent = "calling…";
  try {
    const result = await app.callServerTool({ name: "bump_counter", arguments: {} });
    const structured = result.structuredContent as { count?: number } | undefined;
    pingResult.textContent = `Counter: ${structured?.count ?? "?"}`;
  } catch (error) {
    pingResult.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    pingButton.disabled = false;
  }
});

void app.connect().then(() => {
  document.body.dataset.connected = "true";
});
