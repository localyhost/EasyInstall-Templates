#!/usr/bin/env node
// Checks all Modrinth/Spigot IDs against the real APIs (runs weekly in CI).
import { fileURLToPath } from 'node:url';
import { loadTemplates } from './lib/load.mjs';
import { getJson } from './lib/sources.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Returns [{ label, match }] for the main plugin and all bundles of a template. */
const matchesOf = (t) => [
  { label: 'match', match: t.data.match },
  ...(t.data.bundle ?? []).map((b) => ({ label: `bundle (${b.id})`, match: b.match })),
];

async function checkModrinth(id, report) {
  try {
    const project = await getJson(`https://api.modrinth.com/v2/project/${id}`);
    if (project.id !== id) report.error(`Modrinth ${id}: API returns ID ${project.id} – slug used instead of the ID?`);
    else report.ok(`Modrinth ${id} = ${project.title} (${project.loaders.join(', ')})`);
  } catch (e) {
    report.error(`Modrinth ${id}: ${e.message.includes('404') ? 'project does not exist' : e.message}`);
  }
}

async function checkSpigot(id, report) {
  try {
    const resource = await getJson(`https://api.spiget.org/v2/resources/${id}`);
    report.ok(`Spigot ${id} = ${resource.name}`);
    if (resource.premium) report.warn(`Spigot ${id}: premium plugin, cannot be downloaded automatically`);
    if (resource.external) report.warn(`Spigot ${id}: external download, Spiget cannot serve the file`);
  } catch (e) {
    report.error(`Spigot ${id}: ${e.message.includes('404') ? 'resource does not exist' : e.message}`);
  }
}

let errors = 0;
let warnings = 0;
const report = {
  ok: (m) => console.log(`    ✓ ${m}`),
  warn: (m) => (warnings++, console.log(`    ⚠ ${m}`)),
  error: (m) => (errors++, console.log(`    ✗ ${m}`)),
};
for (const t of await loadTemplates(root)) {
  if (t.isStarter || !t.data) continue;
  console.log(t.relFile);
  for (const { label, match } of matchesOf(t)) {
    if (label !== 'match') console.log(`  ${label}`);
    if (match.modrinth) await checkModrinth(match.modrinth.project_id, report);
    if (match.spigot) await checkSpigot(match.spigot.resource_id, report);
  }
}
console.log(`\n${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
