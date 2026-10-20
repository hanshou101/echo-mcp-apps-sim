/**
 * Compacting a tool result before it goes back to the model: keep the text
 * block, and trim `structuredContent` — drop bulky keys the model does not
 * need (`kitchen` in the bundled example server) and cut each step down to
 * `stepId` / `start` / `end` / `status`. The model needs the timing, not the
 * inventory or the labels it already knows.
 */

export interface ToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

const STEP_KEYS = ["stepId", "start", "end", "status"] as const;

export function textFromToolResult(result: ToolResultLike): string {
  return (Array.isArray(result.content) ? result.content : [])
    .filter((block): block is { type?: string; text: string } => block?.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Key order is preserved so the same result always compacts identically. */
function trimStructured(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(source)) {
    if (key === "kitchen") continue;
    if (key === "steps" && Array.isArray(entry)) {
      out.steps = entry.map((step) => {
        if (!step || typeof step !== "object") return step;
        const record: Record<string, unknown> = {};
        for (const stepKey of STEP_KEYS) {
          record[stepKey] = (step as Record<string, unknown>)[stepKey];
        }
        return record;
      });
      continue;
    }
    out[key] = entry;
  }
  return out;
}

/**
 * The `content` of the `tool` message sent back to the LLM: text plus the
 * trimmed structured payload, as JSON so both halves stay unambiguous.
 */
export function compactToolResult(result: ToolResultLike): string {
  const text = textFromToolResult(result);
  const structured = trimStructured(result.structuredContent);
  const payload =
    structured === undefined
      ? { text }
      : { text, structured };

  if (result.isError) payload.text = `ERROR: ${text || "tool failed"}`.trim();
  return JSON.stringify(payload);
}
