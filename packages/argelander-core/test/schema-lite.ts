/**
 * Minimal draft-07 validator covering exactly the keyword subset used by
 * schemas/strip.schema.json, so fixtures validate against the schema without
 * adding a dependency (CLAUDE.md: argelander-core ships with zero; the test
 * tree stays dependency-free too). Supported: type, enum, const, required,
 * properties, additionalProperties (boolean), items (single schema),
 * minItems, maxItems, minLength, minimum, exclusiveMinimum, oneOf, and
 * local $ref into definitions.
 */

type Schema = Record<string, unknown>;

function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  }
  return node as Schema;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function check(root: Schema, schema: Schema, value: unknown, path: string, errors: string[]): void {
  if (typeof schema['$ref'] === 'string') {
    check(root, resolveRef(root, schema['$ref']), value, path, errors);
    return;
  }
  if (Array.isArray(schema['oneOf'])) {
    let matches = 0;
    for (const sub of schema['oneOf'] as Schema[]) {
      const subErrors: string[] = [];
      check(root, sub, value, path, subErrors);
      if (subErrors.length === 0) matches++;
    }
    if (matches !== 1) errors.push(`${path}: matches ${matches} of oneOf, expected 1`);
    return;
  }
  const t = schema['type'];
  if (typeof t === 'string') {
    const actual = typeOf(value);
    if (t === 'integer') {
      if (!Number.isInteger(value)) errors.push(`${path}: expected integer`);
    } else if (t === 'number') {
      if (actual !== 'number' || !Number.isFinite(value as number)) errors.push(`${path}: expected finite number`);
    } else if (actual !== t) {
      errors.push(`${path}: expected ${t}, got ${actual}`);
    }
  }
  if (schema['const'] !== undefined && value !== schema['const']) {
    errors.push(`${path}: expected const ${JSON.stringify(schema['const'])}`);
  }
  if (Array.isArray(schema['enum']) && !(schema['enum'] as unknown[]).includes(value)) {
    errors.push(`${path}: not in enum`);
  }
  if (typeof value === 'string' && typeof schema['minLength'] === 'number' && value.length < (schema['minLength'] as number)) {
    errors.push(`${path}: shorter than minLength`);
  }
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < (schema['minimum'] as number)) errors.push(`${path}: below minimum`);
    if (typeof schema['exclusiveMinimum'] === 'number' && value <= (schema['exclusiveMinimum'] as number)) errors.push(`${path}: not above exclusiveMinimum`);
  }
  if (Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < (schema['minItems'] as number)) errors.push(`${path}: fewer than minItems`);
    if (typeof schema['maxItems'] === 'number' && value.length > (schema['maxItems'] as number)) errors.push(`${path}: more than maxItems`);
    if (schema['items'] && typeof schema['items'] === 'object' && !Array.isArray(schema['items'])) {
      value.forEach((item, i) => check(root, schema['items'] as Schema, item, `${path}[${i}]`, errors));
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema['properties'] ?? {}) as Record<string, Schema>;
    if (Array.isArray(schema['required'])) {
      for (const key of schema['required'] as string[]) {
        if (obj[key] === undefined) errors.push(`${path}: missing required ${key}`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (obj[key] !== undefined) check(root, sub, obj[key], `${path}.${key}`, errors);
    }
    if (schema['additionalProperties'] === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push(`${path}: unknown field ${key}`);
      }
    }
  }
}

export function validateAgainstSchema(schema: Schema, value: unknown): readonly string[] {
  const errors: string[] = [];
  check(schema, schema, value, '$', errors);
  return errors;
}
