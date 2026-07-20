import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const start = await readFile(`${root}/scripts/start-local-stage2.ps1`, 'utf8');
const ensure = await readFile(`${root}/scripts/ensure-local-workflows.ps1`, 'utf8');
const importer = await readFile(`${root}/scripts/import-workflows.ps1`, 'utf8');

test('local startup imports only a complete inactive workflow set', () => {
  assert.match(start, /ensure-local-workflows\.ps1/u);
  assert.match(ensure, /N8N_WORKFLOW_SET_PARTIAL/u);
  assert.match(ensure, /action = 'imported_inactive'/u);
  assert.match(ensure, /AddSeconds\(90\)/u);
});

test('workflow import is rooted and uses the explicit local compose pair', () => {
  assert.match(importer, /Set-Location -LiteralPath \$root/u);
  assert.match(importer, /'compose', '-f', 'compose\.yaml', '-f', 'compose\.local\.yaml'/u);
  assert.match(importer, /validate-workflows\.mjs/u);
});
