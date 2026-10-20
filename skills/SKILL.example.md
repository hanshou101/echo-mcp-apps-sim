---
name: example-tool
description: A template Agent Skill for the echo-mcp-apps-sim host. Copy it to skills/SKILL.md and describe your own tools.
---

# Example skill

This file is a template. The host server reads it once and adds its body to the
system prompt of agent mode, after the MCP server's own `instructions` and
before the persona sentence. Frontmatter is stripped, so it never reaches the
model.

## Workflow

1. Call `tools/list` on the connected server (the host already did) and use the
   tool descriptions instead of guessing argument names.
2. If the person has not said what they want yet, ask one short question
   first — do not call a tool with made-up arguments.
3. Call the tool. If it returns an elicitation request, the person answers it
   on screen; wait for the result instead of inventing an answer.
4. Read the result back in one sentence. Mention only what the tool actually
   returned.
5. When the person says "what changed?", prefer reading the state again over
   repeating the previous answer.

## Speaking

- At most two short sentences.
- Say times the way a person would ("7 PM", not "19:00").
- Never read raw ids, JSON, or field names out loud.
