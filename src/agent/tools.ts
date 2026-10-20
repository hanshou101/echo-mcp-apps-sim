/**
 * MCP tools → OpenAI function definitions.
 *
 * `parameters` is the MCP `inputSchema` verbatim: the server already publishes
 * JSON Schema, and re-writing it by hand is how tool calls start failing.
 */
import type { OpenAiTool } from "./types";

export interface McpToolLike {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
}

export function toOpenAiTools(tools: McpToolLike[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? tool.title ?? tool.name,
      parameters:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? tool.inputSchema
          : { type: "object", properties: {} },
    },
  }));
}
