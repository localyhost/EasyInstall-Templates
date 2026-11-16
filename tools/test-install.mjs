#!/usr/bin/env node
// Installs templates on a real Paper server to check that they work.
//   npm run test-install                     → all enabled templates
//   npm run test-install -- geyser luckperms → only these
//   --force                                  → also test disabled templates
//   --json <file>                            → write results as JSON (used by CI)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateRepo } from './lib/validate.mjs';
import { runTemplate, SkipError } from './lib/runner.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values: args, positionals: ids } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'string' },
    force: { type: 'boolean', default: false },
    out: { type: 'string', default: join(root, 'test-results') },
  },
});

const results = await validateRepo(root);
const unknown = ids.filter((id) => !results.some((r) => r.id === id));
if (unknown.length) {
  console.error(`✗ unknown templates: ${unknown.join(', ')}`);
  process.exit(1);
}
const selected = results.filter((r) => !r.isStarter && (ids.length ? ids.includes(r.id) : r.tpl.data?.meta?.enabled));

async function testOne(r) {
  const logFile = join(args.out, `${r.id}.log`);
  writeFileSync(logFile, '');
  const entry = { id: r.id, path: r.relFile, log: logFile };
  if (r.errors.length) return { ...entry, status: 'failed', reason: `template is invalid:\n${r.errors.join('\n')}` };
  if (!r.tpl.data.meta.enabled && !args.force) {
    return { ...entry, status: 'skipped', reason: 'template is disabled (meta.enabled: false); use --force to test it anyway' };
  }
  const workDir = join(args.out, 'work', r.id);
  rmSync(workDir, { recursive: true, force: true });
  try {
    const info = await runTemplate({ tpl: r.tpl, workDir, cacheDir: join(args.out, 'cache'), logFile });
    return { ...entry, status: 'passed', ...info };
  } catch (e) {
    return { ...entry, status: e instanceof SkipError ? 'skipped' : 'failed', reason: e.message };
  }
}

mkdirSync(args.out, { recursive: true });
const report = [];
for (const r of selected) {
  console.log(`▶ ${r.id}`);
  const started = Date.now();
  const entry = await testOne(r);
  entry.seconds = Math.round((Date.now() - started) / 1000);
  report.push(entry);
  const icon = { passed: '✓', skipped: '⚠', failed: '✗' }[entry.status];
  const paper = entry.mcVersion ? ` – Paper ${entry.mcVersion}` : '';
  const reason = entry.reason ? `\n    ${entry.reason.replace(/\n/g, '\n    ')}` : '';
  console.log(`${icon} ${r.id} (${entry.seconds}s)${paper}${reason}`);
}

if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`);
const count = (status) => report.filter((e) => e.status === status).length;
console.log(`\n${report.length} templates tested: ${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped`);
process.exit(count('failed') ? 1 : 0);
