// Logic checks that a JSON Schema cannot express.
// Every check receives a template and reports via report.error / report.warn.
import { FILES_DIR, SCHEMA_HEADER } from './load.mjs';

export const SERVER_FIELDS = ['software', 'mc_version', 'memory', 'ip', 'port'];
export const ALLOCATION_FIELDS = ['id', 'ip', 'alias', 'port', 'protocol', 'created'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const STALE_DAYS = 180;
const PLACEHOLDER = /\{\{(.*?)\}\}/g;
const PLUGIN_DATA_DIR = /^plugins\/[^/]+\/?$/;

const optionsOf = (t) => t.options ?? [];
const bundleIds = (t) => new Set((t.bundle ?? []).map((b) => b.id));
const allSteps = (t) => [
  ...(t.steps ?? []).map((s, i) => ({ step: s, where: `steps[${i}]` })),
  ...(t.uninstall ?? []).map((s, i) => ({ step: s, where: `uninstall[${i}]` })),
];

/** Collects all conditions of a template together with their location. */
function collectConditions(t) {
  const found = [];
  optionsOf(t).forEach((o) => {
    if (o.show_when) found.push({ cond: o.show_when, where: `options (${o.key}).show_when` });
    if (o.enable_when) found.push({ cond: o.enable_when, where: `options (${o.key}).enable_when` });
  });
  (t.bundle ?? []).forEach((b) => b.when && found.push({ cond: b.when, where: `bundle (${b.id}).when` }));
  (t.variants ?? []).forEach((v, i) => found.push({ cond: v.when, where: `variants[${i}].when` }));
  allSteps(t).forEach(({ step, where }) => step.when && found.push({ cond: step.when, where: `${where}.when` }));
  return found;
}

/** Returns all field values of a (nested) condition. */
export function conditionFields(cond) {
  if (!cond || typeof cond !== 'object') return [];
  if (cond.field) return [cond.field];
  if (cond.all) return cond.all.flatMap(conditionFields);
  if (cond.any) return cond.any.flatMap(conditionFields);
  if (cond.not) return conditionFields(cond.not);
  return [];
}

/** Calls fn(string, path) for every string in value, including object keys. */
function walkStrings(value, path, fn) {
  if (typeof value === 'string') fn(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, fn));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      fn(k, `${path} (key)`);
      walkStrings(v, `${path}.${k}`, fn);
    }
  }
}

// ---------------------------------------------------------------------------
// Individual checks (numbers match the list in the README)

/** 1: the folder name is a valid template ID; the file starts with the schema comment. */
function checkFolder(tpl, report) {
  if (!tpl.isStarter && !ID_PATTERN.test(tpl.id)) {
    report.error(`folder name "${tpl.id}" is not a valid template ID (allowed: a-z, 0-9, -)`);
  }
  if (!tpl.raw.startsWith(SCHEMA_HEADER)) {
    report.error(`first line must be: ${SCHEMA_HEADER}`);
  }
}

/** 2: option keys are unique and their group exists. */
function checkKeysAndGroups(t, report) {
  const groups = new Set();
  for (const g of t.groups ?? []) {
    if (groups.has(g.id)) report.error(`groups: ID "${g.id}" is duplicated`);
    groups.add(g.id);
  }
  const keys = new Set();
  for (const o of optionsOf(t)) {
    if (keys.has(o.key)) report.error(`options: key "${o.key}" is duplicated`);
    keys.add(o.key);
    if (o.group && !groups.has(o.group)) report.error(`options (${o.key}): group "${o.group}" does not exist`);
  }
  const bundles = new Set();
  for (const b of t.bundle ?? []) {
    if (b.id === 'main' || b.id === 'bundle') report.error(`bundle: ID "${b.id}" is reserved`);
    if (bundles.has(b.id)) report.error(`bundle: ID "${b.id}" is duplicated`);
    bundles.add(b.id);
  }
}

/** 3: min ≤ max and default within range. */
function checkRanges(t, report) {
  for (const o of optionsOf(t)) {
    const where = `options (${o.key})`;
    const lo = o.min ?? o.min_length;
    const hi = o.max ?? o.max_length;
    if (lo !== undefined && hi !== undefined && lo > hi) report.error(`${where}: min (${lo}) is greater than max (${hi})`);

    if (typeof o.default === 'number') {
      if (o.min !== undefined && o.default < o.min) report.error(`${where}: default ${o.default} is below min ${o.min}`);
      if (o.max !== undefined && o.default > o.max) report.error(`${where}: default ${o.default} is above max ${o.max}`);
    }
    if (typeof o.default === 'string') {
      if (o.min_length !== undefined && o.default.length < o.min_length) report.error(`${where}: default is shorter than min_length ${o.min_length}`);
      if (o.max_length !== undefined && o.default.length > o.max_length) report.error(`${where}: default is longer than max_length ${o.max_length}`);
    }
    if (Array.isArray(o.default)) {
      const n = o.default.length;
      if (o.type === 'multiselect' && o.min !== undefined && n < o.min) report.error(`${where}: default has fewer than ${o.min} items`);
      if (o.type === 'multiselect' && o.max !== undefined && n > o.max) report.error(`${where}: default has more than ${o.max} items`);
      if (o.max_items !== undefined && n > o.max_items) report.error(`${where}: default has more than ${o.max_items} items`);
      if (o.type === 'list') {
        const want = o.item_type ?? 'string';
        if (o.default.some((v) => typeof v !== want)) report.error(`${where}: default contains values that are not of type ${want}`);
      }
    }
    if (o.type === 'world' && o.default !== undefined && Array.isArray(o.default) !== Boolean(o.allow_multiple)) {
      report.error(`${where}: default must be ${o.allow_multiple ? 'a list' : 'a single world name'}`);
    }
  }
}

/** 4: the default of select/radio/multiselect is one of its options; option values are unique. */
function checkChoices(t, report) {
  for (const o of optionsOf(t)) {
    if (!['select', 'radio', 'multiselect'].includes(o.type)) continue;
    const values = o.options.map((c) => c.value);
    const dup = values.find((v, i) => values.indexOf(v) !== i);
    if (dup !== undefined) report.error(`options (${o.key}): value ${JSON.stringify(dup)} is duplicated`);
    if (o.default === undefined) continue;
    for (const d of o.type === 'multiselect' ? o.default : [o.default]) {
      if (!values.includes(d)) {
        report.error(`options (${o.key}): default ${JSON.stringify(d)} is not one of the choices (${values.map((v) => JSON.stringify(v)).join(', ')})`);
      }
    }
  }
}

/** 5: pattern is a valid regular expression and matches the default. */
function checkPatterns(t, report) {
  for (const o of optionsOf(t)) {
    if (o.pattern === undefined) continue;
    let re;
    try {
      re = new RegExp(o.pattern, 'u');
    } catch (e) {
      report.error(`options (${o.key}): pattern is not a valid regular expression (${e.message})`);
      continue;
    }
    if (typeof o.default === 'string' && o.default !== '' && !re.test(o.default)) {
      report.error(`options (${o.key}): default does not match pattern`);
    }
  }
}

/** 6: conditions refer to existing fields. */
function checkConditionRefs(t, report) {
  const byKey = new Map(optionsOf(t).map((o) => [o.key, o]));
  const bundles = bundleIds(t);
  for (const { cond, where } of collectConditions(t)) {
    for (const field of conditionFields(cond)) {
      const problem = conditionFieldProblem(field, byKey, bundles);
      if (problem) report.error(`${where}: ${problem}`);
    }
  }
}

function conditionFieldProblem(field, byKey, bundles) {
  if (field.startsWith('server.')) {
    return SERVER_FIELDS.includes(field.slice(7)) ? null : `unknown server field "${field}"`;
  }
  if (field.startsWith('bundle.')) {
    return bundles.has(field.slice(7)) ? null : `bundle "${field.slice(7)}" does not exist`;
  }
  const opt = byKey.get(field);
  if (!opt) return `field "${field}" does not exist`;
  if (opt.type === 'info') return `field "${field}" is of type info and has no value`;
  return null;
}

/** 7: no cycles in show_when/enable_when. */
function checkCycles(t, report) {
  const deps = new Map();
  for (const o of optionsOf(t)) {
    const fields = [...conditionFields(o.show_when), ...conditionFields(o.enable_when)];
    deps.set(o.key, [...new Set(fields.filter((f) => !f.includes('.')))]);
  }
  const state = new Map(); // undefined = new, 1 = in progress, 2 = done
  const reported = new Set();
  const visit = (key, stack) => {
    if (state.get(key) === 2 || !deps.has(key)) return;
    if (state.get(key) === 1) {
      const cycle = [...stack.slice(stack.indexOf(key)), key];
      const id = cycle.slice(0, -1).sort().join(',');
      if (!reported.has(id)) {
        reported.add(id);
        report.error(`cycle in show_when/enable_when: ${cycle.join(' → ')}`);
      }
      return;
    }
    state.set(key, 1);
    for (const next of deps.get(key)) visit(next, [...stack, key]);
    state.set(key, 2);
  };
  for (const key of deps.keys()) visit(key, []);
}

/** Names that script steps set via set("name", …). */
function scriptNames(t) {
  const names = new Set();
  for (const { step } of allSteps(t)) {
    if (step.action !== 'script') continue;
    for (const m of step.code.matchAll(/\bset\(\s*["']([A-Za-z0-9_]+)["']/g)) names.add(m[1]);
  }
  return names;
}

/** 8: placeholders refer to existing values. */
function checkPlaceholders(t, report) {
  const byKey = new Map(optionsOf(t).map((o) => [o.key, o]));
  const scripts = scriptNames(t);
  for (const { step, where } of allSteps(t)) {
    walkStrings(step, where, (str, path) => {
      for (const m of str.matchAll(PLACEHOLDER)) {
        const problem = placeholderProblem(m[1].trim(), byKey, scripts);
        if (problem) report.error(`${path}: {{${m[1]}}} – ${problem}`);
      }
    });
  }
}

function placeholderProblem(expr, byKey, scripts) {
  if (!/^[a-z_]+(\.[A-Za-z0-9_]+)+$/.test(expr)) return 'invalid placeholder (no logic allowed, only e.g. options.key)';
  const [root, name, field, ...rest] = expr.split('.');
  if (rest.length) return 'nested too deeply';
  if (root === 'server') return !field && SERVER_FIELDS.includes(name) ? null : `unknown server field "${name}"`;
  if (root === 'script') return !field && scripts.has(name) ? null : `no script step sets "${name}" via set()`;
  if (root !== 'options') return `unknown scope "${root}" (allowed: options, server, script)`;
  const opt = byKey.get(name);
  if (!opt) return `option "${name}" does not exist`;
  if (opt.type === 'info') return `option "${name}" is of type info and has no value`;
  if (opt.type === 'allocation') {
    if (!field) return `an allocation needs a field, e.g. options.${name}.port`;
    return ALLOCATION_FIELDS.includes(field) ? null : `"${field}" is not a field of an allocation (${ALLOCATION_FIELDS.join(', ')})`;
  }
  return field ? `only allocation options have sub-fields ("${name}" is ${opt.type})` : null;
}

/** 9 + 10: allocate/release match allocation options; every allocation is allocated and released. */
function checkAllocations(t, report) {
  const byKey = new Map(optionsOf(t).map((o) => [o.key, o]));
  const allocated = new Set();
  const released = new Set();
  const scan = (steps, section) => (steps ?? []).forEach((s, i) => {
    if (s.action !== 'allocate' && s.action !== 'release') return;
    const opt = byKey.get(s.option);
    if (!opt) report.error(`${section}[${i}] (${s.action}): option "${s.option}" does not exist`);
    else if (opt.type !== 'allocation') report.error(`${section}[${i}] (${s.action}): option "${s.option}" is not an allocation`);
    if (section === 'steps' && s.action === 'allocate') allocated.add(s.option);
    if (section === 'uninstall' && s.action === 'release') released.add(s.option);
  });
  scan(t.steps, 'steps');
  scan(t.uninstall, 'uninstall');
  for (const o of optionsOf(t).filter((x) => x.type === 'allocation')) {
    if (!allocated.has(o.key)) report.error(`allocation "${o.key}" is never allocated in steps`);
    if (!released.has(o.key)) report.error(`allocation "${o.key}" is never released in uninstall`);
  }
}

/** 11: install.target is main, bundle or a bundle ID. */
function checkInstallTargets(t, report) {
  const bundles = bundleIds(t);
  for (const { step, where } of allSteps(t)) {
    if (step.action !== 'install') continue;
    if (step.target === 'bundle' && bundles.size === 0) report.error(`${where}: target "bundle", but the template has no bundle`);
    if (!['main', 'bundle'].includes(step.target) && !bundles.has(step.target)) {
      report.error(`${where}: target "${step.target}" is neither main, bundle nor a bundle ID`);
    }
  }
}

function stepPaths(step) {
  const paths = [];
  for (const field of ['wait_for', 'file', 'to', 'file_exists']) if (step[field]) paths.push([field, step[field]]);
  (step.paths ?? []).forEach((p, i) => paths.push([`paths[${i}]`, p]));
  return paths;
}

export function pathProblem(path) {
  if (/^([/\\]|[A-Za-z]:)/.test(path)) return 'is absolute';
  if (path.split(/[/\\]/).includes('..')) return 'contains ..';
  return null;
}

/** 12: paths are relative without ..; file.from exists below files/. */
function checkPaths(t, report, tpl) {
  for (const { step, where } of allSteps(t)) {
    for (const [field, path] of stepPaths(step)) {
      const p = pathProblem(path);
      if (p) report.error(`${where}.${field}: path "${path}" ${p}`);
    }
    if (step.action === 'file') {
      const p = pathProblem(step.from);
      if (p) report.error(`${where}.from: path "${step.from}" ${p}`);
      else if (!tpl.files.includes(step.from)) report.error(`${where}.from: file "${FILES_DIR}/${step.from}" does not exist in the template folder`);
    }
  }
  (t.variants ?? []).forEach((v, i) => {
    for (const path of Object.entries(v.replace).flat()) {
      const p = pathProblem(path);
      if (p) report.error(`variants[${i}].replace: path "${path}" ${p}`);
    }
  });
}

/** 13: deleting plugin data folders on uninstall should ask the customer. */
function checkDeleteAsk(t, report) {
  (t.uninstall ?? []).forEach((s, i) => {
    if (s.action !== 'delete' || s.ask) return;
    const dataDirs = s.paths.filter((p) => PLUGIN_DATA_DIR.test(p));
    if (dataDirs.length) report.warn(`uninstall[${i}]: deletes plugin data (${dataDirs.join(', ')}) without ask: true`);
  });
}

/** 15: meta.updated is not older than 180 days. */
function checkStale(t, report, _tpl, now) {
  if (!t.meta.updated) return;
  const age = (now - new Date(`${t.meta.updated}T00:00:00Z`)) / 86_400_000;
  if (age > STALE_DAYS) report.warn(`meta.updated (${t.meta.updated}) is older than ${STALE_DAYS} days – please re-test`);
}

const TEMPLATE_CHECKS = [
  checkKeysAndGroups,
  checkRanges,
  checkChoices,
  checkPatterns,
  checkConditionRefs,
  checkCycles,
  checkPlaceholders,
  checkAllocations,
  checkInstallTargets,
  checkPaths,
  checkDeleteAsk,
  checkStale,
];

/** Runs all single-template checks on a schema-valid template. */
export function runTemplateChecks(tpl, report, now) {
  checkFolder(tpl, report);
  for (const check of TEMPLATE_CHECKS) check(tpl.data, report, tpl, now);
}

/** 14: checks across all templates. Returns a map relFile → errors. */
export function runCrossChecks(templates) {
  const errors = new Map();
  const add = (tpl, msg) => errors.set(tpl.relFile, [...(errors.get(tpl.relFile) ?? []), msg]);
  const seen = { modrinth: new Map(), spigot: new Map() };
  for (const tpl of templates) {
    if (tpl.isStarter || !tpl.data?.match) continue;
    const ids = { modrinth: tpl.data.match.modrinth?.project_id, spigot: tpl.data.match.spigot?.resource_id };
    for (const [source, id] of Object.entries(ids)) {
      if (id === undefined) continue;
      const other = seen[source].get(id);
      if (other) add(tpl, `${source} ID ${id} is already used by template "${other}"`);
      else seen[source].set(id, tpl.id);
    }
  }
  return errors;
}
