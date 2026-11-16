// Evaluates conditions and placeholders – the same way a panel is expected to.

/** Evaluates a condition. lookup(field) returns the current value of a field. */
export function evaluate(cond, lookup) {
  if (cond.all) return cond.all.every((c) => evaluate(c, lookup));
  if (cond.any) return cond.any.some((c) => evaluate(c, lookup));
  if (cond.not) return !evaluate(cond.not, lookup);

  const value = lookup(cond.field);
  if ('is' in cond) return value === cond.is;
  if ('in' in cond) return cond.in.includes(value);
  if ('gt' in cond) return value > cond.gt;
  if ('gte' in cond) return value >= cond.gte;
  if ('lt' in cond) return value < cond.lt;
  if ('lte' in cond) return value <= cond.lte;
  if ('not_empty' in cond) return !isEmpty(value);
  throw new Error(`unknown operator in condition ${JSON.stringify(cond)}`);
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Computes the effective option values: the input for visible and enabled fields,
 * the default otherwise. Dependencies are resolved recursively (validate rules out cycles).
 * @returns {{ values: object, active: Set<string> }}
 */
export function resolveOptions(template, input, server) {
  const options = (template.options ?? []).filter((o) => o.type !== 'info');
  const byKey = new Map(options.map((o) => [o.key, o]));
  const resolved = new Map();
  const active = new Set();

  const lookup = (field) => {
    if (field.startsWith('server.')) return server[field.slice(7)];
    if (field.startsWith('bundle.')) throw new Error('bundle.* is not available in option conditions');
    return valueOf(field);
  };
  const valueOf = (key) => {
    if (resolved.has(key)) return resolved.get(key);
    const opt = byKey.get(key);
    const isActive = (!opt.show_when || evaluate(opt.show_when, lookup)) && (!opt.enable_when || evaluate(opt.enable_when, lookup));
    if (isActive) active.add(key);
    const value = isActive && key in input ? input[key] : opt.default;
    resolved.set(key, value);
    return value;
  };

  for (const o of options) valueOf(o.key);
  return { values: Object.fromEntries(resolved), active };
}

const PLACEHOLDER = /\{\{\s*([a-z_]+(?:\.[A-Za-z0-9_]+)+)\s*\}\}/g;
const ONLY_PLACEHOLDER = /^\{\{\s*([a-z_]+(?:\.[A-Za-z0-9_]+)+)\s*\}\}$/;

function lookupPath(ctx, expr) {
  const value = expr.split('.').reduce((node, seg) => (node == null ? undefined : node[seg]), ctx);
  if (value === undefined) throw new Error(`placeholder {{ ${expr} }} has no value`);
  return value;
}

/**
 * Replaces placeholders. If a string consists of exactly one placeholder, the value keeps
 * its type (number, boolean, list); otherwise it is inserted as text.
 */
export function render(value, ctx) {
  if (typeof value === 'string') {
    const only = value.match(ONLY_PLACEHOLDER);
    if (only) return lookupPath(ctx, only[1]);
    return value.replace(PLACEHOLDER, (_, expr) => String(lookupPath(ctx, expr)));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [render(k, ctx), render(v, ctx)]));
  }
  return value;
}
