import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('docker', ['compose', 'ps', 'workoutreach-dashboard', 'workoutreach-postgres', 'workoutreach-proxy'], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(result.stdout);
console.log(JSON.stringify({ ok: true, url: 'https://dashboard.workoutreach.localhost' }));
