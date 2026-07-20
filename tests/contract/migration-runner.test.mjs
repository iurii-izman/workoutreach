import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = decodeURIComponent(new URL('../../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const runner = await readFile(`${root}/docker/postgres/migrate.sh`, 'utf8');
const registryMigration = await readFile(`${root}/migrations/010_immutable_migration_registry.sql`, 'utf8');

test('migration runner serializes, skips and checksum-pins applied versions', () => {
  assert.match(runner, /pg_advisory_lock/u);
  assert.match(runner, /sha256sum/u);
  assert.match(runner, /Skipping applied migration/u);
  assert.match(runner, /Migration checksum mismatch/u);
  assert.match(runner, /absent from this checkout/u);
});

test('migration registry stores constrained SHA-256 values', () => {
  assert.match(registryMigration, /ADD COLUMN IF NOT EXISTS checksum_sha256 char\(64\)/u);
  assert.match(registryMigration, /\^\[0-9a-f\]\{64\}\$/u);
  assert.match(registryMigration, /010_immutable_migration_registry/u);
});
