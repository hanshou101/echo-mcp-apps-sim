/**
 * `POST /api/chat` — the only place the LLM key exists.
 *
 * The page sends `{messages, tools}`; this handler forwards it to
 * `${LLM_BASE_URL}/chat/completions` with the bearer key, `model=LLM_MODEL`,
 * `tool_choice:"auto"` and `temperature:0.2`, and returns the upstream JSON
 * untouched. The key never reaches the browser, and nothing here logs it.
 *
 * Exported as a factory so the unit test can drive it with a fake fetch.
 */
import type { ChatRequestBody } from "./types";
import { AGENT_DISABLED_MESSAGE } from "./prompt";

export interface LlmEnv {
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** All three settings, or undefined when the endpoint is not configured. */
export function llmSettings(env: LlmEnv): LlmSettings | undefined {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

export function isAgentEnabled(env: LlmEnv): boolean {
  return llmSettings(env) !== undefined;
}

export interface HandlerRequest {
  body?: unknown;
}
export interface HandlerResponse {
  status(code: number): { json(body: unknown): unknown };
}
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ChatHandlerOptions {
  env?: LlmEnv;
  fetchImpl?: FetchLike;
  /** Injected for tests; defaults to `console.warn`. */
  log?: (message: string) => void;
}

function readBody(body: unknown): ChatRequestBody | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const candidate = body as ChatRequestBody;
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) return undefined;
  return candidate;
}

export function createChatHandler(options: ChatHandlerOptions = {}) {
  const env = options.env ?? (process.env as LlmEnv);
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const log = options.log ?? ((message: string) => console.warn(message));

  return async function handleChat(req: HandlerRequest, res: HandlerResponse): Promise<void> {
    const settings = llmSettings(env);
    if (!settings) {
      res.status(503).json({ error: AGENT_DISABLED_MESSAGE });
      return;
    }

    const body = readBody(req.body);
    if (!body) {
      res.status(400).json({ error: "body must be {messages: [...], tools?: [...]}" });
      return;
    }

    const payload: Record<string, unknown> = {
      model: settings.model,
      messages: body.messages,
      temperature: 0.2,
    };
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      payload.tools = body.tools;
      payload.tool_choice = "auto";
    }

    try {
      const upstream = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });

      const text = await upstream.text();
      if (!upstream.ok) {
        // Upstream error bodies are short and useful; keep them, never the key.
        log(`[chat] upstream ${upstream.status}`);
        res.status(502).json({
          error: `LLM upstream ${upstream.status}: ${text.slice(0, 300)}`,
        });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        res.status(502).json({ error: "LLM upstream returned non-JSON" });
        return;
      }
      res.status(200).json(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[chat] request failed: ${message}`);
      res.status(502).json({ error: `LLM request failed: ${message}` });
    }
  };
}
