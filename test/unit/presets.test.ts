import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPresetAvailable, parsePresets, type Preset } from "../../src/presets";
import { repoRoot } from "../../src/agent/skill";

function sample(presets: unknown[]): unknown {
  return { presets };
}

describe("presets.json", () => {
  it("ships a valid default file for the bundled example server", () => {
    const raw: unknown = JSON.parse(readFileSync(join(repoRoot(), "presets.json"), "utf8"));
    const presets = parsePresets(raw);
    expect(presets.map((preset) => preset.tool)).toEqual([
      "show_echo",
      "bump_counter",
      "ask_choice",
    ]);
  });

  it("accepts an empty list", () => {
    expect(parsePresets(sample([]))).toEqual([]);
  });

  it("defaults args to an empty object", () => {
    const [preset] = parsePresets(sample([{ id: "a", label: "A", tool: "t" }]));
    expect(preset.args).toEqual({});
  });

  it("rejects a file without a presets array", () => {
    expect(() => parsePresets({})).toThrow(/presets` array/);
    expect(() => parsePresets([])).toThrow(/presets` array/);
    expect(() => parsePresets(null)).toThrow(/presets` array/);
  });

  it("names the offending field", () => {
    expect(() => parsePresets(sample([{ id: "", label: "A", tool: "t" }]))).toThrow(
      /presets\[0\]\.id/,
    );
    expect(() => parsePresets(sample([{ id: "a", label: "A", tool: 1 }]))).toThrow(
      /presets\[0\]\.tool/,
    );
    expect(() => parsePresets(sample([{ id: "a", label: "A", tool: "t", args: [] }]))).toThrow(
      /presets\[0\]\.args/,
    );
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parsePresets(
        sample([
          { id: "same", label: "A", tool: "t" },
          { id: "same", label: "B", tool: "t" },
        ]),
      ),
    ).toThrow(/used twice/);
  });

  it("greys out a chip when the connected server lacks its tool", () => {
    const preset: Preset = { id: "a", label: "A", tool: "show_echo", args: {} };
    expect(isPresetAvailable(preset, ["show_echo", "bump_counter"])).toBe(true);
    expect(isPresetAvailable(preset, ["bump_counter"])).toBe(false);
  });
});
