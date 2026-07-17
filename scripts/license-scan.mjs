import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const allowed = new Set(['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BlueOak-1.0.0']);
const reviewed = [];
const rejected = [];
for (const [path, value] of Object.entries(lock.packages ?? {})) {
  if (!path || !value.version) continue;
  const licenses = String(value.license ?? '').split(/\s+(?:OR|AND)\s+/u);
  const record = { package: path.replace(/^node_modules\//u, ''), version: value.version, license: value.license ?? 'UNKNOWN' };
  (licenses.every((license) => allowed.has(license.replace(/[()]/gu, ''))) ? reviewed : rejected).push(record);
}
if (rejected.length) {
  console.error(JSON.stringify({ gate: 'license-scan', ok: false, rejected }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ gate: 'license-scan', ok: true, reviewed: reviewed.length, containerReview: 'docs/dependency-inventory.md' }, null, 2));
