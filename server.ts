#!/usr/bin/env npx tsx
/**
 * Host server.
 *
 * Two origins on purpose:
 *  - SIM_PORT (default 8180): the page, `/api/config`, `/api/presets`, and
 *    `/api/chat` (agent mode — the only place the LLM key lives).
 *  - SANDBOX_PORT (default 8181): the MCP Apps sandbox proxy page, served with
 *    a CSP header derived from the App's `_meta.ui.csp`.
 *
 * Adapted from modelcontextprotocol/ext-apps `examples/basic-host/serve.ts`
 * (MIT, https://github.com/modelcontextprotocol/ext-apps): the two-origin
 * split, CSP header builder, and sandbox-only 404 handler.
 */
import express from "express";
import cors from "cors";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";
import { createChatHandler, llmSettings } from "./src/agent/chat-handler";
import { readSkillBody, repoRoot, skillFilePath } from "./src/agent/skill";
import { parsePresets, type Preset } from "./src/presets";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST = join(__dirname, "dist");
const ROOT = repoRoot();

const SIM_PORT = Number.parseInt(process.env.SIM_PORT ?? "8180", 10);
const SANDBOX_PORT = Number.parseInt(process.env.SANDBOX_PORT ?? "8181", 10);
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:3301/mcp";
const PRESETS_FILE = resolve(ROOT, process.env.PRESETS_FILE?.trim() || "presets.json");
const SKILL_FILE = skillFilePath(ROOT, process.env.SKILL_FILE);
const HOST = "127.0.0.1";

/** Read and validate the quick-action file. Errors are reported, not fatal. */
function loadPresets(): { presets: Preset[]; error?: string } {
  if (!existsSync(PRESETS_FILE)) {
    return { presets: [], error: `presets file not found: ${PRESETS_FILE}` };
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(PRESETS_FILE, "utf8"));
    return { presets: parsePresets(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[sim] ${PRESETS_FILE}: ${message}`);
    return { presets: [], error: `${PRESETS_FILE}: ${message}` };
  }
}

// ---------------------------------------------------------------- host app

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/config", (req, res) => {
  const hostname = req.hostname;
  const settings = llmSettings(process.env);
  res.json({
    mcpUrl: MCP_URL,
    sandboxUrl: `http://${hostname}:${SANDBOX_PORT}/sandbox.html`,
    // Agent mode: the page composes the system prompt from this skill body +
    // the MCP server instructions. Empty when the file is missing.
    agent: settings
      ? { enabled: true, model: settings.model }
      : { enabled: false },
    skill: readSkillBody(ROOT, process.env.SKILL_FILE),
    skillFile: SKILL_FILE,
  });
});

app.get("/api/presets", (_req, res) => {
  res.json(loadPresets());
});

// Agent mode: the browser loop talks to the LLM only through this route, so
// the key stays server-side. 503 when the endpoint is not configured.
app.post("/api/chat", createChatHandler());

app.use(express.static(DIST));

app.get("/", (_req, res) => {
  const index = join(DIST, "index.html");
  if (!existsSync(index)) {
    res.status(503).send("The host is not built. Run: npm run build");
    return;
  }
  res.sendFile(index);
});

// ---------------------------------------------------------------- sandbox app

function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ") || null;
  const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains).join(" ") || null;

  const directives = [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ];

  return directives.join("; ");
}

const sandboxApp = express();
sandboxApp.use(cors());

// The sandbox page's own JS/CSS bundle. Nothing else from dist is exposed here.
sandboxApp.use("/assets", express.static(join(DIST, "assets")));

sandboxApp.get(["/", "/sandbox.html"], (req, res) => {
  let cspConfig: McpUiResourceCsp | undefined;
  if (typeof req.query.csp === "string") {
    try {
      cspConfig = JSON.parse(req.query.csp) as McpUiResourceCsp;
    } catch (error) {
      console.warn("[sandbox] invalid csp query param:", error);
    }
  }

  res.setHeader("Content-Security-Policy", buildCspHeader(cspConfig));
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const file = join(DIST, "sandbox.html");
  if (!existsSync(file)) {
    res.status(503).send("The host is not built. Run: npm run build");
    return;
  }
  res.sendFile(file);
});

sandboxApp.use((_req, res) => {
  res.status(404).send("Only sandbox.html is served on this port");
});

// ---------------------------------------------------------------- start

if (!existsSync(join(DIST, "index.html"))) {
  console.warn(`[sim] ${DIST}/index.html is missing — run: npm run build`);
}

app.listen(SIM_PORT, HOST, () => {
  console.log(`Host:      http://${HOST}:${SIM_PORT}`);
  console.log(`MCP URL:   ${MCP_URL}`);
  console.log(`Presets:   ${PRESETS_FILE}`);
  console.log(`Skill:     ${existsSync(SKILL_FILE) ? SKILL_FILE : `${SKILL_FILE} (not found — agent prompt omits it)`}`);
});

sandboxApp.listen(SANDBOX_PORT, HOST, () => {
  console.log(`Sandbox:   http://${HOST}:${SANDBOX_PORT}/sandbox.html`);
});
