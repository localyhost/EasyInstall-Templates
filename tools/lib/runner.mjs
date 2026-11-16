// Runs a template on a real Paper server (reference flow for the install test).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { evaluate, render, resolveOptions } from './conditions.mjs';
import { applyConfig, readConfigValue } from './configfile.mjs';
import { pathProblem } from './checks.mjs';
import { downloadPaper, downloadPlugin, paperVersions, satisfies, supportedGameVersions } from './sources.mjs';
import { TestServer, freePort, parseTimeout } from './server.mjs';
import { FILES_DIR } from './load.mjs';

const FIRST_START_TIMEOUT = 300_000;
const WAIT_TIMEOUT = 120_000;
const SCRIPT_TIMEOUT = 10_000;
// Log lines that indicate a broken plugin.
const FAILURE_PATTERNS = [/Error occurred while enabling/, /Could not load plugin/, /Could not load '.*' in folder/, /Disabling .* due to/];

export class SkipError extends Error {}

/** Finds the newest Paper version that satisfies requirements.mc and has plugin builds. */
async function chooseMcVersion(template) {
  const supported = await supportedGameVersions(template.match);
  const range = template.requirements?.mc;
  const version = (await paperVersions()).find((v) => satisfies(v, range) && (!supported || supported.has(v)));
  if (!version) throw new Error(`no Paper version matches requirements.mc (${range ?? 'any'}) and the plugin builds`);
  return version;
}

/** Resolves a path inside the server folder; prevents escaping it. */
function inServer(serverDir, relPath) {
  const problem = pathProblem(relPath);
  if (problem) throw new Error(`path "${relPath}" ${problem}`);
  return join(serverDir, relPath);
}

/** Applies variants to all path fields of a step. */
function applyVariants(step, replacements) {
  const fix = (p) => replacements.reduce((acc, [from, to]) => acc.split(from).join(to), p);
  const out = { ...step };
  for (const f of ['wait_for', 'file', 'to', 'file_exists']) if (out[f]) out[f] = fix(out[f]);
  if (out.paths) out.paths = out.paths.map(fix);
  return out;
}

function prepareServerDir(serverDir, port) {
  mkdirSync(serverDir, { recursive: true });
  writeFileSync(join(serverDir, 'eula.txt'), 'eula=true\n');
  writeFileSync(join(serverDir, 'server.properties'), [
    `server-port=${port}`, 'online-mode=false', 'level-type=minecraft\\:flat', 'generate-structures=false',
    'view-distance=4', 'simulation-distance=4', 'spawn-protection=0', '',
  ].join('\n'));
}

export async function runTemplate({ tpl, workDir, cacheDir, logFile }) {
  const template = tpl.data;
  if (template.test?.skip) throw new SkipError(template.test.skip);
  const software = template.test?.software ?? 'paper';
  if (software !== 'paper') throw new SkipError(`the install test only supports paper (test.software: ${software})`);
  if (template.requirements?.software && !template.requirements.software.includes('paper')) {
    throw new SkipError('template does not support paper');
  }

  const mcVersion = await chooseMcVersion(template);
  const serverDir = join(workDir, 'server');
  const port = await freePort();
  prepareServerDir(serverDir, port);

  const jar = await downloadPaper(mcVersion, cacheDir);
  const server = new TestServer({ dir: serverDir, jar, logFile });
  const serverInfo = { software, mc_version: mcVersion, memory: server.memoryMb, ip: '0.0.0.0', port };
  const ctx = createContext(template, serverInfo);
  const state = { tpl, template, server, serverDir, ctx, installed: [], versions: {}, configs: [], mcVersion };

  try {
    await runSteps(state, template.steps, 'steps');
    await ensureRunning(server);
    checkLogForFailures(server.lines);
    await server.stop();
    // The plugin must not have thrown away our values on start (e.g. a wrong key path).
    verifyConfigs(state);
    await runSteps(state, template.uninstall ?? [], 'uninstall');
    for (const file of state.installed) rmSync(file, { force: true });
    await server.start();
    checkLogForFailures(server.lines);
  } finally {
    await server.stop();
  }
  return { mcVersion, versions: state.versions };
}

/** Option values, bundles and variants for the test run. */
function createContext(template, serverInfo) {
  const input = { ...(template.test?.options ?? {}) };
  for (const o of template.options ?? []) {
    if (o.type === 'allocation') {
      const port = o.prefer_port ?? 30000 + Math.floor(Math.random() * 1000);
      input[o.key] = { id: 1, ip: '0.0.0.0', alias: null, port, protocol: o.protocol, created: true };
    }
  }
  const { values: options, active } = resolveOptions(template, input, serverInfo);
  for (const o of template.options ?? []) {
    const empty = options[o.key] === undefined || options[o.key] === '';
    if (o.required && active.has(o.key) && empty) {
      throw new Error(`required field "${o.key}" has no value – add a test value under test.options`);
    }
  }

  let bundles = new Set();
  const lookup = (field) => {
    if (field.startsWith('server.')) return serverInfo[field.slice(7)];
    if (field.startsWith('bundle.')) return bundles.has(field.slice(7));
    return options[field];
  };
  bundles = new Set((template.bundle ?? []).filter((b) => !b.when || evaluate(b.when, lookup)).map((b) => b.id));
  const replacements = (template.variants ?? [])
    .filter((v) => evaluate(v.when, lookup))
    .flatMap((v) => Object.entries(v.replace));
  return { options, server: serverInfo, script: {}, bundles, lookup, replacements };
}

async function runSteps(state, steps, section) {
  for (const [i, raw] of steps.entries()) {
    if (raw.when && !evaluate(raw.when, state.ctx.lookup)) continue;
    const step = applyVariants(raw, state.ctx.replacements);
    const label = `${section}[${i}] (${step.name ?? step.action})`;
    state.server.note(`### ${label}`);
    try {
      await ACTIONS[step.action](step, state);
    } catch (e) {
      if (e instanceof SkipError) throw e;
      throw new Error(`${label}: ${e.message}`);
    }
  }
}

function checkLogForFailures(lines) {
  const bad = lines.filter((l) => FAILURE_PATTERNS.some((p) => p.test(l)));
  if (bad.length) throw new Error(`errors in the server log:\n${bad.slice(0, 5).join('\n')}`);
}

/** Plugins may normalize values (48 → "48.0"), so numbers are compared as numbers. */
function sameValue(actual, expected) {
  if (String(actual) === String(expected)) return true;
  return typeof expected === 'number' && actual !== null && actual !== '' && Number(actual) === expected;
}

function verifyConfigs(state) {
  for (const { file, values } of state.configs) {
    for (const [key, expected] of Object.entries(values)) {
      if (typeof expected === 'object') continue;
      const actual = readConfigValue(file, key);
      if (!sameValue(actual, expected)) {
        throw new Error(`${file.slice(state.serverDir.length + 1)}: "${key}" is ${JSON.stringify(actual)} after the restart, expected ${JSON.stringify(expected)} – wrong key path?`);
      }
    }
  }
}

async function ensureRunning(server) {
  if (!server.running) await server.start();
}

const placeholders = (state) => ({ options: state.ctx.options, server: state.ctx.server, script: state.ctx.script });

const ACTIONS = {
  async install(step, state) {
    const { template, ctx, serverDir } = state;
    const targets = step.target === 'main'
      ? [{ id: 'main', match: template.match }]
      : (template.bundle ?? []).filter((b) => ctx.bundles.has(b.id) && (step.target === 'bundle' || step.target === b.id));
    for (const target of targets) {
      const { file, version } = await downloadPlugin(target.match, state.mcVersion, join(serverDir, 'plugins'));
      state.installed.push(file);
      state.versions[target.id] = version;
    }
  },
  async first_start(step, state) {
    await state.server.stop();
    await state.server.start({ waitDone: false });
    await state.server.waitForFile(step.wait_for, parseTimeout(step.timeout, FIRST_START_TIMEOUT));
    await state.server.waitUntilDone(FIRST_START_TIMEOUT);
    await state.server.stop();
  },
  async config(step, state) {
    const values = render(step.values, placeholders(state));
    const file = inServer(state.serverDir, step.file);
    applyConfig(file, { ...step, values });
    if (!step.format || ['yaml', 'json', 'properties'].includes(step.format)) state.configs.push({ file, values });
  },
  async file(step, state) {
    const target = inServer(state.serverDir, render(step.to, placeholders(state)));
    if (existsSync(target) && !step.overwrite) return;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(state.tpl.dir, FILES_DIR, step.from), target);
  },
  async allocate() {},
  async release(step, state) {
    if (!state.ctx.options[step.option]?.created) throw new Error(`allocation "${step.option}" was not created by the panel`);
  },
  async command(step, state) {
    await ensureRunning(state.server);
    state.server.command(render(step.command, placeholders(state)));
  },
  async restart(_step, state) {
    await state.server.restart();
  },
  async reload(step, state) {
    if (!step.command) return state.server.restart();
    await ensureRunning(state.server);
    state.server.command(render(step.command, placeholders(state)));
  },
  wait: waitStep,
  verify: waitStep,
  async delete(step, state) {
    for (const p of step.paths) rmSync(inServer(state.serverDir, render(p, placeholders(state))), { recursive: true, force: true });
  },
  async script(step, state) {
    if (step.runtime !== 'js') throw new SkipError(`script runtime "${step.runtime}" is not supported by the install test`);
    await ensureRunning(state.server);
    vm.runInNewContext(step.code, createScriptApi(state), { timeout: parseTimeout(step.timeout, SCRIPT_TIMEOUT) });
  },
};

async function waitStep(step, state) {
  const timeout = parseTimeout(step.timeout, WAIT_TIMEOUT);
  if (step.log_contains) {
    await ensureRunning(state.server);
    await state.server.waitForLog(render(step.log_contains, placeholders(state)), timeout);
  }
  if (step.file_exists) await state.server.waitForFile(step.file_exists, timeout);
}

/**
 * The sandbox API from the spec (no network, no shell, server folder only).
 * node:vm is not a security boundary – fine for CI, a panel needs a real sandbox.
 */
function createScriptApi(state) {
  const path = (p) => inServer(state.serverDir, p);
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const log = (level) => (msg) => state.server.note(`[script ${level}] ${msg}`);
  return {
    files: {
      read: (p, { binary = false } = {}) => (binary ? readFileSync(path(p)) : readFileSync(path(p), 'utf8')),
      write: (p, data) => {
        mkdirSync(dirname(path(p)), { recursive: true });
        writeFileSync(path(p), data);
      },
      exists: (p) => existsSync(path(p)),
    },
    config: {
      get: (file, key) => readConfigValue(path(file), key),
      set: (file, key, value) => applyConfig(path(file), { values: { [key]: value } }),
    },
    console: { run: (cmd) => state.server.command(cmd) },
    servers: { linked: () => null },
    options: Object.freeze(copy(state.ctx.options)),
    server: Object.freeze(copy(state.ctx.server)),
    log: { info: log('info'), warn: log('warn'), error: log('error') },
    set: (name, value) => {
      state.ctx.script[name] = value;
    },
  };
}
