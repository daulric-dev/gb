/**
 * The subset of JSON Schema the AI features use, and a validator for it.
 *
 * Every model output is untrusted: it is parsed and validated against the
 * same schema the request asked for before any feature looks at it. The
 * validator enforces the constraints providers ignore (lengths, counts,
 * ranges); `providerSchema()` strips those before the schema is sent,
 * because structured-output implementations reject them.
 */
export type JsonSchema =
  | { type: 'object'; properties: Record<string, JsonSchema>; required: string[]; additionalProperties: false; description?: string }
  | { type: 'array'; items: JsonSchema; minItems?: number; maxItems?: number; description?: string }
  | { type: 'string'; enum?: readonly string[]; minLength?: number; maxLength?: number; description?: string }
  | { type: 'number' | 'integer'; minimum?: number; maximum?: number; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'null'; description?: string }
  | { anyOf: JsonSchema[]; description?: string };

export class SchemaError extends Error {}

/** Throws SchemaError naming the first path that does not match. */
export function validateSchema(schema: JsonSchema, value: unknown, path = '$'): void {
  if ('anyOf' in schema) {
    for (const option of schema.anyOf) {
      try {
        validateSchema(option, value, path);
        return;
      } catch {
        // try the next option
      }
    }
    throw new SchemaError(`${path} matches none of the allowed shapes`);
  }
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new SchemaError(`${path} must be an object`);
      }
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) throw new SchemaError(`${path}.${key} is not allowed`);
      }
      for (const key of schema.required) {
        if (!(key in obj)) throw new SchemaError(`${path}.${key} is missing`);
      }
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) validateSchema(sub, obj[key], `${path}.${key}`);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) throw new SchemaError(`${path} must be an array`);
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        throw new SchemaError(`${path} needs at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        throw new SchemaError(`${path} has more than ${schema.maxItems} items`);
      }
      value.forEach((item, i) => validateSchema(schema.items, item, `${path}[${i}]`));
      return;
    }
    case 'string': {
      if (typeof value !== 'string') throw new SchemaError(`${path} must be a string`);
      if (schema.enum && !schema.enum.includes(value)) throw new SchemaError(`${path} is not an allowed value`);
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new SchemaError(`${path} is too short`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new SchemaError(`${path} is too long`);
      }
      return;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new SchemaError(`${path} must be a number`);
      if (schema.type === 'integer' && !Number.isInteger(value)) throw new SchemaError(`${path} must be a whole number`);
      if (schema.minimum !== undefined && value < schema.minimum) throw new SchemaError(`${path} is too small`);
      if (schema.maximum !== undefined && value > schema.maximum) throw new SchemaError(`${path} is too large`);
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new SchemaError(`${path} must be true or false`);
      return;
    case 'null':
      if (value !== null) throw new SchemaError(`${path} must be null`);
      return;
  }
}

const UNSUPPORTED = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']);

/** The schema as sent to a provider: constraints structured outputs reject are removed (enforced locally instead). */
export function providerSchema(schema: JsonSchema): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED.has(k)) continue;
      out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, walk(pv)])) : walk(v);
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

/**
 * Parses a model's text answer as JSON: the whole text, else the content of
 * a ```json fence, else the outermost {...}. Throws SchemaError when none parses.
 */
export function parseJsonText(text: string): unknown {
  const attempts = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) attempts.push(fence[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(text.slice(start, end + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // next
    }
  }
  throw new SchemaError('The answer is not JSON');
}
