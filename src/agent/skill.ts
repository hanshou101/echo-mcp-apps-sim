/**
 * Loading an optional Agent Skill file for agent mode.
 *
 * The page cannot read the filesystem, so the host server reads the skill file
 * once and hands the body (frontmatter stripped) to the browser through
 * `/api/config`. The system prompt is composed in the browser from that body,
 * the MCP server's `instructions`, and the persona sentence.
 *
 * `SKILL_FILE` points at the file; when it is missing the prompt simply omits
 * the skill section. `skills/SKILL.example.md` is a template to copy from.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Default skill file, relative to the repository root. */
export const SKILL_RELATIVE_PATH = join("skills", "SKILL.md");

/** Repository root, from `src/agent/` (two levels up). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * Drop a leading YAML frontmatter block (`---` … `---`). Frontmatter is for
 * skill loaders, not for the model.
 */
export function stripFrontmatter(markdown: string): string {
  const text = markdown.replace(/^\uFEFF/, "");
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

/** Path of the skill file: `SKILL_FILE`, else `<root>/skills/SKILL.md`. */
export function skillFilePath(root: string = repoRoot(), override?: string): string {
  const configured = override?.trim();
  if (configured) return resolve(root, configured);
  return join(root, SKILL_RELATIVE_PATH);
}

/** Read the skill file and return its body; "" when the file is absent. */
export function readSkillBody(root: string = repoRoot(), override?: string): string {
  const file = skillFilePath(root, override);
  if (!existsSync(file)) return "";
  return stripFrontmatter(readFileSync(file, "utf8"));
}
