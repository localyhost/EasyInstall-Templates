// JSON Schema validation with readable error messages.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMA_PATH = fileURLToPath(new URL('../../schema/template.schema.json', import.meta.url));

// Compound keywords: their own messages are noise, the real cause is in the sub-errors.
const NOISE = new Set(['if', 'then', 'else', 'anyOf', 'oneOf', 'allOf', 'not']);

let cached;

/** Returns the compiled schema validator (created once). */
export function getSchemaValidator() {
  if (cached) return cached;
  const ajv = new Ajv2020({
    allErrors: true,
    discriminator: true,
    verbose: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
  });
  addFormats(ajv);
  // Annotation only: shown by VS Code and used here for messages.
  ajv.addKeyword({ keyword: 'errorMessage', schemaType: 'string' });
  cached = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
  return cached;
}

function at(data, segments) {
  return segments.reduce((node, seg) => (node == null ? undefined : node[seg]), data);
}

/**
 * Turns "/options/2/default" into "options[2] (motd).default".
 * Array items get their key/id/action appended so they are easy to find in the file.
 */
export function formatPath(instancePath, data) {
  if (!instancePath) return '(root)';
  const segments = instancePath.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let out = '';
  segments.forEach((seg, i) => {
    if (/^\d+$/.test(seg)) {
      const item = at(data, segments.slice(0, i + 1));
      const label = item && typeof item === 'object' ? item.key ?? item.id ?? item.action : undefined;
      out += `[${seg}]${label !== undefined ? ` (${label})` : ''}`;
    } else {
      out += out ? `.${seg}` : seg;
    }
  });
  return out;
}

const list = (values) => values.map((v) => JSON.stringify(v)).join(', ');

/** Translates one Ajv error. Returns null if the error is just noise. */
function describe(err) {
  const p = err.params;
  const hint = err.parentSchema?.errorMessage;
  switch (err.keyword) {
    case 'required':
      return { sub: p.missingProperty, msg: 'required field is missing' };
    case 'additionalProperties':
      return { sub: p.additionalProperty, msg: 'field is not allowed here' };
    case 'unevaluatedProperties':
      return { sub: p.unevaluatedProperty, msg: 'field is not allowed here' };
    case 'false schema':
      return { msg: 'field is not allowed here' };
    case 'dependentRequired':
      return { msg: `"${p.property}" also needs "${p.missingProperty}"` };
    case 'type':
      return { msg: `must be of type ${[].concat(p.type).join(' or ')}` };
    case 'enum':
      return { msg: `invalid value ${JSON.stringify(err.data)}, allowed: ${list(p.allowedValues)}` };
    case 'const':
      return { msg: `must be ${JSON.stringify(p.allowedValue)}` };
    case 'pattern':
      return { msg: `invalid format${hint ? `: ${hint}` : ` (pattern ${p.pattern})`}` };
    case 'format':
      return { msg: hint ?? `invalid format (${p.format})` };
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return { msg: `must be ${p.comparison} ${p.limit}` };
    case 'minItems':
      return { msg: p.limit === 1 ? 'must not be empty' : `needs at least ${p.limit} items` };
    case 'maxItems':
      return { msg: `must have at most ${p.limit} items` };
    case 'minLength':
      return { msg: p.limit === 1 ? 'must not be empty' : `must be at least ${p.limit} characters long` };
    case 'maxLength':
      return { msg: `must be at most ${p.limit} characters long` };
    case 'minProperties':
      return { msg: p.limit === 1 ? 'must not be empty' : 'needs exactly "field" and one operator' };
    case 'maxProperties':
      return {
        msg: p.limit === 1 ? 'expects exactly one of all/any/not' : 'a condition has exactly "field" and one operator',
      };
    case 'uniqueItems':
      return { msg: 'contains duplicate items' };
    case 'discriminator':
      return p.error === 'mapping'
        ? { msg: `unknown value ${JSON.stringify(p.tagValue)} for "${p.tag}"` }
        : { msg: `"${p.tag}" must be a string` };
    case 'anyOf':
      return anyOfRequiredHint(err);
    default:
      return NOISE.has(err.keyword) ? null : { msg: err.message };
  }
}

/** For an anyOf made only of required branches: "needs at least one of …" instead of single errors. */
function anyOfRequiredHint(err) {
  const branches = err.schema;
  if (!Array.isArray(branches) || !branches.every((b) => Array.isArray(b.required) && Object.keys(b).length === 1)) {
    return null;
  }
  return { msg: `needs at least one of: ${branches.map((b) => b.required.join('+')).join(', ')}` };
}

/** Validates data against the schema; returns a list of messages (empty = valid). */
export function validateSchema(data) {
  const validate = getSchemaValidator();
  if (validate(data)) return [];

  // Summarized anyOf errors replace their individual required errors.
  const summarized = validate.errors
    .filter((e) => e.keyword === 'anyOf' && anyOfRequiredHint(e))
    .map((e) => `${e.schemaPath}/`);
  const isPartOfSummary = (e) => e.keyword === 'required' && summarized.some((sp) => e.schemaPath.startsWith(sp));

  const messages = new Set();
  for (const err of validate.errors) {
    if (isPartOfSummary(err)) continue;
    const d = describe(err);
    if (!d) continue;
    const path = d.sub ? `${err.instancePath}/${d.sub}` : err.instancePath;
    messages.add(`${formatPath(path, data)}: ${d.msg}`);
  }
  return [...messages];
}
