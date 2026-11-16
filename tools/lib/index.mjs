// Builds the deterministic index (dist/index.json) from validated templates.
import { createHash } from 'node:crypto';
import { FILES_DIR } from './load.mjs';

const sortObject = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'en')));

/** Builds the index object from validateRepo results (enabled templates only). */
export function buildIndex(results) {
  const entries = results
    .filter((r) => !r.isStarter && r.errors.length === 0 && r.tpl.data.meta.enabled)
    .map((r) => r.tpl)
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const modrinth = {};
  const spigot = {};
  for (const tpl of entries) {
    const { match } = tpl.data;
    if (match.modrinth) modrinth[match.modrinth.project_id] = tpl.id;
    if (match.spigot) spigot[String(match.spigot.resource_id)] = tpl.id;
  }

  return {
    schema: 1,
    templates: entries.map((tpl) => ({
      id: tpl.id,
      path: tpl.relFile,
      sha256: createHash('sha256').update(tpl.raw, 'utf8').digest('hex'),
      tested_with: tpl.data.meta.tested_with,
      software: tpl.data.requirements?.software ?? [],
      mc: tpl.data.requirements?.mc ?? null,
      files: tpl.files.map((f) => `${FILES_DIR}/${f}`),
    })),
    modrinth: sortObject(modrinth),
    spigot: sortObject(spigot),
  };
}

/** Stable serialization: 2 spaces, LF, trailing newline. */
export const serializeIndex = (index) => `${JSON.stringify(index, null, 2)}\n`;
