import { describe, expect, it } from "vitest";
import { buildElicitationCard, selectionToContent } from "../../src/elicitation";

describe("buildElicitationCard", () => {
  it("renders the 2025-11-25 titled enum (oneOf + const/title)", () => {
    const card = buildElicitationCard({
      message: "Your oven can only hold one temperature at a time. How should I plan it?",
      requestedSchema: {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: "Oven plan",
            oneOf: [
              { const: "share-oven", title: "Share the oven." },
              { const: "keep-temps", title: "Keep recipe temperatures." },
            ],
            default: "share-oven",
          },
        },
        required: ["choice"],
      },
    });

    expect(card.message).toContain("one temperature");
    expect(card.fields).toHaveLength(1);
    expect(card.fields[0].name).toBe("choice");
    expect(card.fields[0].title).toBe("Oven plan");
    expect(card.fields[0].options).toEqual([
      { value: "share-oven", label: "Share the oven." },
      { value: "keep-temps", label: "Keep recipe temperatures." },
    ]);
  });

  it("renders the legacy enum + enumNames schema", () => {
    const card = buildElicitationCard({
      message: "Pick one",
      requestedSchema: {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: "Legacy",
            enum: ["a", "b"],
            enumNames: ["Option A", "Option B"],
          },
        },
        required: ["choice"],
      },
    });

    expect(card.fields[0].options).toEqual([
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
    ]);
  });

  it("falls back to the raw value when enumNames is missing or short", () => {
    const card = buildElicitationCard({
      message: "Pick one",
      requestedSchema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: ["x", "y"], enumNames: ["X only"] },
        },
      },
    });

    expect(card.fields[0].options).toEqual([
      { value: "x", label: "X only" },
      { value: "y", label: "y" },
    ]);
  });

  it("renders boolean properties as Yes / No", () => {
    const card = buildElicitationCard({
      message: "Continue?",
      requestedSchema: {
        type: "object",
        properties: { ok: { type: "boolean", title: "Continue" } },
        required: ["ok"],
      },
    });

    expect(card.fields[0].options).toEqual([
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ]);
  });

  it("keeps the message when no property is a choice", () => {
    const card = buildElicitationCard({
      message: "Just so you know",
      requestedSchema: { type: "object", properties: { note: { type: "string" } } },
    });

    expect(card.message).toBe("Just so you know");
    expect(card.fields).toEqual([]);
  });

  it("survives a missing schema", () => {
    const card = buildElicitationCard({ message: "Hello" });
    expect(card.fields).toEqual([]);
    expect(card.message).toBe("Hello");
  });
});

describe("selectionToContent", () => {
  it("only includes fields the user selected", () => {
    const card = buildElicitationCard({
      message: "Pick",
      requestedSchema: {
        type: "object",
        properties: {
          choice: { type: "string", enum: ["a", "b"] },
          second: { type: "boolean" },
        },
      },
    });

    expect(selectionToContent(card, { choice: "b" })).toEqual({ choice: "b" });
  });
});
