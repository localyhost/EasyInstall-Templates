// Writes values into config files (action "config"). Comments in YAML are preserved.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import YAML from 'yaml';

const FORMAT_BY_EXT = { '.yml': 'yaml', '.yaml': 'yaml', '.json': 'json', '.properties': 'properties', '.toml': 'toml', '.conf': 'hocon', '.env': 'env' };

export const detectFormat = (file) => FORMAT_BY_EXT[extname(file).toLowerCase()];

const writers = {
  yaml(text, values) {
    const doc = YAML.parseDocument(text);
    if (doc.contents === null) doc.contents = doc.createNode({});
    for (const [key, value] of Object.entries(values)) doc.setIn(key.split('.'), value);
    return doc.toString();
  },
  json(text, values) {
    const data = text.trim() ? JSON.parse(text) : {};
    for (const [key, value] of Object.entries(values)) {
      const parts = key.split('.');
      const last = parts.pop();
      const parent = parts.reduce((node, p) => (node[p] ??= {}), data);
      parent[last] = value;
    }
    return `${JSON.stringify(data, null, 2)}\n`;
  },
  properties: (text, values) => writeKeyValue(text, values, /^\s*([^#!\s=:][^=:]*?)\s*[=:]/),
  env: (text, values) => writeKeyValue(text, values, /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/),
};

/** Replaces existing key=value lines and appends new keys. */
function writeKeyValue(text, values, keyPattern) {
  const pending = new Map(Object.entries(values).map(([k, v]) => [k, String(v)]));
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  const out = lines.map((line) => {
    const key = line.match(keyPattern)?.[1];
    if (key === undefined || !pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });
  for (const [k, v] of pending) out.push(`${k}=${v}`);
  return `${out.join('\n')}\n`;
}

/** Applies a config step to a file. */
export function applyConfig(path, { format, mode = 'merge', values }) {
  const fmt = format ?? detectFormat(path);
  const writer = writers[fmt];
  if (!writer) throw new Error(`format "${fmt ?? 'unknown'}" is not supported by the install test`);

  const exists = existsSync(path);
  if (mode === 'create_if_missing' && exists) return;
  const current = exists && mode === 'merge' ? readFileSync(path, 'utf8') : '';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, writer(current, values));
}

/** Reads a value by dot path (for the script API config.get). */
export function readConfigValue(path, key) {
  const fmt = detectFormat(path);
  const text = readFileSync(path, 'utf8');
  if (fmt === 'yaml' || fmt === 'json') {
    const data = fmt === 'yaml' ? YAML.parse(text) : JSON.parse(text);
    return key.split('.').reduce((node, p) => (node == null ? undefined : node[p]), data);
  }
  const line = text.split('\n').find((l) => l.trim().startsWith(`${key}=`));
  return line?.slice(line.indexOf('=') + 1);
}
