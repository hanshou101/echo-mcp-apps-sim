/** Shared types for the simulator page. */

export interface SimAgentConfig {
  enabled: boolean;
  /** Model name from `LLM_MODEL`; shown in the panel, never the key. */
  model?: string;
}

export interface SimConfig {
  mcpUrl: string;
  sandboxUrl: string;
  /** Agent mode is usable only when the server has an LLM endpoint configured. */
  agent?: SimAgentConfig;
  /** Body of the configured skill file (frontmatter stripped). */
  skill?: string;
}

export type CallSource = "preset" | "console" | "app" | "clock" | "agent";

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  source: CallSource;
  status: "running" | "ok" | "error";
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export interface ToolLogger {
  begin(name: string, args: Record<string, unknown>, source: CallSource): ToolCallRecord;
  finish(record: ToolCallRecord, result: unknown, durationMs: number): void;
  fail(record: ToolCallRecord, error: unknown, durationMs: number): void;
}
