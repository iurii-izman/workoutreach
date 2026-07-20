import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('docker', ['compose', 'stop', 'workoutreach-dashboard'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ ok: true, volumes_removed: false }));
