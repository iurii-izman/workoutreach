import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { isInside } from '../../scripts/lib/repo-files.mjs';

test('repository boundary checks are portable across host path semantics', () => {
  const root = resolve('synthetic-repository-root');

  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, join(root, 'src', 'index.mjs')), true);
  assert.equal(isInside(root, resolve(root, '..', 'outside.mjs')), false);
});

test('greenfield guard passes the complete working tree', () => {
  const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
  const result = spawnSync('node', ['scripts/greenfield-guard.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"ok": true/u);
});
