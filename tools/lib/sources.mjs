// Downloads for the install test: Paper (PaperMC Fill v3), Modrinth and Spiget.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const USER_AGENT = 'EasyInstall-Templates-CI (+https://github.com/localyhost/EasyInstall-Templates)';
const PAPER_API = 'https://fill.papermc.io/v3/projects/paper';
const MODRINTH_API = 'https://api.modrinth.com/v2';
const SPIGET_API = 'https://api.spiget.org/v2';
// Paper runs Bukkit/Spigot plugins, so all of these loaders are accepted.
const PAPER_COMPATIBLE = ['paper', 'spigot', 'bukkit', 'purpur'];

export async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function download(url, target, sha256) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (sha256 && createHash('sha256').update(data).digest('hex') !== sha256) throw new Error(`checksum mismatch: ${url}`);
  writeFileSync(target, data);
}

// --- Minecraft versions -----------------------------------------------------

const parseVersion = (v) => v.split('.').map(Number);
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Checks a version against a range like ">=1.20.5 <1.22". */
export function satisfies(version, range) {
  if (!range) return true;
  return range.trim().split(/\s+/).every((part) => {
    const [, op = '=', target] = part.match(/^(>=|<=|>|<|=)?(.+)$/);
    const c = compareVersions(version, target);
    return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[op];
  });
}

/** All stable Paper versions, newest first. */
export async function paperVersions() {
  const { versions } = await getJson(PAPER_API);
  return Object.values(versions).flat().filter((v) => !v.includes('-')).sort((a, b) => compareVersions(b, a));
}

/** Downloads the latest stable Paper build for a version (cached). */
export async function downloadPaper(version, cacheDir) {
  const build = await getJson(`${PAPER_API}/versions/${version}/builds/latest`);
  const file = build.downloads['server:default'];
  mkdirSync(cacheDir, { recursive: true });
  const target = join(cacheDir, file.name);
  if (!existsSync(target)) await download(file.url, target, file.checksums.sha256);
  return target;
}

// --- Plugins ------------------------------------------------------------------

/** Spigot only if preferred or if there is no Modrinth entry. */
export const pickSource = (match) => (match.spigot && (match.prefer === 'spigot' || !match.modrinth) ? 'spigot' : 'modrinth');

async function modrinthVersions(projectId) {
  const loaders = encodeURIComponent(JSON.stringify(PAPER_COMPATIBLE));
  const versions = await getJson(`${MODRINTH_API}/project/${projectId}/version?loaders=${loaders}`);
  if (!versions.length) throw new Error(`Modrinth project ${projectId} has no version for Paper/Spigot/Bukkit`);
  return versions;
}

/** Minecraft versions the plugin has builds for (according to its source). null = unknown. */
export async function supportedGameVersions(match) {
  if (pickSource(match) !== 'modrinth') return null;
  const versions = await modrinthVersions(match.modrinth.project_id);
  return new Set(versions.flatMap((v) => v.game_versions));
}

/** Downloads the matching plugin file into dir and returns { file, version }. */
export async function downloadPlugin(match, mcVersion, dir) {
  mkdirSync(dir, { recursive: true });
  if (pickSource(match) === 'spigot') return downloadSpigot(match.spigot.resource_id, dir);

  const versions = await modrinthVersions(match.modrinth.project_id);
  const version = versions.find((v) => v.game_versions.includes(mcVersion) && v.version_type === 'release')
    ?? versions.find((v) => v.game_versions.includes(mcVersion));
  if (!version) throw new Error(`no Modrinth version of ${match.modrinth.project_id} for Minecraft ${mcVersion}`);
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  const target = join(dir, file.filename);
  await download(file.url, target, null);
  return { file: target, version: version.version_number };
}

async function downloadSpigot(resourceId, dir) {
  const resource = await getJson(`${SPIGET_API}/resources/${resourceId}`);
  if (resource.premium) throw new Error(`Spigot resource ${resourceId} is a premium plugin`);
  if (resource.external) throw new Error(`Spigot resource ${resourceId} has an external download`);
  const target = join(dir, `spigot-${resourceId}.jar`);
  await download(`${SPIGET_API}/resources/${resourceId}/download`, target, null);
  if (readFileSync(target).subarray(0, 2).toString() !== 'PK') throw new Error(`Spigot download ${resourceId} is not a .jar`);
  const latest = await getJson(`${SPIGET_API}/resources/${resourceId}/versions/latest`).catch(() => ({}));
  return { file: target, version: latest.name ?? 'unknown' };
}
