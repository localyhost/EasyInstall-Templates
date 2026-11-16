#!/usr/bin/env node
// Validates all templates. Exit code 1 on errors, 0 if there are only warnings.
import { fileURLToPath } from 'node:url';
import { validateRepo } from './lib/validate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const results = await validateRepo(root);

let errorCount = 0;
let warningCount = 0;
for (const r of results) {
  errorCount += r.errors.length;
  warningCount += r.warnings.length;
  const icon = r.errors.length ? '✗' : r.warnings.length ? '⚠' : '✓';
  console.log(`${icon} ${r.relFile}`);
  for (const e of r.errors) console.log(`    ✗ ${e}`);
  for (const w of r.warnings) console.log(`    ⚠ ${w}`);
}

const failed = results.filter((r) => r.errors.length).length;
console.log(
  `\n${results.length} templates checked: ${results.length - failed} valid, ${failed} with errors` +
    ` (${errorCount} errors, ${warningCount} warnings)`,
);
process.exit(errorCount ? 1 : 0);
