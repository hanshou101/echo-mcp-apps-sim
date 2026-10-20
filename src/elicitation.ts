/**
 * Turns an MCP `elicitation/create` (form mode) request into a card model.
 *
 * Two schema shapes must render (the MCP elicitation spec):
 *  - 2025-11-25 "titled enum":  { type: "string", oneOf: [{ const, title }, ...] }
 *  - legacy enum:               { type: "string", enum: [...], enumNames: [...] }
 * Anything that is not a finite set of choices is ignored; a card with no
 * fields still shows the message and a Close button.
 */

export type ElicitValue = string | number | boolean;

export interface ElicitOption {
  value: ElicitValue;
  label: string;
}

export interface ElicitField {
  name: string;
  title: string;
  required: boolean;
  options: ElicitOption[];
}

export interface ElicitCard {
  message: string;
  fields: ElicitField[];
}

interface JsonSchemaLike {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  enumNames?: unknown[];
  oneOf?: unknown[];
  anyOf?: unknown[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
}

function labelFor(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function titleFromEnumEntry(entry: unknown, fallback: string): string {
  if (entry && typeof entry === "object") {
    const candidate = entry as { title?: unknown; const?: unknown };
    if (typeof candidate.title === "string" && candidate.title.length > 0) {
      return candidate.title;
    }
    if (candidate.const !== undefined) {
      return String(candidate.const);
    }
  }
  return fallback;
}

function valueFromEnumEntry(entry: unknown): ElicitValue | undefined {
  if (entry && typeof entry === "object") {
    const candidate = entry as { const?: unknown; enum?: unknown[]; title?: unknown };
    if (candidate.const !== undefined) {
      const v = candidate.const;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        return v;
      }
      return String(v);
    }
    if (Array.isArray(candidate.enum) && candidate.enum.length > 0) {
      const v = candidate.enum[0];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        return v;
      }
      return String(v);
    }
    if (typeof candidate.title === "string") return candidate.title;
  }
  if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
    return entry;
  }
  return undefined;
}

function optionsFromSchema(schema: JsonSchemaLike): ElicitOption[] {
  const entries = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(entries) && entries.length > 0) {
    const options: ElicitOption[] = [];
    for (const entry of entries) {
      const value = valueFromEnumEntry(entry);
      if (value === undefined) continue;
      options.push({ value, label: titleFromEnumEntry(entry, String(value)) });
    }
    if (options.length > 0) return options;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    const options: ElicitOption[] = [];
    schema.enum.forEach((raw, index) => {
      if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") return;
      const fallback = String(raw);
      options.push({ value: raw, label: labelFor(names[index], fallback) });
    });
    if (options.length > 0) return options;
  }

  if (schema.type === "boolean") {
    return [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ];
  }

  return [];
}

/** Build the card model from the raw `elicitation/create` params. */
export function buildElicitationCard(params: {
  message?: unknown;
  requestedSchema?: unknown;
}): ElicitCard {
  const message =
    typeof params?.message === "string" && params.message.length > 0
      ? params.message
      : "The server needs more information.";

  const schema = (params?.requestedSchema ?? {}) as JsonSchemaLike;
  const properties = schema.properties ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  const fields: ElicitField[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== "object") continue;
    const options = optionsFromSchema(prop);
    if (options.length === 0) continue;
    fields.push({
      name,
      title: typeof prop.title === "string" && prop.title.length > 0 ? prop.title : name,
      required: required.includes(name),
      options,
    });
  }

  return { message, fields };
}

/** Build the `content` object for an `accept` result from per-field selections. */
export function selectionToContent(
  card: ElicitCard,
  selections: Record<string, ElicitValue>,
): Record<string, ElicitValue> {
  const content: Record<string, ElicitValue> = {};
  for (const field of card.fields) {
    const value = selections[field.name];
    if (value !== undefined) content[field.name] = value;
  }
  return content;
}
