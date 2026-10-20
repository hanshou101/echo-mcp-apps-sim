/**
 * The browser-side agent loop.
 *
 * Turn shape: user text → /api/chat → (tool calls)* → assistant text.
 * Tool calls come back as OpenAI `tool_calls`; each one is executed against
 * the real MCP connection, and its result goes back as a `tool` message with
 * the compacted payload. At most MAX_TOOL_ROUNDS tool rounds per turn.
 *
 * Elicitation is NOT answered here: the MCP client's elicitation handler shows
 * the card and waits for the person to click. The loop just waits for the
 * tool call to settle.
 */
import { compactToolResult, type ToolResultLike } from "./compact";
import type {
  ChatCompletionResponse,
  ChatMessage,
  ChatToolCall,
  OpenAiTool,
} from "./types";

export const MAX_TOOL_ROUNDS = 6;

export interface AgentLoopDeps {
  /** `POST /api/chat` — one chat-completions round trip. */
  chat(messages: ChatMessage[], tools: OpenAiTool[]): Promise<ChatCompletionResponse>;
  /** `tools/call` against the real MCP session. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResultLike>;
  /** Called once per tool call, before it runs (the UI logs it). */
  onToolCall?(call: ChatToolCall): void;
  /** Tool-round ceiling; defaults to MAX_TOOL_ROUNDS (6). */
  maxToolRounds?: number;
}

export interface AgentTurnResult {
  /** Full message list, ready to be reused as history for the next turn. */
  history: ChatMessage[];
  /** Assistant text of the last round ("" if the model only emitted tools). */
  reply: string;
  /** How many tool calls actually ran. */
  toolCalls: number;
  /** How many tool rounds ran (0 when the model answered directly). */
  rounds: number;
  /** Set when the round limit was hit and the final answer still asked for tools. */
  truncated: boolean;
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through: the model sent something that is not JSON
  }
  return {};
}

function assistantMessage(response: ChatCompletionResponse): ChatMessage {
  const message = response.choices?.[0]?.message;
  if (message && typeof message === "object") {
    return {
      role: "assistant",
      content: typeof message.content === "string" ? message.content : null,
      ...(Array.isArray(message.tool_calls) && message.tool_calls.length > 0
        ? { tool_calls: message.tool_calls }
        : {}),
    };
  }
  return { role: "assistant", content: "" };
}

export async function runAgentTurn(
  deps: AgentLoopDeps,
  history: ChatMessage[],
  tools: OpenAiTool[],
  userText: string,
): Promise<AgentTurnResult> {
  const messages: ChatMessage[] = [...history, { role: "user", content: userText }];
  const maxRounds = deps.maxToolRounds ?? MAX_TOOL_ROUNDS;
  let toolCalls = 0;
  let rounds = 0;
  let truncated = false;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await deps.chat(messages, tools);
    if (response.error) {
      throw new Error(response.error.message || "chat completion failed");
    }

    const message = assistantMessage(response);
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        history: messages,
        reply: (message.content ?? "").trim(),
        toolCalls,
        rounds,
        truncated,
      };
    }

    rounds += 1;
    for (const call of calls) {
      deps.onToolCall?.(call);
      let content: string;
      try {
        const result = await deps.callTool(call.function.name, parseArgs(call.function.arguments));
        content = compactToolResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        content = JSON.stringify({ text: `ERROR: ${message}` });
      }
      toolCalls += 1;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content,
      });
    }

    if (round === maxRounds - 1) truncated = true;
  }

  // Round limit hit with tool calls still coming: ask once more with no tools
  // so the person gets an answer instead of a silent stop.
  const finalResponse = await deps.chat(messages, []);
  if (finalResponse.error) {
    throw new Error(finalResponse.error.message || "chat completion failed");
  }
  const finalMessage = assistantMessage(finalResponse);
  messages.push(finalMessage);

  return {
    history: messages,
    reply: (finalMessage.content ?? "").trim(),
    toolCalls,
    rounds,
    truncated,
  };
}
