// Finds and loads all templates below <root>/templates.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import YAML from 'yaml';

export const TEMPLATE_FILE = 'template.yaml';
export const FILES_DIR = 'files';
export const SCHEMA_HEADER = '# yaml-language-server: $schema=../../schema/template.schema.json';

/** Converts a path to forward slashes (stable across operating systems). */
export const toPosix = (p) => p.split(sep).join('/');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Lists all files below dir recursively, sorted, relative to base. */
export async function listFiles(dir, base = dir) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(full, base)));
    else if (entry.isFile()) result.push(toPosix(relative(base, full)));
  }
  return result.sort();
}

/**
 * Loads all templates. Each result holds the raw text and the parsed data;
 * YAML syntax errors end up in parseError instead of throwing.
 */
export async function loadTemplates(root) {
  const templatesDir = join(root, 'templates');
  const dirs = (await readdir(templatesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const templates = [];
  for (const id of dirs) {
    const dir = join(templatesDir, id);
    const file = join(dir, TEMPLATE_FILE);
    const relFile = toPosix(relative(root, file));
    const isStarter = id.startsWith('_');
    if (!(await exists(file))) {
      templates.push({ id, dir, file, relFile, isStarter, missing: true });
      continue;
    }
    const raw = await readFile(file, 'utf8');
    const doc = YAML.parseDocument(raw, { prettyErrors: true });
    const parseError = doc.errors.length ? doc.errors.map((e) => e.message).join('\n') : null;
    templates.push({
      id,
      dir,
      file,
      relFile,
      isStarter,
      raw,
      data: parseError ? undefined : doc.toJS(),
      parseError,
      files: await listFiles(join(dir, FILES_DIR)),
    });
  }
  return templates;
}
