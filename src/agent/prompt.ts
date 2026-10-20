/**
 * System prompt for agent mode: the optional Agent Skill body, then the MCP
 * server's `instructions`, then the fixed persona sentence. The order is
 * pinned by a unit test.
 */

/** Fixed persona appended to every agent-mode system prompt. */
export const PERSONA =
  "You are a voice assistant on an Echo Show-style smart display. Answer in at most two short sentences and say times the way a person would.";

/** Exactly the sentence the disabled agent input shows. */
export const AGENT_DISABLED_MESSAGE =
  "Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env to enable agent mode";

export interface SystemPromptParts {
  /** Body of the configured skill file, frontmatter already stripped. */
  skill: string;
  /** `instructions` from the MCP server's initialize result. */
  instructions?: string;
}

export function buildSystemPrompt({ skill, instructions }: SystemPromptParts): string {
  return [skill.trim(), (instructions ?? "").trim(), PERSONA]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
