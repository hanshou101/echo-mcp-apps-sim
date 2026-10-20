/**
 * Quick-action chips (direct mode, no LLM).
 *
 * The chips are not hard-coded to one product: they come from `presets.json`
 * (override with `PRESETS_FILE`). Every chip runs a real `tools/call`; a chip
 * is disabled when the connected server does not expose its tool, so the same
 * file can be pointed at several servers without breaking the page.
 */

export interface Preset {
  id: string;
  label: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PresetsFile {
  presets: Preset[];
}

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`presets[${index}].${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate a parsed `presets.json` value.
 *
 * Throws with the offending field so a typo in a user's file is a clear error
 * in the server log instead of a silently empty panel.
 */
export function parsePresets(raw: unknown): Preset[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("presets file must be an object with a `presets` array");
  }
  const list = (raw as { presets?: unknown }).presets;
  if (!Array.isArray(list)) {
    throw new Error("presets file must be an object with a `presets` array");
  }

  const seen = new Set<string>();
  return list.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`presets[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const preset: Preset = {
      id: requireString(record.id, "id", index),
      label: requireString(record.label, "label", index),
      tool: requireString(record.tool, "tool", index),
      args: {},
    };
    if (record.args !== undefined) {
      if (record.args === null || typeof record.args !== "object" || Array.isArray(record.args)) {
        throw new Error(`presets[${index}].args must be an object`);
      }
      preset.args = record.args as Record<string, unknown>;
    }
    if (seen.has(preset.id)) {
      throw new Error(`presets[${index}].id "${preset.id}" is used twice`);
    }
    seen.add(preset.id);
    return preset;
  });
}

/** True when the tool the preset needs is exposed by the connected server. */
export function isPresetAvailable(
  preset: Preset,
  toolNames: readonly string[],
): boolean {
  return toolNames.includes(preset.tool);
}
