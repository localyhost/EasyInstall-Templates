#!/usr/bin/env node
// Writes dist/index.json. Aborts if any template has errors.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateRepo } from './lib/validate.mjs';
import { buildIndex, serializeIndex } from './lib/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const results = await validateRepo(root);

const broken = results.filter((r) => r.errors.length);
if (broken.length) {
  console.error(`✗ Index not built: ${broken.map((r) => r.relFile).join(', ')} has errors. Run "npm run validate" first.`);
  process.exit(1);
}

const index = buildIndex(results);
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'index.json'), serializeIndex(index));
console.log(`✓ dist/index.json written (${index.templates.length} templates)`);
