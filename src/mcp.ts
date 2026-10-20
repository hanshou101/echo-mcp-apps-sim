/**
 * The host page's MCP client.
 *
 * A real `@modelcontextprotocol/client` over Streamable HTTP — not a mock. It
 * declares `elicitation: { form: {} }` and the MCP Apps UI extension, and
 * forwards App-initiated `tools/call` requests to the server through the same
 * connection (the AppBridge owns that path; we only observe it for the log).
 */
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ToolLogger } from "./types";

const IMPLEMENTATION = { name: "echo-mcp-apps-sim", version: "1.0.0" };
const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";

export interface ElicitRequestLike {
  message?: unknown;
  requestedSchema?: unknown;
}

export type ElicitResultLike =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "decline" }
  | { action: "cancel" };

export interface McpConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  sessionId: string;
  tools: Tool[];
  instructions?: string;
}

export interface ConnectOptions {
  mcpUrl: string;
  logger?: ToolLogger;
  onElicitation: (params: ElicitRequestLike) => Promise<ElicitResultLike>;
}

export async function connectMcp(options: ConnectOptions): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(options.mcpUrl));
  const client = new Client(IMPLEMENTATION, {
    capabilities: {
      elicitation: { form: {} },
      extensions: {
        [UI_EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
      },
    },
  });

  client.setRequestHandler("elicitation/create", async (request) => {
    const params = (request as unknown as { params: ElicitRequestLike }).params;
    return (await options.onElicitation(params)) as never;
  });

  instrumentAppToolCalls(client, options.logger);

  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  const tools = (await client.listTools()).tools;

  return {
    client,
    transport,
    serverName: serverVersion?.name ?? "unknown",
    serverVersion: serverVersion?.version ?? "0.0.0",
    protocolVersion: client.getNegotiatedProtocolVersion() ?? "unknown",
    sessionId: transport.sessionId ?? "",
    tools,
    instructions: client.getInstructions(),
  };
}

/**
 * The AppBridge forwards `tools/call` from the App by calling
 * `client.request({ method: "tools/call", ... })` directly, so `callTool()`
 * wrappers never see those calls. Wrap the one method to put them in the log.
 *
 * Host-originated calls (`main.ts`) mark themselves with a depth counter so
 * they are not logged twice.
 */
let hostCallDepth = 0;

export async function withHostCall<T>(fn: () => Promise<T>): Promise<T> {
  hostCallDepth += 1;
  try {
    return await fn();
  } finally {
    hostCallDepth -= 1;
  }
}

function instrumentAppToolCalls(client: Client, logger?: ToolLogger): void {
  if (!logger) return;
  const target = client as unknown as {
    request: (request: { method: string; params?: Record<string, unknown> }, ...rest: unknown[]) => Promise<unknown>;
  };
  const original = target.request.bind(client);

  target.request = async (request, ...rest) => {
    const isToolCall = request?.method === "tools/call" && hostCallDepth === 0;
    if (!isToolCall) return original(request, ...rest);

    const params = (request.params ?? {}) as { name?: string; arguments?: unknown };
    const name = typeof params.name === "string" ? params.name : "tools/call";
    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};
    const record = logger.begin(name, args, "app");
    const startedAt = performance.now();
    try {
      const result = await original(request, ...rest);
      logger.finish(record, result, performance.now() - startedAt);
      return result;
    } catch (error) {
      logger.fail(record, error, performance.now() - startedAt);
      throw error;
    }
  };
}

export type { CallToolResult, Tool };
