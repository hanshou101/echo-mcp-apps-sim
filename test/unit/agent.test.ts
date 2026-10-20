import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { compactToolResult } from "../../src/agent/compact";
import { createChatHandler, llmSettings } from "../../src/agent/chat-handler";
import { MAX_TOOL_ROUNDS, runAgentTurn } from "../../src/agent/loop";
import { AGENT_DISABLED_MESSAGE, PERSONA, buildSystemPrompt } from "../../src/agent/prompt";
import {
  readSkillBody,
  repoRoot,
  skillFilePath,
  stripFrontmatter,
} from "../../src/agent/skill";
import { pickEnglishVoice } from "../../src/agent/speech";
import { toOpenAiTools } from "../../src/agent/tools";
import type { ChatCompletionResponse, ChatMessage, OpenAiTool } from "../../src/agent/types";

// ---------------------------------------------------------------- skill file

describe("skill file loading", () => {
  const example = join(repoRoot(), "skills", "SKILL.example.md");

  it("ships a valid example skill with Agent Skills frontmatter", () => {
    const raw = readFileSync(example, "utf8");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toMatch(/^name: example-tool/m);
    expect(raw).toMatch(/^description: .+/m);
    expect(raw.split("\n").length).toBeLessThanOrEqual(80);
  });

  it("strips frontmatter for the prompt but keeps the body", () => {
    const body = stripFrontmatter(readFileSync(example, "utf8"));
    expect(body.startsWith("# Example skill")).toBe(true);
    expect(body).not.toContain("name: example-tool");
    expect(body).toContain("tools/list");
  });

  it("returns an empty body when the configured file does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-"));
    expect(readSkillBody(root)).toBe("");
    expect(readSkillBody(root, "nope/SKILL.md")).toBe("");
  });

  it("honours SKILL_FILE over the default path", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-"));
    const file = join(root, "custom.md");
    writeFileSync(file, "---\nname: custom\n---\n\n# Custom body\n", "utf8");
    expect(skillFilePath(root, "custom.md")).toBe(file);
    expect(readSkillBody(root, "custom.md")).toBe("# Custom body");
  });
});

// ---------------------------------------------------------------- system prompt

describe("buildSystemPrompt", () => {
  const skill = stripFrontmatter(readFileSync(join(repoRoot(), "skills", "SKILL.example.md"), "utf8"));
  const instructions = "Sample server instructions: call get_status before planning.";

  it("loads the configured skill body into the prompt", () => {
    const prompt = buildSystemPrompt({ skill, instructions });
    expect(skill.length).toBeGreaterThan(200);
    expect(prompt.startsWith(skill)).toBe(true);
    expect(prompt).toContain("tools/list");
  });

  it("appends server instructions and the persona sentence, in order", () => {
    const prompt = buildSystemPrompt({ skill, instructions });
    expect(prompt.indexOf(skill)).toBe(0);
    expect(prompt.indexOf(instructions)).toBeGreaterThan(prompt.indexOf(skill));
    expect(prompt.trimEnd().endsWith(PERSONA)).toBe(true);
  });

  it("degrades to instructions + persona when the skill is missing", () => {
    const prompt = buildSystemPrompt({ skill: "", instructions });
    expect(prompt.startsWith(instructions)).toBe(true);
    expect(prompt.endsWith(PERSONA)).toBe(true);
  });
});
// ---------------------------------------------------------------- tool mapping

describe("toOpenAiTools", () => {
  it("maps MCP tools to OpenAI functions with the inputSchema untouched", () => {
    const schema = {
      type: "object",
      properties: { dishes: { type: "array", items: { type: "string" } } },
      required: ["dishes"],
    };
    const [fn] = toOpenAiTools([
      { name: "plan_event", title: "Plan Event", description: "Plan an event", inputSchema: schema },
    ]);

    expect(fn.type).toBe("function");
    expect(fn.function.name).toBe("plan_event");
    expect(fn.function.description).toBe("Plan an event");
    expect(fn.function.parameters).toEqual(schema);
  });

  it("falls back to the title, then the name, and to an empty object schema", () => {
    const tools = toOpenAiTools([{ name: "get_status", title: "What's Next" }, { name: "get_profile" }]);
    expect(tools[0].function.description).toBe("What's Next");
    expect(tools[1].function.description).toBe("get_profile");
    expect(tools[0].function.parameters).toEqual({ type: "object", properties: {} });
  });
});

// ---------------------------------------------------------------- compaction

describe("compactToolResult", () => {
  const result = {
    content: [{ type: "text", text: "Plan ready at 7:00 PM." }],
    structuredContent: {
      serveAt: "19:00",
      revision: 1,
      kitchen: { ovens: 1, burners: 4, cooks: 2 },
      steps: [
        { stepId: "event.main", itemId: "main", itemName: "Main", start: "15:10", end: "18:30", status: "upcoming", station: 1, stationTempF: 325, minutes: 200, label: "Main step" },
      ],
    },
  };

  it("keeps text and plan timing, drops kitchen and step detail", () => {
    const payload = JSON.parse(compactToolResult(result)) as {
      text: string;
      structured: Record<string, unknown> & { steps: Record<string, unknown>[] };
    };

    expect(payload.text).toBe("Plan ready at 7:00 PM.");
    expect(payload.structured.serveAt).toBe("19:00");
    expect(payload.structured.kitchen).toBeUndefined();
    expect(payload.structured.steps).toEqual([
      { stepId: "event.main", start: "15:10", end: "18:30", status: "upcoming" },
    ]);
  });

  it("marks tool errors and keeps plain text results readable", () => {
    const failed = compactToolResult({ content: [{ type: "text", text: "Too late." }], isError: true });
    expect(JSON.parse(failed)).toEqual({ text: "ERROR: Too late." });

    const plain = compactToolResult({ content: [{ type: "text", text: "ok" }] });
    expect(JSON.parse(plain)).toEqual({ text: "ok" });
  });
});

// ---------------------------------------------------------------- the loop

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): ChatCompletionResponse {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

function textResponse(text: string): ChatCompletionResponse {
  return { choices: [{ message: { role: "assistant", content: text } }] };
}

describe("runAgentTurn", () => {
  const tools: OpenAiTool[] = [
    { type: "function", function: { name: "plan_event", parameters: { type: "object" } } },
  ];

  it("runs the tool the model asked for and feeds a compacted result back", async () => {
    const seen: { toolMessages: ChatMessage[]; calls: Array<[string, Record<string, unknown>]> } = {
      toolMessages: [],
      calls: [],
    };
    const replies = [toolCallResponse("call_1", "plan_event", { items: ["main"], serveAt: "19:00" }), textResponse("Plan ready at 7:00 PM.")];

    const chat = vi.fn(async (messages: ChatMessage[]) => {
      seen.toolMessages = messages.filter((message) => message.role === "tool");
      return replies.shift()!;
    });

    const result = await runAgentTurn(
      {
        chat,
        callTool: async (name, args) => {
          seen.calls.push([name, args]);
          return {
            content: [{ type: "text", text: "planned" }],
            structuredContent: { serveAt: "19:00", kitchen: { cooks: 2 }, steps: [{ stepId: "a", start: "15:00", end: "16:00", status: "upcoming", label: "x" }] },
          };
        },
      },
      [],
      tools,
      "Plan my evening.",
    );

    expect(seen.calls).toEqual([["plan_event", { items: ["main"], serveAt: "19:00" }]]);
    expect(result.toolCalls).toBe(1);
    expect(result.rounds).toBe(1);
    expect(result.reply).toBe("Plan ready at 7:00 PM.");
    expect(result.history.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const fedBack = JSON.parse(seen.toolMessages[0].content ?? "{}") as Record<string, unknown>;
    expect(fedBack.structured).toMatchObject({ serveAt: "19:00", steps: [{ stepId: "a" }] });
    expect(JSON.stringify(fedBack)).not.toContain("kitchen");
  });

  it("turns a failing tool into a tool message and keeps going", async () => {
    const replies = [toolCallResponse("call_1", "get_status", {}), textResponse("No plan yet.")];
    const result = await runAgentTurn(
      {
        chat: async () => replies.shift()!,
        callTool: async () => {
          throw new Error("server unreachable");
        },
      },
      [],
      tools,
      "What's next?",
    );

    const toolMessage = result.history.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("ERROR: server unreachable");
    expect(result.reply).toBe("No plan yet.");
  });

  it("stops after six tool rounds and asks once more without tools", async () => {
    const chat = vi.fn(async (_messages: ChatMessage[], sentTools: OpenAiTool[]) =>
      sentTools.length === 0
        ? textResponse("Let's stop here.")
        : toolCallResponse("call_x", "plan_event", {}),
    );
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));

    const result = await runAgentTurn({ chat, callTool }, [], tools, "plan it");

    expect(MAX_TOOL_ROUNDS).toBe(6);
    expect(callTool).toHaveBeenCalledTimes(6);
    expect(result.truncated).toBe(true);
    expect(result.reply).toBe("Let's stop here.");
    expect(chat).toHaveBeenLastCalledWith(expect.any(Array), []);
  });

  it("surfaces a chat error instead of a fake answer", async () => {
    await expect(
      runAgentTurn({ chat: async () => ({ error: { message: "HTTP 503" } }), callTool: async () => ({}) }, [], tools, "hi"),
    ).rejects.toThrow("HTTP 503");
  });
});

// ---------------------------------------------------------------- /api/chat

interface Captured {
  status?: number;
  body?: unknown;
}

function fakeResponse(): { res: { status(code: number): { json(body: unknown): unknown } }; captured: Captured } {
  const captured: Captured = {};
  return {
    captured,
    res: {
      status(code: number) {
        captured.status = code;
        return {
          json(body: unknown) {
            captured.body = body;
            return body;
          },
        };
      },
    },
  };
}

describe("POST /api/chat handler", () => {
  const env = { LLM_BASE_URL: "https://llm.example/v1/", LLM_API_KEY: "sk-test-secret", LLM_MODEL: "demo-model" };
  const oneTool: OpenAiTool = {
    type: "function",
    function: { name: "list_dishes", parameters: { type: "object", properties: {} } },
  };

  it("is disabled until all three settings exist", async () => {
    const { res, captured } = fakeResponse();
    const handler = createChatHandler({ env: { LLM_BASE_URL: "https://llm.example/v1" }, fetchImpl: vi.fn() });

    await handler({ body: { messages: [{ role: "user", content: "hi" }] } }, res);

    expect(captured.status).toBe(503);
    expect(captured.body).toEqual({ error: AGENT_DISABLED_MESSAGE });
    expect(llmSettings({})).toBeUndefined();
  });

  it("forwards model, messages and tools with tool_choice auto and temperature 0.2", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(textResponse("hello")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { res, captured } = fakeResponse();
    const handler = createChatHandler({ env, fetchImpl });

    await handler(
      { body: { messages: [{ role: "user", content: "hi" }], tools: [oneTool] } },
      res,
    );

    expect(captured.status).toBe(200);
    expect(captured.body).toEqual(textResponse("hello"));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-secret");
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent.model).toBe("demo-model");
    expect(sent.tool_choice).toBe("auto");
    expect(sent.temperature).toBe(0.2);
    expect(sent.tools).toHaveLength(1);
  });

  it("rejects a body without messages", async () => {
    const { res, captured } = fakeResponse();
    await createChatHandler({ env, fetchImpl: vi.fn() })({ body: {} }, res);
    expect(captured.status).toBe(400);
  });

  it("reports an upstream failure without echoing the key", async () => {
    const { res, captured } = fakeResponse();
    const handler = createChatHandler({
      env,
      fetchImpl: async () => new Response("quota exceeded", { status: 429 }),
      log: () => {},
    });

    await handler({ body: { messages: [{ role: "user", content: "hi" }] } }, res);

    expect(captured.status).toBe(502);
    expect(JSON.stringify(captured.body)).toContain("429");
    expect(JSON.stringify(captured.body)).not.toContain("sk-test-secret");
  });
});

describe("pickEnglishVoice", () => {
  it("prefers en-US, then any English voice", () => {
    expect(pickEnglishVoice([{ lang: "de-DE" }, { lang: "en-GB" }])).toEqual({ lang: "en-GB" });
    expect(pickEnglishVoice([{ lang: "en-GB" }, { lang: "en-US", name: "Samantha" }])).toEqual({
      lang: "en-US",
      name: "Samantha",
    });
    expect(pickEnglishVoice([{ lang: "fr-FR" }])).toBeUndefined();
  });
});
