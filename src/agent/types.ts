/**
 * Shapes of the OpenAI-compatible chat-completions API that the agent loop
 * uses. Only the fields this project needs; anything else is passed through.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface OpenAiToolFunction {
  name: string;
  description?: string;
  /** JSON Schema taken from the MCP tool's `inputSchema`. */
  parameters: unknown;
}

export interface OpenAiTool {
  type: "function";
  function: OpenAiToolFunction;
}

export interface ChatCompletionChoice {
  message?: ChatMessage;
  finish_reason?: string;
}

export interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  error?: { message?: string };
}

/** What `POST /api/chat` accepts from the page. */
export interface ChatRequestBody {
  messages: ChatMessage[];
  tools?: OpenAiTool[];
}
