import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateRepo } from '../tools/lib/validate.mjs';
import { buildIndex, serializeIndex } from '../tools/lib/index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'test', 'fixtures');
const NOW = new Date('2026-11-16T12:00:00Z');

// Fixture folder → expected part of the error (or warning) message.
const EXPECT_ERROR = {
  'schema-unknown-step-field': 'steps[0] (restart).foo: field is not allowed here',
  'schema-slider-protocol': 'options[0] (a).protocol: field is not allowed here',
  '01-bad-folder': 'is not a valid template ID',
  '01-missing-header': 'first line must be',
  '02-duplicate-key': 'key "a" is duplicated',
  '02-missing-group': 'group "nope" does not exist',
  '03-min-greater-max': 'min (10) is greater than max (1)',
  '03-default-out-of-range': 'default 99 is above max 10',
  '04-default-not-in-options': 'default "c" is not one of the choices',
  '05-invalid-pattern': 'pattern is not a valid regular expression',
  '06-unknown-condition-field': 'field "ghost" does not exist',
  '06-condition-on-info': 'field "hint" is of type info',
  '06-unknown-bundle': 'bundle "ghost" does not exist',
  '07-cycle': 'cycle in show_when/enable_when: a → b → a',
  '08-unknown-placeholder': 'option "ghost" does not exist',
  '08-allocation-bad-field': '"host" is not a field of an allocation',
  '08-subfield-on-non-allocation': 'only allocation options have sub-fields',
  '08-logic-in-placeholder': 'no logic allowed',
  '09-allocate-non-allocation': 'option "a" is not an allocation',
  '10-allocation-not-released': 'is never released in uninstall',
  '11-bad-install-target': 'target "floodgate" is neither main, bundle nor a bundle ID',
  '12-file-from-missing': 'file "files/missing.yml" does not exist',
  '12-absolute-path': 'path must be relative to the server folder',
  '12-dotdot-in-variant': 'path "../outside" contains ..',
  '14-duplicate-ids': 'modrinth ID BBBBBBBB is already used by template "one"',
};

const EXPECT_WARNING = {
  '13-delete-without-ask': 'deletes plugin data (plugins/Example) without ask: true',
  '15-stale': 'is older than 180 days',
};

const collect = (results, field) => results.flatMap((r) => r[field]);

for (const [fixture, expected] of Object.entries(EXPECT_ERROR)) {
  test(`error: ${fixture}`, async () => {
    const errors = collect(await validateRepo(join(FIXTURES, fixture), { now: NOW }), 'errors');
    assert.ok(
      errors.some((e) => e.includes(expected)),
      `expected "${expected}", got:\n  ${errors.join('\n  ') || '(no errors)'}`,
    );
  });
}

for (const [fixture, expected] of Object.entries(EXPECT_WARNING)) {
  test(`warning: ${fixture}`, async () => {
    const results = await validateRepo(join(FIXTURES, fixture), { now: NOW });
    assert.deepEqual(collect(results, 'errors'), [], 'warnings must not be errors');
    const warnings = collect(results, 'warnings');
    assert.ok(warnings.some((w) => w.includes(expected)), `expected "${expected}", got: ${warnings.join(' | ')}`);
  });
}

test('every fixture has an expectation', async () => {
  const dirs = (await readdir(FIXTURES)).sort();
  assert.deepEqual(dirs, Object.keys({ ...EXPECT_ERROR, ...EXPECT_WARNING }).sort());
});

test('the real templates are valid', async () => {
  const results = await validateRepo(ROOT, { now: NOW });
  for (const r of results) assert.deepEqual(r.errors, [], `${r.relFile}:\n  ${r.errors.join('\n  ')}`);
});

test('the index is deterministic and up to date', async () => {
  const first = serializeIndex(buildIndex(await validateRepo(ROOT)));
  const second = serializeIndex(buildIndex(await validateRepo(ROOT)));
  assert.equal(first, second);
  const onDisk = await readFile(join(ROOT, 'dist', 'index.json'), 'utf8');
  assert.equal(onDisk, first, 'dist/index.json is outdated – run "npm run build"');
});

test('the index only contains enabled templates and no starters', async () => {
  const index = buildIndex(await validateRepo(ROOT));
  const ids = index.templates.map((t) => t.id);
  assert.ok(!ids.includes('_starter'));
  assert.ok(!ids.includes('geyser'), 'geyser is disabled');
  assert.equal(index.modrinth.Vebnzrzj, 'luckperms');
  assert.equal(index.spigot['28140'], 'luckperms');
});
