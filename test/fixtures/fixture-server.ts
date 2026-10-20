#!/usr/bin/env npx tsx
/**
 * TEST-ONLY MCP server for the simulator E2E tests.
 *
 * Product code must not import this file. It exists to prove that the
 * simulator is a real MCP client and MCP Apps host:
 *  - stateful Streamable HTTP (one McpServer per session, `Mcp-Session-Id`
 *    exposed through CORS so the browser can read it),
 *  - `show_echo`: a UI tool whose App shows the arguments it received and has
 *    a button that calls `bump_counter` through the host,
 *  - `ask_choice`: an elicitation during the tool call using the 2025-11-25
 *    titled-enum (`oneOf`) schema; the chosen value is written into the result,
 *  - `ask_enum`: the same with the legacy `enum` + `enumNames` schema.
 */
import cors from "cors";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/server";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_HTML = join(__dirname, "dist", "index.html");
const UI_URI = "ui://fixture/app.html";
const PORT = Number.parseInt(process.env.FIXTURE_PORT ?? "3301", 10);
const HOST = "127.0.0.1";

let counter = 0;

interface Session {
  server: McpServer;
  transport: NodeStreamableHTTPServerTransport;
}

const sessions = new Map<string, Session>();

const CHOICE_SCHEMA: ElicitRequestFormParams["requestedSchema"] = {
  type: "object",
  properties: {
    choice: {
      type: "string",
      title: "Next step",
      oneOf: [
        { const: "option-a", title: "Continue with option A." },
        { const: "option-b", title: "Continue with option B." },
      ],
      default: "option-a",
    },
  },
  required: ["choice"],
};

const LEGACY_ENUM_SCHEMA: ElicitRequestFormParams["requestedSchema"] = {
  type: "object",
  properties: {
    choice: {
      type: "string",
      title: "Next step (legacy enum)",
      enum: ["option-a", "option-b"],
      enumNames: ["Continue with option A (legacy)", "Continue with option B (legacy)"],
      default: "option-a",
    },
  },
  required: ["choice"],
};

function readAppHtml(): string {
  if (!existsSync(APP_HTML)) {
    throw new Error(`Fixture App is not built: ${APP_HTML}. Run: npm --prefix sim run build`);
  }
  return readFileSync(APP_HTML, "utf8");
}

function createServer(): McpServer {
  const server = new McpServer({ name: "fixture-tower", version: "0.1.0" });

  registerAppTool(
    server,
    "show_echo",
    {
      title: "Show the fixture App",
      description:
        "Render the fixture App; it displays the arguments it received and can call bump_counter.",
      inputSchema: z.object({ label: z.string().describe("Text the App should display") }),
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ label }) => ({
      content: [{ type: "text", text: `Showing "${label}" in the fixture App.` }],
      structuredContent: { label, tool: "show_echo", nested: { received: true } },
    }),
  );

  server.registerTool(
    "bump_counter",
    {
      title: "Bump the counter",
      description: "Increment a process-wide counter and return the new value.",
      inputSchema: z.object({}),
    },
    async () => {
      counter += 1;
      return {
        content: [{ type: "text", text: `Counter is ${counter}.` }],
        structuredContent: { count: counter },
      };
    },
  );

  server.registerTool(
    "ask_choice",
    {
      title: "Ask for a choice",
      description: "Ask the user to choose through elicitation (titled enum).",
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const elicitation = await ctx.mcpReq.elicitInput({
        message: "The next step depends on your choice. How should I continue?",
        requestedSchema: CHOICE_SCHEMA,
      });
      const choice =
        elicitation.action === "accept"
          ? String((elicitation.content as Record<string, unknown> | undefined)?.choice ?? "")
          : elicitation.action;
      return {
        content: [{ type: "text", text: `Choice: ${choice}` }],
        structuredContent: { action: elicitation.action, choice },
      };
    },
  );

  server.registerTool(
    "ask_enum",
    {
      title: "Ask for a choice (legacy enum)",
      description: "Ask through elicitation using the legacy enum + enumNames schema.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const elicitation = await ctx.mcpReq.elicitInput({
        message: "How should I continue? (legacy enum card)",
        requestedSchema: LEGACY_ENUM_SCHEMA,
      });
      const choice =
        elicitation.action === "accept"
          ? String((elicitation.content as Record<string, unknown> | undefined)?.choice ?? "")
          : elicitation.action;
      return {
        content: [{ type: "text", text: `Choice: ${choice}` }],
        structuredContent: { action: elicitation.action, choice },
      };
    },
  );

  registerAppResource(
    server,
    "Fixture App",
    UI_URI,
    { description: "Test-only MCP App for the host page." },
    async () => ({
      contents: [
        {
          uri: UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readAppHtml(),
        },
      ],
    }),
  );

  return server;
}

const app = createMcpExpressApp({ host: HOST });

// The simulator page runs on another origin, so CORS must both allow the MCP
// headers and expose the session id header to browser JavaScript.
app.use(
  cors({
    origin: true,
    allowedHeaders: [
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
      "last-event-id",
      "authorization",
    ],
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "fixture-tower", sessions: sessions.size });
});

// Test controls for the demo-clock workflow. Off by default so the main E2E
// run sees a server WITHOUT /demo/clock (the control must stay hidden).
let demoClockEnabled = process.env.FIXTURE_DEMO_CLOCK === "1";
let demoClockTime = "13:00";

app.post("/__demo-clock/enable", (_req, res) => {
  demoClockEnabled = true;
  res.json({ ok: true, time: demoClockTime });
});

app.get("/demo/clock", (_req, res) => {
  if (!demoClockEnabled) {
    res.status(404).json({ error: "demo clock disabled" });
    return;
  }
  res.json({ time: demoClockTime });
});

app.post("/demo/clock", (req, res) => {
  if (!demoClockEnabled) {
    res.status(404).json({ error: "demo clock disabled" });
    return;
  }
  const time = typeof req.body?.time === "string" ? req.body.time : "";
  if (!/^\d{2}:\d{2}$/.test(time)) {
    res.status(400).json({ error: "time must be HH:MM" });
    return;
  }
  demoClockTime = time;
  res.json({ ok: true, time: demoClockTime });
});

app.all("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  if (existing) {
    await existing.transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method !== "POST") {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: no valid session id" },
      id: null,
    });
    return;
  }

  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport });
      console.log(`[fixture] session ${id} initialized`);
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
      void server.close().catch(() => undefined);
      console.log(`[fixture] session ${id} closed`);
    },
  });
  transport.onerror = (error) => console.error("[fixture] transport error:", error);

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`Fixture MCP server: http://${HOST}:${PORT}/mcp`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[fixture] ${signal}, closing ${sessions.size} session(s)`);
  for (const [id, session] of sessions) {
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
    sessions.delete(id);
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
