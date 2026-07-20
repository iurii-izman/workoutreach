import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createPasswordHash } from '../dashboard/auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secrets = join(root, '.secrets');

async function hiddenPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Dashboard setup requires an interactive terminal');
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = '';
  return new Promise((resolvePrompt, reject) => {
    const onKey = (_text, key) => {
      if (key?.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Setup cancelled'));
      } else if (key?.name === 'return') {
        cleanup();
        process.stdout.write('\n');
        resolvePrompt(value);
      } else if (key?.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (_text && !key?.ctrl && !key?.meta) {
        value += _text;
      }
    };
    const cleanup = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on('keypress', onKey);
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, LIVE_SEND_ENABLED: 'false' } });
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status ?? 1}`);
}

await mkdir(secrets, { recursive: true, mode: 0o700 });
const password = await hiddenPrompt('Новый пароль dashboard (минимум 12 символов): ');
const confirmation = await hiddenPrompt('Повторите пароль: ');
if (password !== confirmation) throw new Error('Пароли не совпадают');
const passwordHash = await createPasswordHash(password);

async function ensureRandomSecret(name, bytes) {
  const path = join(secrets, name);
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (Buffer.byteLength(existing) < 32) throw new Error(`${name} is invalid`);
    await chmod(path, 0o600);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(path, `${randomBytes(bytes).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  }
}

await ensureRandomSecret('dashboard_db_password', 32);
await ensureRandomSecret('dashboard_session_secret', 48);
await writeFile(join(secrets, 'dashboard_password_hash'), `${passwordHash}\n`, { mode: 0o600 });
await chmod(join(secrets, 'dashboard_password_hash'), 0o600);

run('docker', ['compose', 'up', '-d', 'workoutreach-postgres']);
run('node', ['scripts/dashboard-backup.mjs']);
run('docker', ['compose', '--profile', 'tools', 'run', '--rm', 'workoutreach-dashboard-provision']);
run('docker', ['compose', '--profile', 'tools', 'run', '--rm', 'workoutreach-migrate']);
run('docker', ['compose', 'up', '-d', '--build', 'workoutreach-dashboard', 'workoutreach-proxy']);
console.log(JSON.stringify({ ok: true, url: 'https://dashboard.workoutreach.localhost', password_stored: false, secrets_logged: false }));
