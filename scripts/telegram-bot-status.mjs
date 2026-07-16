import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

try {
  const status = JSON.parse(await readFile(join(root, '.runtime/telegram-bot-status.json'), 'utf8'));
  const alive = processAlive(status.pid);
  const heartbeatAgeSeconds = Math.max(0, Math.round((Date.now() - Date.parse(status.heartbeat_at)) / 1000));
  const healthy = alive && status.status === 'running' && heartbeatAgeSeconds <= 45;
  console.log(JSON.stringify({
    ok: healthy,
    process_alive: alive,
    status: status.status,
    heartbeat_age_seconds: heartbeatAgeSeconds,
    mode: status.mode,
    mail_transport: status.mail_transport,
  }, null, 2));
  if (!healthy) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ ok: false, process_alive: false, status: 'not_started' }, null, 2));
  process.exitCode = 1;
}
