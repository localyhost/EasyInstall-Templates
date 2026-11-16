import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, render, resolveOptions } from '../tools/lib/conditions.mjs';
import { applyConfig } from '../tools/lib/configfile.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const values = { a: true, n: 5, list: [], s: 'x' };
const lookup = (f) => values[f];

test('conditions: operators', () => {
  assert.equal(evaluate({ field: 'a', is: true }, lookup), true);
  assert.equal(evaluate({ field: 's', in: ['x', 'y'] }, lookup), true);
  assert.equal(evaluate({ field: 'n', gt: 4 }, lookup), true);
  assert.equal(evaluate({ field: 'n', lte: 4 }, lookup), false);
  assert.equal(evaluate({ field: 'list', not_empty: true }, lookup), false);
  assert.equal(evaluate({ all: [{ field: 'a', is: true }, { not: { field: 'n', lt: 1 } }] }, lookup), true);
  assert.equal(evaluate({ any: [{ field: 'a', is: false }, { field: 's', is: 'y' }] }, lookup), false);
});

test('hidden or disabled options fall back to their default', () => {
  const template = {
    options: [
      { key: 'on', type: 'switch', default: false },
      { key: 'text', type: 'text', default: 'd', show_when: { field: 'on', is: true } },
      { key: 'num', type: 'number', default: 1, enable_when: { field: 'text', is: 'custom' } },
    ],
  };
  const off = resolveOptions(template, { on: false, text: 'custom', num: 9 }, {});
  assert.deepEqual(off.values, { on: false, text: 'd', num: 1 });
  assert.deepEqual([...off.active], ['on']);

  const on = resolveOptions(template, { on: true, text: 'custom', num: 9 }, {});
  assert.deepEqual(on.values, { on: true, text: 'custom', num: 9 });
});

test('placeholders keep their type when they are the whole string', () => {
  const ctx = { options: { port: { port: 19132 }, flag: false, name: 'x' }, server: {}, script: {} };
  assert.equal(render('{{ options.port.port }}', ctx), 19132);
  assert.equal(render('{{options.flag}}', ctx), false);
  assert.equal(render('host:{{ options.port.port }}', ctx), 'host:19132');
  assert.deepEqual(render({ 'a.b': '{{ options.name }}' }, ctx), { 'a.b': 'x' });
  assert.throws(() => render('{{ options.missing }}', ctx), /has no value/);
});

test('config merge keeps comments and other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const yml = join(dir, 'config.yml');
  writeFileSync(yml, '# comment\nbedrock:\n  port: 19132 # inline\n  other: 1\n');
  applyConfig(yml, { values: { 'bedrock.port': 19133, 'motd.primary-motd': 'Hi' } });
  const text = readFileSync(yml, 'utf8');
  assert.match(text, /# comment/);
  assert.match(text, /port: 19133/);
  assert.match(text, /other: 1/);
  assert.match(text, /primary-motd: Hi/);

  const props = join(dir, 'a.properties');
  writeFileSync(props, '# c\nport=24454\nx=1\n');
  applyConfig(props, { values: { port: 25000, new_key: 'v' } });
  assert.equal(readFileSync(props, 'utf8'), '# c\nport=25000\nx=1\nnew_key=v\n');
});
