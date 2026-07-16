import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listRepoEntries, isInside } from './lib/repo-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootReal = await realpath(root);
const errors = [];
const policyAllowlist = new Set([
  'TECHNICAL_SPEC.md', 'AGENTS.md', 'docs/adr/0001-strict-greenfield.md',
  'docs/source-provenance.md', 'scripts/greenfield-guard.mjs',
  'tests/security/greenfield.test.mjs',
]);

const entries = await listRepoEntries(root);
for (const entry of entries) {
  if (!isInside(rootReal, entry.resolved)) errors.push(`external path: ${entry.relative}`);
  if (entry.stat.isSymbolicLink()) errors.push(`symlink/junction: ${entry.relative}`);
}

try {
  await access(join(root, '.gitmodules'), constants.F_OK);
  errors.push('.gitmodules is forbidden');
} catch {}

for (const entry of entries.filter((item) => item.stat.isFile() && /(?:package(?:-lock)?\.json|compose\.ya?ml)$/u.test(item.relative))) {
  const text = await readFile(entry.path, 'utf8');
  if (/"(?:file|link):[^"\n]+"/iu.test(text)) errors.push(`path dependency: ${entry.relative}`);
  if (/^\s*-\s*(?:[A-Za-z]:[\\/]|\/{1,2}[^/])/mu.test(text)) errors.push(`absolute bind mount: ${entry.relative}`);
}

for (const entry of entries.filter((item) => item.stat.isFile() && !policyAllowlist.has(item.relative))) {
  const text = await readFile(entry.path).catch(() => Buffer.alloc(0));
  if (text.includes(0)) continue;
  const value = text.toString('utf8');
  if (/C:[\\/]Dev[\\/]coldmails/iu.test(value)) errors.push(`donor absolute path: ${entry.relative}`);
  if (/\bcoldmails\b/iu.test(value)) errors.push(`legacy namespace: ${entry.relative}`);
}

const rootCommit = spawnSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const rootFiles = spawnSync('git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', rootCommit], { cwd: root, encoding: 'utf8' }).stdout.trim().split(/\r?\n/u).filter(Boolean);
if (rootFiles.length !== 1 || rootFiles[0] !== 'TECHNICAL_SPEC.md') errors.push(`root commit files: ${rootFiles.join(',')}`);

if (errors.length) {
  console.error(JSON.stringify({ gate: 'greenfield', ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ gate: 'greenfield', ok: true, checkedEntries: entries.length, rootCommit }, null, 2));
